import logging
import simplejson as json
import re
from functools import reduce
from decimal import Decimal
from django.conf import settings
from django.db import connection
from django.shortcuts import render
from django.http import HttpResponse
from django.views.decorators.csrf import ensure_csrf_cookie
from grin_app.ensure_nocache import ensure_nocache

# SRID 4326 is WGS 84 long lat unit=degrees, also the specification of the
# geoometric_coord field in the grin_accessions table.
SRID = 4326
DEFAULT_LIMIT = 200
TWO_PLACES = Decimal('0.01')
ACCESSION_TAB = 'lis_germplasm.grin_accession'
ACC_SELECT_COLS = (
    'gid', 'taxon', 'latdec', 'longdec', 'accenumb', 'elevation', 'cropname',
    'collsite', 'acqdate', 'origcty'
)
# Brewer nominal category colors from chroma.js set1,2,3 concatenated:
NOMINAL_COLORS = [
    "#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00", "#ffff33",
    "#a65628", "#f781bf", "#999999", "#66c2a5", "#fc8d62", "#8da0cb",
    "#e78ac3", "#a6d854", "#ffd92f", "#e5c494", "#b3b3b3", "#8dd3c7",
    "#ffffb3", "#bebada", "#fb8072", "#80b1d3", "#fdb462", "#b3de69",
    "#fccde5", "#d9d9d9", "#bc80bd", "#ccebc5", "#ffed6f"
]
NOMINAL_THRESHOLD = 10
DEFAULT_COLOR = 'lightgrey'
ORDER_BY_FRAG = '''
 ORDER BY ST_Distance(
  geographic_coord::geography,
  ST_Centroid(
   ST_MakeEnvelope(%(minx)s, %(miny)s, %(maxx)s, %(maxy)s, %(srid)s)
  )
 ) ASC, taxon, gid
'''
LIMIT_FRAG = 'LIMIT %(limit)s'
COUNTRY_REGEX = re.compile(r'[a-z]{3}', re.I)
TAXON_FTS_BOOLEAN_REGEX = re.compile(r'^(\w+\s*[\||&]\s*\w+)+$')

logger = logging.getLogger(__name__)

GRIN_ACC_WHERE_FRAGS = {
    'fts': {
        'include': lambda p: TAXON_FTS_BOOLEAN_REGEX.match(
                                p.get('taxon_query', '')),
        'sql': "taxon_fts @@ to_tsquery('english', %(taxon_query)s)",
    },
    'fts_simple': {
        'include': lambda p: p.get('taxon_query', None) and not
                                GRIN_ACC_WHERE_FRAGS['fts']['include'](p),
        'sql': "taxon_fts @@ plainto_tsquery('english', %(taxon_query)s)",
    },
    'country': {
        'include': lambda p: p.get('country', None),
        'sql': 'origcty = %(country)s',
    },
    'geocoded_only': {
        'include': lambda p: p.get('limit_geo_bounds', None) in (
            True, 'true') or p.get('geocoded_only', None) in (True, 'true'),
        'sql': 'latdec <> 0 AND longdec <> 0',
    },
    'limit_geo_bounds': {
        'include': lambda p: p.get('limit_geo_bounds', None) in (True, 'true'),
        'sql': '''
           latdec <> 0 AND longdec <> 0 AND
           ST_Contains(
            ST_MakeEnvelope(%(minx)s, %(miny)s, %(maxx)s, %(maxy)s, %(srid)s),
            geographic_coord::geometry
           )''',
    },
}

GRIN_EVAL_WHERE_FRAGS = {
    'descriptor_name': {
        'include': lambda p: p.get('descriptor_name', None),
        'sql': 'descriptor_name = %(descriptor_name)s',
    },
    'accession prefix': {
        'include': lambda p: p.get('prefix', None),
        'sql': 'accession_prefix = %(prefix)s',
    },
    'accession number': {
        'include': lambda p: p.get('acc_num', None),
        'sql': 'accession_number = %(acc_num)s',
    },
    'accession surfix': {
        'include': lambda p: p.get('suffix', None),
        'sql': 'accession_surfix = %(suffix)s',
    },
}


@ensure_csrf_cookie
@ensure_nocache
def index(req):
    """Render the index template, which will boot up angular-js.
    """
    return render(req, 'grin_app/index.html', context=settings.BRANDING)


