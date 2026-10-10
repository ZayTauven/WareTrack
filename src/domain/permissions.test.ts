import { describe, expect, it } from 'vitest';
import { assignableRoles, can, canManageMember, requiredRole } from './permissions.ts';

describe('permissions', () => {
  it('lets operators run the floor and only admins change docks', () => {
    expect(can('viewer', 'truck.dock')).toBe(false);
    expect(can('operator', 'truck.dock')).toBe(true);
    expect(can('operator', 'forklift.assign')).toBe(true);
    expect(can('operator', 'dock.state')).toBe(false);
    expect(can('admin', 'dock.state')).toBe(true);
    expect(can('owner', 'dock.state')).toBe(true);
  });

  it('grants nothing to an unknown or missing role', () => {
    expect(can(undefined, 'truck.dock')).toBe(false);
    expect(can('superuser', 'truck.dock')).toBe(false);
  });

  it('names the role an action needs', () => {
    expect(requiredRole('dock.state')).toBe('admin');
  });

  it('keeps the owner role for owners to grant', () => {
    expect(assignableRoles('owner')).toEqual(['viewer', 'operator', 'admin', 'owner']);
    expect(assignableRoles('admin')).toEqual(['viewer', 'operator', 'admin']);
    expect(assignableRoles('operator')).toEqual([]);
  });

  it('lets admins manage everyone but owners and themselves', () => {
    expect(canManageMember('admin', 'operator', false)).toBe(true);
    expect(canManageMember('admin', 'owner', false)).toBe(false);
    expect(canManageMember('owner', 'owner', false)).toBe(true);
    expect(canManageMember('owner', 'viewer', true)).toBe(false);
    expect(canManageMember('viewer', 'viewer', false)).toBe(false);
  });
});
