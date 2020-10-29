-- grant "read-only" privileges to nobody
CREATE ROLE nobody LOGIN;
GRANT USAGE on SCHEMA lis_germplasm TO nobody;
GRANT SELECT ON ALL TABLES IN SCHEMA lis_germplasm TO nobody;
ALTER DEFAULT PRIVILEGES IN SCHEMA lis_germplasm GRANT SELECT ON TABLES TO nobody;