@ensure_csrf_cookie
@ensure_nocache
def evaluation_descr_names(req):
    """Return JSON for all distinct trait descriptor names matching the
    given taxon. (the trait overlay choice is only available after a
    taxon is selected). Join on the grin_accession table to use the
    FTS index on taxon there.
    """
    assert req.method == 'GET', 'GET request method required'
    params = req.GET.dict()
    assert 'taxon' in params, 'missing taxon param'
    assert params['taxon'], 'empty taxon param'
    params['taxon_query'] = params['taxon']
    where_clauses = [
        val['sql'] for key, val in GRIN_ACC_WHERE_FRAGS.items()
        if val['include'](params)
        ]
    if len(where_clauses) == 0:
        where_sql = ''
    else:
        where_sql = 'WHERE %s' % ' AND '.join(where_clauses)
    sql = '''
    SELECT DISTINCT descriptor_name
    FROM lis_germplasm.legumes_grin_evaluation_data
    JOIN lis_germplasm.grin_accession
    USING (accenumb)
    %s
    ORDER BY descriptor_name
    ''' % where_sql
    sql_params = {'taxon_query': params['taxon']}
    cursor = connection.cursor()
    # logger.info(cursor.mogrify(sql, sql_params))
    cursor.execute(sql, sql_params)
    names = [row[0] for row in cursor.fetchall()]
    result = json.dumps(names)
    response = HttpResponse(result, content_type='application/json')
    return response


@ensure_csrf_cookie
@ensure_nocache
def evaluation_search(req):
    """Return JSON array of observation_value for all trait records
    matching a set of accession ids, and matching the descriptor_name
    field. Used for creating map markers or map overlays with specific
    accesions' trait data.
    """
    assert req.method == 'POST', 'POST request method required'
    params = json.loads(req.body)
    assert 'accession_ids' in params, 'missing accession_ids param'
    assert 'descriptor_name' in params, 'missing descriptor_name param'
    sql = '''
    SELECT accenumb, descriptor_name, observation_value
     FROM lis_germplasm.legumes_grin_evaluation_data
     WHERE descriptor_name = %(descriptor_name)s 
     AND accenumb IN %(accession_ids)s
    '''
    sql_params = {
        'descriptor_name': params['descriptor_name'],
        'accession_ids': tuple(params['accession_ids'])
    }
    cursor = connection.cursor()
    # logger.info(cursor.mogrify(sql, sql_params))
    cursor.execute(sql, sql_params)
    rows = _dictfetchall(cursor)
    # observation_value is a string field, so cast to int or float as necessary
    rows_clean = []
    for row in rows:
        row['observation_value'] = _string2num(row['observation_value'])
        rows_clean.append(row)
    result = json.dumps(rows_clean, use_decimal=True)
    response = HttpResponse(result, content_type='application/json')
    return response


def _string2num(s):
    """
    Convert a string to int or float if possible.
    """
    try:
        return int(s)
    except ValueError:
        pass
    try:
        return float(s)
    except ValueError:
        pass
    return s


@ensure_csrf_cookie
@ensure_nocache
def evaluation_metadata(req):
    """Return JSON with trait metadata for the given taxon and trait
    descriptor_name. This enables the client to display a legend, and
    colorize accessions by either numeric or category traits.
    """
    assert req.method == 'POST', 'POST request method required'
    params = json.loads(req.body)
    assert 'taxon' in params, 'missing taxon param'
    assert 'descriptor_name' in params, 'missing descriptor_name param'
    assert 'trait_scale' in params, 'missing trait_scale param'
    assert 'accession_ids' in params, 'missing accession_ids param'
    assert params['taxon'], 'empty taxon param'
    result = None
    cursor = connection.cursor()
    # full text search on the taxon field in accessions table, also
    # joining on taxon to get relevant evaluation metadata.
    sql_params = {
        'taxon_query': params['taxon'],
        'descriptor_name': params['descriptor_name']
    }
    where_clauses = [
        val['sql'] for
        key, val in {**GRIN_ACC_WHERE_FRAGS, **GRIN_EVAL_WHERE_FRAGS}.items()
        if val['include'](sql_params)
        ]
    if len(where_clauses) == 0:
        where_sql = ''
    else:
        where_sql = 'WHERE %s' % ' AND '.join(where_clauses)
    sql = '''
    SELECT DISTINCT taxon, descriptor_name, obs_type, obs_min, obs_max, 
           obs_nominal_values
    FROM lis_germplasm.grin_evaluation_metadata
    JOIN lis_germplasm.grin_accession
    USING (taxon)
    %s
    ''' % where_sql
    # logger.info(cursor.mogrify(sql, sql_params))
    cursor.execute(sql, sql_params)
    trait_metadata = _dictfetchall(cursor)
    if len(trait_metadata) == 0:
        # early out if there were no matching metadata records
        return HttpResponse({}, content_type='application/json')

    obs_type = trait_metadata[0]['obs_type']
    if obs_type == 'numeric':
        if params['trait_scale'] == 'local':
            # must perform another query to restrict observations to this
            # set of accessions (local, not global)
            sql = '''
            SELECT observation_value 
            FROM lis_germplasm.legumes_grin_evaluation_data
            WHERE accenumb IN %(accession_ids)s
            AND descriptor_name = %(descriptor_name)s
            '''
            sql_params = {
                'descriptor_name': params['descriptor_name'],
                'accession_ids': tuple(params['accession_ids'])
            }
            # logger.info(cursor.mogrify(sql, sql_params))
            cursor.execute(sql, sql_params)
            obs_values = [_string2num(row[0]) for row in cursor.fetchall()]
            result = {
                'taxon_query': params['taxon'],
                'descriptor_name': params['descriptor_name'],
                'trait_type': 'numeric',
                'min': min(obs_values) if obs_values else 0,
                'max': max(obs_values) if obs_values else 0,
            }
        elif params['trait_scale'] == 'global':
            mins = [rec['obs_min'] for rec in trait_metadata]
            maxes = [rec['obs_max'] for rec in trait_metadata]
            result = {
                'taxon_query': params['taxon'],
                'descriptor_name': params['descriptor_name'],
                'trait_type': 'numeric',
                'min': reduce(lambda x, y: x + y, mins) / len(mins),
                'max': reduce(lambda x, y: x + y, maxes) / len(maxes),
            }
    elif obs_type == 'nominal':
        vals = set()
        for rec in trait_metadata:
            vals |= set(rec['obs_nominal_values'])
        num_preset_colors = len(NOMINAL_COLORS)
        colors = {}
        for i, val in enumerate(vals):
            if i < num_preset_colors:
                colors[val] = NOMINAL_COLORS[i]
            else:
                colors[val] = DEFAULT_COLOR
        result = {
            'taxon_query': params['taxon'],
            'descriptor_name': params['descriptor_name'],
            'trait_type': 'nominal',
            'obs_nominal_values': sorted(vals),
            'colors': colors,
        }
    response = HttpResponse(json.dumps(result, use_decimal=True),
                            content_type='application/json')
    return response


