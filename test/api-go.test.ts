// A2 · Go 9×9, full scripted game to scoring through the API (ARCHITECTURE 11.2).
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { parse } from '@sabaki/sgf';
import type { ErrorCode, GameView, WaitResponse } from '../src/shared/types';
import { errorCode, startTestServer, type TestServer } from './helpers/server';

// Each entry is one request; a code means the request must be rejected without advancing ply.
const SCRIPT: [string, string, ErrorCode?][] = [
  ['B', 'E6'], ['W', 'F6'], ['B', 'D5'], ['W', 'E5'], ['B', 'E4'], ['W', 'F4'], ['B', 'C3'], ['W', 'G5'],
  ['B', 'F5'],
  ['W', 'E5', 'ko'],
  ['W', 'H3'], ['B', 'E5'],
  ['W', 'F3'], ['B', 'E3'], ['W', 'F2'], ['B', 'E2'], ['W', 'F1'], ['B', 'E1'],
  ['W', 'F7'], ['B', 'E7'], ['W', 'F8'], ['B', 'E8'], ['W', 'F9'], ['B', 'E9'],
  ['W', 'H5'], ['B', 'B5'], ['W', 'H4'], ['B', 'C4'], ['W', 'H6'], ['B', 'C6'],
  ['W', 'C5', 'suicide'],
  ['W', 'B8'],
];

let srv: TestServer;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(() => srv.stop());

async function playScript(id: string, B: string, W: string): Promise<GameView> {
  let view!: GameView;
  let ply = 0;
  for (const [color, vertex, rejection] of SCRIPT) {
    const r = await srv.call('POST', `/api/games/${id}/move`, color === 'B' ? B : W, { ply, move: vertex });
    if (rejection) {
      expect(r.status).toBe(422);
      expect(errorCode(r.body)).toBe(rejection);
      continue;
    }
    expect(r.status).toBe(200);
    view = r.body;
    ply++;
    expect(view.ply).toBe(ply);
    if (vertex === 'F5' && color === 'B') expect(view.captures!.black).toBe(1);
  }
  expect(ply).toBe(30);
  return view;
}

test('A2 scripted 9×9 Go game to scoring, B+3.5', async () => {
  const game = await srv.create({ kind: 'go', maiaSeat: 'white', go: { boardSize: 9, komi: 7.5 } });
  const B = game.williamToken;
  const W = game.maiaToken;
  const id = game.id;
  expect(game.state.players.black.name).toBe('William');
  await playScript(id, B, W);

  let r = await srv.call('POST', `/api/games/${id}/pass`, B, { ply: 30 });
  expect(r.status).toBe(200);
  expect(r.body.status).toBe('playing');
  r = await srv.call('POST', `/api/games/${id}/pass`, W, { ply: 31 });
  expect(r.status).toBe(200);
  expect(r.body.status).toBe('scoring');
  expect(r.body.scoring!.estimating).toBe(true);
  expect(r.body.clock).toBeNull();

  // The dead-stone estimate arrives through the long-poll.
  let view = r.body;
  const deadline = Date.now() + 20_000;
  while (view.scoring!.estimating && Date.now() < deadline) {
    const w = await srv.call<WaitResponse>('GET', `/api/games/${id}/wait?since=${view.version}&for=change&timeout=20`, B);
    view = w.body.state;
  }
  expect(view.scoring!.estimating).toBe(false);
  expect(view.scoring!.dead).toEqual(['B8']);
  expect(view.scoring!.score.black).toEqual({ stones: 15, territory: 31, total: 46 });
  expect(view.scoring!.score.white).toEqual({ stones: 13, territory: 22, komi: 7.5, total: 42.5 });

  // Black accepts, then toggling B8 alive clears both acceptances.
  r = await srv.call('POST', `/api/games/${id}/scoring/accept`, B, { scoringVersion: view.scoring!.scoringVersion });
  expect(r.body.scoring!.accepted.black).toBe(true);
  r = await srv.call('POST', `/api/games/${id}/scoring/dead`, W, { vertex: 'B8' });
  expect(r.status).toBe(200);
  expect(r.body.scoring!.dead).toEqual([]);
  expect(r.body.scoring!.accepted).toEqual({ black: false, white: false });
  expect(r.body.scoring!.score.black).toEqual({ stones: 15, territory: 1, total: 16 });
  expect(r.body.scoring!.score.white).toEqual({ stones: 14, territory: 22, komi: 7.5, total: 43.5 });
  const staleVersion = r.body.scoring!.scoringVersion;

  r = await srv.call('POST', `/api/games/${id}/scoring/dead`, B, { vertex: 'B8' });
  expect(r.body.scoring!.dead).toEqual(['B8']);
  const current = r.body.scoring!.scoringVersion;

  r = await srv.call('POST', `/api/games/${id}/scoring/accept`, W, { scoringVersion: staleVersion });
  expect(r.status).toBe(409);
  expect(errorCode(r.body)).toBe('stale');

  r = await srv.call('POST', `/api/games/${id}/scoring/accept`, W, { scoringVersion: current });
  expect(r.status).toBe(200);
  expect(r.body.status).toBe('scoring');
  r = await srv.call('POST', `/api/games/${id}/scoring/accept`, B, { scoringVersion: current });
  expect(r.status).toBe(200);
  expect(r.body.status).toBe('over');
  expect(r.body.result).toEqual({ winner: 'black', reason: 'score', margin: 3.5 });

  const sgfText = await (await fetch(`${srv.url}/api/games/${id}/sgf`, { headers: { Authorization: `Bearer ${B}` } })).text();
  const [root] = parse(sgfText);
  expect(root!.data.SZ).toEqual(['9']);
  expect(root!.data.KM).toEqual(['7.5']);
  expect(root!.data.RE).toEqual(['B+3.5']);
  const nodes: Record<string, string[]>[] = [];
  for (let node = root!.children[0]; node; node = node.children[0]) nodes.push(node.data);
  expect(nodes.length).toBe(32);
  expect(nodes[30]).toEqual({ B: [''] });
  expect(nodes[31]).toEqual({ W: [''] });
}, 120_000);

