"""
Team management rules: members, roles and invitations.

- Managing the team needs the admin role (Ability.MANAGE_MEMBERS, checked by the views).
- Only an owner grants the owner role, or changes or removes an owner.
- An organization always keeps at least one owner.
- Nobody changes their own role or removes themselves here.
"""

import secrets
from datetime import datetime, timedelta
from uuid import UUID

from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction

from .models import Invitation, Membership, Organization, User

Role = Membership.Role
INVITATION_LIFETIME = timedelta(days=7)


class TeamRejected(Exception):
    """A team rule forbids the change. `code` is stable for clients; `message` is for people."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _target(organization: Organization, user_id: UUID) -> Membership:
    membership = (
        Membership.objects.select_for_update()
        .select_related('user')
        .filter(organization=organization, user_id=user_id)
        .first()
    )
    if membership is None:
        raise Membership.DoesNotExist
    return membership


def _owners(organization: Organization) -> int:
    return Membership.objects.filter(organization=organization, role=Role.OWNER).count()


def _guard_owner_rules(actor: Membership, target_role: str, new_role: str | None) -> None:
    involves_owner = target_role == Role.OWNER or new_role == Role.OWNER
    if involves_owner and actor.role != Role.OWNER:
        raise TeamRejected('owner_only', 'Only an owner can grant, change or remove the owner role.')


@transaction.atomic
def change_role(actor: Membership, user_id: UUID, role: str) -> Membership:
    target = _target(actor.organization, user_id)
    if target.user_id == actor.user_id:
        raise TeamRejected('own_role', 'You cannot change your own role.')
    _guard_owner_rules(actor, target.role, role)
    if target.role == Role.OWNER and role != Role.OWNER and _owners(actor.organization) == 1:
        raise TeamRejected('last_owner', 'The organization needs at least one owner.')
    target.role = role
    target.save(update_fields=['role'])
    return target


@transaction.atomic
def remove_member(actor: Membership, user_id: UUID) -> None:
    target = _target(actor.organization, user_id)
    if target.user_id == actor.user_id:
        raise TeamRejected('own_membership', 'You cannot remove yourself.')
    _guard_owner_rules(actor, target.role, None)
    if target.role == Role.OWNER and _owners(actor.organization) == 1:
        raise TeamRejected('last_owner', 'The organization needs at least one owner.')
    target.delete()


@transaction.atomic
def invite(actor: Membership, email: str, role: str, now: datetime) -> tuple[Invitation, str]:
    """Creates an invitation and returns it with its token (the only time the token exists in clear)."""
    email = email.strip().lower()
    _guard_owner_rules(actor, Role.VIEWER, role)
    if Membership.objects.filter(organization=actor.organization, user__email=email).exists():
        raise TeamRejected('already_member', f'{email} is already a member.')
    # A new invitation replaces any open one for the same address.
    Invitation.objects.filter(
        organization=actor.organization, email=email, accepted_at__isnull=True, revoked_at__isnull=True
    ).update(revoked_at=now)
    token = secrets.token_urlsafe(32)
    invitation = Invitation.objects.create(
        organization=actor.organization,
        email=email,
        role=role,
        token_hash=Invitation.digest(token),
        invited_by=actor.user,
        expires_at=now + INVITATION_LIFETIME,
    )
    return invitation, token


def revoke(actor: Membership, invitation_id: UUID, now: datetime) -> None:
    updated = Invitation.objects.filter(
        organization=actor.organization, pk=invitation_id, accepted_at__isnull=True, revoked_at__isnull=True
    ).update(revoked_at=now)
    if not updated:
        raise Invitation.DoesNotExist


def find_invitation(token: str) -> Invitation | None:
    return (
        Invitation.objects.select_related('organization', 'invited_by')
        .filter(token_hash=Invitation.digest(token))
        .first()
    )


@transaction.atomic
def accept(token: str, password: str, first_name: str, last_name: str, now: datetime) -> User:
    """
    Turns an open invitation into a membership. A new address gets an account with this password;
    an existing account must confirm with its current password.
    """
    invitation = (
        Invitation.objects.select_for_update()
        .select_related('organization')
        .filter(token_hash=Invitation.digest(token))
        .first()
    )
    if invitation is None or invitation.status(now) != 'pending':
        raise TeamRejected('invitation_unusable', 'This invitation link is no longer valid. Ask for a new one.')

    user = User.objects.filter(email=invitation.email).first()
    if user is None:
        candidate = User(email=invitation.email, first_name=first_name, last_name=last_name)
        try:
            validate_password(password, candidate)
        except ValidationError as error:
            raise TeamRejected('weak_password', ' '.join(error.messages)) from error
        user = User.objects.create_user(invitation.email, password, first_name=first_name, last_name=last_name)
    elif authenticate(email=invitation.email, password=password) is None:
        raise TeamRejected('wrong_password', 'An account already uses this email: enter its current password.')

    Membership.objects.update_or_create(
        user=user, organization=invitation.organization, defaults={'role': invitation.role}
    )
    invitation.accepted_at = now
    invitation.save(update_fields=['accepted_at'])
    return user
