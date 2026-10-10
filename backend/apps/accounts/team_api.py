"""Team endpoints: members and invitations of an organization, plus the public invitation link."""

from uuid import UUID

from django.core.exceptions import ObjectDoesNotExist
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from apps.warehouse.serializers import ActionRejectedSerializer, ReadModelSerializer

from . import team
from .api import SessionSerializer, TokenEndpoint, _me, _with_refresh_cookie
from .models import Invitation, Membership, User
from .roles import Ability
from .scoping import ORG_PARAMETER, OrganizationScopedMixin, requires
from .team import TeamRejected

USER_PARAMETER = OpenApiParameter('user_id', OpenApiTypes.UUID, OpenApiParameter.PATH)
INVITATION_PARAMETER = OpenApiParameter('invitation_id', OpenApiTypes.UUID, OpenApiParameter.PATH)
TOKEN_PARAMETER = OpenApiParameter('token', OpenApiTypes.STR, OpenApiParameter.PATH)


# --- Serializers ------------------------------------------------------------------


class MemberSerializer(ReadModelSerializer):
    id = serializers.UUIDField(source='user.id')
    email = serializers.EmailField(source='user.email')
    firstName = serializers.CharField(source='user.first_name')
    lastName = serializers.CharField(source='user.last_name')
    joinedAt = serializers.DateTimeField(source='created_at')

    class Meta:
        model = Membership
        fields = ['id', 'email', 'firstName', 'lastName', 'role', 'joinedAt']


class InvitationSerializer(ReadModelSerializer):
    invitedBy = serializers.EmailField(source='invited_by.email', allow_null=True, default=None)
    createdAt = serializers.DateTimeField(source='created_at')
    expiresAt = serializers.DateTimeField(source='expires_at')

    class Meta:
        model = Invitation
        fields = ['id', 'email', 'role', 'invitedBy', 'createdAt', 'expiresAt']


class InvitationCreatedSerializer(InvitationSerializer):
    path = serializers.SerializerMethodField(help_text='Link path to share; shown only once.')

    class Meta(InvitationSerializer.Meta):
        fields = [*InvitationSerializer.Meta.fields, 'path']

    def get_path(self, invitation: Invitation) -> str:
        return f'/invite/{self.context["token"]}'


class InvitationPreviewSerializer(serializers.Serializer):
    organization = serializers.CharField()
    slug = serializers.SlugField(help_text='Organization slug, to open it once joined.')
    email = serializers.EmailField()
    role = serializers.ChoiceField(choices=Membership.Role.choices)
    status = serializers.ChoiceField(choices=['pending', 'expired', 'accepted', 'revoked'])
    expiresAt = serializers.DateTimeField()
    accountExists = serializers.BooleanField(help_text='True: confirm with the existing password.')


class RoleChangeSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=Membership.Role.choices)


class InviteSerializer(serializers.Serializer):
    email = serializers.EmailField()
    role = serializers.ChoiceField(choices=Membership.Role.choices)


class AcceptInvitationSerializer(serializers.Serializer):
    password = serializers.CharField(trim_whitespace=False, write_only=True)
    firstName = serializers.CharField(required=False, allow_blank=True, default='', max_length=150)
    lastName = serializers.CharField(required=False, allow_blank=True, default='', max_length=150)


def _rejected(error: TeamRejected) -> Response:
    return Response({'code': error.code, 'detail': error.message}, status=status.HTTP_409_CONFLICT)


# --- Members ----------------------------------------------------------------------


class MembersView(OrganizationScopedMixin, APIView):
    """Everyone in the organization, with their role. Visible to every member."""

    @extend_schema(parameters=[ORG_PARAMETER], responses=MemberSerializer(many=True))
    def get(self, request: Request, org: str) -> Response:
        members = (
            Membership.objects.filter(organization=self.get_organization())
            .select_related('user')
            .order_by('user__email')
        )
        return Response(MemberSerializer(members, many=True).data)


