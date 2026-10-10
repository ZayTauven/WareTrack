from .base import *  # noqa: F403
from .base import REST_FRAMEWORK

# Hashing is the slowest part of tests that create users; security is irrelevant here.
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']

# Throttling is covered by its own test; elsewhere it would make tests order-dependent.
REST_FRAMEWORK = {
    **REST_FRAMEWORK,
    'DEFAULT_THROTTLE_RATES': {'user': '10000/min', 'login': '1000/min', 'refresh': '1000/min', 'invite': '1000/min'},
}

# No Redis needed to test the real-time path.
CHANNEL_LAYERS = {'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}}
