"""lis_germplasm URL Configuration

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/1.8/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  url(r'^$', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  url(r'^$', Home.as_view(), name='home')
Including another URLconf
    1. Add an import:  from blog import urls as blog_urls
    2. Add a URL to urlpatterns:  url(r'^blog/', include(blog_urls))
"""
from django.conf.urls import url
# from django.contrib import admin
from grin_app import views as grin_views

urlpatterns = [

    url(r'^$', grin_views.index),
    url(r'^search$', grin_views.search),
    url(r'^countries$', grin_views.countries),
    url(r'^accession_detail$', grin_views.accession_detail),
    url(r'^evaluation_descr_names$', grin_views.evaluation_descr_names),
    url(r'^evaluation_detail$', grin_views.evaluation_detail),
    url(r'^evaluation_search$', grin_views.evaluation_search),
    url(r'^evaluation_metadata$', grin_views.evaluation_metadata),

    # disabling admin site until it's actually required/used --agr
    # url(r'^admin/', include(admin.site.urls)),
]
