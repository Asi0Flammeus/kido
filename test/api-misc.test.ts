// A3 · Cross-cutting API tests: auth, timeout, draw, SSE, restart (ARCHITECTURE 11.3).
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import type { ApiErrorBody, GameView, WaitResponse } from '../src/shared/types';
import { errorCode, readSse, startTestServer, type TestServer } from './helpers/server';

// 51 plies that leave white with king + knight only, black to move (generated with chess.js).
const KNIGHT_LINE =
  'c2c3 b7b6 f2f3 h7h5 f3f4 b8c6 e2e4 g7g5 d1e2 g5f4 b2b4 c6b4 e2c4 b4a2 c4c5 a2c1 c5d6 e7d6 d2d3 c1d3 e1d2 h5h4 g2g3 h4g3 e4e5 d3e5 f1d3 e5d3 a1a5 b6a5 h2h3 h8h3 d2c2 h3h1 c2d1 h1g1 d1d2 g3g2 c3c4 d8f6 d2c2 d3c5 c2d2 c5b3 d2d3 c7c6 d3c2 g8e7 c4c5 d6c5 c2d3'.split(' ');

let srv: TestServer;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(() => srv.stop());

test('auth: hidden games, spectators, admin token', async () => {
  const hidden = await srv.create({ kind: 'chess', maiaSeat: 'black' });
  expect((await srv.call('GET', `/api/games/${hidden.id}`)).status).toBe(404);
  expect((await srv.call('GET', `/api/games/${hidden.id}`, 'not-a-real-token-at-all-000000000')).status).toBe(404);
  expect((await srv.call('GET', `/api/games/${hidden.id}`, hidden.williamToken)).status).toBe(200);
  expect((await srv.call('GET', '/api/games/nope')).status).toBe(404);

  const open = await srv.create({ kind: 'go', maiaSeat: 'white', go: { boardSize: 9 }, spectators: true });
  const spectator = await srv.call('GET', `/api/games/${open.id}`);
  expect(spectator.status).toBe(200);
  expect(spectator.body.you).toBeNull();
  expect(spectator.body.actions).toEqual([]);
  const write = await srv.call('POST', `/api/games/${open.id}/move`, null, { ply: 0, move: 'E5' });
  expect(write.status).toBe(401);
  expect(errorCode(write.body)).toBe('unauthorized');
  expect(open.links.spectator).toBe(`https://kido.wmmw.sh/g/${open.id}`);

  expect((await srv.call('POST', '/api/games', null, { kind: 'chess' })).status).toBe(401);
  expect((await srv.call('GET', '/api/games')).status).toBe(401);
  expect((await srv.call('GET', '/api/games', hidden.williamToken)).status).toBe(401);
  const list = await srv.call<{ games: { id: string }[] }>('GET', '/api/games?limit=5', srv.admin);
  expect(list.status).toBe(200);
  expect(list.body.games[0]!.id).toBe(open.id);
  expect((await srv.call('GET', '/api/nothing-here')).status).toBe(404);
});

test('timeout without any request, then gameOver with the result in state', async () => {
  // The spec's 1 s base is raised to 3 s: on this loaded host a single request can take over 1 s,
  // which would flag white before its ply-2 move arrives.
  const game = await srv.create({ kind: 'chess', maiaSeat: 'black', timeControl: { baseSec: 3, incrementSec: 0 } });
  const { id, williamToken: W, maiaToken: M } = game;
  await srv.call('POST', `/api/games/${id}/move`, W, { ply: 0, move: 'e2e4' });
  await srv.call('POST', `/api/games/${id}/move`, M, { ply: 1, move: 'e7e5' });
  const r = await srv.call('POST', `/api/games/${id}/move`, W, { ply: 2, move: 'g1f3' });
  expect(r.status).toBe(200);
  const events = await readSse(
    `${srv.url}/api/games/${id}/events?s=${W}`,
    (evs) => evs.some((e) => e.event === 'state' && (JSON.parse(e.data!) as GameView).status === 'over'),
    20_000,
  );
  const last = JSON.parse(events.filter((e) => e.event === 'state').at(-1)!.data!) as GameView;
  expect(last.result).toEqual({ winner: 'white', reason: 'timeout' });
  expect(last.clock!.remainingMs.black).toBe(0);
  const late = await srv.call<ApiErrorBody>('POST', `/api/games/${id}/move`, M, { ply: 3, move: 'b8c6' });
  expect(late.status).toBe(409);
  expect(errorCode(late.body)).toBe('gameOver');
  expect(late.body.state!.result).toEqual({ winner: 'white', reason: 'timeout' });
}, 60_000);

test('draw: offer, decline by moving, offer again, accept', async () => {
  const game = await srv.create({ kind: 'chess', maiaSeat: 'black' });
  const { id, williamToken: W, maiaToken: M } = game;
  await srv.call('POST', `/api/games/${id}/move`, W, { ply: 0, move: 'e2e4' });
  let r = await srv.call('POST', `/api/games/${id}/draw`, W, { action: 'offer' });
  expect(r.body.draw).toBe('offeredByYou');
  r = await srv.call('POST', `/api/games/${id}/draw`, W, { action: 'offer' });
  expect(errorCode(r.body)).toBe('wrongPhase');
  let maia = (await srv.call('GET', `/api/games/${id}`, M)).body;
  expect(maia.draw).toBe('offeredByThem');
  expect(maia.actions).toContain('acceptDraw');
  maia = (await srv.call('POST', `/api/games/${id}/move`, M, { ply: 1, move: 'e7e5' })).body;
  expect(maia.draw).toBe('none');
  expect(maia.drawOfferedBy).toBeNull();
  await srv.call('POST', `/api/games/${id}/draw`, W, { action: 'offer' });
  r = await srv.call('POST', `/api/games/${id}/draw`, M, { action: 'accept' });
  expect(r.status).toBe(200);
  expect(r.body.result).toEqual({ winner: null, reason: 'agreement' });
});

