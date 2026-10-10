"""
Read API, scoped to one organization taken from the URL (/api/v1/orgs/{org}/...).

Tenant isolation lives in one place, OrganizationScopedMixin: the organization is looked up
among the caller's memberships, so a non-member gets 404 (existence is not disclosed), and every
queryset is filtered through it.
"""

import uuid
from typing import ClassVar

from django.db.models import Model, Prefetch, QuerySet
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Organization

from .kpis import site_kpis
from .models import Dock, Forklift, InventoryItem, Rack, Shipment, ShipmentLine, Site, Truck
from .serializers import (
    DockSerializer,
    ForkliftSerializer,
    InventoryItemSerializer,
    RackSerializer,
    ShipmentSerializer,
    SiteKpisSerializer,
    SiteSerializer,
    SnapshotSerializer,
    TruckSerializer,
)

ORG_PARAMETER = OpenApiParameter('org', OpenApiTypes.STR, OpenApiParameter.PATH, description='Organization slug.')
SITE_FILTER = OpenApiParameter('site', OpenApiTypes.UUID, description='Only records of this site.')
STATUS_FILTER = OpenApiParameter('status', OpenApiTypes.STR, description='Only records in this status.')


class OrganizationScopedMixin:
    request: Request
    kwargs: dict

    def get_organization(self) -> Organization:
        if not hasattr(self, '_organization'):
            members_only = Organization.objects.filter(memberships__user=self.request.user)
            self._organization = get_object_or_404(members_only, slug=self.kwargs['org'])
        return self._organization


def _shipments_with_lines(queryset: QuerySet[Shipment]) -> QuerySet[Shipment]:
    return queryset.prefetch_related(
        Prefetch('lines', queryset=ShipmentLine.objects.only('shipment_id', 'item_id', 'quantity'))
    )


@extend_schema(parameters=[ORG_PARAMETER], responses=SnapshotSerializer)
class SnapshotView(OrganizationScopedMixin, APIView):
    """The whole operation of an organization in one response: what the 3D view loads on start."""

    def get(self, request: Request, org: str) -> Response:
        organization = self.get_organization()
        in_org = {'site__organization': organization}
        snapshot = {
            'sites': Site.objects.filter(organization=organization),
            'docks': Dock.objects.filter(**in_org),
            'racks': Rack.objects.filter(**in_org),
            'trucks': Truck.objects.filter(**in_org),
            'forklifts': Forklift.objects.filter(**in_org),
            'inventory': InventoryItem.objects.filter(**in_org),
            'shipments': _shipments_with_lines(Shipment.objects.filter(**in_org)),
        }
        return Response(SnapshotSerializer(snapshot).data)


class ScopedReadViewSet(OrganizationScopedMixin, viewsets.ReadOnlyModelViewSet):
    """Lists and details of one entity type within the organization, filterable by site (and status)."""

    model: ClassVar[type[Model]]
    filterable_by_status: ClassVar[bool] = False

    def base_queryset(self) -> QuerySet:
        return self.model.objects.all()

    def get_queryset(self) -> QuerySet:
        if getattr(self, 'swagger_fake_view', False):  # schema generation: no request, only the model matters
            return self.model.objects.none()
        queryset = self.base_queryset().filter(site__organization=self.get_organization())
        site = self.request.query_params.get('site')
        if site:
            try:
                queryset = queryset.filter(site_id=uuid.UUID(site))
            except ValueError as error:
                raise ValidationError({'site': 'Must be a site id (UUID).'}) from error
        status = self.request.query_params.get('status')
        if status and self.filterable_by_status:
            queryset = queryset.filter(status=status)
        return queryset


def _read_schema(*, status: bool = False):
    parameters = [ORG_PARAMETER, SITE_FILTER, *([STATUS_FILTER] if status else [])]
    return extend_schema_view(
        list=extend_schema(parameters=parameters), retrieve=extend_schema(parameters=[ORG_PARAMETER])
    )


@extend_schema_view(
    list=extend_schema(parameters=[ORG_PARAMETER]),
    retrieve=extend_schema(parameters=[ORG_PARAMETER]),
    kpis=extend_schema(parameters=[ORG_PARAMETER], responses=SiteKpisSerializer),
)
class SiteViewSet(OrganizationScopedMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = SiteSerializer

    def get_queryset(self) -> QuerySet[Site]:
        if getattr(self, 'swagger_fake_view', False):
            return Site.objects.none()
        return Site.objects.filter(organization=self.get_organization())

    @action(detail=True, methods=['get'], serializer_class=SiteKpisSerializer)
    def kpis(self, request: Request, org: str, pk: str) -> Response:
        return Response(SiteKpisSerializer(site_kpis(self.get_object())).data)


@_read_schema()
class DockViewSet(ScopedReadViewSet):
    model = Dock
    serializer_class = DockSerializer


@_read_schema()
class RackViewSet(ScopedReadViewSet):
    model = Rack
    serializer_class = RackSerializer


@_read_schema(status=True)
class TruckViewSet(ScopedReadViewSet):
    model = Truck
    serializer_class = TruckSerializer
    filterable_by_status = True


@_read_schema(status=True)
class ForkliftViewSet(ScopedReadViewSet):
    model = Forklift
    serializer_class = ForkliftSerializer
    filterable_by_status = True


@_read_schema()
class InventoryItemViewSet(ScopedReadViewSet):
    model = InventoryItem
    serializer_class = InventoryItemSerializer


@_read_schema(status=True)
class ShipmentViewSet(ScopedReadViewSet):
    model = Shipment
    serializer_class = ShipmentSerializer
    filterable_by_status = True

    def base_queryset(self) -> QuerySet[Shipment]:
        return _shipments_with_lines(Shipment.objects.all())
