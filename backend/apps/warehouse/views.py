"""
Read API, scoped to one organization taken from the URL (/api/v1/orgs/{org}/...).

Tenant isolation lives in one place, OrganizationScopedMixin: the organization is looked up
among the caller's memberships, so a non-member gets 404 (existence is not disclosed), and every
queryset is filtered through it.
"""

import uuid
from collections.abc import Callable
from typing import ClassVar

from django.core.exceptions import ObjectDoesNotExist
from django.db.models import Model, Prefetch, QuerySet
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Membership, Organization
from apps.accounts.roles import Ability, can

from . import actions
from .actions import ActionRejected
from .kpis import site_kpis
from .models import Dock, Forklift, InventoryItem, Rack, Shipment, ShipmentLine, Site, Truck
from .realtime import broadcast, patch_payload
from .serializers import (
    ActionRejectedSerializer,
    AssignForkliftSerializer,
    DockSerializer,
    DockStateSerializer,
    DockTruckSerializer,
    ForkliftSerializer,
    InventoryItemSerializer,
    PatchSerializer,
    RackSerializer,
    ShipmentSerializer,
    SiteKpisSerializer,
    SiteSerializer,
    SnapshotSerializer,
    TruckSerializer,
)
from .simulation import Journal

ORG_PARAMETER = OpenApiParameter('org', OpenApiTypes.STR, OpenApiParameter.PATH, description='Organization slug.')
SITE_FILTER = OpenApiParameter('site', OpenApiTypes.UUID, description='Only records of this site.')
STATUS_FILTER = OpenApiParameter('status', OpenApiTypes.STR, description='Only records in this status.')


class OrganizationScopedMixin:
    request: Request
    kwargs: dict

    def get_membership(self) -> Membership:
        """The caller's membership in the organization of the URL; 404 if there is none."""
        if not hasattr(self, '_membership'):
            self._membership = get_object_or_404(
                Membership.objects.select_related('organization'),
                user=self.request.user,
                organization__slug=self.kwargs['org'],
            )
        return self._membership

    def get_organization(self) -> Organization:
        return self.get_membership().organization


def requires(ability: Ability) -> type[BasePermission]:
    """Permission: the caller's role in the URL's organization grants `ability`."""

    class RoleAllows(BasePermission):
        message = f'Your role does not allow this ({ability.value}).'

        def has_permission(self, request: Request, view: OrganizationScopedMixin) -> bool:
            return can(view.get_membership().role, ability)

    return RoleAllows


def _act(organization: Organization, run: Callable[[], Journal]) -> Response:
    """Runs an action, broadcasts what changed, and answers with the same patch."""
    try:
        journal = run()
    except ActionRejected as rejected:
        return Response({'code': rejected.code, 'detail': rejected.message}, status=status.HTTP_409_CONFLICT)
    except ObjectDoesNotExist as error:
        raise NotFound from error
    payload = patch_payload(journal, timezone.now())
    broadcast(organization, payload)
    return Response(payload)


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


def _uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as error:
        raise NotFound from error


def _action_schema(request: type, summary: str) -> Callable:
    return extend_schema(
        parameters=[ORG_PARAMETER],
        request=request,
        responses={200: PatchSerializer, 403: None, 404: None, 409: ActionRejectedSerializer},
        summary=summary,
    )


@_read_schema()
class DockViewSet(ScopedReadViewSet):
    model = Dock
    serializer_class = DockSerializer

    @_action_schema(DockStateSerializer, 'Take a dock out of service, or put it back (admin)')
    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated, requires(Ability.SET_DOCK_STATE)])
    def state(self, request: Request, org: str, pk: str) -> Response:
        body = DockStateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        organization = self.get_organization()
        return _act(
            organization,
            lambda: actions.set_dock_state(organization, _uuid(pk), body.validated_data['state'], timezone.now()),
        )


@_read_schema()
class RackViewSet(ScopedReadViewSet):
    model = Rack
    serializer_class = RackSerializer


@_read_schema(status=True)
class TruckViewSet(ScopedReadViewSet):
    model = Truck
    serializer_class = TruckSerializer
    filterable_by_status = True

    @_action_schema(DockTruckSerializer, 'Send a truck waiting in the yard to a dock (operator)')
    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated, requires(Ability.DOCK_TRUCK)])
    def dock(self, request: Request, org: str, pk: str) -> Response:
        body = DockTruckSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        organization = self.get_organization()
        return _act(
            organization,
            lambda: actions.dock_truck(organization, _uuid(pk), body.validated_data['dockId'], timezone.now()),
        )


@_read_schema(status=True)
class ForkliftViewSet(ScopedReadViewSet):
    model = Forklift
    serializer_class = ForkliftSerializer
    filterable_by_status = True

    @_action_schema(AssignForkliftSerializer, 'Put a forklift on a docked shipment, or release it with null (operator)')
    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated, requires(Ability.ASSIGN_FORKLIFT)])
    def assign(self, request: Request, org: str, pk: str) -> Response:
        body = AssignForkliftSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        organization = self.get_organization()
        shipment_id = body.validated_data['shipmentId']
        return _act(organization, lambda: actions.assign_forklift(organization, _uuid(pk), shipment_id, timezone.now()))

    @_action_schema(None, 'Send a forklift to the charger (operator)')
    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated, requires(Ability.CHARGE_FORKLIFT)])
    def charge(self, request: Request, org: str, pk: str) -> Response:
        organization = self.get_organization()
        return _act(organization, lambda: actions.charge_forklift(organization, _uuid(pk), timezone.now()))


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
