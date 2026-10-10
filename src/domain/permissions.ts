/**
 * Who may do what: mirror of backend/apps/accounts/roles.py, used to show only the actions a user
 * can take. The server enforces it on every write; this copy only shapes the interface.
 */

export type Role = 'viewer' | 'operator' | 'admin' | 'owner';

export type Ability = 'truck.dock' | 'forklift.assign' | 'forklift.charge' | 'dock.state' | 'members.manage';

const RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2, owner: 3 };

const REQUIRED_ROLE: Record<Ability, Role> = {
  'truck.dock': 'operator',
  'forklift.assign': 'operator',
  'forklift.charge': 'operator',
  'dock.state': 'admin',
  'members.manage': 'admin',
};

export const ROLES: Role[] = ['viewer', 'operator', 'admin', 'owner'];

/** Roles an actor may give (or take away): the owner role is for owners to grant. */
export function assignableRoles(actor: string | undefined): Role[] {
  if (!can(actor, 'members.manage')) return [];
  return actor === 'owner' ? ROLES : ROLES.filter((role) => role !== 'owner');
}

/** Whether an actor may change or remove a member with `target` role (backend: team.py). */
export function canManageMember(actor: string | undefined, target: string, isSelf: boolean): boolean {
  if (isSelf || !can(actor, 'members.manage')) return false;
  return target !== 'owner' || actor === 'owner';
}

export const ROLE_LABEL: Record<Role, string> = { viewer: 'Viewer', operator: 'Operator', admin: 'Admin', owner: 'Owner' };

export function can(role: string | undefined, ability: Ability): boolean {
  const rank = role && role in RANK ? RANK[role as Role] : -1;
  return rank >= RANK[REQUIRED_ROLE[ability]];
}

/** The lowest role that grants an ability, to explain why an action is unavailable. */
export const requiredRole = (ability: Ability): Role => REQUIRED_ROLE[ability];
