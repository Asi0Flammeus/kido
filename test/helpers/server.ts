// Starts the real server in-process on port 0 with a temp database; talks to it only through fetch.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiErrorBody, CreateGameBody, CreateGameResponse, GameView } from '../../src/shared/types';
import { type KidoServer, startServer } from '../../src/server/main';

export const errorCode = (body: unknown) => (body as ApiErrorBody).error.code;

export interface TestServer {
  url: string;
  admin: string;
  dbPath: string;
  kido: KidoServer;
  call<T = GameView>(method: string, path: string, token?: string | null, body?: unknown): Promise<{ status: number; body: T }>;
  create(body: CreateGameBody): Promise<CreateGameResponse>;
  stop(): Promise<void>;
}

export async function startTestServer(
  dbPath?: string,
  admin = `admin-${crypto.randomUUID()}-${crypto.randomUUID()}`,
  port = 0,
): Promise<TestServer> {
  const path = dbPath ?? join(mkdtempSync(join(tmpdir(), 'kido-test-')), 'kido.sqlite');
  const kido = startServer({
    port,
    databasePath: path,
    adminToken: admin,
    publicUrl: 'https://kido.wmmw.sh',
    gitSha: 'test',
    webDir: new URL('../../dist/web', import.meta.url).pathname,
    publicDir: new URL('../../public', import.meta.url).pathname,
  });
  const url = kido.url;
  const call: TestServer['call'] = async (method, path, token, body) => {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as never };
  };
  return {
    url,
    admin,
    dbPath: path,
    kido,
    call,
    async create(body) {
      const res = await call<CreateGameResponse>('POST', '/api/games', admin, body);
      if (res.status !== 201) throw new Error(`create failed: ${res.status} ${JSON.stringify(res.body)}`);
      return res.body;
    },
    stop: () => kido.stop(),
  };
}

/** Reads SSE events from a stream until `until` returns true or the timeout passes. */
export async function readSse(
  url: string,
  until: (events: { event: string; id?: string; data?: string; raw: string }[]) => boolean,
  timeoutMs: number,
  onOpen?: () => void,
): Promise<{ event: string; id?: string; data?: string; raw: string }[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const events: { event: string; id?: string; data?: string; raw: string }[] = [];
  try {
    const res = await fetch(url, { signal: controller.signal });
    onOpen?.();
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const ev: { event: string; id?: string; data?: string; raw: string } = { event: 'message', raw };
        for (const line of raw.split('\n')) {
          if (line.startsWith('event: ')) ev.event = line.slice(7);
          else if (line.startsWith('id: ')) ev.id = line.slice(4);
          else if (line.startsWith('data: ')) ev.data = line.slice(6);
          else if (line.startsWith(':')) ev.event = 'comment';
          else if (line.startsWith('retry: ')) ev.event = 'retry';
        }
        events.push(ev);
        if (until(events)) {
          controller.abort();
          return events;
        }
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    clearTimeout(timer);
  }
  return events;
}
