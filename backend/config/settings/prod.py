from .base import *  # noqa: F403
from .base import SIMPLE_JWT, env

ALLOWED_HOSTS = env.list('DJANGO_ALLOWED_HOSTS')
# Origins allowed to POST to Django forms (the admin) when served behind a proxy, e.g. https://app.example.com
CSRF_TRUSTED_ORIGINS = env.list('DJANGO_CSRF_TRUSTED_ORIGINS', default=[])

# A key of its own, so it can be rotated (logging every user out) without touching SECRET_KEY.
SIMPLE_JWT = {**SIMPLE_JWT, 'SIGNING_KEY': env('JWT_SIGNING_KEY')}

SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31_536_000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
# Preloading is a long-lived commitment for the whole domain: opt in per deployment.
SECURE_HSTS_PRELOAD = env.bool('SECURE_HSTS_PRELOAD', default=False)
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'
if not SECURE_HSTS_PRELOAD:
    SILENCED_SYSTEM_CHECKS = ['security.W021']
