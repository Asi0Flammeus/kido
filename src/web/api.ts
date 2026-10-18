// Fetch wrapper (Bearer seat token) and the EventSource lifecycle (ARCHITECTURE 3, 7.2).
import type { ApiErrorBody, ErrorCode, GameView } from '../shared/types';

export type ActionResult =
  | { ok: true; view: GameView }
  | { ok: false; code: ErrorCode; state?: GameView }
  | { ok: false; code: 'network' };

export type LoadResult = { ok: true; view: GameView } | { ok: false; reason: 'invalid' | 'unreachable' };

export type Connection = 'live' | 'reconnecting' | 'offline';

const OFFLINE_AFTER_MS = 10_000;
const REOPEN_AFTER_MS = 2_000;

export class GameClient {
  constructor(
    readonly id: string,
    readonly token: string | null,
  ) {}

  private headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  /** `?s=` for links the browser opens itself (downloads, EventSource). */
  withToken(path: string): string {
    return this.token ? `${path}?s=${encodeURIComponent(this.token)}` : path;
  }

  async load(): Promise<LoadResult> {
    try {
      const res = await fetch(`/api/games/${this.id}`, { headers: this.headers(false), cache: 'no-store' });
      if (res.ok) return { ok: true, view: (await res.json()) as GameView };
      return { ok: false, reason: res.status === 404 || res.status === 401 ? 'invalid' : 'unreachable' };
    } catch {
      return { ok: false, reason: 'unreachable' };
    }
  }

  async post(path: string, body: unknown): Promise<ActionResult> {
    try {
      const res = await fetch(`/api/games/${this.id}/${path}`, {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify(body),
      });
      const parsed = (await res.json()) as GameView | ApiErrorBody;
      if (res.ok) return { ok: true, view: parsed as GameView };
      const err = parsed as ApiErrorBody;
      return { ok: false, code: err.error?.code ?? 'badRequest', state: err.state };
    } catch {
      return { ok: false, code: 'network' };
    }
  }

  /**
   * Opens the SSE stream and keeps it open: EventSource retries by itself on network errors, but a
   * proxy 502 closes it for good, so a closed stream is reopened here. Returns a stop function.
   */
  connect(onState: (view: GameView) => void, onConnection: (c: Connection) => void): () => void {
    let es: EventSource | null = null;
    let offlineTimer: ReturnType<typeof setTimeout> | undefined;
    let reopenTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let healthy = false;
    let pastOfflineThreshold = false;

    const degrade = () => {
      if (!navigator.onLine) pastOfflineThreshold = true;
      if (pastOfflineThreshold) {
        onConnection('offline');
        return;
      }
      onConnection('reconnecting');
      if (offlineTimer === undefined) {
        offlineTimer = setTimeout(() => {
          pastOfflineThreshold = true;
          onConnection('offline');
        }, OFFLINE_AFTER_MS);
      }
    };

    const open = () => {
      if (stopped) return;
      es?.close();
      const source = new EventSource(this.withToken(`/api/games/${this.id}/events`));
      es = source;
      source.addEventListener('state', (event) => {
        clearTimeout(offlineTimer);
        offlineTimer = undefined;
        pastOfflineThreshold = false;
        healthy = true;
        onConnection('live');
        onState(JSON.parse((event as MessageEvent<string>).data) as GameView);
      });
      source.onerror = () => {
        if (es !== source) return;
        healthy = false;
        degrade();
        if (source.readyState === EventSource.CLOSED) {
          clearTimeout(reopenTimer);
          reopenTimer = setTimeout(open, REOPEN_AFTER_MS);
        }
      };
    };

    const onOffline = () => {
      pastOfflineThreshold = true;
      onConnection('offline');
    };
    const onOnline = () => {
      pastOfflineThreshold = false;
      if (!healthy) {
        degrade();
        open();
      }
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || stopped) return;
      if (es?.readyState !== EventSource.OPEN) {
        void this.load().then((r) => r.ok && onState(r.view));
        open();
      }
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    open();
    return () => {
      stopped = true;
      es?.close();
      clearTimeout(offlineTimer);
      clearTimeout(reopenTimer);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }
}
