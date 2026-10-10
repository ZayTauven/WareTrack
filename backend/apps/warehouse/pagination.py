from rest_framework.pagination import LimitOffsetPagination


class BoundedLimitOffsetPagination(LimitOffsetPagination):
    """Limit/offset pages with a ceiling, so `?limit=` cannot pull a whole table in one request."""

    max_limit = 500
