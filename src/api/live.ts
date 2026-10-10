import type { LivePatch } from './contract.ts';
import { freshToken, tokenExpiry } from './http.ts';

/**
 * Live feed of one organization over WebSocket.
 *
 * Auth rides in the subprotocols (`waretrack.v1` + `bearer.<token>`), never in the URL. The server
 * closes a socket when its token expires, so shortly before that the feed opens a successor with a
 * fresh token and closes the old one only once the new one is up: no gap, and patches received
 * twice during the hand-over are harmless (merging is idempotent). An unexpected drop reconnects
 * with backoff and asks for a resync, since patches sent while disconnected are lost.
 */

export const LIVE_PROTOCOL = 'waretrack.v1';
/** Open the successor socket this long before the current token expires. */
const HANDOVER_LEAD_MS = 45_000;
const MIN_HANDOVER_DELAY_MS = 5_000;
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000];

export type LiveStatus = 'connecting' | 'live' | 'reconnecting';

export interface LiveFeedOptions {
  org: string;
  onPatch: (patch: LivePatch) => void;
  onStatus: (status: LiveStatus) => void;
  /** Called once the feed is back after a drop: reload the state, patches were missed. */
  onResync: () => void;
  /** The refresh token was refused: the session is over. */
  onSignedOut: () => void;
  /** Test seam. */
  createSocket?: (url: string, protocols: string[]) => WebSocket;
}

export function liveUrl(org: string, location: Pick<Location, 'protocol' | 'host'> = window.location): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/ws/v1/orgs/${encodeURIComponent(org)}/live/`;
}

/** Starts the feed; returns a function that stops it. */
export function startLiveFeed(options: LiveFeedOptions): () => void {
  const createSocket = options.createSocket ?? ((url, protocols) => new WebSocket(url, protocols));
  const url = liveUrl(options.org);

  let stopped = false;
  let current: WebSocket | null = null;
  let opening: WebSocket | null = null;
  let needsResync = false;
  let attempt = 0;
  let renewTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    stopped = true;
    clearTimeout(renewTimer);
    clearTimeout(retryTimer);
    opening?.close(1000);
    current?.close(1000);
  };

  const retry = () => {
    const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? 10_000;
    attempt += 1;
    retryTimer = setTimeout(() => void open(), delay);
  };

  const scheduleHandover = (token: string) => {
    clearTimeout(renewTimer);
    const delay = Math.max(MIN_HANDOVER_DELAY_MS, tokenExpiry(token) - Date.now() - HANDOVER_LEAD_MS);
    renewTimer = setTimeout(() => void open(), delay);
  };

  async function open(): Promise<void> {
    const token = await freshToken();
    if (stopped) return;
    if (!token) {
      stop();
      options.onSignedOut();
      return;
    }

    const socket = createSocket(url, [LIVE_PROTOCOL, `bearer.${token}`]);
    opening = socket;

    socket.onmessage = (event: MessageEvent<string>) => {
      if (stopped) return;
      try {
        const message = JSON.parse(event.data) as LivePatch;
        if (message.type === 'patch') options.onPatch(message);
      } catch {
        // malformed message: ignore it rather than break the feed
      }
    };

    socket.onopen = () => {
      if (stopped) return socket.close(1000);
      const previous = current;
      current = socket;
      opening = null;
      attempt = 0;
      previous?.close(1000, 'handover');
      options.onStatus('live');
      if (needsResync) {
        needsResync = false;
        options.onResync();
      }
      scheduleHandover(token);
    };

    socket.onclose = () => {
      if (stopped) return;
      if (socket === current) {
        // The live socket dropped (network, server restart, token expired before a hand-over).
        current = null;
        clearTimeout(renewTimer);
        needsResync = true;
        options.onStatus('reconnecting');
        retry();
      } else if (socket === opening) {
        // A connection attempt failed. Keep the current socket if a hand-over was being tried.
        opening = null;
        if (current) {
          renewTimer = setTimeout(() => void open(), RETRY_DELAYS_MS[0]);
        } else {
          options.onStatus('reconnecting');
          retry();
        }
      }
      // Otherwise: an old socket closed after a hand-over. Nothing to do.
    };
  }

  options.onStatus('connecting');
  void open();
  return stop;
}
