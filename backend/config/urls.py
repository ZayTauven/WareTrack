from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

api_v1 = [
    path('', include('apps.accounts.urls')),
    path('', include('apps.warehouse.urls')),
]

urlpatterns = [
    path(settings.ADMIN_URL, admin.site.urls),
    path('api/v1/', include(api_v1)),
]

if settings.DEBUG:
    # Interactive docs in development only; the schema file is the published contract.
    urlpatterns += [
        path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
        path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='docs'),
    ]
