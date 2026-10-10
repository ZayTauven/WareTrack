import pytest
from django.conf import settings
from django.core.cache import cache
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from apps.accounts.models import User
from testing import PASSWORD

COOKIE = settings.REFRESH_COOKIE['key']


def login(client: APIClient, email: str, password: str = PASSWORD):
    return client.post('/api/v1/auth/login/', {'email': email, 'password': password}, format='json')


def test_login_returns_access_and_sets_a_locked_down_refresh_cookie(client: APIClient, member: User) -> None:
    response = login(client, member.email.upper())  # email is case-insensitive

    assert response.status_code == 200
    assert response.data['access']
    assert 'refresh' not in response.data  # never exposed to JavaScript
    assert response.data['user']['email'] == member.email
    assert response.data['user']['organizations'] == [{'slug': 'acme', 'name': 'Acme Logistics', 'role': 'operator'}]
    cookie = response.cookies[COOKIE]
    assert cookie['httponly'] is True
    assert cookie['samesite'] == 'Strict'
    assert cookie['path'] == '/api/v1/auth/'


def test_login_rejects_bad_credentials(client: APIClient, member: User) -> None:
    response = login(client, member.email, 'wrong-password')
    assert response.status_code == 401
    assert COOKIE not in response.cookies


def test_refresh_rotates_and_a_used_token_cannot_be_replayed(client: APIClient, member: User) -> None:
    first = login(client, member.email).cookies[COOKIE].value

    refreshed = client.post('/api/v1/auth/refresh/')
    assert refreshed.status_code == 200
    assert refreshed.data['access']
    assert refreshed.cookies[COOKIE].value != first

    replay = APIClient()
    replay.cookies[COOKIE] = first
    response = replay.post('/api/v1/auth/refresh/')
    assert response.status_code == 401
    assert response.cookies[COOKIE].value == ''  # cleared


def test_refresh_without_cookie_is_unauthorized(client: APIClient) -> None:
    assert client.post('/api/v1/auth/refresh/').status_code == 401


def test_logout_revokes_the_refresh_token(client: APIClient, member: User) -> None:
    token = login(client, member.email).cookies[COOKIE].value
    response = client.post('/api/v1/auth/logout/')
    assert response.status_code == 204
    assert response.cookies[COOKIE].value == ''

    replay = APIClient()
    replay.cookies[COOKIE] = token
    assert replay.post('/api/v1/auth/refresh/').status_code == 401


def test_me_requires_a_bearer_token(authed: APIClient) -> None:
    assert APIClient().get('/api/v1/me/').status_code == 401
    assert authed.get('/api/v1/me/').data['email'] == 'ops@acme.test'


@pytest.mark.django_db
def test_login_is_throttled(client: APIClient, monkeypatch: pytest.MonkeyPatch) -> None:
    # Rates are read into the throttle class at import time, so patch the class itself.
    monkeypatch.setattr(ScopedRateThrottle, 'THROTTLE_RATES', {'login': '3/min'})
    cache.clear()
    try:
        statuses = [login(client, 'nobody@acme.test', 'x').status_code for _ in range(4)]
    finally:
        cache.clear()
    assert statuses[-1] == 429
