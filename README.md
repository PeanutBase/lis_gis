# lis_gis
Map viewer for and search interface for USDA/GRIN germplasm accessions and traits. See http://legumeinfo.org/germplasm/map for a live demo.
server requirements
* Python 2.7.x
* Django
* PostgreSQL and PostGIS

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

