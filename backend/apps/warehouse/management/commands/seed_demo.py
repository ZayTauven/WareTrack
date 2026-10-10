from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Membership, Organization, User
from apps.warehouse.seed import seed_demo
from config.settings.base import env


class Command(BaseCommand):
    help = 'Creates (or resets) the demo organization, its owner account and the demo operation.'

    @transaction.atomic
    def handle(self, *args: object, **options: object) -> None:
        email = env('DEMO_USER_EMAIL', default='')
        password = env('DEMO_USER_PASSWORD', default='')
        if not email or not password or password == 'change-me':
            raise CommandError('Set DEMO_USER_EMAIL and DEMO_USER_PASSWORD in backend/.env first.')

        organization, _ = Organization.objects.get_or_create(slug='demo', defaults={'name': 'Demo Logistics'})
        user, created = User.objects.get_or_create(email=email.lower())
        user.set_password(password)
        user.save()
        Membership.objects.update_or_create(
            user=user, organization=organization, defaults={'role': Membership.Role.OWNER}
        )

        # One account per lower role, on the owner's domain and with the same password, so each
        # interface can be tried as that role.
        domain = user.email.split('@')[1]
        accounts = [user.email]
        for role in (Membership.Role.OPERATOR, Membership.Role.VIEWER):
            member, _ = User.objects.get_or_create(email=f'{role}@{domain}')
            member.set_password(password)
            member.save()
            Membership.objects.update_or_create(user=member, organization=organization, defaults={'role': role})
            accounts.append(member.email)

        counts = seed_demo(organization, timezone.now())
        summary = ', '.join(f'{count} {name}' for name, count in counts.items())
        self.stdout.write(self.style.SUCCESS(f'{organization.name}: {summary}.'))
        self.stdout.write(
            f'Owner account {"created" if created else "reset"}: {user.email}. Role accounts: '
            f'{", ".join(accounts[1:])}. Password for all: DEMO_USER_PASSWORD in backend/.env.'
        )
