"""
Live updates over WebSocket.

A client connects to /ws/v1/orgs/{org}/live/ offering two subprotocols: `waretrack.v1` and
`bearer.<access token>`. The token travels in the handshake header, never in the URL (so it does
not end up in access logs). The server checks the token and the membership, joins the
organization's group, and closes the socket when the token expires; the client reconnects with a
fresh one. Each simulation tick broadcasts one patch per organization: full entity states, read
back from the database after the write, so clients can merge by id.
"""

import asyncio
import json
import time
from datetime import datetime
from typing import Any
from uuid import UUID

from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.layers import get_channel_layer
from django.core.serializers.json import DjangoJSONEncoder
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import Organization

from .models import Forklift, InventoryItem, Shipment, Truck
from .serializers import ForkliftSerializer, InventoryItemSerializer, ShipmentSerializer, TruckSerializer
from .simulation import Journal

PROTOCOL = 'waretrack.v1'
BEARER_PREFIX = 'bearer.'
CLOSE_TOKEN_EXPIRED = 4401


def group_name(organization_id: UUID) -> str:
    return f'org.{organization_id}'


def patch_payload(journal: Journal, at: datetime) -> dict[str, Any]:
    shipment_ids = [*journal.changed(Shipment), *(s.id for s in journal.created)]
    payload = {
        'type': 'patch',
        'at': at,
        'trucks': TruckSerializer(Truck.objects.filter(id__in=journal.changed(Truck)), many=True).data,
        'forklifts': ForkliftSerializer(Forklift.objects.filter(id__in=journal.changed(Forklift)), many=True).data,
        'shipments': ShipmentSerializer(
            Shipment.objects.filter(id__in=shipment_ids).prefetch_related('lines'), many=True
        ).data,
        'inventory': InventoryItemSerializer(
            InventoryItem.objects.filter(id__in=journal.changed(InventoryItem)), many=True
        ).data,
        'removedShipmentIds': journal.deleted,
    }
    # Plain JSON types for the channel layer (msgpack over Redis).
    return json.loads(json.dumps(payload, cls=DjangoJSONEncoder))


def broadcast(organization: Organization, payload: dict[str, Any]) -> None:
    async_to_sync(get_channel_layer().group_send)(
        group_name(organization.id), {'type': 'operation.patch', 'payload': payload}
    )


class OperationConsumer(AsyncJsonWebsocketConsumer):
    group: str | None = None
    expiry: asyncio.Task | None = None

    async def connect(self) -> None:
        offered: list[str] = self.scope.get('subprotocols', [])
        token = next((p.removeprefix(BEARER_PREFIX) for p in offered if p.startswith(BEARER_PREFIX)), None)
        if PROTOCOL not in offered or not token:
            await self.close()
            return
        try:
            access = AccessToken(token)
        except TokenError:
            await self.close()
            return
        organization_id = await self._organization_id(access['user_id'], self.scope['url_route']['kwargs']['org'])
        if organization_id is None:  # unknown organization or not a member: same answer
            await self.close()
            return

        self.group = group_name(organization_id)
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept(subprotocol=PROTOCOL)
        self.expiry = asyncio.create_task(self._close_when_expired(access['exp'] - time.time()))

    async def disconnect(self, code: int) -> None:
        if self.expiry:
            self.expiry.cancel()
        if self.group:
            await self.channel_layer.group_discard(self.group, self.channel_name)

    async def receive_json(self, content: Any, **kwargs: Any) -> None:
        """Read-only feed: client messages are ignored."""

    async def operation_patch(self, event: dict[str, Any]) -> None:
        await self.send_json(event['payload'])

    async def _close_when_expired(self, delay: float) -> None:
        await asyncio.sleep(max(0.0, delay))
        await self.close(code=CLOSE_TOKEN_EXPIRED)

    @database_sync_to_async
    def _organization_id(self, user_id: str, slug: str) -> UUID | None:
        return (
            Organization.objects.filter(slug=slug, memberships__user_id=user_id, memberships__user__is_active=True)
            .values_list('id', flat=True)
            .first()
        )