@ensure_csrf_cookie
@ensure_nocache
def evaluation_detail(req):
    """Return JSON for all evalation/trait records matching this accession id.
    """
    assert req.method == 'GET', 'GET request method required'
    params = req.GET.dict()
    assert 'accenumb' in params, 'missing accenumb param'
    prefix = ''
    acc_num = ''
    suffix = ''
    parts = params['accenumb'].split()
    parts_len = len(parts)
    if parts_len > 2:
        prefix, acc_num, rest = parts[0], parts[1], parts[2:]  # suffix optional
        suffix = ' '.join(rest)
    elif parts_len == 2:
        prefix, acc_num = parts[0], parts[1]
    elif parts_len == 1:
        acc_num = parts[0]
    else:
        acc_num = params['accenumb']
    cursor = connection.cursor()
    sql_params = {
        'prefix': prefix,
        'acc_num': acc_num,
        'suffix': suffix,
    }
    where_clauses = [
        val['sql'] for key, val in GRIN_EVAL_WHERE_FRAGS.items()
        if val['include'](sql_params)
        ]
    where_sql = ' AND '.join(where_clauses)
    sql = '''
    SELECT accession_prefix,
           accession_number,
           accession_surfix,
           observation_value,
           descriptor_name,
           method_name,
           plant_name,
           taxon,
           origin,
           original_value,
           frequency,
           low,
           hign,
           mean,
           sdev,
           ssize,
           inventory_prefix,
           inventory_number,
           inventory_suffix,
           accession_comment
    FROM lis_germplasm.legumes_grin_evaluation_data
    WHERE %s
    ORDER BY descriptor_name
    ''' % where_sql
    # logger.info(cursor.mogrify(sql, sql_params))
    cursor.execute(sql, sql_params)
    rows = _dictfetchall(cursor)
    result = json.dumps(rows, use_decimal=True)
    response = HttpResponse(result, content_type='application/json')
    return response


@ensure_csrf_cookie
@ensure_nocache
def accession_detail(req):
    """Return JSON for all columns for a accession id."""
    assert req.method == 'GET', 'GET request method required'
    params = req.GET.dict()
    assert 'accenumb' in params, 'missing accenumb param'
    # fix me: name the columns dont select *!
    sql = '''
    SELECT * FROM lis_germplasm.grin_accession WHERE accenumb = %(accenumb)s
    '''
    cursor = connection.cursor()
    # logger.info(cursor.mogrify(sql, params))
    cursor.execute(sql, params)
    rows = _dictfetchall(cursor)
    return _acc_search_response(rows)


