import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A JWT-shaped token whose payload carries `exp` (seconds from now). */
const jwt = (secondsFromNow: number) => {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsFromNow }));
  return `header.${payload.replace(/=+$/, '')}.signature`;
};

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('api client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules(); // fresh module state: no token carried over between tests
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  const calls = () => fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${url}`);

  it('reads the expiry from a token', async () => {
    const { tokenExpiry } = await import('./http.ts');
    expect(tokenExpiry(jwt(60))).toBeGreaterThan(Date.now());
    expect(tokenExpiry('garbage')).toBe(0);
  });

  it('signs in and sends the access token with later requests', async () => {
    const access = jwt(300);
    fetchMock.mockResolvedValueOnce(json(200, { access, user: {} })).mockResolvedValueOnce(json(200, { ok: true }));
    const { apiGet, signIn } = await import('./http.ts');

    await signIn('ops@acme.test', 'pw');
    await apiGet('/me/');

    const [, init] = fetchMock.mock.calls[1]!;
    expect((init as RequestInit).headers).toEqual({ Authorization: `Bearer ${access}` });
  });

  it('turns a rejected login into a readable error', async () => {
    fetchMock.mockResolvedValueOnce(json(401));
    const { signIn } = await import('./http.ts');
    await expect(signIn('ops@acme.test', 'nope')).rejects.toMatchObject({ status: 401 });
  });

  it('refreshes once and retries when the access token is rejected', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { access: jwt(300), user: {} }))
      .mockResolvedValueOnce(json(401))
      .mockResolvedValueOnce(json(200, { access: jwt(300) }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    const { apiGet, signIn } = await import('./http.ts');
    await signIn('ops@acme.test', 'pw');

    await expect(apiGet('/me/')).resolves.toEqual({ ok: true });
    expect(calls()).toEqual(['POST /api/v1/auth/login/', 'GET /api/v1/me/', 'POST /api/v1/auth/refresh/', 'GET /api/v1/me/']);
  });

  it('shares one refresh between concurrent requests', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.endsWith('/auth/refresh/') ? json(200, { access: jwt(300) }) : json(200, {})));
    const { apiGet } = await import('./http.ts');

    await Promise.all([apiGet('/a/'), apiGet('/b/'), apiGet('/c/')]);
    expect(calls().filter((c) => c.endsWith('/auth/refresh/'))).toHaveLength(1);
  });

  it('reports an ended session when the refresh is refused too', async () => {
    fetchMock.mockImplementation(async () => json(401));
    const { apiGet } = await import('./http.ts');
    await expect(apiGet('/me/')).rejects.toMatchObject({ status: 401 });
  });
});
