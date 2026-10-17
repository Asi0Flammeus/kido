// Bun.serve: API, SSE, long-poll, PNG, and the built web app (ARCHITECTURE 3, 6, 7).
import { existsSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import type { Server } from 'bun';
import type { ErrorCode, GameStatus, GameView, Seat } from '../shared/types';
import { requestToken, resolveViewer, safeEqual } from './auth';
import { type Config, loadConfig } from './config';
import { openDb } from './db';
import type { GameRuntime } from './games/runtime';
import { ApiError, type Estimator, GameService } from './games/service';
import { Hub } from './realtime/hub';
import { BoardRenderer } from './render/png';
import { Repo } from './repo';

const SECURITY_HEADERS = { 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...extra },
  });
}

function errorResponse(error: ApiError, state?: GameView): Response {
  const body: Record<string, unknown> = { error: { code: error.code, message: error.message } };
  if (state && error.status >= 409) body.state = state;
  return json(body, error.status);
}

const fail = (code: ErrorCode, message?: string) => errorResponse(new ApiError(code, message));

class WorkerEstimator implements Estimator {
  private readonly worker = new Worker(new URL('./deadstones-worker.ts', import.meta.url).href);
  private readonly pending = new Map<number, (dead: [number, number][]) => void>();
  private seq = 0;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<{ id: number; dead: [number, number][] }>) => {
      this.pending.get(event.data.id)?.(event.data.dead);
      this.pending.delete(event.data.id);
    };
  }

  guess(signMap: number[][]): Promise<[number, number][]> {
    const id = ++this.seq;
    const { promise, resolve } = Promise.withResolvers<[number, number][]>();
    this.pending.set(id, resolve);
    this.worker.postMessage({ id, signMap });
    return promise;
  }

  terminate(): void {
    this.worker.terminate();
  }
}

export interface KidoServer {
  server: Server<undefined>;
  url: string;
  stop(): Promise<void>;
}

