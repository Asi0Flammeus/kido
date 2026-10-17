import { expect, test } from 'bun:test';
import { displayRemaining, formatClock } from '../src/shared/clock';
import { chargeMove, clockView, flagTime } from '../src/server/games/clock';
import type { GameRow } from '../src/server/repo';

test('clock format: m:ss, tenths under ten seconds, h:mm:ss', () => {
  expect(formatClock(762_000)).toBe('12:42');
  expect(formatClock(7_400)).toBe('0:07.4');
  expect(formatClock(0)).toBe('0:00.0');
  expect(formatClock(-5)).toBe('0:00.0');
  expect(formatClock(10_000)).toBe('0:10');
  expect(formatClock(3_600_000)).toBe('1:00:00');
  expect(formatClock(3_725_000)).toBe('1:02:05');
});

test('client extrapolation only moves the running side, floored at zero', () => {
  const clock = { baseMs: 1000, incrementMs: 0, remainingMs: { white: 5000, black: 3000 }, running: 'white' as const, serverNow: 1_000 };
  expect(displayRemaining(clock, 'white', 2_000, 0)).toBe(4000);
  expect(displayRemaining(clock, 'black', 2_000, 0)).toBe(3000);
  expect(displayRemaining(clock, 'white', 10_000, 0)).toBe(0);
  expect(displayRemaining(clock, 'white', 1_500, 500)).toBe(4000);
});

function row(): GameRow {
  return {
    id: 'x', kind: 'chess', created_at: 0, updated_at: 0, version: 1, white_name: 'William', black_name: 'Maïa',
    maia_seat: 'black', white_token: 'a', black_token: 'b', spectators: 0, base_ms: 60_000, increment_ms: 2_000,
    board_size: null, komi: null, status: 'playing', white_ms: 60_000, black_ms: 60_000, turn_started_at: null,
    draw_offer: null, go_resume_ply: 0, scoring_json: null, result_winner: null, result_reason: null, result_margin: null,
    ended_at: null,
  };
}

test('first move of each side is free, then Fischer increments', () => {
  const r = row();
  expect(chargeMove(r, 'white', 1_000, 1)).toEqual({ remaining_ms: 60_000, spent_ms: null });
  expect(r.turn_started_at).toBeNull();
  expect(chargeMove(r, 'black', 5_000, 2)).toEqual({ remaining_ms: 60_000, spent_ms: null });
  expect(r.turn_started_at).toBe(5_000);
  expect(flagTime(r, 'white')).toBe(65_000);
  expect(clockView(r, 'white', 15_000)!.remainingMs.white).toBe(50_000);
  expect(chargeMove(r, 'white', 15_000, 3)).toEqual({ remaining_ms: 52_000, spent_ms: 10_000 });
  expect(r.turn_started_at).toBe(15_000);
  expect(clockView(r, 'black', 15_000)!.running).toBe('black');
});
