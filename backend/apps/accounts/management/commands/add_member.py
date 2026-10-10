import getpass
import os

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.db import transaction

from apps.accounts.models import Membership, Organization, User


class Command(BaseCommand):
    help = (
        'Creates a user (or updates an existing one) and gives them a role in an organization. '
        'The password comes from $MEMBER_PASSWORD or is prompted for; it is never a command-line argument.'
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument('email')
        parser.add_argument('--org', default='demo', help='Organization slug (default: demo).')
        parser.add_argument('--role', choices=Membership.Role.values, default=Membership.Role.VIEWER)
        parser.add_argument('--first-name', default='')
        parser.add_argument('--last-name', default='')
        parser.add_argument('--superuser', action='store_true', help='Also give access to the Django admin.')
        parser.add_argument('--keep-password', action='store_true', help='Existing user: leave the password as is.')

    def handle(self, *args: object, email: str, org: str, role: str, **options: object) -> None:
        organization = Organization.objects.filter(slug=org).first()
        if organization is None:
            raise CommandError(f'No organization "{org}". Run seed_demo first, or pass --org.')

        user = User.objects.filter(email=email.lower()).first()
        password = None
        if user is None or not options['keep_password']:
            password = os.environ.get('MEMBER_PASSWORD') or self._prompt()
            try:
                validate_password(password, user or User(email=email.lower()))
            except ValidationError as error:
                raise CommandError(' '.join(error.messages)) from error

        with transaction.atomic():
            created = user is None
            if created:
                user = User.objects.create_user(email, password)
            elif password:
                user.set_password(password)
            user.first_name = options['first_name'] or user.first_name
            user.last_name = options['last_name'] or user.last_name
            if options['superuser']:
                user.is_staff = user.is_superuser = True
            user.save()
            Membership.objects.update_or_create(user=user, organization=organization, defaults={'role': role})

        admin = ' + Django admin' if user.is_superuser else ''
        self.stdout.write(
            self.style.SUCCESS(
                f'{"Created" if created else "Updated"} {user.email}: {role} of {organization.name}{admin}.'
            )
        )

    def _prompt(self) -> str:
        first = getpass.getpass('Password: ')
        if first != getpass.getpass('Password (again): '):
            raise CommandError('The passwords do not match.')
        return first
