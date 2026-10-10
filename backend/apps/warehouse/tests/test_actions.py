from collections.abc import Callable

import pytest
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from rest_framework.test import APIClient

from apps.accounts.models import Membership, Organization, User
from apps.warehouse.invariants import find_violations
from apps.warehouse.models import Dock, Forklift, Shipment, Truck
from apps.warehouse.realtime import group_name
from apps.warehouse.seed import seed_demo
from apps.warehouse.simulation import Operation
from testing import NOW

API = '/api/v1/orgs/acme'


@pytest.fixture
def as_role(seeded: Organization) -> Callable[[str], APIClient]:
    def make(role: str) -> APIClient:
        user = User.objects.create_user(f'{role}@acme.test', 'x' * 12)
        Membership.objects.create(user=user, organization=seeded, role=role)
        client = APIClient()
        client.force_authenticate(user)
        return client

    return make


def truck(name: str) -> Truck:
    return Truck.objects.get(site__organization__slug='acme', name=name)


def dock(site: str, number: int) -> Dock:
    return Dock.objects.get(site__organization__slug='acme', site__code=site, number=number)


def consistent(organization: Organization) -> None:
    assert find_violations(Operation.load(organization)) == []


# --- Roles ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ('role', 'dock_truck', 'dock_state'),
    [('viewer', 403, 403), ('operator', 200, 403), ('admin', 200, 200), ('owner', 200, 200)],
)
def test_role_matrix(as_role, role: str, dock_truck: int, dock_state: int) -> None:
    client = as_role(role)
    waiting = truck('YTE-992')
    sent = client.post(f'{API}/trucks/{waiting.id}/dock/', {'dockId': str(dock('OAK', 1).id)}, format='json')
    assert sent.status_code == dock_truck
    free = dock('OAK', 5)
    toggled = client.post(f'{API}/docks/{free.id}/state/', {'state': 'maintenance'}, format='json')
    assert toggled.status_code == dock_state


# --- Sending a truck to a dock -----------------------------------------------------


def test_sends_a_waiting_truck_to_a_free_dock(as_role, seeded: Organization) -> None:
    waiting, door = truck('YTE-992'), dock('OAK', 1)
    response = as_role('operator').post(f'{API}/trucks/{waiting.id}/dock/', {'dockId': str(door.id)}, format='json')

    assert response.status_code == 200
    waiting.refresh_from_db()
    assert (waiting.status, waiting.dock_id, waiting.position_z) == ('unloading', door.id, -26)
    shipment = Shipment.objects.get(reference='S-1046A')
    assert (shipment.status, shipment.dock_id) == ('at_dock', door.id)
    assert [t['id'] for t in response.data['trucks']] == [str(waiting.id)]
    assert [s['id'] for s in response.data['shipments']] == [str(shipment.id)]
    consistent(seeded)


@pytest.mark.parametrize(
    ('truck_name', 'site', 'number', 'code'),
    [
        ('YTE-992', 'OAK', 4, 'dock_occupied'),
        ('LGX-8847', 'OAK', 5, 'truck_not_waiting'),
        ('YTE-992', 'DAL', 2, 'dock_not_on_site'),
    ],
)
def test_refuses_impossible_dockings(as_role, seeded, truck_name: str, site: str, number: int, code: str) -> None:
    response = as_role('operator').post(
        f'{API}/trucks/{truck(truck_name).id}/dock/', {'dockId': str(dock(site, number).id)}, format='json'
    )
    assert response.status_code == 409
    assert response.data['code'] == code
    assert response.data['detail']
    consistent(seeded)


def test_refuses_a_dock_in_maintenance(as_role, seeded: Organization) -> None:
    admin = as_role('admin')
    door = dock('OAK', 5)
    admin.post(f'{API}/docks/{door.id}/state/', {'state': 'maintenance'}, format='json')
    response = admin.post(f'{API}/trucks/{truck("YTE-992").id}/dock/', {'dockId': str(door.id)}, format='json')
    assert (response.status_code, response.data['code']) == (409, 'dock_in_maintenance')


# --- Forklifts ----------------------------------------------------------------------


