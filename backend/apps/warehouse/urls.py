from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
org = r'orgs/(?P<org>[-\w]+)'
router.register(rf'{org}/sites', views.SiteViewSet, basename='site')
router.register(rf'{org}/docks', views.DockViewSet, basename='dock')
router.register(rf'{org}/racks', views.RackViewSet, basename='rack')
router.register(rf'{org}/trucks', views.TruckViewSet, basename='truck')
router.register(rf'{org}/forklifts', views.ForkliftViewSet, basename='forklift')
router.register(rf'{org}/inventory', views.InventoryItemViewSet, basename='inventory-item')
router.register(rf'{org}/shipments', views.ShipmentViewSet, basename='shipment')

urlpatterns = [
    path('orgs/<slug:org>/snapshot/', views.SnapshotView.as_view(), name='snapshot'),
    *router.urls,
]
