// In-memory game state rebuilt from the row plus every stored move (ARCHITECTURE 4.2).
import type { Chess } from 'chess.js';
import type { Seat } from '../../shared/types';
import type { GameRow, MoveRow } from '../repo';
import { replayChess } from './chess';
import { replayGo, type GoState } from './go';

export interface ScoringState {
  dead: string[];
  accepted: Record<Seat, boolean>;
  scoringVersion: number;
  estimating: boolean;
}

export interface GameRuntime {
  row: GameRow;
  moves: MoveRow[];
  chess: Chess | null;
  go: GoState | null;
  timer: Timer | null;
  estimateSeq: number;
}

export function buildRuntime(row: GameRow, moves: MoveRow[]): GameRuntime {
  return {
    row,
    moves,
    chess: row.kind === 'chess' ? replayChess(moves) : null,
    go: row.kind === 'go' ? replayGo(row.board_size!, moves) : null,
    timer: null,
    estimateSeq: 0,
  };
}

export const scoringOf = (row: GameRow): ScoringState | null =>
  row.scoring_json === null ? null : (JSON.parse(row.scoring_json) as ScoringState);

/** Side to move from parity: chess white first, Go black first. */
export function turnOf(row: GameRow, ply: number): Seat {
  const even = ply % 2 === 0;
  return row.kind === 'chess' ? (even ? 'white' : 'black') : even ? 'black' : 'white';
}
