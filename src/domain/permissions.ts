/**
 * Who may do what: mirror of backend/apps/accounts/roles.py, used to show only the actions a user
 * can take. The server enforces it on every write; this copy only shapes the interface.
 */

export type Role = 'viewer' | 'operator' | 'admin' | 'owner';

export type Ability = 'truck.dock' | 'forklift.assign' | 'forklift.charge' | 'dock.state';

const RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2, owner: 3 };

const REQUIRED_ROLE: Record<Ability, Role> = {
  'truck.dock': 'operator',
  'forklift.assign': 'operator',
  'forklift.charge': 'operator',
  'dock.state': 'admin',
};

export const ROLE_LABEL: Record<Role, string> = { viewer: 'Viewer', operator: 'Operator', admin: 'Admin', owner: 'Owner' };

export function can(role: string | undefined, ability: Ability): boolean {
  const rank = role && role in RANK ? RANK[role as Role] : -1;
  return rank >= RANK[REQUIRED_ROLE[ability]];
}

/** The lowest role that grants an ability, to explain why an action is unavailable. */
export const requiredRole = (ability: Ability): Role => REQUIRED_ROLE[ability];
