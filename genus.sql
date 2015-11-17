create schema lis_germplasm;

set search_path to public,topology,myschema;

create table lis_germplasm.grin_accession (
   gid serial primary key,
   taxon text,
   taxon_fts tsvector,
   is_legume boolean,
   genus text,
   species text,
   spauthor text,
   subtaxa text,
   subtauthor text,
   cropname  text,
   avail text,
   instcode text,
   accenumb text,
   acckey int,
   collnumb text,
   collcode text,
   taxno int,
   accename text,
   acqdate date,
   origcty text,
   collsite text,
   latitude text,
   longitude text,
   elevation int,
   colldate date,
   bredcode  text,
   sampstat int,
   ancest text,
   collsrc int,
   donorcode text,
   donornumb text,
   othernumb text,
   duplsite text,
   storage text,
   latdec float,
   longdec float,
   geographic_coord geography(Point,4326),
   remarks text,
   history text,
   released text
);

create unique index accenumb_idx on grin_accession (lower(accenumb));
create index geog_coord_idx on grin_accession using gist (geographic_coord);
create index grin_accession_idx on grin_accession (lower(grin_accession));
create index species_idx on grin_accession (lower(species));
create index taxon_idx on grin_accession (lower(taxon));
create index taxon_fts_idx on grin_accession using gin(taxon_fts);

-- Setup full text search. this could be done with stemming (although
-- stemming won't work on taxon because they are latin words and
-- there is no latin stemmer)

CREATE TEXT SEARCH CONFIGURATION taxon (parser='default');

CREATE TEXT SEARCH DICTIONARY taxon_simple (
       template = simple,
       stopwords = english,
       accept = false
);

CREATE TEXT SEARCH CONFIGURATION taxon (parser='default');

ALTER TEXT SEARCH CONFIGURATION taxon
    ALTER MAPPING FOR asciiword, asciihword, hword_asciipart,
                  word, hword, hword_part
    WITH taxon_simple;

-- update fts dictionary
UPDATE grin_accession
       SET taxon_fts = to_tsvector('english', coalesce(taxon,''));
       
