"""
Tenant scoping shared by every organization URL (/api/v1/orgs/{org}/...).

The organization is looked up among the caller's memberships, so a non-member gets 404 (its
existence is not disclosed), and the membership found carries the caller's role for permissions.
"""

from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter
from rest_framework.permissions import BasePermission
from rest_framework.request import Request

from .models import Membership, Organization
from .roles import Ability, can

ORG_PARAMETER = OpenApiParameter('org', OpenApiTypes.STR, OpenApiParameter.PATH, description='Organization slug.')


class OrganizationScopedMixin:
    request: Request
    kwargs: dict

    def get_membership(self) -> Membership:
        """The caller's membership in the organization of the URL; 404 if there is none."""
        if not hasattr(self, '_membership'):
            self._membership = get_object_or_404(
                Membership.objects.select_related('organization', 'user'),
                user=self.request.user,
                organization__slug=self.kwargs['org'],
            )
        return self._membership

    def get_organization(self) -> Organization:
        return self.get_membership().organization


def requires(ability: Ability) -> type[BasePermission]:
    """Permission: the caller's role in the URL's organization grants `ability`."""

    class RoleAllows(BasePermission):
        message = f'Your role does not allow this ({ability.value}).'

        def has_permission(self, request: Request, view: OrganizationScopedMixin) -> bool:
            return can(view.get_membership().role, ability)

    return RoleAllows
