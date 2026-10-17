// A1 · Chess, full scripted game to checkmate through the API (ARCHITECTURE 11.1).
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Chess } from 'chess.js';
import type { ChessMoveView, GameView, WaitResponse } from '../src/shared/types';
import { errorCode, startTestServer, type TestServer } from './helpers/server';

const MOVES = 'e2e4 g8f6 e4e5 d7d5 e5d6 e7e6 d6c7 d8d7 c7b8q a8b8 g1f3 f8d6 f1c4 e8g8 e1g1 a7a6 f3g5 f6d5 d1h5 b7b5 h5h7'.split(' ');

let srv: TestServer;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(() => srv.stop());

test('A1 scripted chess game to Qxh7#', async () => {
  const game = await srv.create({ kind: 'chess', maiaSeat: 'black', timeControl: { baseSec: 300, incrementSec: 3 } });
  const W = game.williamToken;
  const M = game.maiaToken;
  const id = game.id;
  const post = (token: string, body: unknown) => srv.call('POST', `/api/games/${id}/move`, token, body);

  // Rejections before move 1.
  let r = await post(M, { ply: 0, move: 'e7e5' });
  expect(r.status).toBe(409);
  expect(errorCode(r.body)).toBe('notYourTurn');
  r = await post(W, { ply: 0, move: 'e2e5' });
  expect(r.status).toBe(422);
  expect(errorCode(r.body)).toBe('illegal');
  r = await post(W, { ply: 5, move: 'e2e4' });
  expect(r.status).toBe(409);
  expect(errorCode(r.body)).toBe('stale');

  let view!: GameView;
  let beforeRemaining: Record<string, number> = {};
  for (let ply = 0; ply < MOVES.length; ply++) {
    const token = ply % 2 === 0 ? W : M;
    const move = ply === 19 ? 'b5' : MOVES[ply]!; // black's 10th move as SAN
    if (ply === 2) {
      // Long-poll by Maïa started before William's move returns within 1 s of it.
      const v = (await srv.call('GET', `/api/games/${id}`, M)).body;
      const started = Date.now();
      const waiting = srv.call<WaitResponse>('GET', `/api/games/${id}/wait?since=${v.version}&for=turn&timeout=30`, M);
      // Real delay on purpose: the long-poll must already be parked server-side before the move.
      await Bun.sleep(150);
      r = await post(token, { ply, move });
      const moved = Date.now(); // the move is committed once its response is back
      const waited = await waiting;
      expect(waited.status).toBe(200);
      expect(waited.body.changed).toBe(true);
      expect(waited.body.state.yourTurn).toBe(true);
      expect(Date.now() - moved).toBeLessThan(1000);
      expect(Date.now() - started).toBeGreaterThan(100);
    } else {
      if (view?.clock) beforeRemaining = { ...view.clock.remainingMs };
      r = await post(token, { ply, move });
    }
    expect(r.status).toBe(200);
    view = r.body;
    expect(view.ply).toBe(ply + 1);
    if (ply <= 1) {
      // Each side's first move is free: no time charged, no increment, no clock before ply 2.
      expect((view.moves[ply] as ChessMoveView).remainingMs).toBe(300000);
      expect(view.clock!.remainingMs[ply === 0 ? 'white' : 'black']).toBe(300000);
      expect(view.clock!.running).toBe(ply === 1 ? 'white' : null);
    } else if (view.status === 'playing') {
      expect(view.clock!.running).toBe(view.turn);
    }
    if (ply === 3) {
      // Ply 3 sent twice: the retry is idempotent.
      const again = await post(token, { ply, move });
      expect(again.status).toBe(200);
      expect(again.body.ply).toBe(4);
    }
    if (ply === 4) {
      // remaining_after = remaining_before - spent + 3000 for the mover (white, ply 4).
      const mv = view.moves[4] as ChessMoveView;
      const before = beforeRemaining.white!;
      expect(mv.remainingMs).toBeLessThanOrEqual(before + 3000);
      expect(mv.remainingMs).toBeGreaterThan(before + 3000 - 2000);
    }
  }

  expect(view.status).toBe('over');
  expect(view.result).toEqual({ winner: 'white', reason: 'checkmate' });
  expect(view.fen).toBe('1rb2rk1/3q1ppQ/p2bp3/1p1n2N1/2B5/8/PPPP1PPP/RNB2RK1 b - - 0 11');
  expect(view.moves.length).toBe(21);
  expect(view.check).toBe(true);
  expect((view.moves as ChessMoveView[]).map((m) => m.san).join(' ')).toBe(
    'e4 Nf6 e5 d5 exd6 e6 dxc7 Qd7 cxb8=Q Rxb8 Nf3 Bd6 Bc4 O-O O-O a6 Ng5 Nd5 Qh5 b5 Qxh7#',
  );

  // Any further move → gameOver.
  r = await post(M, { ply: 21, move: 'g8h8' });
  expect(r.status).toBe(409);
  expect(errorCode(r.body)).toBe('gameOver');

  // PGN.
  const pgnRes = await fetch(`${srv.url}/api/games/${id}/pgn`, { headers: { Authorization: `Bearer ${W}` } });
  expect(pgnRes.headers.get('content-disposition')).toContain(`kido-${id}.pgn`);
  const pgn = await pgnRes.text();
  expect(pgn).toContain('[Result "1-0"]');
  expect(pgn).toContain('[White "William"]');
  expect(pgn).toContain('[Black "Maïa"]');
  expect(pgn).toContain('11. Qxh7#');
  const reloaded = new Chess();
  reloaded.loadPgn(pgn);
  expect(reloaded.fen()).toBe(view.fen!);

  // PNG.
  const png = await fetch(`${srv.url}/api/games/${id}/board.png?ply=21`, { headers: { Authorization: `Bearer ${W}` } });
  expect(png.status).toBe(200);
  expect(png.headers.get('content-type')).toBe('image/png');
  const bytes = new Uint8Array(await png.arrayBuffer());
  expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
}, 60_000);