test('SSE: retry, state with id = version, publish within 200 ms, survives 25 s idle', async () => {
  const game = await srv.create({ kind: 'chess', maiaSeat: 'black' });
  const { id, williamToken: W } = game;
  let movedAt = 0;
  let publishedAt = 0;
  let sawPing = false;
  const events = await readSse(
    `${srv.url}/api/games/${id}/events?s=${W}`,
    (evs) => {
      const states = evs.filter((e) => e.event === 'state');
      if (states.length === 1 && movedAt === 0) {
        movedAt = Date.now();
        void srv.call('POST', `/api/games/${id}/move`, W, { ply: 0, move: 'd2d4' });
      }
      if (states.length === 2 && publishedAt === 0) publishedAt = Date.now();
      sawPing ||= evs.some((e) => e.event === 'comment');
      return sawPing && evs.length > 0 && Date.now() - movedAt > 25_000;
    },
    40_000,
  );
  expect(events[0]!.raw).toBe('retry: 2000');
  const states = events.filter((e) => e.event === 'state');
  const first = JSON.parse(states[0]!.data!) as GameView;
  expect(states[0]!.id).toBe(String(first.version));
  expect(publishedAt).toBeGreaterThan(movedAt); // latency after commit is asserted in the next test
  expect(sawPing).toBe(true);
  expect(Date.now() - movedAt).toBeGreaterThan(25_000);
}, 60_000);

test('SSE publish latency after the move is committed is under 200 ms', async () => {
  const game = await srv.create({ kind: 'go', maiaSeat: 'white', go: { boardSize: 9 } });
  const { id, williamToken: B } = game;
  let move: Promise<number> | null = null;
  let receivedAt = 0;
  await readSse(
    `${srv.url}/api/games/${id}/events?s=${B}`,
    (evs) => {
      const states = evs.filter((e) => e.event === 'state');
      if (states.length === 1 && move === null) {
        move = srv.call('POST', `/api/games/${id}/move`, B, { ply: 0, move: 'E5' }).then(() => Date.now());
      }
      if (states.length === 2) receivedAt = Date.now();
      return states.length === 2;
    },
    15_000,
  );
  const committedAt = await move!;
  expect(receivedAt).toBeGreaterThan(0);
  // The event usually beats the HTTP response; it must never trail it by more than 200 ms.
  expect(receivedAt - committedAt).toBeLessThan(200);
}, 60_000);

test('restart: same state, downtime charged to the side to move, flag timer re-armed; K+N flag is a draw', async () => {
  const dbPath = srv.dbPath;
  const timed = await srv.create({ kind: 'chess', maiaSeat: 'black', timeControl: { baseSec: 600, incrementSec: 0 } });
  const fixture = await srv.create({ kind: 'chess', maiaSeat: 'black', timeControl: { baseSec: 600, incrementSec: 0 } });
  for (let ply = 0; ply < KNIGHT_LINE.length; ply++) {
    const token = ply % 2 === 0 ? fixture.williamToken : fixture.maiaToken;
    const r = await srv.call('POST', `/api/games/${fixture.id}/move`, token, { ply, move: KNIGHT_LINE[ply] });
    expect(r.status).toBe(200);
  }
  await srv.call('POST', `/api/games/${timed.id}/move`, timed.williamToken, { ply: 0, move: 'e2e4' });
  await srv.call('POST', `/api/games/${timed.id}/move`, timed.maiaToken, { ply: 1, move: 'e7e5' });
  const before = (await srv.call('GET', `/api/games/${timed.id}`, timed.williamToken)).body;
  expect(before.clock!.running).toBe('white');
  await srv.stop();

  // Fixtures written while the server is down (the host is slow, so real budgets stay small and known):
  // the timed game's running clock (white) gets 30 s from now; in the K+N game black, the side to
  // move with plenty of material, gets 300 ms while white has king + knight only.
  const stoppedAt = Date.now();
  const db = new Database(dbPath);
  db.query('UPDATE games SET white_ms = 30000, turn_started_at = ? WHERE id = ?').run(stoppedAt, timed.id);
  db.query('UPDATE games SET black_ms = 300, turn_started_at = ? WHERE id = ?').run(stoppedAt, fixture.id);
  db.close();
  // Real delay on purpose: downtime must be charged against the running clock.
  await Bun.sleep(800);

  srv = await startTestServer(dbPath, srv.admin);
  const after = (await srv.call('GET', `/api/games/${timed.id}`, timed.williamToken)).body;
  expect(after.moves).toEqual(before.moves);
  expect(after.fen).toBe(before.fen);
  expect(after.clock!.running).toBe('white');
  expect(after.clock!.remainingMs.white).toBe(Math.max(0, 30000 - (after.clock!.serverNow - stoppedAt)));
  expect(after.clock!.remainingMs.white).toBeLessThanOrEqual(30000 - 800);

  // The re-armed timer ends the game with no further action request.
  let v = after;
  while (v.status === 'playing') {
    v = (await srv.call<WaitResponse>('GET', `/api/games/${timed.id}/wait?since=${v.version}&for=change&timeout=40`, timed.maiaToken)).body.state;
  }
  expect(v.result).toEqual({ winner: 'black', reason: 'timeout' });

  const knight = (await srv.call('GET', `/api/games/${fixture.id}`, fixture.williamToken)).body;
  expect(knight.status).toBe('over');
  expect(knight.result).toEqual({ winner: null, reason: 'insufficientMaterial' });
}, 180_000);
