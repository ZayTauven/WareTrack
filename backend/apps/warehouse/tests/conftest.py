from datetime import UTC, datetime

import pytest

from apps.accounts.models import Organization
from apps.warehouse.seed import seed_demo

NOW = datetime(2026, 10, 10, 14, 0, tzinfo=UTC)


@pytest.fixture
def organization(db: None) -> Organization:
    return Organization.objects.create(name='Acme Logistics', slug='acme')


@pytest.fixture
def seeded(organization: Organization) -> Organization:
    seed_demo(organization, NOW)
    return organization
