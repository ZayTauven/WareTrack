"""
Who may do what. Roles are ordered; each ability needs a minimum role.

The front end mirrors this table (src/domain/permissions.ts) to show only what a user can do,
but the server is the authority: every write checks it.
"""

from enum import StrEnum

from .models import Membership

Role = Membership.Role

RANK = {Role.VIEWER: 0, Role.OPERATOR: 1, Role.ADMIN: 2, Role.OWNER: 3}


class Ability(StrEnum):
    DOCK_TRUCK = 'truck.dock'
    ASSIGN_FORKLIFT = 'forklift.assign'
    CHARGE_FORKLIFT = 'forklift.charge'
    SET_DOCK_STATE = 'dock.state'


REQUIRED_ROLE: dict[Ability, str] = {
    Ability.DOCK_TRUCK: Role.OPERATOR,
    Ability.ASSIGN_FORKLIFT: Role.OPERATOR,
    Ability.CHARGE_FORKLIFT: Role.OPERATOR,
    Ability.SET_DOCK_STATE: Role.ADMIN,
}


def can(role: str, ability: Ability) -> bool:
    return RANK.get(role, -1) >= RANK[REQUIRED_ROLE[ability]]
