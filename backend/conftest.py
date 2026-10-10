"""Fixtures shared by every app's tests."""

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Membership, Organization, User
from apps.warehouse.seed import seed_demo
from testing import NOW, PASSWORD


@pytest.fixture
def organization(db: None) -> Organization:
    return Organization.objects.create(name='Acme Logistics', slug='acme')


@pytest.fixture
def seeded(organization: Organization) -> Organization:
    seed_demo(organization, NOW)
    return organization


@pytest.fixture
def member(organization: Organization) -> User:
    user = User.objects.create_user('ops@acme.test', PASSWORD)
    Membership.objects.create(user=user, organization=organization, role=Membership.Role.OPERATOR)
    return user


@pytest.fixture
def client() -> APIClient:
    return APIClient()


@pytest.fixture
def authed(client: APIClient, member: User) -> APIClient:
    response = client.post('/api/v1/auth/login/', {'email': member.email, 'password': PASSWORD}, format='json')
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {response.data["access"]}')
    return client
