import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tokens = vi.hoisted(() => ({ next: [] as (string | null)[] }));

vi.mock('./http.ts', () => ({
  freshToken: vi.fn(async () => tokens.next.shift() ?? null),
  // Tokens in these tests are "token-<expiry ms>".
  tokenExpiry: (token: string) => Number(token.split('-')[1]),
}));

const { liveUrl, startLiveFeed, LIVE_PROTOCOL } = await import('./live.ts');

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  closed = false;
  readonly url: string;
  readonly protocols: string[];

  constructor(url: string, protocols: string[]) {
    this.url = url;
    this.protocols = protocols;
    FakeSocket.all.push(this);
  }
  open() {
    this.onopen?.();
  }
  drop() {
    this.closed = true;
    this.onclose?.();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
  send(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const expiringIn = (ms: number) => `token-${Date.now() + ms}`;

describe('live feed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost:5173' } });
    FakeSocket.all = [];
    tokens.next = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const start = () => {
    const events = { patches: [] as unknown[], statuses: [] as string[], resyncs: 0, signedOut: 0 };
    const stop = startLiveFeed({
      org: 'acme',
      onPatch: (p) => events.patches.push(p),
      onStatus: (s) => events.statuses.push(s),
      onResync: () => (events.resyncs += 1),
      onSignedOut: () => (events.signedOut += 1),
      createSocket: (url, protocols) => new FakeSocket(url, protocols) as unknown as WebSocket,
    });
    return { events, stop };
  };

  it('builds the URL from the page origin', () => {
    expect(liveUrl('acme', { protocol: 'https:', host: 'app.waretrack.io' })).toBe('wss://app.waretrack.io/ws/v1/orgs/acme/live/');
  });

  it('authenticates through subprotocols and forwards patches', async () => {
    const token = expiringIn(300_000);
    tokens.next = [token];
    const { events } = start();
    await flush();

    const [socket] = FakeSocket.all;
    expect(socket!.protocols).toEqual([LIVE_PROTOCOL, `bearer.${token}`]);
    expect(socket!.url).not.toContain(token);
    socket!.open();
    socket!.send({ type: 'patch', trucks: [] });
    expect(events.statuses).toEqual(['connecting', 'live']);
    expect(events.patches).toHaveLength(1);
  });

  it('hands over to a fresh socket before the token expires, without a resync', async () => {
    tokens.next = [expiringIn(120_000), expiringIn(300_000)];
    const { events } = start();
    await flush();
    const first = FakeSocket.all[0]!;
    first.open();

    await vi.advanceTimersByTimeAsync(80_000); // 120 s token, 45 s lead
    const second = FakeSocket.all[1]!;
    expect(second).toBeDefined();
    expect(first.closed).toBe(false); // still serving until the successor is up
    second.open();
    expect(first.closed).toBe(true);
    expect(events.statuses).toEqual(['connecting', 'live', 'live']);
    expect(events.resyncs).toBe(0);
  });

  it('reconnects after a drop and asks for a resync', async () => {
    tokens.next = [expiringIn(300_000), expiringIn(300_000)];
    const { events } = start();
    await flush();
    FakeSocket.all[0]!.open();

    FakeSocket.all[0]!.drop();
    expect(events.statuses.at(-1)).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1_000);
    FakeSocket.all[1]!.open();
    expect(events.statuses.at(-1)).toBe('live');
    expect(events.resyncs).toBe(1);
  });

  it('signs out when no token can be obtained', async () => {
    tokens.next = [null];
    const { events } = start();
    await flush();
    expect(events.signedOut).toBe(1);
    expect(FakeSocket.all).toHaveLength(0);
  });

  it('stops cleanly', async () => {
    tokens.next = [expiringIn(300_000)];
    const { events, stop } = start();
    await flush();
    FakeSocket.all[0]!.open();
    stop();
    expect(FakeSocket.all[0]!.closed).toBe(true);
    expect(events.statuses.at(-1)).toBe('live'); // no "reconnecting" after an intentional stop
  });
});
