import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Membership, Organization, User
from apps.warehouse.models import Site, Truck
from apps.warehouse.seed import seed_demo
from testing import NOW, PASSWORD

API = '/api/v1/orgs/acme'


@pytest.fixture
def operation(seeded: Organization, authed: APIClient) -> APIClient:
    return authed


def test_snapshot_matches_the_front_end_shape(operation: APIClient, django_assert_max_num_queries) -> None:
    with django_assert_max_num_queries(12):  # one query per collection, not per row
        data = operation.get(f'{API}/snapshot/').json()

    assert {key: len(rows) for key, rows in data.items()} == {
        'sites': 3, 'docks': 18, 'racks': 36, 'trucks': 12, 'forklifts': 8, 'inventory': 40, 'shipments': 25,
    }  # fmt: skip
    truck = next(t for t in data['trucks'] if t['name'] == 'LGX-8847')
    assert set(truck) == {'id', 'name', 'carrier', 'siteId', 'status', 'dockId', 'position', 'rotationY', 'updatedAt'}
    assert truck['position'] == {'x': 4.5, 'z': -26.0}
    site = data['sites'][0]
    assert set(site['bounds']) == {'minX', 'maxX', 'minZ', 'maxZ'}
    shipment = next(s for s in data['shipments'] if s['reference'] == 'EXP-993-C')
    assert [set(line) for line in shipment['lines']] == [{'itemId', 'quantity'}] * 2
    idle = next(f for f in data['forklifts'] if f['name'] == 'Unit 405')
    assert idle['operator'] is None and idle['shipmentId'] is None


def test_requires_authentication(seeded: Organization, client: APIClient) -> None:
    assert client.get(f'{API}/snapshot/').status_code == 401


def test_other_tenants_are_invisible(seeded: Organization, operation: APIClient) -> None:
    other = Organization.objects.create(name='Rival Freight', slug='rival')
    seed_demo(other, NOW)
    rival_truck = Truck.objects.filter(site__organization=other).first()
    assert rival_truck is not None

    # Not a member: the organization does not exist as far as this user can tell.
    assert operation.get('/api/v1/orgs/rival/snapshot/').status_code == 404
    assert operation.get('/api/v1/orgs/rival/trucks/').status_code == 404
    # A rival record cannot be reached through the caller's own organization either.
    assert operation.get(f'{API}/trucks/{rival_truck.id}/').status_code == 404
    rival_site = Site.objects.filter(organization=other).first()
    assert operation.get(f'{API}/trucks/', {'site': str(rival_site.id)}).json()['count'] == 0


def test_membership_grants_access(seeded: Organization, client: APIClient) -> None:
    other = Organization.objects.create(name='Rival Freight', slug='rival')
    seed_demo(other, NOW)
    user = User.objects.create_user('both@acme.test', PASSWORD)
    Membership.objects.create(user=user, organization=other)
    token = client.post('/api/v1/auth/login/', {'email': user.email, 'password': PASSWORD}, format='json').data[
        'access'
    ]
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
    assert client.get('/api/v1/orgs/rival/snapshot/').status_code == 200
    assert client.get(f'{API}/snapshot/').status_code == 404


def test_lists_filter_by_site_and_status(operation: APIClient) -> None:
    oak = Site.objects.get(code='OAK')
    trucks = operation.get(f'{API}/trucks/', {'site': str(oak.id)}).json()
    assert trucks['count'] == 5
    unloading = operation.get(f'{API}/trucks/', {'status': 'unloading'}).json()
    assert sorted(t['name'] for t in unloading['results']) == ['CBX-402', 'LGX-8847', 'LSF-221']
    assert operation.get(f'{API}/trucks/', {'site': 'not-a-uuid'}).status_code == 400


def test_site_kpis_match_the_front_end_definitions(operation: APIClient) -> None:
    sites = {s.code: s.id for s in Site.objects.all()}
    assert operation.get(f'{API}/sites/{sites["OAK"]}/kpis/').json() == {
        'onTimeRate': 1.0, 'completed': 3, 'docksInUse': 2, 'docksOperational': 6,
        'activeTrucks': 4, 'trucks': 5, 'lowStock': 4, 'items': 14, 'delayed': 2,
    }  # fmt: skip
    dal = operation.get(f'{API}/sites/{sites["DAL"]}/kpis/').json()
    assert dal['onTimeRate'] == pytest.approx(2 / 3)
    assert (dal['docksInUse'], dal['docksOperational'], dal['lowStock'], dal['delayed']) == (2, 5, 3, 0)
    mia = operation.get(f'{API}/sites/{sites["MIA"]}/kpis/').json()
    assert (mia['activeTrucks'], mia['trucks'], mia['delayed']) == (3, 3, 1)
