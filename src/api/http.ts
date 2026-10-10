import type { ApiMe, ApiSession } from './contract.ts';

/**
 * HTTP client for /api/v1.
 *
 * The access token lives in this module only (memory, never storage), so it cannot outlive the
 * tab or be read by injected scripts that look at storage. The refresh token is an httpOnly cookie
 * the browser sends to /api/v1/auth/ on its own. A 401 triggers one refresh, shared by every request
 * that hit it at the same time, then one retry.
 */

const API = '/api/v1';
/** Refresh slightly before expiry so a request never leaves with a token about to lapse. */
const EXPIRY_MARGIN_MS = 30_000;

export class ApiError extends Error {
  readonly status: number;
  /** Machine-readable reason when a business rule refused an action (HTTP 409), e.g. `dock_occupied`. */
  readonly code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

let accessToken: string | null = null;
let refreshing: Promise<string | null> | null = null;

/** Expiry of a JWT in epoch ms, read from its payload (no verification: the server does that). */
export function tokenExpiry(token: string): number {
  try {
    const payload = token.split('.')[1] ?? '';
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${API}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Exchanges the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<string | null> {
  refreshing ??= (async () => {
    try {
      const response = await post('/auth/refresh/');
      accessToken = response.ok ? ((await response.json()) as { access: string }).access : null;
      return accessToken;
    } catch {
      return null; // offline: keep the caller's own error handling
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** A token valid for at least the safety margin, refreshing it if needed; null when signed out. */
export async function freshToken(): Promise<string | null> {
  if (accessToken && tokenExpiry(accessToken) - Date.now() > EXPIRY_MARGIN_MS) return accessToken;
  return refreshSession();
}

export async function signIn(email: string, password: string): Promise<ApiSession> {
  const response = await post('/auth/login/', { email, password });
  if (response.status === 401 || response.status === 400) throw new ApiError(401, 'That email and password do not match.');
  if (response.status === 429) throw new ApiError(429, 'Too many attempts. Wait a minute, then try again.');
  if (!response.ok) throw new ApiError(response.status, 'Signing in failed. Try again in a moment.');
  const session = (await response.json()) as ApiSession;
  accessToken = session.access;
  return session;
}

export async function signOut(): Promise<void> {
  accessToken = null;
  await post('/auth/logout/').catch(() => undefined); // the cookie is gone either way on the next refresh
}

/** Authenticated request; refreshes once on 401, then gives up with ApiError(401). */
async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const send = (token: string | null) => {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };

  let response = await send(await freshToken());
  if (response.status === 401) response = await send(await refreshSession());
  if (response.status === 401) throw new ApiError(401, 'Your session has ended. Sign in again.');
  if (response.status === 403) throw new ApiError(403, 'Your role does not allow this.');
  if (response.status === 409) {
    const rejected = (await response.json()) as { code: string; detail: string };
    throw new ApiError(409, rejected.detail, rejected.code);
  }
  if (!response.ok) throw new ApiError(response.status, `Request failed (${response.status}).`);
  return (await response.json()) as T;
}

export const apiGet = <T>(path: string) => request<T>('GET', path);
export const apiPost = <T>(path: string, body?: unknown) => request<T>('POST', path, body);

export const fetchMe = () => apiGet<ApiMe>('/me/');
