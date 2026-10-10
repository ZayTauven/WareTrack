from datetime import timedelta

import pytest
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import Membership, Organization, User
from apps.warehouse.realtime import CLOSE_TOKEN_EXPIRED, PROTOCOL, group_name
from apps.warehouse.routing import websocket_urlpatterns

application = URLRouter(websocket_urlpatterns)
pytestmark = pytest.mark.django_db(transaction=True)  # the consumer reads the database from another thread


def token_for(user: User, lifetime: timedelta | None = None) -> str:
    token = AccessToken.for_user(user)
    if lifetime is not None:
        token.set_exp(lifetime=lifetime)
    return str(token)


def connect(org: str, *protocols: str):
    async def attempt():
        communicator = WebsocketCommunicator(application, f'/ws/v1/orgs/{org}/live/', subprotocols=list(protocols))
        connected, subprotocol = await communicator.connect()
        return communicator, connected, subprotocol

    return attempt


def test_a_member_receives_the_organization_patches(organization: Organization, member: User) -> None:
    async def scenario():
        communicator, connected, subprotocol = await connect('acme', PROTOCOL, f'bearer.{token_for(member)}')()
        assert connected and subprotocol == PROTOCOL
        payload = {'type': 'patch', 'trucks': [], 'removedShipmentIds': []}
        await get_channel_layer().group_send(
            group_name(organization.id), {'type': 'operation.patch', 'payload': payload}
        )
        assert await communicator.receive_json_from() == payload
        await communicator.disconnect()

    async_to_sync(scenario)()


@pytest.mark.parametrize(
    'protocols',
    [
        pytest.param((PROTOCOL,), id='no token'),
        pytest.param((PROTOCOL, 'bearer.not-a-jwt'), id='invalid token'),
        pytest.param(('bearer.{token}',), id='unknown protocol'),
    ],
)
def test_rejects_unauthenticated_handshakes(
    organization: Organization, member: User, protocols: tuple[str, ...]
) -> None:
    offered = [p.format(token=token_for(member)) for p in protocols]

    async def scenario():
        _, connected, _ = await connect('acme', *offered)()
        assert not connected

    async_to_sync(scenario)()


def test_rejects_expired_tokens(organization: Organization, member: User) -> None:
    async def scenario():
        _, connected, _ = await connect('acme', PROTOCOL, f'bearer.{token_for(member, timedelta(seconds=-1))}')()
        assert not connected

    async_to_sync(scenario)()


def test_non_members_cannot_subscribe(organization: Organization, member: User) -> None:
    Organization.objects.create(name='Rival Freight', slug='rival')
    outsider = User.objects.create_user('spy@rival.test', 'x' * 12)

    async def scenario():
        _, to_rival, _ = await connect('rival', PROTOCOL, f'bearer.{token_for(member)}')()
        _, to_acme, _ = await connect('acme', PROTOCOL, f'bearer.{token_for(outsider)}')()
        assert not to_rival and not to_acme

    async_to_sync(scenario)()


def test_closes_the_socket_when_the_token_expires(organization: Organization, member: User) -> None:
    async def scenario():
        communicator, connected, _ = await connect(
            'acme', PROTOCOL, f'bearer.{token_for(member, timedelta(seconds=1))}'
        )()
        assert connected
        closing = await communicator.receive_output(timeout=3)
        assert closing == {'type': 'websocket.close', 'code': CLOSE_TOKEN_EXPIRED}

    async_to_sync(scenario)()


def test_inactive_members_cannot_subscribe(organization: Organization, member: User) -> None:
    User.objects.filter(pk=member.pk).update(is_active=False)
    assert Membership.objects.filter(user=member).exists()

    async def scenario():
        _, connected, _ = await connect('acme', PROTOCOL, f'bearer.{token_for(member)}')()
        assert not connected

    async_to_sync(scenario)()
