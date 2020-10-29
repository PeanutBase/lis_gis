# lis_gis
Map viewer for and search interface for USDA/GRIN germplasm accessions and traits. See http://legumeinfo.org/germplasm/map for a live demo.
server requirements
* Python >= 3.5.x
* Django
* PostgreSQL and PostGIS

## Docker quick start

Docker can be used to start Django and Postgres, loading an example data set from PeanutBase:

```
docker-compose up --build
```

Point your browser to http://localhost:8000/

The lis_gis git working tree is bind-mounted at /app in the container, so changes to source files will be immediatey reflected in the container.

### Running Unit Tests

After building container images & running containers with `docker-compose up --build`, Django unit tests can be executed thus:

```
docker-compose exec web python3 manage.py test
```

### Loading your own data

To substitute your own (PostGIS 2.5) schema, first dump the database to an SQL script:

```
pg_dump --no-owner --no-privileges --schema=<SCHEMA_NAME> --compress=9 > z-SCHEMA_NAME.sql.gz

```

Move the .sql.gz file to ./postgres/docker-entrypoint-initdb.d/ before executing `docker-compose up --build`.
The name of the file does not matter, as long as the extension is `*.sql.gz`, `*.sql.xz`, or `*.sql`, and as long as it lexicographically sorts after the `/docker-entrypoint-initdb.d/10_postgis.sh` script from the container image, which must be executed first.

### Production Docker Compose

lis_gis can be built & deployed on a remote node (after setting DOCKER_HOST or docker context) thus:

```
export ALLOWED_HOSTS='myhost.mydomain'
docker-compose -f docker-compose.prod.yml up -d --build
```

## PostgreSQL setup
Create a database and before loading the schema.sql, create the spatial extension (assuming PostGIS is already available in your PostgrSQL install). Creating the schema will fail unless PostGIS extension is created first.

```
createdb lis_gis
psql lis_gis
-> CREATE EXTENSION postgis;
-> \q
createuser www
```

### Restore from a db dump

```
pg_restore -O -C -d lis_gis lis_germplasm.dump
```

### Or start from empty database

```
psql lis_gis < scripts/schema.sql
```

## Python and Djanjo setup

The required python modules are in the requirements.txt


```pip install -r requirements.txt```


## Unit tests using django_nose


```./manage.py test```

This command will run Nose test, first populating the test db with subset of the legume accessions. All of views.py is covered. Note: Client side javascript code is not yet covered by this test suite. TODO: implement Selenium or something to test the angular-js application itself.

