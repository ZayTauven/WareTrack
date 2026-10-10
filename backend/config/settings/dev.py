from .base import *  # noqa: F403
from .base import env

DEBUG = True
ALLOWED_HOSTS = env.list('DJANGO_ALLOWED_HOSTS', default=['localhost', '127.0.0.1'])

# Plain http on localhost: the browser would drop a Secure cookie.
REFRESH_COOKIE = {**REFRESH_COOKIE, 'secure': False}  # noqa: F405
