from django.urls import path

from .realtime import OperationConsumer

websocket_urlpatterns = [
    path('ws/v1/orgs/<slug:org>/live/', OperationConsumer.as_asgi()),
]
