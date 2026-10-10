from .base import *  # noqa: F403

# Hashing is the slowest part of tests that create users; security is irrelevant here.
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
