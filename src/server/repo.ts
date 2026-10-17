// The only file with SQL (ARCHITECTURE 2).
import type { Database } from 'bun:sqlite';
import type { GameKind, GameStatus, PlayerName, ResultReason, Seat } from '../shared/types';

export interface GameRow {
  id: string;
  kind: GameKind;
  created_at: number;
  updated_at: number;
  version: number;
  white_name: PlayerName;
  black_name: PlayerName;
  maia_seat: Seat;
  white_token: string;
  black_token: string;
  spectators: 0 | 1;
  base_ms: number | null;
  increment_ms: number | null;
  board_size: 9 | 13 | 19 | null;
  komi: 6.5 | 7.5 | null;
  status: GameStatus;
  white_ms: number | null;
  black_ms: number | null;
  turn_started_at: number | null;
  draw_offer: Seat | null;
  go_resume_ply: number;
  scoring_json: string | null;
  result_winner: Seat | null;
  result_reason: ResultReason | null;
  result_margin: number | null;
  ended_at: number | null;
}

export interface MoveRow {
  game_id: string;
  ply: number;
  seat: Seat;
  notation: string;
  uci: string | null;
  fen_after: string | null;
  remaining_ms: number | null;
  spent_ms: number | null;
  created_at: number;
}

const GAME_COLUMNS = [
  'id', 'kind', 'created_at', 'updated_at', 'version', 'white_name', 'black_name', 'maia_seat',
  'white_token', 'black_token', 'spectators', 'base_ms', 'increment_ms', 'board_size', 'komi',
  'status', 'white_ms', 'black_ms', 'turn_started_at', 'draw_offer', 'go_resume_ply', 'scoring_json',
  'result_winner', 'result_reason', 'result_margin', 'ended_at',
] as const;
const MUTABLE_COLUMNS = GAME_COLUMNS.filter(
  (c) => !['id', 'kind', 'created_at', 'white_name', 'black_name', 'maia_seat', 'white_token', 'black_token',
    'spectators', 'base_ms', 'increment_ms', 'board_size', 'komi'].includes(c),
);

export class Repo {
  private readonly insertGameStmt;
  private readonly saveGameStmt;
  private readonly getGameStmt;
  private readonly insertMoveStmt;
  private readonly movesStmt;

  constructor(readonly db: Database) {
    this.insertGameStmt = db.query(
      `INSERT INTO games (${GAME_COLUMNS.join(', ')}) VALUES (${GAME_COLUMNS.map((c) => `$${c}`).join(', ')})`,
    );
    this.saveGameStmt = db.query(
      `UPDATE games SET ${MUTABLE_COLUMNS.map((c) => `${c} = $${c}`).join(', ')} WHERE id = $id`,
    );
    this.getGameStmt = db.query<GameRow, { id: string }>('SELECT * FROM games WHERE id = $id');
    this.insertMoveStmt = db.query(
      `INSERT INTO moves (game_id, ply, seat, notation, uci, fen_after, remaining_ms, spent_ms, created_at)
       VALUES ($game_id, $ply, $seat, $notation, $uci, $fen_after, $remaining_ms, $spent_ms, $created_at)`,
    );
    this.movesStmt = db.query<MoveRow, { id: string }>('SELECT * FROM moves WHERE game_id = $id ORDER BY ply');
  }

  insertGame(row: GameRow): void {
    this.insertGameStmt.run(row as never);
  }

  saveGame(row: GameRow): void {
    const params: Record<string, unknown> = { id: row.id };
    for (const c of MUTABLE_COLUMNS) params[c] = row[c];
    this.saveGameStmt.run(params as never);
  }

  getGame(id: string): GameRow | null {
    return this.getGameStmt.get({ id });
  }

  insertMove(move: MoveRow): void {
    this.insertMoveStmt.run(move as never);
  }

  moves(id: string): MoveRow[] {
    return this.movesStmt.all({ id });
  }

  listGames(status: GameStatus | null, limit: number): GameRow[] {
    return status
      ? this.db
          .query<GameRow, { status: string; limit: number }>(
            'SELECT * FROM games WHERE status = $status ORDER BY created_at DESC LIMIT $limit',
          )
          .all({ status, limit })
      : this.db
          .query<GameRow, { limit: number }>('SELECT * FROM games ORDER BY created_at DESC LIMIT $limit')
          .all({ limit });
  }

  /** Timed games whose clock may be running (boot: settle or re-arm flag timers). */
  runningClockGameIds(): string[] {
    return this.db
      .query<{ id: string }, []>(
        "SELECT id FROM games WHERE status = 'playing' AND turn_started_at IS NOT NULL",
      )
      .all()
      .map((r) => r.id);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}
