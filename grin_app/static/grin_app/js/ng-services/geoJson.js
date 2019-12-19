 "use strict";

app.service('geoJsonService',
    function ($http, $rootScope, $location, $timeout, $q,
              $localStorage, $uibModal, $controller) {

      //var DEFAULT_CENTER = {'lat': 35.87, 'lng': -109.47};
      // better default for arachis
      var DEFAULT_CENTER = { 'lat' : -2.17, 'lng' : -79.38 };
      
        var MAX_RECS = 200;
        var DEFAULT_ZOOM = 6;
        var MARKER_RADIUS = 8;
        var MAX_URL = 2000;
        var DEFAULT_TRAIT = '(default)';
        var TRAIT_TYPE = {
            NOMINAL : 'nominal',
            NUMERIC : 'numeric',
            HYBRID : 'hybrid',
        };

        // Brewer nominal category colors from chroma.js set1,2,3 concatenated/
        // this code is duplicated from views.py -> evaluation_metadata()
        var NOMINAL_COLORS = [
            "#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00", "#ffff33",
            "#a65628", "#f781bf", "#999999", "#66c2a5", "#fc8d62", "#8da0cb",
            "#e78ac3", "#a6d854", "#ffd92f", "#e5c494", "#b3b3b3", "#8dd3c7",
            "#ffffb3", "#bebada", "#fb8072", "#80b1d3", "#fdb462", "#b3de69",
            "#fccde5", "#d9d9d9", "#bc80bd", "#ccebc5", "#ffed6f"
        ];

        var s = {}; // service/singleton we will construct & return
        s.DEFAULT_TRAIT = DEFAULT_TRAIT;
        s.updating = false;
        s.data = []; // an array of geoJson features
        s.sortedHeaders = [];
        s.selectedAccession = null; // single accession object currently select.

        s.traitData = []; // an array of json with observation_values
        s.traitHash = {}; // lookup hash for accenumb to array of obs. values
        s.traitMetadata = {};
        s.traitLegend = {}; // all the info for map.js to build a legend

        s.map = null; // the leaflet map, Note: this belongs to
                      // mapController! don't update the map within in this
                      // service.
        s.bounds = L.latLngBounds(L.latLng(0, 0), L.latLng(0, 0));

        // array of event names we are publishing
        s.events = [
            'updated',
            'willUpdate',
            'selectedAccessionUpdated',
            'accessionIdsUpdated',
            'taxonUpdated',
            'traitOverlayUpdated'
        ];

        // userData controller may set this descriptor_name for the edge case
        // where the user provided accession ids, but did not specifify the
        // taxon of the accessions in their data sets.
        s.bootSearchTaxonForTraitDescriptor = null;

        s.init = function () {

            // set default search values on $location service
            s.params = getSearchParams();

            if (!('zoom' in s.params)) {
                $location.search('zoom', DEFAULT_ZOOM);
            }
            if (!('maxRecs' in s.params)) {
                $location.search('maxRecs', MAX_RECS);
            }
            if (!('taxonQuery' in s.params)) {
                $location.search('taxonQuery', '');
            }
            if (!('traitOverlay' in s.params)) {
                $location.search('traitOverlay', '');
            }
            if (!('traitScale' in s.params)) {
                $location.search('traitScale', 'global');
            }
            if (!('country' in s.params)) {
                $location.search('country', '');
            }
            if (!('geocodedOnly' in s.params)) {
                $location.search('geocodedOnly', false);
            }
            if (!('traitExcludeUnchar' in s.params)) {
                $location.search('traitExcludeUnchar', false);
            }
            if (!('limitToMapExtent' in s.params) &&
                !('accessionIds' in s.params)) {
                $location.search('limitToMapExtent', true);
            }
            if (!('lng' in s.params)) {
                $location.search('lat', DEFAULT_CENTER.lat);
                $location.search('lng', DEFAULT_CENTER.lng);
            }

            if('userDataURL' in s.params) {
                $timeout(preProcessUserData);
            }

            // store updated search params in property of service, for ease of
            // use by controllers and views.
            s.params = getSearchParams();
        };

        s.showAllNearbySameTaxon = function () {
            var acc = s.data[0];
            var taxon = acc.properties.taxon;
            s.setAccessionIds(null, false);
            s.setLimitToMapExtent(true, false);
            s.setTaxonQuery(taxon, false);
            s.map.setZoom(DEFAULT_ZOOM);
        };

        s.showAllNearby = function () {
            s.setAccessionIds(null, false);
            s.setLimitToMapExtent(true, false);
            s.setTaxonQuery(null, false);
            s.map.setZoom(DEFAULT_ZOOM);
        };

        s.getBoundsOfGeoJSONPoints = function () {
            var boundsArr = [];
            _.each(s.data, function (d) {
                if (d.geometry.coordinates) {
                    // convert from geojson simple coords to leafletjs simple coords
                    boundsArr.push([d.geometry.coordinates[1],
                        d.geometry.coordinates[0]]);
                }
            });
            return new L.LatLngBounds(boundsArr);
        };

        /* preProcessUserData() : if userDataURL was in the search parameters
         * (URL query string) and the data set is not in local storage, attempt
         * to fetch it and parse it into localstorage (same as if user had
         * manually loaded it via the 'Add my data' tool. */
        function preProcessUserData() {
            var params = s.params;
            if(!('userDataURL' in params)) {
                return;
            }
            var dataSetName = params.userDataName;
            if($localStorage.userData && $localStorage.userData[dataSetName]) {
                // is appears this data set is already loaded.
                return;
            }
            var url = params.userDataURL;
            var setName = params.userDataName;
            var scope = {};
            var controller = $controller('userDataController', {
                '$scope' : scope,
                '$localStorage': $localStorage,
                '$uibModalInstance' : null,
                '$http': $http,
                '$timeout': $timeout,
                geoJsonService: s,
                model: {
                    BRANDING: BRANDING,
                    STATIC_PATH: STATIC_PATH,
                    fileURL: url,
                    dataSetName : setName,
                }
            });
            var cb = function() {
                scope.onOK();
            };
            scope.onLoadURL(url, cb);
        }

        /* postProcessSearch() : */
        function postProcessSearch() {
            if ($localStorage.userGeoJson) {
                // merge results with user provided data, if any
               mergeUserGeoJson();
               mergeUserTraitJson();
            }
            if(! _.isEmpty(s.bootSearchTaxonForTraitDescriptor) &&
               ! _.isEmpty(s.params.accessionIds) &&
               ! _.isEmpty(s.data)) {
                // extract the taxon from the first accession in the search
                // results (assuming that userData controller has set
                // the list of accession ids), then search again.
                var acc = s.data[0];
                var taxon = acc.properties.taxon;
                s.bootSearchTaxonForTraitDescriptor = null;
                $timeout(function() {
                    s.setTaxonQuery(taxon, true);
                });
                return;
            }
            s.updateBounds();
            s.updateColors();
            // setSelectedAccession will order the search results so the sel. is
            // in first position.
            s.setSelectedAccession(s.selectedAccession);
            s.updating = false;
            notify('updated');
        }

        /* onUserData() -- display the modal dialog for user provided data. */
        s.onUserData = function() {
          var modal = $uibModal.open({
                animation: true,
                templateUrl: STATIC_PATH + 'grin_app/partials/user-data-modal.html',
                controller: 'userDataController',
                size: 'lg',
                resolve: {
                    model: {
                        BRANDING: BRANDING,
                        STATIC_PATH: STATIC_PATH
                    }
                }
            });
        };

        s.search = function () {
            if(s.updating) {
                $timeout(function() {
                    s.updating = false;
                });
                return;
            }

            s.updating = true;
            s.data = [];
            s.traitData = [];
            s.traitHash = {};
            s.traitMetadata = {};

            // s.params will be used by various templates and controllers,
            // so refresh it upon every search
            s.params = getSearchParams();
            if(window.location.href.length > MAX_URL) {
                $rootScope.warnings.push('Warning: location.href is exceeding '+
                    'recommended length (2k): ' + window.location.href.length);
            }

            $http({
                // POST should never be cached, but append a unique query 
                // string to the url anyways.
                url: API_PATH + '/search?v=' + new Date().getTime(),
                method: 'POST',
                data: {
                    taxon_query: s.params.taxonQuery,
                    ne_lat: s.bounds._northEast.lat,
                    ne_lng: s.bounds._northEast.lng,
                    sw_lat: s.bounds._southWest.lat,
                    sw_lng: s.bounds._southWest.lng,
                    limit_geo_bounds: parseBool(s.params.limitToMapExtent),
                    geocoded_only: s.params.geocodedOnly,
                    country: s.params.country,
                    accession_ids: s.params.accessionIds,
                    accession_ids_inclusive: parseBool(s.params.accessionIdsInclusive),
                    trait_overlay: s.params.traitOverlay,
                    limit: s.params.maxRecs,
                }
            }).then(
                function (resp) {
                    // success handler;
                    s.data = resp.data;
                    if (s.data.length === 0 && s.params.geocodedOnly) {
                        /* retry search with geocodedOnly off (to support edge case
                         e.g. when searching by some countries which only have
                         non-geographic accessions. */
                        s.setGeocodedAccessionsOnly(false, true);
                        return;
                    }
                    if (! _.isEmpty(s.params.taxonQuery) &&
                        ! _.isEmpty(s.params.traitOverlay) &&
                        ! _.isEmpty(s.data)) {
                        var promise1 = $http({
                            // POST should never be cached, but append a 
                            // unique query string to the url anyways.
                            url: API_PATH + '/evaluation_search?v=' + new Date().getTime(),
                            method: 'POST',
                            data: {
                                accession_ids: s.getAccessionIds(),
                                descriptor_name: s.params.traitOverlay,
                            }
                        }).then(
                            function (resp) {
                                // success handler
                                s.traitData = resp.data;
                            },
                            function (resp) {
                                // error handler
                                console.log(resp);
                            }
                        );
                        var promise2 = $http({
                            url: API_PATH + '/evaluation_metadata',
                            method: 'POST',
                            data: {
                                taxon: s.params.taxonQuery,
                                descriptor_name: s.params.traitOverlay,
                                accession_ids: (s.params.traitScale === 'local') ? s.getAccessionIds() : [],
                                trait_scale: s.params.traitScale,                                
                            }
                        }).then(
                            function (resp) {
                                // success handler
                                s.traitMetadata = resp.data || {};
                            },
                            function (resp) {
                                // error handler
                                console.log(resp);
                            }
                        );
                        $q.all([promise1, promise2]).then(postProcessSearch);
                    }
                    else {
                        postProcessSearch();
                    }
                },
                function (resp) {
                    // error handler
                    console.log('Error:');
                    console.log(resp);
                });
        };

        /* return array an of accession ids in the current geojson data set. */
        s.getAccessionIds = function () {
            return _.map(s.data, function (d) {
                return d.properties.accenumb;
            });
        };

        /* return a shallow copy of $location.search() object, merging in
         properties for any local storage params, e.g. accessionIds which
         have overflowed the limit for URL param. */
         function getSearchParams() {
            var params = $location.search(); // get search dictionary (no params)
            // url query string overrides anything in localStorage
            if (params.accessionIds) {
                delete $localStorage.accessionIds;
            }
            var merged = {};
            angular.extend(merged, params);
            if ($localStorage.accessionIds) {
                merged.accessionIds = $localStorage.accessionIds;
            }
            // force some parameters to be booleans ($location.search() has
            // the unfortunate feature of being untyped; depending on how data
            // was set
            if ('limitToMapExtent' in merged) {
                merged.limitToMapExtent = parseBool(merged.limitToMapExtent);
            }
            if ('geocodedOnly' in merged) {
                merged.geocodedOnly = parseBool(merged.geocodedOnly);
            }
            if ('traitExcludeUnchar' in merged) {
                merged.traitExcludeUnchar = parseBool(merged.traitExcludeUnchar);
            }
            if ('zoom' in merged) {
                merged.zoom = parseInt(merged.zoom);
            }
            if ('maxRecs' in merged) {
                merged.maxRecs = parseInt(merged.maxRecs);
            }
            if ('mapHeight' in merged) {
                merged.mapHeight = parseInt(merged.mapHeight);
            }
            return merged;
        };

        /* Search for trait descriptors matching this taxon string. Merge in
         * user trait data, if any. Call the callback function with array of
         * allowed descriptors. */
        s.getTraitDescriptors = function(taxon, callback) {
            var postProcess = function(response) {
                var apiDescriptors = response.data;
                var userTraits = $localStorage.userTraitData;
                var userDescriptors = _.map(userTraits, function(d) {
                   return d.descriptor_name;
                });
                var result = _.union(apiDescriptors, _.uniq(userDescriptors));
                result.sort();
                callback(result);
            };
            $http({
                url: API_PATH + '/evaluation_descr_names',
                method: 'GET',
                params: { taxon: taxon, v: new Date().getTime() }
            }).then(postProcess);
        };
        
        /* set one selected accession (may be set by various controllers). */
        s.setSelectedAccession = function (accId) {
            var changed = false;
            var prevAccId = s.selectedAccession;
            var accession = _.find(s.data, function (d) {
                return (d.properties.accenumb === accId);
            });
            if (! accession) {
                // the accession id is not in the current result set, or accId
                // is null, in either case just clear the result
                s.selectedAccession = null;
                changed = (prevAccId !== null);
            }
            else {
                // splice the record to beginning of geoJson dataset, if it's
                // not already at top of list.
                var idx = _.indexOf(s.data, accession);
                if (idx !== -1) {
                    s.data.splice(idx, 1);
                    s.data.splice(0, 0, accession);
                }
                changed = (prevAccId !== accId);
                s.selectedAccession = accId;
            }
            if (changed) {
                notify('selectedAccessionUpdated');
            }
        };

        /* set the bounds of map extent, and save to search parameters */
        s.setBounds = function (bounds, doSearch) {
            if (s.bounds.equals(bounds) && s.data.length > 0) {
                // early out if the bounds is already set to same, and we have results
                return;
            }
            s.bounds = bounds;
            $location.search('ne_lat', s.bounds._northEast.lat);
            $location.search('ne_lng', s.bounds._northEast.lng);
            $location.search('sw_lat', s.bounds._southWest.lat);
            $location.search('sw_lng', s.bounds._southWest.lng);
            s.params = getSearchParams();
            if (doSearch) {
                s.search();
            }
        };

        /* set a country filter for the search. */
        s.setCountry = function (cty, search) {
            $location.search('country', cty);
            s.params = getSearchParams();
            if (search) {
                s.search();
            }
        };

        /* set the max number of records in search results limit. */
        s.setMaxRecs = function (max, search) {
            $location.search('maxRecs', max);
            s.params = getSearchParams();
            if (search) {
                s.search();
            }
        };

        /* set whether to limit the search to the current geographic extent. */
        s.setLimitToMapExtent = function (bool, search) {
            $location.search('limitToMapExtent', bool);
            s.params = getSearchParams();
            if (search) {
                s.search();
            }
        };

        /* set a taxon query string for full-text search by genus or species.*/
        s.setTaxonQuery = function (q, search) {
            $location.search('taxonQuery', q);
            s.params = getSearchParams();
            notify('taxonUpdated');
            if (search) {
                s.search();
            }
        };

        /* set a list of specific accession ids */
        s.setAccessionIds = function (accessionIds, search) {
            // if there 'too many' accessionIds, it *will* overflow the
            // allowed URL length with search parameters, so use localstorage.
            delete $localStorage.accessionIds;
            $location.search('accessionIds', null);
            s.params = getSearchParams();
            if (accessionIds) {
                var ids = accessionIds.split(',');
                if (ids.length <= 10) {
                    // use url query parameter
                    $location.search('accessionIds', accessionIds);
                }
                else {
                    // use local storage api
                    $localStorage.accessionIds = accessionIds;
                }
            }
            notify('accessionIdsUpdated');
            s.initialBoundsUpdated = false;
            if (search) {
                s.search();
            }
        };

        /* set a custom color for the user's list of accessionIds */
        s.setAccessionIdsColor = function (color, search) {
            $location.search('accessionIdsColor', color);
            s.params = getSearchParams();
            if (search) {
                s.search();
            }
        };

        /* set whether to merge other search results in (true), or display
         results exclusively for this set of accession ids. */
        s.setAccessionIdsInclusive = function (bool, search) {
            $location.search('accessionIdsInclusive', bool);
            s.params = getSearchParams();         
            if (search) {
                s.search();
            }
        };

        /* set a trait descriptor_name to display for the taxon query. */
        s.setTraitOverlay = function (trait, search) {
            $location.search('traitOverlay', trait);
            s.params = getSearchParams();
            notify('traitOverlayUpdated');
            if (search) {
                s.search();
            }
        };

        /* set whether to exclude descriptor_name uncharacterized accessions
         from the map display. */
        s.setTraitExcludeUnchar = function (bool, search) {
            $location.search('traitExcludeUnchar', bool);
            s.params = getSearchParams();
            if (search) {
                s.search();
            }
        };

        /* set either local or global trait scale, which effects display of
         min/max values for numeric traits. */
        s.setTraitScale = function (scale, search) {
            $location.search('traitScale', scale);
            s.params = getSearchParams();
            if (search) {
                s.search();
            }
        };

        /* set whether to limit search results to those having geographic coords. */
        s.setGeocodedAccessionsOnly = function (bool, search) {
            $location.search('geocodedOnly', bool);
            s.params = getSearchParams();
            if (search) {
                s.search();
            }
        };

        /* mergeUserGeoJson(): make a dict of all accession ids in search
         * results, check & merge properties if user geojson is overriding any
         * of the accessions. Some of the geoJson coming from userData.js may be
         * invalid, for instance of they did not provide lat/long, then we
         * should default to the lat/long provided by the GRIN accessions. */
        function mergeUserGeoJson() {
            var addAccessions = {};
            var userAccessions = {};
            var allAccessions = {};
            var customizer = function (destProp, srcProp) {
                // allow sourced properties to override destination properties.
                return _.isUndefined(srcProp) ? destProp : destProp;
            };
            var data = s.data;
            _.each(data, function (d) {
                allAccessions[d.properties.accenumb] = d;
            });
            var userData = $localStorage.userGeoJson;
            _.each(userData, function (d) {
                var accId = d.properties.accenumb;
                userAccessions[accId] = d;
                if (allAccessions[accId]) {
                    // user has searched for this accession id already, so
                    // so extend it's props.
                    var src = d.properties;
                    var dst = allAccessions[accId].properties;
                    _.extendWith(dst, src, customizer);
                    // make sure the lat/long are defined, otherwise default
                    // to the GRIN accessions geographic coords.
                    if ((! _.isEmpty(d.geometry.coordinates)) &&
                        d.geometry.coordinates[0]) {
                        allAccessions[accId].geometry.coordinates =
                            d.geometry.coordinates;
                    }
                }
                else {
                    // mark user's accession to add complete collection
                    addAccessions[accId] = d;
                }
            });
            _.each(addAccessions, function (d, accId) {
                data.unshift(d);
            });
            s.data = data;
        }

        /*
         * mergeUserTraitJson(): $localStorage.userTraitData is already in same
         * format as the data received from API for metadata (same as
         * s.traitData). Filter the user trait data to match what is selected in
         * the Search interface, then concat the userTrait data, and then update
         * the trait metadata.
         */
        function mergeUserTraitJson() {
            var traits = $localStorage.userTraitData;
            var selectedTrait = s.params.traitOverlay;
            var selectedUserTraits = _.filter(traits, function(d) {
                return (d.descriptor_name === selectedTrait);
            });
            if(_.isEmpty(selectedUserTraits)) { return; }

            var traitData = _.concat(s.traitData, selectedUserTraits);
            s.traitData = traitData;

            angular.extend(s.traitMetadata, {
                    colors : {},
                    descriptor_name: selectedUserTraits[0].descriptor_name,
                    taxon_query : s.params.taxonQuery
            });

            var traitMetadata = s.traitMetadata;

            // detect the type of trait: numeric, nominal or hybrid (e.g.
            // population study)
            if(selectedUserTraits[0].is_nominal) {
                traitMetadata.trait_type = TRAIT_TYPE.NOMINAL;
                var values = _.map(traitData, function(d) {
                    return d.observation_value;
                });
                var uniqVals = _.uniq(values);
                uniqVals.sort();
                var colorsLen = NOMINAL_COLORS.length;
                for(var i = 0; i< uniqVals.length; i++) {
                    var val = uniqVals[i];
                    traitMetadata.colors[val] = (i < colorsLen)  ?
                        NOMINAL_COLORS[i] : taxonChroma.defaultColor;
                }
                traitMetadata.obs_nominal_values = uniqVals;
            }
            else {
                if(selectedUserTraits[0].sub_descriptor_name) {
                    traitMetadata.trait_type = TRAIT_TYPE.HYBRID;
                    var values = _.map(traitData, function(d) {
                        return d.sub_descriptor_name;
                    });
                    var uniqVals = _.uniq(values);
                    uniqVals.sort();
                    var colorsLen = NOMINAL_COLORS.length;
                    for(var i = 0; i< uniqVals.length; i++) {
                        var val = uniqVals[i];
                        traitMetadata.colors[val] = (i < colorsLen)  ?
                            NOMINAL_COLORS[i] : taxonChroma.defaultColor;
                    }
                    traitMetadata.obs_nominal_values = uniqVals;
                }
                else {
                    traitMetadata.trait_type = TRAIT_TYPE.NUMERIC;
                     var min = traitMetadata.min || Number.POSITIVE_INFINITY;
                    var max = traitMetadata.max || Number.NEGATIVE_INFINITY;
                     _.each(selectedUserTraits, function(d) {
                        if(d.observation_value < min) {
                            min = d.observation_value;
                        }
                        else if(d.observation_value > max) {
                            max = d.observation_value;
                        }
                    });
                    traitMetadata.min = min;
                    traitMetadata.max = max;
                }
            }
            s.traitMetadata = traitMetadata;
        }

        /* use a custom color scheme with a range of the selected trait.
         iterate the trait results once, to build a lookup table by accession
         id. */
        function colorStrategyNumericTrait() {
            var traitData = s.traitData;
            var traitHash = s.traitHash;

            // make a dict of all the observations for each accession id
            // multi-keyed like: accession id -> subdescriptor -> value
            _.each(traitData, function (d) {
                var accId = d.accenumb;
                var subDescriptor = (d.sub_descriptor_name) ?
                    d.sub_descriptor_name : DEFAULT_TRAIT;
                if(! traitHash[accId]) {
                    traitHash[accId] = {};
                }
                if (traitHash[accId][subDescriptor]) {
                    traitHash[accId][subDescriptor].push(d.observation_value);
                }
                else {
                    traitHash[accId][subDescriptor] = [d.observation_value];
                }
            });
            s.traitHash = traitHash;

            var min = s.traitMetadata.min;
            var max = s.traitMetadata.max;
            var scale = chroma.scale('Spectral').domain([max, min]);
            var data = s.data;

            _.each(data, function (acc) {
                var props = acc.properties;
                var accId = props.accenumb;
                var traitDescriptors = traitHash[accId];
                if(_.isEmpty(traitDescriptors) ||
                    DEFAULT_TRAIT in traitDescriptors) {
                    // it is not unusual to have multiple observations, so just
                    // average them. this seems to make the most sense for now.
                    var valueLists = _.map(traitHash[accId],
                        function (value, key) {
                            return value;
                        });
                    var traitValues = _.uniq(_.flatten(valueLists));
                    if (!_.isEmpty(traitValues)) {
                        var avg = _.sum(traitValues, function (d) {
                                return d;
                            }) / traitValues.length;
                        props.color = scale(avg).hex();
                        props.haveTrait = true;
                    } else {
                        props.color = taxonChroma.defaultColor;
                    }
                }
                else {
                    // have custom sub-descriptors, e.g for population study.
                    // the pieChartNumericMarkerMaker() will construct
                    // the pie values
                    props.color = null;
                }
            });

            // build a legend with min/max values and interpolated colors
            var steps = 10;
            var step = (max - min) / steps;
            try {
                var legendValues = _.map(_.range(min, max + step, step), function (n) {
                return {
                    label: n.toFixed(2),
                    color: scale(n).hex()
                }
            });
            s.traitLegend = {
                min: min,
                max: max,
                colorScale: scale,
                values: legendValues
            };
            } catch(e) {
                // horrible workaround for supporting userprovided data.
            }
        }

        function colorStrategyHybridTrait() {
            var traitData = s.traitData;
            var traitHash = s.traitHash;
            var traitMetadata = s.traitMetadata;
            var data = s.data;

            _.each(traitData, function (d) {
                var accId = d.accenumb;
                var value = d.observation_value;
                var subDescriptor = (d.sub_descriptor_name) ?
                    d.sub_descriptor_name : DEFAULT_TRAIT;
                if(! traitHash[accId]) {
                    traitHash[accId] = {};
                }
                if(traitHash[accId][subDescriptor]) {
                    traitHash[accId][subDescriptor].push(value);
                }
                else {
                    traitHash[accId][subDescriptor] = [value];
                }
            });
             s.traitHash = traitHash;

            var valueLists = [];
            var defaultColor = taxonChroma.defaultColor;
            _.each(data, function (d) {
                var props = d.properties;
                valueLists.push(_.map(traitHash[props.accenumb],
                    function (value, key) {
                        return key;
                    }));
                // the map marker itself will be colored by
                // pieChartHybridMarkerMaker so this is just a placeholder color
                // to be used in the list view
                props.color = defaultColor;
            });
            var traitValues = _.uniq(_.flatten(valueLists));
            var legendValues = _.map(traitMetadata.obs_nominal_values,
                function (n) {
                    return {
                        label: n,
                        color: traitMetadata.colors[n]
                    }
                });
            s.traitLegend = {
                min: null,
                max: null,
                colorScale: null,
                values: legendValues
            };
        }

        function colorStrategyCategoryTrait() {
            var traitData = s.traitData;
            var traitHash = s.traitHash;
            var traitMetadata = s.traitMetadata;
            var data = s.data;

            _.each(traitData, function (d) {
                var accId = d.accenumb;
                var value = d.observation_value;
                var subDescriptor = (d.sub_descriptor_name) ?
                    d.sub_descriptor_name : DEFAULT_TRAIT;
                if(! traitHash[accId]) {
                    traitHash[accId] = {};
                }
                if (traitHash[accId][subDescriptor]) {
                    traitHash[accId][subDescriptor].push(value);
                }
                else {
                    traitHash[accId][subDescriptor] = [value];
                }
            });
             s.traitHash = traitHash;
            _.each(data, function (d) {
                var props = d.properties;
                var valueLists =  _.map(traitHash[props.accenumb],
                    function(value, key) {
                        return value;
                    });
                var traitValues = _.uniq(_.flatten(valueLists));
                if (! _.isEmpty(traitValues)) {
                    var val = traitValues[0];
                    if(val in traitMetadata.colors) {
                        props.color = traitMetadata.colors[val];
                    }
                    else {
                        props.color = taxonChroma.defaultColor;
                    }
                    props.haveTrait = true;
                }
                else {
                    props.color = taxonChroma.defaultColor;
                }
            });

            var legendValues = _.map(traitMetadata.obs_nominal_values,
                function (n) {
                    return {
                        label: n,
                        color: traitMetadata.colors[n]
                    }
                });
            s.traitLegend = {
                min: null,
                max: null,
                colorScale: null,
                values: legendValues
            };
        }

        /* update the geojson color properties */
        s.updateColors = function () {
            s.traitHash = {};
            s.traitLegend = {};
            var data = s.data;
            var params = s.params;
            var traitMetadata = s.traitMetadata;
            if (params.traitOverlay) {
                // a trait descriptor is selected, so apply a coloring
                // strategy, generate a legend, etc.
                switch(traitMetadata.trait_type)
                {
                    case TRAIT_TYPE.NOMINAL:
                        colorStrategyCategoryTrait();
                        break;
                    case TRAIT_TYPE.NUMERIC:
                        colorStrategyNumericTrait();
                        break;
                    case TRAIT_TYPE.HYBRID:
                        colorStrategyHybridTrait();
                        break;
                }
            }
            else {
                // use color scheme from from taxonChroma
                _.each(data, function (acc) {
                    acc.properties.color = taxonChroma.get(acc.properties.taxon);
                });
            }
            // override all over coloring schemas, with user's accessionIds
            // specific coloring, if any.
            if (params.accessionIds && params.accessionIdsColor) {
                var accIds = params.accessionIds.split(',');
                _.each(data, function (acc) {
                    if (accIds.indexOf(acc.properties.accenumb) !== -1) {
                        acc.properties.color = s.params.accessionIdsColor;
                    }
                });
            }
        };

        /*
        * getFeatureMarker(): Return a circle marker by default, if there is no
        * trait overlay. If the trait is categorical, with multiple values,
        * return a pie chart marker of equal proportions. If the trait is
        * numeric, return a pie chart marker with pieces sized proportionately.
        * Otherwise, return a circle marker.
         */
        s.getFeatureMarker = function(feature, latlng) {
            if(_.isEmpty(s.params.traitOverlay)) {
                // default to circle marker
                return circleMarkerMaker(feature.properties, latlng);
            }
            var traitSubDescriptors = s.traitHash[feature.properties.accenumb];
            if(_.isEmpty(traitSubDescriptors) || _.size(traitSubDescriptors) < 2) {
                // either this is either an uncharacterized accession, or
                // there is no custom sub-descriptor, but anyways, use circle.
                return circleMarkerMaker(feature.properties, latlng);
            }

            switch(s.traitMetadata.trait_type)
            {
                case TRAIT_TYPE.NOMINAL:
                    return pieChartNominalMarkerMaker(
                        feature.properties,
                        traitSubDescriptors,
                        latlng);
                case TRAIT_TYPE.NUMERIC:
                    return pieChartNumericMarkerMaker(
                        feature.properties,
                        traitSubDescriptors,
                        latlng);
                case TRAIT_TYPE.HYBRID:
                    return pieChartHybridMarkerMaker(
                        feature.properties,
                        traitSubDescriptors,
                        latlng);

            }
        };

         var circleMarkerMaker = function(props, latlng) {
            // get a circle marker and tag it with the accession #.
           var mouseOverLabel = '<b>'+props.accenumb + '</b>: '+ props.taxon;
            var marker = L.circleMarker(latlng, {
                id: props.accenumb,
                radius: MARKER_RADIUS,
                fillColor: props.color,
                color: '#000',
                weight: 1,
                opacity: 1,
                fillOpacity: 1
            });
            marker.bindTooltip(mouseOverLabel);
            return marker;
          };

         var pieChartHybridMarkerMaker = function(props, data, latlng) {
            // construct data dictionary and chartOptions for leaflet-dvf
            // piechart plugin.

            // the data dict needs to be keyed by the subdescriptor, and the
            // observation value, for the map marker to display the info.
            // collapse all the observed values into an array. each observed
            // value will be sized by the numeric value.
            var legend = s.traitLegend;
            var traitMetadata = s.traitMetadata;
            var dataDict = {};
            var chartOpts = {};
            _.each(data, function(value, key) {
            var k = key + ' = ' + value;
                dataDict[k] = value;
                chartOpts[k] = {
                    fillColor: traitMetadata.colors[key],
                        displayText: function () {
                            return props.accenumb;
                    }
                }
            });
            var options = {
            data: dataDict,
            chartOptions: chartOpts,
            radius: MARKER_RADIUS,
            opacity: 1.0,
            fillOpacity: 1.0,
            gradient: false
            };
            return new L.PieChartMarker(latlng, options);
        };

         var pieChartNumericMarkerMaker = function(props, data, latlng) {
            // construct data dictionary and chartOptions for leaflet-dvf
            // piechart plugin.

             // the geojson element may be tagged with a color already, in
             // which case just return a circle
             if(props.color !== null) {
                  return circleMarkerMaker(props, latlng);
             }

             // the data dict needs to be keyed by the subdescriptor, and the
             // observation value, for the map marker to display the info.
            // collapse all the observed values into an array. each observed
            // value will be sized by the numeric value.
            var legend = s.traitLegend;
            var dataDict = {};
            var chartOpts = {};
            _.each(data, function(value, key) {
                var k = key + ' = ' + value;
                dataDict[k] = value;
                chartOpts[k] = {
                    fillColor: legend.colorScale(value).hex(),
                        displayText: function () {
                            return props.accenumb;
                    }
                }
            });
            var options = {
                data: dataDict,
                chartOptions: chartOpts,
                radius: MARKER_RADIUS,
                opacity: 1.0,
                fillOpacity: 1.0,
                gradient: false
            };
            return new L.PieChartMarker(latlng, options);
        };

        var pieChartNominalMarkerMaker = function(props, data, latlng) {
            // construct data dictionary and chartOptions for leaflet-dvf
            // piechart plugin
            var dataDict = {};
            var chartOpts = {};
            var traitMetadata = s.traitMetadata;

            // collapse all the observed values into an array. each observed
            // value will be an equal valued piece of pie chart.
            var counts = {};
            _.each(data, function(value, key) {
                _.each(value, function(d) {
                    var k = d;
                    if(k in dataDict) {
                        // multiple observations of same nominal trait.
                        // make another pie piece for each one.
                        counts[d]++;
                        k = d + ' (' + counts[d] + ')';
                    }
                    else {
                        counts[d] = 1;
                    }
                    dataDict[k] = 1;
                    chartOpts[k] = {
                        fillColor: traitMetadata.colors[d],
                        displayText: function () {
                            return props.accenumb;
                        }
                    }
                });
            });
            var options = {
                data: dataDict,
                chartOptions: chartOpts,
                radius: MARKER_RADIUS,
                opacity: 1.0,
                fillOpacity: 1.0,
                gradient: false
            };
            return new L.PieChartMarker(latlng, options);
        };

        s.getAnyGeocodedAccession = function () {
            return _.find(s.data, function (geoJson) {
                if (_.has(geoJson, 'geometry.coordinates.length')) {
                    return true;
                }
            });
        };

        s.initialBoundsUpdated = false;

        s.updateBounds = function () {
            /* in case we are searching by accessionIds, we need to derive new
             * bounds before sending updated event to listeners
             * (e.g. mapController) Use Leafletjs to perform all the bounds
             * calculations and extent fitting. */
            var accessionIds = _.get(s.params, 'accessionIds');
            if (!accessionIds) {
                return;
            }
            if (s.initialBoundsUpdated || s.data.length == 0) {
                return;
            }
            var geocodedAcc = s.getAnyGeocodedAccession();
            if (!geocodedAcc) {
                return;
            }
            var point = L.latLng(geocodedAcc.geometry.coordinates[1],
                geocodedAcc.geometry.coordinates[0]);
            var bounds = L.latLngBounds(point, point);
            _.each(s.data, function (geoJson) {
                if (_.has(geoJson, 'geometry.coordinates.length')) {
                    var point = L.latLng(geoJson.geometry.coordinates[1],
                        geoJson.geometry.coordinates[0]);
                    bounds.extend(point);
                }
            });
            s.bounds = bounds;
            s.initialBoundsUpdated = true;
        };

        /* pub/sub event model adapted from here :
         http://www.codelord.net/2015/05/04/angularjs-notifying-about-changes-from-services-to-controllers/
         TODO: instead of Pub/Sub, implement this with Observables.
         */
        s.subscribe = function (scope, eventName, callback) {
            if (!_.includes(s.events, eventName)) {
                throw 'invalid eventName ' + eventName;
            }
            var handler = $rootScope.$on('geoJsonService_' + eventName, callback);
            scope.$on('$destroy', handler);
            return handler;
        };

        function notify(eventName) {
            $rootScope.$emit('geoJsonService_' + eventName);
        }

        s.init();

        return s;
    });
