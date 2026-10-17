// Server clock math (ARCHITECTURE 4.5). Fischer: base + increment, first move of each side free.
import type { ClockView, Seat } from '../../shared/types';
import type { GameRow } from '../repo';

const msField = (seat: Seat) => (seat === 'white' ? 'white_ms' : 'black_ms') as 'white_ms' | 'black_ms';

/** The side whose clock is running at `ply`, or null. */
export function runningSeat(row: GameRow, turn: Seat): Seat | null {
  return row.status === 'playing' && row.base_ms !== null && row.turn_started_at !== null ? turn : null;
}

/** When the running clock reaches zero (epoch ms), or null when no clock is running. */
export function flagTime(row: GameRow, turn: Seat): number | null {
  const seat = runningSeat(row, turn);
  return seat === null ? null : row.turn_started_at! + row[msField(seat)]!;
}

/**
 * Charges the mover's thinking time and adds the increment, then starts the next side's clock
 * when the new ply is 2 or more. Mutates `row`; returns the move row's clock columns.
 */
export function chargeMove(
  row: GameRow,
  mover: Seat,
  now: number,
  plyAfter: number,
): { remaining_ms: number | null; spent_ms: number | null } {
  if (row.base_ms === null) return { remaining_ms: null, spent_ms: null };
  const field = msField(mover);
  let spent: number | null = null;
  if (row.turn_started_at !== null) {
    spent = now - row.turn_started_at;
    row[field] = row[field]! - spent + row.increment_ms!;
  }
  row.turn_started_at = plyAfter >= 2 ? now : null;
  return { remaining_ms: row[field], spent_ms: spent };
}

/** Stops the running clock at `now` without an increment (game end, scoring). */
export function stopClock(row: GameRow, turn: Seat, now: number): void {
  const seat = runningSeat(row, turn);
  if (seat !== null) row[msField(seat)] = Math.max(0, row[msField(seat)]! - (now - row.turn_started_at!));
  row.turn_started_at = null;
}

export function zeroClock(row: GameRow, seat: Seat): void {
  row[msField(seat)] = 0;
  row.turn_started_at = null;
}

export function clockView(row: GameRow, turn: Seat, now: number): ClockView | null {
  if (row.base_ms === null) return null;
  const running = runningSeat(row, turn);
  const remainingMs = { white: row.white_ms!, black: row.black_ms! };
  if (running !== null) remainingMs[running] = Math.max(0, remainingMs[running] - (now - row.turn_started_at!));
  return { baseMs: row.base_ms, incrementMs: row.increment_ms!, remainingMs, running, serverNow: now };
}
