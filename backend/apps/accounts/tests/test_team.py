from collections.abc import Callable
from datetime import timedelta

import pytest
from django.conf import settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Invitation, Membership, Organization, User
from testing import PASSWORD

API = '/api/v1/orgs/acme'
STRONG = 'Lorry-Dock-Pallet-42'


@pytest.fixture
def people(organization: Organization) -> dict[str, User]:
    """One member per role, plus a second owner."""
    users = {}
    for key, role in [
        ('owner', 'owner'),
        ('owner2', 'owner'),
        ('admin', 'admin'),
        ('operator', 'operator'),
        ('viewer', 'viewer'),
    ]:
        users[key] = User.objects.create_user(f'{key}@acme.test', PASSWORD)
        Membership.objects.create(user=users[key], organization=organization, role=role)
    return users


@pytest.fixture
def as_user(people: dict[str, User]) -> Callable[[str], APIClient]:
    def make(key: str) -> APIClient:
        client = APIClient()
        client.force_authenticate(people[key])
        return client

    return make


def role_of(user: User) -> str | None:
    membership = Membership.objects.filter(user=user, organization__slug='acme').first()
    return membership.role if membership else None


# --- Members ---------------------------------------------------------------------------


def test_every_member_sees_the_team(as_user) -> None:
    team = as_user('viewer').get(f'{API}/members/').json()
    assert {m['email']: m['role'] for m in team}['admin@acme.test'] == 'admin'
    assert len(team) == 5


def test_non_members_do_not_see_the_team(people, organization) -> None:
    outsider = User.objects.create_user('out@rival.test', PASSWORD)
    client = APIClient()
    client.force_authenticate(outsider)
    assert client.get(f'{API}/members/').status_code == 404


@pytest.mark.parametrize(
    ('actor', 'target', 'role', 'expected'),
    [
        ('admin', 'operator', 'viewer', 200),
        ('operator', 'viewer', 'operator', 403),
        ('viewer', 'operator', 'viewer', 403),
        ('admin', 'viewer', 'owner', 'owner_only'),  # granting owner needs an owner
        ('admin', 'owner', 'admin', 'owner_only'),  # changing an owner needs an owner
        ('owner', 'admin', 'owner', 200),
        ('owner', 'owner2', 'admin', 200),
        ('admin', 'admin', 'viewer', 'own_role'),
    ],
)
def test_role_changes_follow_the_rules(as_user, people, actor: str, target: str, role: str, expected) -> None:
    response = as_user(actor).patch(f'{API}/members/{people[target].id}/', {'role': role}, format='json')
    if isinstance(expected, int):
        assert response.status_code == expected
        if expected == 200:
            assert role_of(people[target]) == role
    else:
        assert (response.status_code, response.data['code']) == (409, expected)


def test_removing_members(as_user, people) -> None:
    admin = as_user('admin')
    assert admin.delete(f'{API}/members/{people["operator"].id}/').status_code == 204
    assert role_of(people['operator']) is None
    assert User.objects.filter(pk=people['operator'].pk).exists()  # the account itself stays

    assert admin.delete(f'{API}/members/{people["owner"].id}/').data['code'] == 'owner_only'
    assert admin.delete(f'{API}/members/{people["admin"].id}/').data['code'] == 'own_membership'
    assert as_user('viewer').delete(f'{API}/members/{people["admin"].id}/').status_code == 403


def test_an_organization_keeps_an_owner(as_user, people, organization) -> None:
    owner = as_user('owner')
    assert owner.delete(f'{API}/members/{people["owner2"].id}/').status_code == 204
    # The remaining owner cannot be demoted or removed by anyone else (only owners may, and it is the only one).
    assert (
        as_user('admin').patch(f'{API}/members/{people["owner"].id}/', {'role': 'admin'}, format='json').data['code']
        == 'owner_only'
    )
    assert Membership.objects.filter(organization=organization, role='owner').count() == 1


# --- Invitations --------------------------------------------------------------------------


def invite(client: APIClient, email: str, role: str = 'operator'):
    return client.post(f'{API}/invitations/', {'email': email, 'role': role}, format='json')


def token_of(response) -> str:
    return response.data['path'].removeprefix('/invite/')


