FROM postgis/postgis:12-2.5-alpine AS db
COPY ./docker-entrypoint-initdb.d/ /docker-entrypoint-initdb.d/

########################################

FROM python:3.8-alpine3.12 AS build

RUN apk add --no-cache py3-psycopg2
ENV PYTHONPATH=/usr/lib/python3.8/site-packages

WORKDIR /app/grin_app/static/grin_app/js/
COPY grin_app/static/grin_app/js/package.json .
RUN apk add --no-cache npm \
 && npm install \
 && apk del -r npm

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

########################################

FROM build AS dev

RUN apk add --no-cache postgresql-client \
 && pip install --no-cache-dir Werkzeug==1.0.1

WORKDIR /app

USER nobody
ENV PYTHONUNBUFFERED=1
CMD ["python3", "manage.py", "runserver_plus", "0.0.0.0:8000"]

EXPOSE 8000

VOLUME ["/app/grin_app/static/grin_app/js/node_modules"]

########################################

FROM nginx:1.19-alpine AS nginx

COPY ./nginx/ /etc/nginx/templates
COPY --from=build /app/grin_app/static/ /usr/share/nginx/html/static/
COPY ./grin_app/static/ /usr/share/nginx/html/static/

########################################

FROM build AS prod

RUN pip install --no-cache-dir gunicorn==20.0.4

WORKDIR /app

COPY manage.py ./
COPY grin_app ./grin_app
COPY lis_germplasm ./lis_germplasm
# Allow socket directory to be accessed by "nobody" (gunicorn) and nginx (gid 101)
RUN mkdir -m 750 /run/gunicorn && chown nobody:101 /run/gunicorn
USER nobody
CMD ["gunicorn", "--bind", "unix:/run/gunicorn/gunicorn.sock", "lis_germplasm.wsgi:application"]

VOLUME ["/run/gunicorn"]
