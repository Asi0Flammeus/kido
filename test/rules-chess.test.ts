import { expect, test } from 'bun:test';
import { Chess } from 'chess.js';
import { applyChessMove, cannotMate, chessAscii, chessEnd } from '../src/server/games/chess';

test('UCI and SAN are both accepted; illegal moves return null', () => {
  const chess = new Chess();
  expect(applyChessMove(chess, 'e2e4')?.san).toBe('e4');
  expect(applyChessMove(chess, 'Nf6')?.lan).toBe('g8f6');
  expect(applyChessMove(chess, 'e4e6')).toBeNull();
  expect(applyChessMove(chess, 'Qh9')).toBeNull();
});

test('promotion by UCI suffix', () => {
  const chess = new Chess('8/P6k/8/8/8/8/8/K7 w - - 0 1');
  expect(applyChessMove(chess, 'a7a8n')?.san).toBe('a8=N');
});

test('end detection order: mate, stalemate, insufficient material', () => {
  const mate = new Chess();
  for (const m of ['f2f3', 'e7e5', 'g2g4', 'd8h4']) applyChessMove(mate, m);
  expect(chessEnd(mate, 'black')).toEqual({ winner: 'black', reason: 'checkmate' });
  const stale = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  expect(chessEnd(stale, 'white')).toEqual({ winner: null, reason: 'stalemate' });
  const bare = new Chess('8/8/8/4k3/8/8/8/4K3 w - - 0 1');
  expect(chessEnd(bare, 'white')).toEqual({ winner: null, reason: 'insufficientMaterial' });
  expect(chessEnd(new Chess(), 'white')).toBeNull();
});

test('cannotMate: lone king, king + minor', () => {
  expect(cannotMate(new Chess('8/8/8/4k3/8/8/8/4K2N w - - 0 1'), 'white')).toBe(true);
  expect(cannotMate(new Chess('8/8/8/4k3/8/8/8/4K2B w - - 0 1'), 'white')).toBe(true);
  expect(cannotMate(new Chess('8/8/8/4k3/8/8/8/4K2R w - - 0 1'), 'white')).toBe(false);
  expect(cannotMate(new Chess('8/8/8/4k3/8/8/8/4K2R w - - 0 1'), 'black')).toBe(true);
});

test('ascii diagram for Maïa', () => {
  const lines = chessAscii(new Chess()).split('\n');
  expect(lines[1]).toBe('8 r n b q k b n r 8');
  expect(lines.at(-1)).toBe('white to move');
});