class MemberView(OrganizationScopedMixin, APIView):
    permission_classes = [IsAuthenticated, requires(Ability.MANAGE_MEMBERS)]

    @extend_schema(
        parameters=[ORG_PARAMETER, USER_PARAMETER],
        request=RoleChangeSerializer,
        responses={200: MemberSerializer, 409: ActionRejectedSerializer},
    )
    def patch(self, request: Request, org: str, user_id: UUID) -> Response:
        """Changes a member's role (admin; owner role changes need an owner)."""
        body = RoleChangeSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            membership = team.change_role(self.get_membership(), user_id, body.validated_data['role'])
        except TeamRejected as error:
            return _rejected(error)
        except ObjectDoesNotExist as error:
            raise NotFound from error
        return Response(MemberSerializer(membership).data)

    @extend_schema(parameters=[ORG_PARAMETER, USER_PARAMETER], responses={204: None, 409: ActionRejectedSerializer})
    def delete(self, request: Request, org: str, user_id: UUID) -> Response:
        """Removes someone from the organization (their account stays)."""
        try:
            team.remove_member(self.get_membership(), user_id)
        except TeamRejected as error:
            return _rejected(error)
        except ObjectDoesNotExist as error:
            raise NotFound from error
        return Response(status=status.HTTP_204_NO_CONTENT)


# --- Invitations --------------------------------------------------------------------


class InvitationsView(OrganizationScopedMixin, APIView):
    permission_classes = [IsAuthenticated, requires(Ability.MANAGE_MEMBERS)]

    @extend_schema(parameters=[ORG_PARAMETER], responses=InvitationSerializer(many=True))
    def get(self, request: Request, org: str) -> Response:
        """Invitations still waiting to be accepted."""
        open_invitations = Invitation.objects.filter(
            organization=self.get_organization(),
            accepted_at__isnull=True,
            revoked_at__isnull=True,
            expires_at__gt=timezone.now(),
        ).select_related('invited_by')
        return Response(InvitationSerializer(open_invitations, many=True).data)

    @extend_schema(
        parameters=[ORG_PARAMETER],
        request=InviteSerializer,
        responses={201: InvitationCreatedSerializer, 409: ActionRejectedSerializer},
    )
    def post(self, request: Request, org: str) -> Response:
        """Invites an email address with a role. The link is in the response, and only there."""
        body = InviteSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            invitation, token = team.invite(
                self.get_membership(), body.validated_data['email'], body.validated_data['role'], timezone.now()
            )
        except TeamRejected as error:
            return _rejected(error)
        data = InvitationCreatedSerializer(invitation, context={'token': token}).data
        return Response(data, status=status.HTTP_201_CREATED)


class InvitationView(OrganizationScopedMixin, APIView):
    permission_classes = [IsAuthenticated, requires(Ability.MANAGE_MEMBERS)]

    @extend_schema(parameters=[ORG_PARAMETER, INVITATION_PARAMETER], responses={204: None})
    def delete(self, request: Request, org: str, invitation_id: UUID) -> Response:
        """Revokes an invitation: its link stops working."""
        try:
            team.revoke(self.get_membership(), invitation_id, timezone.now())
        except ObjectDoesNotExist as error:
            raise NotFound from error
        return Response(status=status.HTTP_204_NO_CONTENT)


class PublicInvitationView(TokenEndpoint):
    """The invitation link itself: anyone holding it can see what it is for, and accept it."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'invite'

    @extend_schema(parameters=[TOKEN_PARAMETER], responses={200: InvitationPreviewSerializer, 404: None}, auth=[])
    def get(self, request: Request, token: str) -> Response:
        """What the invitation is for, so the page can show it before asking for a password."""
        invitation = team.find_invitation(token)
        if invitation is None:
            raise NotFound
        return Response(
            InvitationPreviewSerializer(
                {
                    'organization': invitation.organization.name,
                    'slug': invitation.organization.slug,
                    'email': invitation.email,
                    'role': invitation.role,
                    'status': invitation.status(timezone.now()),
                    'expiresAt': invitation.expires_at,
                    'accountExists': User.objects.filter(email=invitation.email).exists(),
                }
            ).data
        )


class AcceptInvitationView(TokenEndpoint):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'invite'

    @extend_schema(
        parameters=[TOKEN_PARAMETER],
        request=AcceptInvitationSerializer,
        responses={200: SessionSerializer, 409: ActionRejectedSerializer},
        auth=[],
    )
    def post(self, request: Request, token: str) -> Response:
        """Accepts the invitation and signs in: same answer and refresh cookie as login."""
        body = AcceptInvitationSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            user = team.accept(
                token,
                body.validated_data['password'],
                body.validated_data['firstName'],
                body.validated_data['lastName'],
                timezone.now(),
            )
        except TeamRejected as error:
            return _rejected(error)
        refresh = RefreshToken.for_user(user)
        response = Response({'access': str(refresh.access_token), 'user': _me(user)})
        return _with_refresh_cookie(response, str(refresh))
