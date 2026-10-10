import type { ApiInvitation, ApiInvitationCreated, ApiMember } from '../api/contract.ts';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '../api/http.ts';
import type { Role } from '../domain/permissions.ts';
import { useWarehouse } from '../store/warehouseStore.ts';

/** Team calls for the organization in focus. Errors come back as readable messages. */

export type Result<T> = { ok: true; value: T } | { ok: false; message: string };

async function attempt<T>(call: (org: string) => Promise<T>): Promise<Result<T>> {
  const workspace = useWarehouse.getState().workspace;
  if (!workspace) return { ok: false, message: 'Not signed in to an organization.' };
  try {
    return { ok: true, value: await call(encodeURIComponent(workspace.slug)) };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, message: error.message };
    return { ok: false, message: 'The server could not be reached. Check your connection, then retry.' };
  }
}

export const listMembers = () => attempt((org) => apiGet<ApiMember[]>(`/orgs/${org}/members/`));

export const listInvitations = () => attempt((org) => apiGet<ApiInvitation[]>(`/orgs/${org}/invitations/`));

export const changeRole = (userId: string, role: Role) =>
  attempt((org) => apiPatch<ApiMember>(`/orgs/${org}/members/${userId}/`, { role }));

export const removeMember = (userId: string) => attempt((org) => apiDelete(`/orgs/${org}/members/${userId}/`));

export const invite = (email: string, role: Role) =>
  attempt((org) => apiPost<ApiInvitationCreated>(`/orgs/${org}/invitations/`, { email, role }));

export const revokeInvitation = (id: string) => attempt((org) => apiDelete(`/orgs/${org}/invitations/${id}/`));
