"""
Authentication endpoints.

The access token (5 min) is returned in the body and kept in memory by the client.
The refresh token lives in an httpOnly, SameSite=Strict cookie scoped to /api/v1/auth/,
is rotated on every refresh and blacklisted after use, so a stolen one works at most once.
"""

from contextlib import suppress

from django.conf import settings
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Membership, User


class MembershipSerializer(serializers.ModelSerializer):
    slug = serializers.CharField(source='organization.slug')
    name = serializers.CharField(source='organization.name')

    class Meta:
        model = Membership
        fields = ['slug', 'name', 'role']


class MeSerializer(serializers.ModelSerializer):
    organizations = MembershipSerializer(source='memberships', many=True)
    firstName = serializers.CharField(source='first_name')  # the API speaks camelCase
    lastName = serializers.CharField(source='last_name')

    class Meta:
        model = User
        fields = ['id', 'email', 'firstName', 'lastName', 'organizations']


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)


SessionSerializer = inline_serializer('Session', {'access': serializers.CharField(), 'user': MeSerializer()})
AccessSerializer = inline_serializer('Access', {'access': serializers.CharField()})


def _with_refresh_cookie(response: Response, refresh: str) -> Response:
    cookie = settings.REFRESH_COOKIE
    response.set_cookie(
        cookie['key'],
        refresh,
        max_age=int(settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME'].total_seconds()),
        path=cookie['path'],
        httponly=cookie['httponly'],
        secure=cookie['secure'],
        samesite=cookie['samesite'],
    )
    return response


def _without_refresh_cookie(response: Response) -> Response:
    cookie = settings.REFRESH_COOKIE
    response.delete_cookie(cookie['key'], path=cookie['path'], samesite=cookie['samesite'])
    return response


class TokenEndpoint(APIView):
    """Public endpoints that answer 401 (not 403) when credentials are wrong.

    DRF downgrades 401 to 403 when a view has no authenticate header to send; these
    views authenticate by body or cookie, so they declare the Bearer scheme themselves.
    """

    authentication_classes: list = []
    permission_classes = [AllowAny]

    def get_authenticate_header(self, request: Request) -> str:
        return 'Bearer realm="api"'


def _me(user: User) -> dict:
    user = User.objects.prefetch_related('memberships__organization').get(pk=user.pk)
    return MeSerializer(user).data


class LoginView(TokenEndpoint):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'login'

    @extend_schema(request=LoginSerializer, responses={200: SessionSerializer}, auth=[])
    def post(self, request: Request) -> Response:
        credentials = LoginSerializer(data=request.data)
        credentials.is_valid(raise_exception=True)
        tokens = TokenObtainPairSerializer(
            data={
                'email': credentials.validated_data['email'].lower(),
                'password': credentials.validated_data['password'],
            }
        )
        tokens.is_valid(raise_exception=True)  # 401 on bad credentials
        body = {'access': tokens.validated_data['access'], 'user': _me(tokens.user)}
        return _with_refresh_cookie(Response(body), tokens.validated_data['refresh'])


class RefreshView(TokenEndpoint):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'refresh'

    @extend_schema(request=None, responses={200: AccessSerializer, 401: None}, auth=[])
    def post(self, request: Request) -> Response:
        refresh = request.COOKIES.get(settings.REFRESH_COOKIE['key'])
        if not refresh:
            return Response({'detail': 'Not signed in.'}, status=status.HTTP_401_UNAUTHORIZED)
        tokens = TokenRefreshSerializer(data={'refresh': refresh})
        try:
            tokens.is_valid(raise_exception=True)
        except TokenError as error:
            # simplejwt raises a bare TokenError for a blacklisted (replayed) token, which would be a 500.
            raise InvalidToken(str(error)) from error
        # expired, revoked or reused tokens all end as 401 here, and handle_exception clears the cookie
        return _with_refresh_cookie(
            Response({'access': tokens.validated_data['access']}), tokens.validated_data['refresh']
        )

    def handle_exception(self, exc: Exception) -> Response:
        # An invalid or reused refresh token must also clear the cookie.
        response = super().handle_exception(exc)
        if response.status_code == status.HTTP_401_UNAUTHORIZED:
            _without_refresh_cookie(response)
        return response


class LogoutView(TokenEndpoint):
    @extend_schema(request=None, responses={204: None}, auth=[])
    def post(self, request: Request) -> Response:
        refresh = request.COOKIES.get(settings.REFRESH_COOKIE['key'])
        if refresh:
            with suppress(TokenError):  # already invalid: nothing to revoke
                RefreshToken(refresh).blacklist()
        return _without_refresh_cookie(Response(status=status.HTTP_204_NO_CONTENT))


class MeView(APIView):
    @extend_schema(responses=MeSerializer)
    def get(self, request: Request) -> Response:
        return Response(_me(request.user))
