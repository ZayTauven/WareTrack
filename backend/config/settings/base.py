"""Settings shared by every environment. Secrets and hosts come from the environment."""

from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()
environ.Env.read_env(BASE_DIR / '.env')

SECRET_KEY = env('DJANGO_SECRET_KEY')
DEBUG = False
ALLOWED_HOSTS: list[str] = env.list('DJANGO_ALLOWED_HOSTS', default=[])

INSTALLED_APPS = [
    'daphne',  # first: makes runserver an ASGI server, so WebSockets work in development
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'rest_framework_simplejwt.token_blacklist',
    'drf_spectacular',
    'apps.accounts',
    'apps.warehouse',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

DATABASES = {'default': env.db('DATABASE_URL')}
DATABASES['default']['CONN_MAX_AGE'] = env.int('DB_CONN_MAX_AGE', default=60)
DATABASES['default']['CONN_HEALTH_CHECKS'] = True

AUTH_USER_MODEL = 'accounts.User'
# Argon2 first (memory-hard); the others only verify hashes created before the switch.
PASSWORD_HASHERS = [
    'django.contrib.auth.hashers.Argon2PasswordHasher',
    'django.contrib.auth.hashers.PBKDF2PasswordHasher',
]
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 10}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# --- API ---------------------------------------------------------------------

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': ['rest_framework_simplejwt.authentication.JWTAuthentication'],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'DEFAULT_RENDERER_CLASSES': ['rest_framework.renderers.JSONRenderer'],
    'DEFAULT_PARSER_CLASSES': ['rest_framework.parsers.JSONParser'],
    'DEFAULT_PAGINATION_CLASS': 'apps.warehouse.pagination.BoundedLimitOffsetPagination',
    'PAGE_SIZE': 100,
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
    'DEFAULT_THROTTLE_CLASSES': ['rest_framework.throttling.UserRateThrottle'],
    'DEFAULT_THROTTLE_RATES': {'user': '600/min', 'login': '10/min', 'refresh': '30/min', 'invite': '20/min'},
    # Proxies in front of the app. Throttles identify clients by REMOTE_ADDR unless this says how
    # many trusted X-Forwarded-For hops to skip; left unset, DRF would trust a client-supplied header
    # and anyone could dodge the login throttle by sending a new X-Forwarded-For on every attempt.
    'NUM_PROXIES': env.int('NUM_PROXIES', default=0),
}

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=5),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'UPDATE_LAST_LOGIN': True,
    'SIGNING_KEY': env('JWT_SIGNING_KEY', default=SECRET_KEY),
}

# The refresh token never reaches JavaScript: httpOnly cookie, scoped to the auth endpoints.
REFRESH_COOKIE = {
    'key': 'waretrack_refresh',
    'path': '/api/v1/auth/',
    'httponly': True,
    'secure': env.bool('REFRESH_COOKIE_SECURE', default=True),
    'samesite': 'Strict',
}

SPECTACULAR_SETTINGS = {
    'TITLE': 'WareTrack API',
    'DESCRIPTION': 'Multi-tenant warehouse operations: sites, docks, racks, trucks, forklifts, inventory, shipments.',
    'VERSION': '1.0.0',
    'SERVE_INCLUDE_SCHEMA': False,
    'COMPONENT_SPLIT_REQUEST': True,
    'ENUM_NAME_OVERRIDES': {
        'TruckStatusEnum': 'apps.warehouse.models.Truck.Status',
        'ForkliftStatusEnum': 'apps.warehouse.models.Forklift.Status',
        'ShipmentStatusEnum': 'apps.warehouse.models.Shipment.Status',
        'MembershipRoleEnum': 'apps.accounts.models.Membership.Role',
    },
}

# --- Logging --------------------------------------------------------------------

# Containers log to stdout. Security events (bad Host headers, suspicious operations) are kept.
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {'plain': {'format': '{asctime} {levelname} {name} {message}', 'style': '{'}},
    'handlers': {'console': {'class': 'logging.StreamHandler', 'formatter': 'plain'}},
    'root': {'handlers': ['console'], 'level': env('LOG_LEVEL', default='INFO')},
    'loggers': {
        'django.security': {'handlers': ['console'], 'level': 'WARNING', 'propagate': False},
        'django.request': {'handlers': ['console'], 'level': 'ERROR', 'propagate': False},
    },
}

ADMIN_URL = env('DJANGO_ADMIN_URL', default='admin/')

# --- Real time ----------------------------------------------------------------

CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels_redis.core.RedisChannelLayer',
        'CONFIG': {'hosts': [env('REDIS_URL', default='redis://localhost:6379/0')]},
    }
}
