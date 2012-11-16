from django import template
from django.conf import settings
from django.contrib.gis.geos import GEOSGeometry, Point

register = template.Library()


@register.filter
def latlngbounds(obj, fieldname='geom'):
    if obj is None or isinstance(obj, basestring):
        return 'null'
    if not isinstance(obj, GEOSGeometry):
        obj = getattr(obj, fieldname)
    if obj is None:
        return 'null'
    obj.transform(settings.API_SRID)
    if isinstance(obj, Point):
        extent = [obj.x-0.005, obj.y-0.005, obj.x+0.005, obj.y+0.005]
    else:
        extent = list(obj.extent)
    return [[extent[1], extent[0]], [extent[3], extent[2]]]
