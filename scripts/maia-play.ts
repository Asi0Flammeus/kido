#!/usr/bin/env bun
// Tiny CLI over the Kido API for manual play and smoke tests.
//
//   KIDO_URL=https://kido.wmmw.sh KIDO_ADMIN_TOKEN=… bun scripts/maia-play.ts create '{"kind":"chess","maiaSeat":"black"}'
//   KIDO_TOKEN=<seat token> bun scripts/maia-play.ts state <id>
//   KIDO_TOKEN=… bun scripts/maia-play.ts wait <id> [turn|change]
//   KIDO_TOKEN=… bun scripts/maia-play.ts move <id> <move>        (uses the current ply)
//   KIDO_TOKEN=… bun scripts/maia-play.ts pass|resign|resume <id>
//   KIDO_TOKEN=… bun scripts/maia-play.ts draw <id> offer|accept|decline
//   KIDO_TOKEN=… bun scripts/maia-play.ts dead <id> <vertex>
//   KIDO_TOKEN=… bun scripts/maia-play.ts accept <id>
//   KIDO_TOKEN=… bun scripts/maia-play.ts png <id> <out.png> [size]
//
// Prints the ASCII board and the JSON fields that matter; never prints tokens.
import type { GameView, WaitResponse } from '../src/shared/types';

const base = (process.env.KIDO_URL ?? 'http://127.0.0.1:4370').replace(/\/$/, '');
const [command, id, ...rest] = process.argv.slice(2);

async function call<T>(method: string, path: string, token: string | undefined, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) {
    console.error(`${res.status} ${text.slice(0, 400)}`);
    process.exit(1);
  }
  return JSON.parse(text) as T;
}

function show(view: GameView) {
  console.log(view.ascii);
  const brief = {
    status: view.status,
    ply: view.ply,
    version: view.version,
    turn: view.turn,
    yourTurn: view.yourTurn,
    actions: view.actions,
    draw: view.draw,
    result: view.result ?? null,
    scoring: view.scoring ? { dead: view.scoring.dead, score: view.scoring.score, accepted: view.scoring.accepted, scoringVersion: view.scoring.scoringVersion } : undefined,
  };
  console.log(JSON.stringify(brief));
}

const seat = process.env.KIDO_TOKEN;
const game = `/api/games/${id}`;
switch (command) {
  case 'create': {
    const created = await call<{ id: string; state: GameView }>('POST', '/api/games', process.env.KIDO_ADMIN_TOKEN, JSON.parse(id ?? '{}'));
    console.log(`created ${created.id}; links are in the API response (not printed)`);
    show(created.state);
    break;
  }
  case 'state':
    show(await call<GameView>('GET', game, seat));
    break;
  case 'wait': {
    const v = await call<GameView>('GET', game, seat);
    const r = await call<WaitResponse>('GET', `${game}/wait?since=${v.version}&for=${rest[0] ?? 'turn'}&timeout=120`, seat);
    show(r.state);
    break;
  }
  case 'move':
  case 'pass': {
    const v = await call<GameView>('GET', game, seat);
    show(await call<GameView>('POST', `${game}/${command}`, seat, command === 'move' ? { ply: v.ply, move: rest[0] } : { ply: v.ply }));
    break;
  }
  case 'resign':
    show(await call<GameView>('POST', `${game}/resign`, seat, {}));
    break;
  case 'resume':
    show(await call<GameView>('POST', `${game}/scoring/resume`, seat, {}));
    break;
  case 'draw':
    show(await call<GameView>('POST', `${game}/draw`, seat, { action: rest[0] }));
    break;
  case 'dead':
    show(await call<GameView>('POST', `${game}/scoring/dead`, seat, { vertex: rest[0] }));
    break;
  case 'accept': {
    const v = await call<GameView>('GET', game, seat);
    show(await call<GameView>('POST', `${game}/scoring/accept`, seat, { scoringVersion: v.scoring?.scoringVersion }));
    break;
  }
  case 'png': {
    const res = await fetch(`${base}${game}/board.png?size=${rest[1] ?? 800}`, { headers: { Authorization: `Bearer ${seat}` } });
    await Bun.write(rest[0] ?? 'board.png', await res.arrayBuffer());
    console.log(`wrote ${rest[0] ?? 'board.png'} (${res.status})`);
    break;
  }
  default:
    console.error('usage: maia-play.ts create|state|wait|move|pass|resign|resume|draw|dead|accept|png …');
    process.exit(2);
}
