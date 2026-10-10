import random
import time

from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.utils import timezone

from apps.accounts.models import Organization
from apps.warehouse.actions import operation_lock
from apps.warehouse.realtime import broadcast, patch_payload
from apps.warehouse.simulation import Operation, persist, simulate_tick


class Command(BaseCommand):
    help = 'Runs the live operation simulator: one tick per interval, written to the database and broadcast.'

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument('--interval', type=float, default=2.0, help='Seconds between ticks (default 2).')
        parser.add_argument('--org', help='Only this organization (slug). Default: every organization with sites.')
        parser.add_argument('--ticks', type=int, default=0, help='Stop after this many ticks (default: run forever).')
        parser.add_argument('--seed', type=int, help='Seed the random generator for a reproducible run.')

    def handle(
        self, *args: object, interval: float, org: str | None, ticks: int, seed: int | None, **options: object
    ) -> None:
        organizations = Organization.objects.filter(sites__isnull=False).distinct()
        if org:
            organizations = organizations.filter(slug=org)
        if not organizations.exists():
            raise CommandError('No organization with sites to simulate. Run seed_demo first.')

        rng = random.Random(seed)
        self.stdout.write(f'Simulating {", ".join(o.slug for o in organizations)} every {interval:g}s. Ctrl+C to stop.')
        tick = 0
        try:
            while not ticks or tick < ticks:
                started = time.monotonic()
                tick += 1
                for organization in organizations:
                    # Reload every tick: the worker holds no state, so edits made elsewhere are picked up.
                    # The lock is the one operator actions take: a tick never overwrites an action
                    # with state read before it.
                    with operation_lock(organization):
                        operation = Operation.load(organization)
                        now = timezone.now()
                        journal = simulate_tick(operation, now, rng)
                        persist(operation, journal)
                    broadcast(organization, patch_payload(journal, now))
                    if options['verbosity'] > 1:
                        self.stdout.write(f'tick {tick} · {organization.slug}: {len(journal.saves)} changes')
                time.sleep(max(0.0, interval - (time.monotonic() - started)))
        except KeyboardInterrupt:
            self.stdout.write('Stopped.')
