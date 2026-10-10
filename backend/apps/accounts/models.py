import hashlib
import uuid
from datetime import datetime

from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models


class UserManager(BaseUserManager):
    """Users sign in with their email; there is no username."""

    use_in_migrations = True

    def _create(self, email: str, password: str | None, **extra: object) -> 'User':
        if not email:
            raise ValueError('An email is required.')
        user = self.model(email=self.normalize_email(email).lower(), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email: str, password: str | None = None, **extra: object) -> 'User':
        extra.setdefault('is_staff', False)
        extra.setdefault('is_superuser', False)
        return self._create(email, password, **extra)

    def create_superuser(self, email: str, password: str | None = None, **extra: object) -> 'User':
        extra.update(is_staff=True, is_superuser=True)
        return self._create(email, password, **extra)


class User(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    username = None
    email = models.EmailField(unique=True)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS: list[str] = []

    objects = UserManager()

    class Meta:
        ordering = ['email']

    def __str__(self) -> str:
        return self.email


class Organization(models.Model):
    """The tenant. Every warehouse record belongs to exactly one organization through its site."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=60, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    members = models.ManyToManyField(User, through='Membership', related_name='organizations')

    class Meta:
        ordering = ['name']

    def __str__(self) -> str:
        return self.name


class Membership(models.Model):
    class Role(models.TextChoices):
        OWNER = 'owner', 'Owner'
        ADMIN = 'admin', 'Admin'
        OPERATOR = 'operator', 'Operator'
        VIEWER = 'viewer', 'Viewer'

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='memberships')
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='memberships')
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.VIEWER)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['user', 'organization'], name='one_membership_per_org')]

    def __str__(self) -> str:
        return f'{self.user} · {self.organization} ({self.role})'


class Invitation(models.Model):
    """
    A single-use link inviting an email address into an organization with a role.

    Only a SHA-256 digest of the token is stored: the link is shown once, at creation, and a
    database leak does not hand out working invitations.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='invitations')
    email = models.EmailField()
    role = models.CharField(max_length=16, choices=Membership.Role.choices)
    token_hash = models.CharField(max_length=64, unique=True)
    invited_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    accepted_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['organization', 'email'],
                condition=models.Q(accepted_at__isnull=True, revoked_at__isnull=True),
                name='one_open_invitation_per_email',
            ),
        ]

    def __str__(self) -> str:
        return f'{self.email} → {self.organization} ({self.role})'

    @staticmethod
    def digest(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    def status(self, now: datetime) -> str:
        if self.accepted_at:
            return 'accepted'
        if self.revoked_at:
            return 'revoked'
        return 'expired' if self.expires_at <= now else 'pending'