def test_invites_and_shows_the_link_once(as_user) -> None:
    admin = as_user('admin')
    created = invite(admin, 'New.Hire@Acme.test')
    assert created.status_code == 201
    assert created.data['email'] == 'new.hire@acme.test'
    assert created.data['path'].startswith('/invite/')

    pending = admin.get(f'{API}/invitations/').json()
    assert [i['email'] for i in pending] == ['new.hire@acme.test']
    assert 'path' not in pending[0]  # never shown again
    stored = Invitation.objects.get()
    assert stored.token_hash != token_of(created)
    assert stored.token_hash == Invitation.digest(token_of(created))


@pytest.mark.parametrize(
    ('actor', 'email', 'role', 'expected'),
    [
        ('viewer', 'x@acme.test', 'viewer', 403),
        ('operator', 'x@acme.test', 'viewer', 403),
        ('admin', 'x@acme.test', 'owner', 'owner_only'),
        ('admin', 'operator@acme.test', 'viewer', 'already_member'),
        ('owner', 'x@acme.test', 'owner', 201),
    ],
)
def test_invitation_rules(as_user, actor: str, email: str, role: str, expected) -> None:
    response = invite(as_user(actor), email, role)
    if isinstance(expected, int):
        assert response.status_code == expected
    else:
        assert (response.status_code, response.data['code']) == (409, expected)


def test_a_new_invitation_replaces_the_open_one(as_user) -> None:
    admin = as_user('admin')
    first = token_of(invite(admin, 'x@acme.test'))
    second = token_of(invite(admin, 'x@acme.test', 'viewer'))
    public = APIClient()
    assert public.get(f'/api/v1/invitations/{first}/').data['status'] == 'revoked'
    assert public.get(f'/api/v1/invitations/{second}/').data['status'] == 'pending'


def test_accepting_creates_the_account_and_signs_in(as_user, organization) -> None:
    token = token_of(invite(as_user('admin'), 'new@acme.test'))
    public = APIClient()

    preview = public.get(f'/api/v1/invitations/{token}/').data
    assert (preview['organization'], preview['role'], preview['accountExists']) == ('Acme Logistics', 'operator', False)

    weak = public.post(f'/api/v1/invitations/{token}/accept/', {'password': '123'}, format='json')
    assert weak.data['code'] == 'weak_password'

    accepted = public.post(
        f'/api/v1/invitations/{token}/accept/', {'password': STRONG, 'firstName': 'Nora'}, format='json'
    )
    assert accepted.status_code == 200
    assert accepted.data['access']
    assert accepted.cookies[settings.REFRESH_COOKIE['key']]['httponly']
    assert accepted.data['user']['organizations'] == [{'slug': 'acme', 'name': 'Acme Logistics', 'role': 'operator'}]
    assert User.objects.get(email='new@acme.test').first_name == 'Nora'

    again = APIClient().post(f'/api/v1/invitations/{token}/accept/', {'password': STRONG}, format='json')
    assert again.data['code'] == 'invitation_unusable'


def test_an_existing_account_confirms_with_its_password(as_user, organization) -> None:
    User.objects.create_user('known@rival.test', PASSWORD)
    token = token_of(invite(as_user('admin'), 'known@rival.test', 'viewer'))
    public = APIClient()
    assert public.get(f'/api/v1/invitations/{token}/').data['accountExists'] is True

    wrong = public.post(f'/api/v1/invitations/{token}/accept/', {'password': 'not-it'}, format='json')
    assert wrong.data['code'] == 'wrong_password'
    right = public.post(f'/api/v1/invitations/{token}/accept/', {'password': PASSWORD}, format='json')
    assert right.status_code == 200
    assert role_of(User.objects.get(email='known@rival.test')) == 'viewer'


def test_revoked_and_expired_links_stop_working(as_user) -> None:
    admin = as_user('admin')
    revoked = invite(admin, 'gone@acme.test')
    assert admin.delete(f'{API}/invitations/{revoked.data["id"]}/').status_code == 204
    assert admin.get(f'{API}/invitations/').json() == []

    expired = invite(admin, 'late@acme.test')
    Invitation.objects.filter(pk=expired.data['id']).update(expires_at=timezone.now() - timedelta(minutes=1))

    public = APIClient()
    for token in (token_of(revoked), token_of(expired)):
        response = public.post(f'/api/v1/invitations/{token}/accept/', {'password': STRONG}, format='json')
        assert response.data['code'] == 'invitation_unusable'
    assert public.get(f'/api/v1/invitations/{token_of(expired)}/').data['status'] == 'expired'


@pytest.mark.django_db
def test_unknown_links_are_not_found() -> None:
    assert APIClient().get('/api/v1/invitations/not-a-real-token/').status_code == 404
