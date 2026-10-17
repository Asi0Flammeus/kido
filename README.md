# Kido · 棋道

Go and chess, played slowly.

Kido is a small web app for slow games of Go and chess between two fixed players: William, on a phone, and Maïa, his Ghost, who plays through the HTTP API. There are no accounts. A game is created with an admin token and played through two secret seat links; a third, spectator link exists only when the game allows it.

- Chess with [chessground](https://github.com/lichess-org/chessground) and [chess.js](https://github.com/jhlywa/chess.js): legal-move hints, promotion picker, draw offers, resignation, Fischer clocks, PGN export.
- Go (9×9, 13×13, 19×19) with [Shudan](https://github.com/SabakiHQ/Shudan) and [go-board](https://github.com/SabakiHQ/go-board): preview-then-confirm placement, positional superko, area scoring with komi, dead-stone marking seeded by [deadstones](https://github.com/SabakiHQ/deadstones), SGF export.
- Live updates over Server-Sent Events, a long-poll endpoint for API players, server-side clocks, board PNGs for players who read the position from an image.

Live at <https://kido.wmmw.sh>.

## Run locally

Requires [Bun](https://bun.sh) 1.3.14.

```sh
bun install
bun run build:web                       # dist/web
KIDO_ADMIN_TOKEN=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=') \
DATABASE_PATH=./data/kido.sqlite KIDO_PUBLIC_URL=http://127.0.0.1:3000 \
bun run start                           # http://127.0.0.1:3000
```

Create a game with the admin token, then open the `william` link from the response:

```sh
curl -sS -X POST http://127.0.0.1:3000/api/games -H "Authorization: Bearer $KIDO_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"kind":"go","maiaSeat":"white","go":{"boardSize":9}}'
```

`scripts/maia-play.ts` is a small CLI over the same API (`create`, `state`, `wait`, `move`, `pass`, `resign`, `draw`, `dead`, `accept`, `resume`, `png`).

## Tests

```sh
bun run test       # rules, clocks and the API acceptance games (A1 to A3)
bun run test:e2e   # Playwright game on the phone viewport (A4), needs Chromium from Playwright 1.60
bun run check      # tsc --noEmit
```

## Deploy

One Bun process in a Docker Compose service on `127.0.0.1:4370`, SQLite (WAL) in the `kido-data` volume, a hand-managed nginx vhost (`deploy/kido.wmmw.sh.conf`) with a certbot webroot certificate.

```sh
./deploy.sh up       # first deploy: creates .env.prod (mode 600) with a fresh admin token, builds, starts
./deploy.sh update   # git pull, rebuild, restart; not during a timed game (downtime counts on the clock)
./deploy.sh status
```

`.env.prod` holds `KIDO_ADMIN_TOKEN` and `KIDO_PUBLIC_URL` and is never committed.

## How Maïa plays

Maïa keeps `KIDO_ADMIN_TOKEN` and, per game, her seat token. One game:

```sh
K=https://kido.wmmw.sh
# 1. create, send links.william to asi0
curl -sS -X POST $K/api/games -H "Authorization: Bearer $KIDO_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"kind":"chess","maiaSeat":"black","timeControl":{"baseSec":600,"incrementSec":5}}'
# 2. loop: wait for her turn (returns within 120 s; repeat while changed=false)
curl -sS "$K/api/games/$ID/wait?since=$V&for=turn&timeout=120" -H "Authorization: Bearer $T"
# 3. look at the board if needed
curl -sS "$K/api/games/$ID/board.png?size=800" -H "Authorization: Bearer $T" -o board.png
# 4. move with the ply she saw
curl -sS -X POST $K/api/games/$ID/move -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -d '{"ply":1,"move":"e7e5"}'
```

`ascii` format: chess = 8 ranks from rank 8, `KQRBNP` white, `kqrbnp` black, `.` empty, files/ranks labelled, side to move and check on a last line. Go = rows from the top, `X` black, `O` white, `.` empty, `+` hoshi, GTP column letters, last move in parentheses, `x`/`o` for stones marked dead during scoring.

### API quick reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/healthz` | none | `{ "ok": true, "version": "<git sha>" }` |
| POST | `/api/games` | admin | create a game (`kind`, `maiaSeat`, `timeControl`, `go`, `spectators`) |
| GET | `/api/games?status=playing\|scoring\|over&limit=20` | admin | list games with links |
| GET | `/api/games/:id` | seat or spectator | current state |
| GET | `/api/games/:id/wait?since=<version>&for=change\|turn&timeout=<1..120>` | seat or spectator | long-poll |
| GET | `/api/games/:id/events` (`?s=` token) | seat or spectator | SSE stream of `state` events |
| POST | `/api/games/:id/move` `{ ply, move }` | seat | chess UCI or SAN, Go GTP vertex |
| POST | `/api/games/:id/pass` `{ ply }` | seat | Go pass |
| POST | `/api/games/:id/resign` | seat | resign |
| POST | `/api/games/:id/draw` `{ action: offer\|accept\|decline }` | seat | chess draw offers |
| POST | `/api/games/:id/scoring/dead` `{ vertex }` | seat | Go: toggle a group dead or alive |
| POST | `/api/games/:id/scoring/accept` `{ scoringVersion }` | seat | Go: accept the score |
| POST | `/api/games/:id/scoring/resume` | seat | Go: leave scoring, resume play |
| GET | `/api/games/:id/board.png?ply=&size=256..1600&coords=0\|1` | seat or spectator | board image |
| GET | `/api/games/:id/pgn`, `/api/games/:id/sgf` | seat or spectator | downloads |

Errors are `{ "error": { "code", "message" } }` with `badRequest` (400), `unauthorized` (401), `notFound` (404), `notYourTurn`, `stale`, `gameOver`, `wrongPhase` (409), `illegal`, `ko`, `suicide` (422); 409 and 422 also carry the current `state`. A `move` or `pass` retried with the previous `ply` and the same move returns 200.

## Licence

Kido is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See [LICENSE](LICENSE). SPDX: `GPL-3.0-or-later`.

The licence follows from the chess board: the browser bundle includes chessground, which is GPL-3.0-or-later.

## Credits

- [chessground](https://github.com/lichess-org/chessground) by Lichess, GPL-3.0-or-later.
- Chess pieces: the cburnett set by **Colin M.L. Burnett**, GPLv2+ (shipped inside chessground's `chessground.cburnett.css`).
- [chess.js](https://github.com/jhlywa/chess.js), BSD-2-Clause.
- [Shudan](https://github.com/SabakiHQ/Shudan), [go-board](https://github.com/SabakiHQ/go-board), [deadstones](https://github.com/SabakiHQ/deadstones) and [sgf](https://github.com/SabakiHQ/sgf) from the Sabaki project by Yichuan Shen, MIT.
- [Preact](https://preactjs.com), MIT. [resvg-js](https://github.com/yisibl/resvg-js), MPL-2.0 (server only).
- [IBM Plex Sans and Plex Mono](https://github.com/IBM/plex) via Fontsource, SIL Open Font License 1.1.
- [Phosphor Icons](https://phosphoricons.com), MIT.
