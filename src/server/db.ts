import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MIGRATIONS: string[] = [
  `
CREATE TABLE games (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('chess','go')),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  version          INTEGER NOT NULL DEFAULT 1,
  white_name       TEXT NOT NULL CHECK (white_name IN ('Maïa','William')),
  black_name       TEXT NOT NULL CHECK (black_name IN ('Maïa','William')),
  maia_seat        TEXT NOT NULL CHECK (maia_seat IN ('white','black')),
  white_token      TEXT NOT NULL UNIQUE,
  black_token      TEXT NOT NULL UNIQUE,
  spectators       INTEGER NOT NULL DEFAULT 0 CHECK (spectators IN (0,1)),
  base_ms          INTEGER CHECK (base_ms BETWEEN 1000 AND 10800000),
  increment_ms     INTEGER CHECK (increment_ms BETWEEN 0 AND 180000),
  board_size       INTEGER CHECK (board_size IN (9,13,19)),
  komi             REAL CHECK (komi IN (6.5, 7.5)),
  status           TEXT NOT NULL CHECK (status IN ('playing','scoring','over')),
  white_ms         INTEGER,
  black_ms         INTEGER,
  turn_started_at  INTEGER,
  draw_offer       TEXT CHECK (draw_offer IN ('white','black')),
  go_resume_ply    INTEGER NOT NULL DEFAULT 0,
  scoring_json     TEXT,
  result_winner    TEXT CHECK (result_winner IN ('white','black')),
  result_reason    TEXT CHECK (result_reason IN ('checkmate','stalemate','resignation','timeout','agreement',
                                                 'repetition','fiftyMoves','insufficientMaterial','score')),
  result_margin    REAL,
  ended_at         INTEGER,
  CHECK ((base_ms IS NULL) = (increment_ms IS NULL)),
  CHECK ((kind = 'go') = (board_size IS NOT NULL)),
  CHECK ((kind = 'go') = (komi IS NOT NULL)),
  CHECK (white_name <> black_name),
  CHECK ((status = 'over') = (result_reason IS NOT NULL))
);
CREATE INDEX games_by_status ON games (status, updated_at);

CREATE TABLE moves (
  game_id       TEXT NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  ply           INTEGER NOT NULL,
  seat          TEXT NOT NULL CHECK (seat IN ('white','black')),
  notation      TEXT NOT NULL,
  uci           TEXT,
  fen_after     TEXT,
  remaining_ms  INTEGER,
  spent_ms      INTEGER,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (game_id, ply)
);
`,
];

export function openDb(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  const { user_version: current } = db.query('PRAGMA user_version').get() as { user_version: number };
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    })();
  }
  return db;
}
