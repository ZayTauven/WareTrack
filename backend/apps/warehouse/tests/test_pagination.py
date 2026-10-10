from rest_framework.request import Request
from rest_framework.test import APIRequestFactory

from apps.warehouse.pagination import BoundedLimitOffsetPagination


def test_page_size_is_capped() -> None:
    request = Request(APIRequestFactory().get('/', {'limit': '1000000'}))
    assert BoundedLimitOffsetPagination().get_limit(request) == 500