def test_assigns_and_releases_a_forklift(as_role, seeded: Organization) -> None:
    client = as_role('operator')
    forklift = Forklift.objects.get(name='Unit 401')
    shipment = Shipment.objects.get(reference='S-1045A')

    assigned = client.post(f'{API}/forklifts/{forklift.id}/assign/', {'shipmentId': str(shipment.id)}, format='json')
    assert assigned.status_code == 200
    forklift.refresh_from_db()
    assert (forklift.status, forklift.shipment_id) == ('moving', shipment.id)
    consistent(seeded)

    released = client.post(f'{API}/forklifts/{forklift.id}/assign/', {'shipmentId': None}, format='json')
    assert released.status_code == 200
    forklift.refresh_from_db()
    assert (forklift.status, forklift.shipment_id) == ('idle', None)


@pytest.mark.parametrize(
    ('forklift_name', 'reference', 'code'),
    [
        ('Unit 405', 'D-2201', 'no_operator'),
        ('Unit 408', 'M-3301', 'forklift_in_maintenance'),
        ('Unit 401', 'S-1048A', 'shipment_not_at_dock'),
        ('Unit 401', 'D-2201', 'shipment_not_on_site'),
    ],
)
def test_refuses_impossible_assignments(as_role, forklift_name: str, reference: str, code: str) -> None:
    forklift = Forklift.objects.get(name=forklift_name)
    shipment = Shipment.objects.get(reference=reference)
    response = as_role('operator').post(
        f'{API}/forklifts/{forklift.id}/assign/', {'shipmentId': str(shipment.id)}, format='json'
    )
    assert (response.status_code, response.data['code']) == (409, code)


def test_sends_a_forklift_to_charge(as_role, seeded: Organization) -> None:
    forklift = Forklift.objects.get(name='Unit 403')  # working S-1045A
    response = as_role('operator').post(f'{API}/forklifts/{forklift.id}/charge/')
    assert response.status_code == 200
    forklift.refresh_from_db()
    assert (forklift.status, forklift.shipment_id) == ('charging', None)
    consistent(seeded)


# --- Docks --------------------------------------------------------------------------


def test_toggles_dock_service(as_role, seeded: Organization) -> None:
    client = as_role('admin')
    door = dock('OAK', 5)
    response = client.post(f'{API}/docks/{door.id}/state/', {'state': 'maintenance'}, format='json')
    assert response.status_code == 200
    assert response.data['docks'][0]['state'] == 'maintenance'
    back = client.post(f'{API}/docks/{door.id}/state/', {'state': 'operational'}, format='json')
    assert back.data['docks'][0]['state'] == 'operational'


def test_keeps_an_occupied_dock_in_service(as_role) -> None:
    occupied = dock('OAK', 4)
    response = as_role('admin').post(f'{API}/docks/{occupied.id}/state/', {'state': 'maintenance'}, format='json')
    assert (response.status_code, response.data['code']) == (409, 'dock_occupied')


# --- Boundaries ---------------------------------------------------------------------


def test_actions_stay_inside_the_organization(as_role, seeded: Organization) -> None:
    other = Organization.objects.create(name='Rival Freight', slug='rival')
    seed_demo(other, NOW)
    rival_truck = Truck.objects.get(site__organization=other, name='YTE-992')
    client = as_role('admin')

    assert (
        client.post(
            f'{API}/trucks/{rival_truck.id}/dock/', {'dockId': str(dock('OAK', 1).id)}, format='json'
        ).status_code
        == 404
    )
    assert client.post(f'/api/v1/orgs/rival/trucks/{rival_truck.id}/dock/', {}, format='json').status_code == 404
    rival_truck.refresh_from_db()
    assert rival_truck.status == 'waiting'


def test_rejects_malformed_requests(as_role) -> None:
    client = as_role('operator')
    assert (
        client.post(f'{API}/trucks/not-a-uuid/dock/', {'dockId': str(dock('OAK', 1).id)}, format='json').status_code
        == 404
    )
    assert (
        client.post(f'{API}/trucks/{truck("YTE-992").id}/dock/', {'dockId': 'nope'}, format='json').status_code == 400
    )


def test_broadcasts_the_change_to_the_organization(as_role, seeded: Organization) -> None:
    layer = get_channel_layer()
    channel = async_to_sync(layer.new_channel)()
    async_to_sync(layer.group_add)(group_name(seeded.id), channel)

    response = as_role('operator').post(
        f'{API}/trucks/{truck("YTE-992").id}/dock/', {'dockId': str(dock('OAK', 1).id)}, format='json'
    )
    message = async_to_sync(layer.receive)(channel)
    assert message['payload'] == response.json()