export function startServer(config: Config): KidoServer {
  const db = openDb(config.databasePath);
  const repo = new Repo(db);
  const hub = new Hub();
  const estimator = new WorkerEstimator();
  const service = new GameService(repo, hub, config.publicUrl, estimator);
  const renderer = new BoardRenderer();
  const streams = new Set<() => void>();
  // Warm the dead-stone worker (first call in a fresh process is slow, ARCHITECTURE 4.4).
  void estimator.guess(Array.from({ length: 9 }, () => Array<number>(9).fill(0)));
  service.boot();

  const indexPath = join(config.webDir, 'index.html');
  const indexHtml = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '<!doctype html><title>Kido</title><p>Run bun run build:web first.</p>';

  const page = (ogTitle: string | null, game: boolean) =>
    new Response(
      ogTitle ? indexHtml.replace('<meta property="og:title" content="Kido">', `<meta property="og:title" content="${ogTitle}">`) : indexHtml,
      {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
          ...SECURITY_HEADERS,
          ...(game ? { 'X-Robots-Tag': 'noindex' } : {}),
        },
      },
    );

  /** Resolves the game and the caller's seat, or a 404 response. */
  function viewer(req: Request, id: string): { rt: GameRuntime; seat: Seat | null } | Response {
    const rt = service.load(id);
    if (!rt) return fail('notFound');
    service.settle(rt);
    const resolved = resolveViewer(rt.row, requestToken(req, new URL(req.url)));
    if (!resolved) return fail('notFound');
    return { rt, seat: resolved.seat };
  }

  function isAdmin(req: Request): boolean {
    const header = req.headers.get('authorization');
    return header?.startsWith('Bearer ') === true && safeEqual(header.slice(7).trim(), config.adminToken);
  }

  async function readBody(req: Request): Promise<Record<string, unknown>> {
    const text = await req.text();
    if (text.trim() === '') return {};
    try {
      const parsed = JSON.parse(text);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      return parsed as Record<string, unknown>;
    } catch {
      throw new ApiError('badRequest', 'The body must be a JSON object.');
    }
  }

  /** Write routes: seat required; returns the caller's fresh view or a mapped error. */
  function action(fn: (rt: GameRuntime, seat: Seat, body: Record<string, unknown>) => void) {
    return async (req: Bun.BunRequest<string>) => {
      const id = (req.params as Record<string, string>).id!;
      const found = viewer(req, id);
      if (found instanceof Response) return found;
      if (found.seat === null) return fail('unauthorized');
      try {
        const body = await readBody(req);
        fn(found.rt, found.seat, body);
        const rt = service.load(id)!;
        return json(service.view(rt, found.seat));
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        const rt = service.load(id);
        return errorResponse(error, rt ? service.view(rt, found.seat) : undefined);
      }
    };
  }

  const server = Bun.serve({
    port: config.port,
    maxRequestBodySize: 64 * 1024,
    idleTimeout: 30,
    routes: {
      '/healthz': () => {
        db.query('SELECT 1').get();
        return json({ ok: true, version: config.gitSha });
      },
      '/': () => page(null, false),
      '/g/:id': (req) => {
        const rt = service.load(req.params.id);
        const resolved = rt ? resolveViewer(rt.row, requestToken(req, new URL(req.url))) : undefined;
        const ogTitle = rt && resolved ? (rt.row.kind === 'go' ? `Kido · Go, ${rt.row.board_size}×${rt.row.board_size}` : 'Kido · Chess') : null;
        return page(ogTitle, true);
      },
      '/api/games': {
        POST: async (req) => {
          if (!isAdmin(req)) return fail('unauthorized');
          try {
            return json(service.create((await readBody(req)) as never), 201);
          } catch (error) {
            if (error instanceof ApiError) return errorResponse(error);
            throw error;
          }
        },
        GET: (req) => {
          if (!isAdmin(req)) return fail('unauthorized');
          const url = new URL(req.url);
          const status = url.searchParams.get('status');
          if (status !== null && !['playing', 'scoring', 'over'].includes(status)) return fail('badRequest', 'status is invalid.');
          const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 20) || 20));
          return json({ games: service.list(status as GameStatus | null, limit) });
        },
      },
      '/api/games/:id': {
        GET: (req) => {
          const found = viewer(req, req.params.id);
          return found instanceof Response ? found : json(service.view(found.rt, found.seat));
        },
      },
      '/api/games/:id/wait': {
        GET: (req, srv) => {
          const found = viewer(req, req.params.id);
          if (found instanceof Response) return found;
          const url = new URL(req.url);
          const since = Number(url.searchParams.get('since'));
          if (url.searchParams.get('since') === null || !Number.isInteger(since)) return fail('badRequest', 'since is required.');
          const mode = url.searchParams.get('for') ?? 'change';
          if (mode !== 'change' && mode !== 'turn') return fail('badRequest', 'for must be change or turn.');
          const timeoutSec = Math.min(120, Math.max(1, Number(url.searchParams.get('timeout') ?? 60) || 60));
          const { seat } = found;
          const id = req.params.id;
          const current = () => service.view(service.load(id)!, seat);
          const first = current();
          if (mode === 'change' ? first.version > since : first.yourTurn) return json({ changed: first.version > since, state: first });
          srv.timeout(req, timeoutSec + 10);
          const { promise, resolve } = Promise.withResolvers<Response>();
          let done = false;
          const finish = (changed: boolean, state: GameView) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            unsubscribe();
            resolve(json({ changed, state }));
          };
          const unsubscribe = hub.subscribe(id, {
            seat,
            notify: () => {
              const v = current();
              if (v.version <= since) return;
              if (mode === 'change' || v.yourTurn || v.status !== 'playing' || v.draw === 'offeredByThem') finish(true, v);
            },
          });
          const timer = setTimeout(() => finish(false, current()), timeoutSec * 1000);
          req.signal.addEventListener('abort', () => finish(false, current()));
          return promise;
        },
      },
      '/api/games/:id/events': {
        GET: (req, srv) => {
          const found = viewer(req, req.params.id);
          if (found instanceof Response) return found;
          srv.timeout(req, 0);
          const { seat } = found;
          const id = req.params.id;
          const encoder = new TextEncoder();
          let cleanup = () => {};
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              const send = (chunk: string) => {
                try {
                  controller.enqueue(encoder.encode(chunk));
                } catch {
                  cleanup();
                }
              };
              const push = () => {
                const rt = service.load(id);
                if (!rt) return;
                const v = service.view(rt, seat);
                send(`id: ${v.version}\nevent: state\ndata: ${JSON.stringify(v)}\n\n`);
              };
              send('retry: 2000\n\n');
              push();
              const unsubscribe = hub.subscribe(id, { seat, notify: push });
              const ping = setInterval(() => send(': ping\n\n'), 15_000);
              const close = () => {
                try {
                  controller.close();
                } catch {}
                cleanup();
              };
              cleanup = () => {
                clearInterval(ping);
                unsubscribe();
                streams.delete(close);
                cleanup = () => {};
              };
              streams.add(close);
              req.signal.addEventListener('abort', () => cleanup());
            },
            cancel() {
              cleanup();
            },
          });
          return new Response(stream, {
            headers: {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-store',
              'X-Accel-Buffering': 'no',
              ...SECURITY_HEADERS,
            },
          });
        },
      },
      '/api/games/:id/move': { POST: action((rt, seat, body) => service.move(rt, seat, body)) },
      '/api/games/:id/pass': { POST: action((rt, seat, body) => service.pass(rt, seat, body)) },
      '/api/games/:id/resign': { POST: action((rt, seat) => service.resign(rt, seat)) },
      '/api/games/:id/draw': { POST: action((rt, seat, body) => service.draw(rt, seat, body)) },
      '/api/games/:id/scoring/dead': { POST: action((rt, seat, body) => service.markDead(rt, seat, body)) },
      '/api/games/:id/scoring/accept': { POST: action((rt, seat, body) => service.acceptScore(rt, seat, body)) },
      '/api/games/:id/scoring/resume': { POST: action((rt, seat) => service.resume(rt, seat)) },
      '/api/games/:id/board.png': {
        GET: (req) => {
          const found = viewer(req, req.params.id);
          if (found instanceof Response) return found;
          const { rt, seat } = found;
          const url = new URL(req.url);
          const plyParam = url.searchParams.get('ply');
          const ply = plyParam === null ? rt.moves.length : Number(plyParam);
          if (!Number.isInteger(ply) || ply < 0 || ply > rt.moves.length) return fail('badRequest', 'ply is out of range.');
          const size = Number(url.searchParams.get('size') ?? 800);
          if (!Number.isInteger(size) || size < 256 || size > 1600) return fail('badRequest', 'size must be 256..1600.');
          const coords = url.searchParams.get('coords') !== '0';
          const png = renderer.render(rt, seat, ply, size, coords);
          const immutable = plyParam !== null && ply < rt.moves.length;
          // resvg's asPng() is a Buffer over a plain ArrayBuffer.
          return new Response(png as Uint8Array<ArrayBuffer>, {
            headers: {
              'Content-Type': 'image/png',
              'Cache-Control': immutable ? 'private, max-age=31536000, immutable' : 'no-store',
              ...SECURITY_HEADERS,
            },
          });
        },
      },
      '/api/games/:id/pgn': {
        GET: (req) => {
          const found = viewer(req, req.params.id);
          if (found instanceof Response) return found;
          if (found.rt.row.kind !== 'chess') return fail('wrongPhase', 'PGN is for chess games.');
          return new Response(service.view(found.rt, found.seat).pgn, {
            headers: {
              'Content-Type': 'application/x-chess-pgn; charset=utf-8',
              'Content-Disposition': `attachment; filename="kido-${found.rt.row.id}.pgn"`,
              'Cache-Control': 'no-store',
              ...SECURITY_HEADERS,
            },
          });
        },
      },
      '/api/games/:id/sgf': {
        GET: (req) => {
          const found = viewer(req, req.params.id);
          if (found instanceof Response) return found;
          if (found.rt.row.kind !== 'go') return fail('wrongPhase', 'SGF is for Go games.');
          return new Response(service.view(found.rt, found.seat).sgf, {
            headers: {
              'Content-Type': 'application/x-go-sgf; charset=utf-8',
              'Content-Disposition': `attachment; filename="kido-${found.rt.row.id}.sgf"`,
              'Cache-Control': 'no-store',
              ...SECURITY_HEADERS,
            },
          });
        },
      },
      '/api/*': () => fail('notFound'),
    },
    fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname);
      for (const [dir, immutable] of [
        [config.webDir, true],
        [config.publicDir, false],
      ] as const) {
        const file = normalize(join(dir, path));
        if (!file.startsWith(normalize(dir) + '/') || !existsSync(file) || file.endsWith('/index.html')) continue;
        const f = Bun.file(file);
        const type = file.endsWith('.webmanifest') ? 'application/manifest+json' : f.type;
        return new Response(f, {
          headers: {
            'Content-Type': type,
            'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
            ...SECURITY_HEADERS,
          },
        });
      }
      return new Response('Not found', { status: 404, headers: SECURITY_HEADERS });
    },
    error(error) {
      console.error(error);
      return json({ error: { code: 'badRequest', message: 'Internal error.' } }, 500);
    },
  });

  return {
    server,
    url: `http://127.0.0.1:${server.port}`,
    async stop() {
      for (const close of [...streams]) close();
      service.close();
      estimator.terminate();
      await server.stop(true);
      db.close();
    },
  };
}

if (import.meta.main) {
  const kido = startServer(loadConfig());
  console.log(`kido listening on ${kido.url}`);
  const shutdown = () => {
    void kido.stop().then(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