test('A2 resume after two passes needs two new passes', async () => {
  const game = await srv.create({ kind: 'go', maiaSeat: 'white', go: { boardSize: 9 } });
  const B = game.williamToken;
  const W = game.maiaToken;
  const id = game.id;
  await srv.call('POST', `/api/games/${id}/move`, B, { ply: 0, move: 'E5' });
  await srv.call('POST', `/api/games/${id}/pass`, W, { ply: 1 });
  let r = await srv.call('POST', `/api/games/${id}/pass`, B, { ply: 2 });
  expect(r.body.status).toBe('scoring');
  r = await srv.call('POST', `/api/games/${id}/scoring/resume`, W, {});
  expect(r.status).toBe(200);
  expect(r.body.status).toBe('playing');
  expect(r.body.turn).toBe('white');
  // The side to move is the one who did not make the last pass (black passed last here).
  r = await srv.call('POST', `/api/games/${id}/pass`, W, { ply: 3 });
  expect(r.body.status).toBe('playing');
  r = await srv.call('POST', `/api/games/${id}/pass`, B, { ply: 4 });
  expect(r.body.status).toBe('scoring');
}, 60_000);

test('A2 resume puts black to move when white passed last', async () => {
  const game = await srv.create({ kind: 'go', maiaSeat: 'white', go: { boardSize: 9 } });
  const B = game.williamToken;
  const W = game.maiaToken;
  const id = game.id;
  await srv.call('POST', `/api/games/${id}/pass`, B, { ply: 0 });
  let r = await srv.call('POST', `/api/games/${id}/pass`, W, { ply: 1 });
  expect(r.body.status).toBe('scoring');
  r = await srv.call('POST', `/api/games/${id}/scoring/resume`, B, {});
  expect(r.body.status).toBe('playing');
  expect(r.body.turn).toBe('black');
  r = await srv.call('POST', `/api/games/${id}/pass`, B, { ply: 2 });
  expect(r.body.status).toBe('playing');
  r = await srv.call('POST', `/api/games/${id}/pass`, W, { ply: 3 });
  expect(r.body.status).toBe('scoring');
}, 60_000);
