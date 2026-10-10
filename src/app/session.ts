import type { ApiMe, ApiSnapshot, LivePatch } from '../api/contract.ts';
import { acceptInvitation, ApiError, apiGet, fetchMe, refreshSession, signIn, signOut } from '../api/http.ts';
import { startLiveFeed } from '../api/live.ts';
import { useWarehouse } from '../store/warehouseStore.ts';

/**
 * Session and data flow: sign-in, the live feed and snapshot loading.
 *
 * Ordering matters. The feed is opened before the snapshot is fetched, and patches that arrive
 * meanwhile are held, then replayed on top of the snapshot. Merging ignores rows older than what
 * the snapshot holds, so the result is right whichever came first. The same applies to a resync
 * after a dropped connection.
 */

const store = useWarehouse;
let stopFeed: (() => void) | null = null;
let held: LivePatch[] | null = null;
let booted = false;

/** Restores a session from the refresh cookie, once per page load. */
export function boot(): void {
  if (booted) return;
  booted = true;
  void restore();
}

async function restore(): Promise<void> {
  store.setState({ status: 'booting' });
  const token = await refreshSession();
  if (!token) {
    store.getState().reset('signed-out');
    return;
  }
  try {
    await enter(await fetchMe());
  } catch {
    store.getState().reset('signed-out');
  }
}

/** Signs in, then opens the user's organization. Errors are for the sign-in form to show. */
export async function signInWithPassword(email: string, password: string): Promise<void> {
  const session = await signIn(email, password);
  await enter(session.user);
}

/** Accepts an invitation (which signs in), then opens the organization it was for. */
export async function joinWithInvitation(
  token: string,
  organizationName: string,
  details: { password: string; firstName?: string; lastName?: string },
): Promise<void> {
  booted = true; // the invitation replaces the session restore
  const session = await acceptInvitation(token, details);
  const joined = session.user.organizations.find((o) => o.name === organizationName);
  await enter(session.user, joined?.slug);
}

/** Opens another organization the user belongs to. */
export async function switchWorkspace(slug: string): Promise<void> {
  const { user, workspace } = store.getState();
  if (!user || workspace?.slug === slug) return;
  stopFeed?.();
  stopFeed = null;
  store.getState().reset('signed-out');
  await enter(user, slug);
}

export async function signOutNow(): Promise<void> {
  stopFeed?.();
  stopFeed = null;
  await signOut();
  store.getState().reset('signed-out');
}

/** Retries loading the operation after a failure. */
export function retryLoading(): void {
  const workspace = store.getState().workspace;
  if (!workspace) return void restore();
  store.setState({ status: 'loading', notice: null });
  openFeed(workspace.slug);
  void resync(workspace.slug);
}

async function enter(user: ApiMe, slug?: string): Promise<void> {
  const workspace = user.organizations.find((o) => o.slug === slug) ?? user.organizations[0];
  if (!workspace) {
    store.setState({ user, status: 'failed', notice: 'Your account is not part of an organization yet. Ask an admin to invite you.' });
    return;
  }
  store.setState({ user, workspace, status: 'loading', notice: null });
  openFeed(workspace.slug);
  await resync(workspace.slug);
}

function openFeed(org: string): void {
  stopFeed?.();
  stopFeed = startLiveFeed({
    org,
    onPatch: (patch) => (held ? held.push(patch) : store.getState().applyPatch(patch)),
    onStatus: (live) => store.setState({ live }),
    onResync: () => void resync(org),
    onSignedOut: expire,
  });
}

async function resync(org: string): Promise<void> {
  held = [];
  try {
    const snapshot = await apiGet<ApiSnapshot>(`/orgs/${encodeURIComponent(org)}/snapshot/`);
    const pending = held;
    held = null;
    store.getState().loadSnapshot(snapshot);
    pending.forEach((patch) => store.getState().applyPatch(patch));
  } catch (error) {
    held = null;
    if (error instanceof ApiError && error.status === 401) return expire();
    // During a live session keep showing the last known state; the feed will retry.
    if (store.getState().status !== 'ready') {
      store.setState({ status: 'failed', notice: 'The operation could not be loaded. Check your connection, then retry.' });
    }
  }
}

function expire(): void {
  stopFeed?.();
  stopFeed = null;
  store.getState().reset('signed-out', 'Your session has ended. Sign in again.');
}