@ensure_csrf_cookie
@ensure_nocache
def countries(req):
    """Return a json array of countries for search filtering ui.
    """
    cursor = connection.cursor()
    sql = '''
    SELECT DISTINCT origcty FROM lis_germplasm.grin_accession ORDER by origcty
    '''
    cursor.execute(sql)
    # flatten into array, filter out bogus records like '' or 3 number codes
    results = [row[0] for row in cursor.fetchall()
               if row[0] and COUNTRY_REGEX.match(row[0])]
    return HttpResponse(json.dumps(results), content_type='application/json')


@ensure_csrf_cookie
@ensure_nocache
def search(req):
    """Search by map bounds and return GeoJSON results."""
    assert req.method == 'POST', 'POST request method required'
    params = json.loads(req.body)
    # logger.info(params)
    if 'limit' not in params:
        params['limit'] = DEFAULT_LIMIT
    else:
        params['limit'] = int(params['limit'])
    where_clauses = [
        val['sql'] for key, val in GRIN_ACC_WHERE_FRAGS.items()
        if val['include'](params)
        ]
    if len(where_clauses) == 0:
        where_sql = ''
    else:
        where_sql = 'WHERE (%s)' % ' AND '.join(where_clauses)
    cols_sql = ' , '.join(ACC_SELECT_COLS)
    sql = '''SELECT %s FROM %s %s %s %s''' % (
        cols_sql,
        ACCESSION_TAB,
        where_sql,
        ORDER_BY_FRAG,
        LIMIT_FRAG
    )
    cursor = connection.cursor()
    sql_params = {
        'taxon_query': params.get('taxon_query', None),
        'country': params.get('country', None),
        'minx': float(params.get('sw_lng', 0)),
        'miny': float(params.get('sw_lat', 0)),
        'maxx': float(params.get('ne_lng', 0)),
        'maxy': float(params.get('ne_lat', 0)),
        'limit': params['limit'],
        'srid': SRID,
    }
    # logger.info(cursor.mogrify(sql, sql_params))
    cursor.execute(sql, sql_params)
    rows = _dictfetchall(cursor)

    # when searching for a set of accessionIds, the result needs to
    # either get merged in addition to the SQL LIMIT results, or just
    # returned instead
    if params.get('accession_ids', None):
        if ',' in params['accession_ids']:
            sql_params = {'accession_ids': params['accession_ids'].split(',')}
        else:
            sql_params = {'accession_ids': [params['accession_ids']]}
        where_sql = 'WHERE accenumb = ANY( %(accession_ids)s )'
        sql = 'SELECT %s FROM %s %s' % (
            cols_sql,
            ACCESSION_TAB,
            where_sql
        )
        cursor.execute(sql, sql_params)
        rows_with_requested_accessions = _dictfetchall(cursor)
        if params.get('accession_ids_inclusive', None):
            # merge results with previous set
            uniq = set()

            def is_unique(r):
                k = r.get('accenumb', None)
                if k in uniq:
                    return False
                uniq.add(k)
                return True

            rows = [row for row in rows_with_requested_accessions + rows
                    if is_unique(row)]
        else:
            # simple replace with these results
            rows = rows_with_requested_accessions
    return _acc_search_response(rows)


def _acc_search_response(rows):
    geo_json = []
    # logger.info('results: %d' % len(rows))
    for rec in rows:
        # fix up properties which are not json serializable
        if rec.get('acqdate', None):
            rec['acqdate'] = str(rec['acqdate'])
        else:
            rec['acqdate'] = None
        if rec.get('colldate', None):
            rec['colldate'] = str(rec['colldate'])
        else:
            rec['colldate'] = None
        # geojson can have null coords, so output this for
        # non-geocoded search results (e.g. full text search w/ limit
        # to current map extent turned off
        if rec.get('longdec', 0) == 0 and rec.get('latdec', 0) == 0:
            coords = None
        else:
            lat = Decimal(rec['latdec']).quantize(TWO_PLACES)
            lng = Decimal(rec['longdec']).quantize(TWO_PLACES)
            coords = [lng, lat]
            del rec['latdec']  # have been translated into geojson coords, 
            del rec['longdec']  # so these keys are extraneous now.
        geo_json_frag = {
            'type': 'Feature',
            'geometry': {
                'type': 'Point',
                'coordinates': coords
            },
            'properties': rec  # rec happens to be a dict of properties. yay
        }
        # tag this accession with something to distinguish it from
        # user provided accession ids
        geo_json_frag['properties']['from_api'] = True

        geo_json.append(geo_json_frag)
    result = json.dumps(geo_json, use_decimal=True)
    response = HttpResponse(result, content_type='application/json')
    return response


def _dictfetchall(cursor):
    """Return all rows from a cursor as a dict"""
    columns = [col[0] for col in cursor.description]
    return [
        dict(zip(columns, row))
        for row in cursor.fetchall()
        ]
