import { expect, test } from 'bun:test';
import Board from '@sabaki/go-board';
import { areaScore, emptySignMap, hashSignMap, playGo, toggleDeadChain } from '../src/shared/go-rules';
import { parseGtp, toGtp, toSgfPoint } from '../src/shared/gtp';

test('GTP vertices skip I and count rows from the bottom', () => {
  expect(parseGtp('A1', 9)).toEqual([0, 8]);
  expect(parseGtp('J9', 9)).toEqual([8, 0]);
  expect(parseGtp('d4', 19)).toEqual([3, 15]);
  expect(parseGtp('I5', 19)).toBeNull();
  expect(parseGtp('K5', 9)).toBeNull();
  expect(parseGtp('A10', 9)).toBeNull();
  expect(toGtp([18, 0], 19)).toBe('T19');
  expect(toSgfPoint([4, 3])).toBe('ed');
});

/**
 * One ko shape at offset (ox, oy). State 'A': white stone at (ox+1, oy+1) in atari, black can
 * capture by playing (ox+2, oy+1). State 'B': black stone at (ox+2, oy+1), white can capture at (ox+1, oy+1).
 */
function placeKo(map: number[][], ox: number, oy: number, state: 'A' | 'B') {
  const set = (x: number, y: number, s: 1 | -1) => (map[oy + y]![ox + x] = s);
  set(1, 0, 1);
  set(0, 1, 1);
  set(1, 2, 1);
  set(2, 0, -1);
  set(3, 1, -1);
  set(2, 2, -1);
  if (state === 'A') set(1, 1, -1);
  else set(2, 1, 1);
}

test('positional superko rejects a triple-ko cycle that simple ko misses', () => {
  const map = emptySignMap(13);
  placeKo(map, 0, 4, 'A'); // k1: black can capture at (2,5)
  placeKo(map, 5, 4, 'B'); // k2: white can capture at (6,5)
  placeKo(map, 9, 4, 'A'); // k3: black can capture at (11,5)
  let board = new Board(map);
  const positions = new Set([hashSignMap(map)]);
  const cycle: [1 | -1, [number, number]][] = [
    [1, [2, 5]], // B takes k1
    [-1, [6, 5]], // W takes k2
    [1, [11, 5]], // B takes k3
    [-1, [1, 5]], // W retakes k1
    [1, [7, 5]], // B retakes k2
  ];
  for (const [sign, v] of cycle) {
    const out = playGo(board, sign, v, positions);
    expect('board' in out).toBe(true);
    if (!('board' in out)) return;
    expect(board.diff(out.board)!.length).toBe(2); // one stone placed, one captured
    board = out.board;
    positions.add(hashSignMap(board.signMap));
  }
  // W retaking k3 would recreate the starting position (six moves ago).
  expect(board.analyzeMove(-1, [10, 5]).ko).toBe(false); // simple ko does not see it
  expect(playGo(board, -1, [10, 5], positions)).toEqual({ error: 'ko' });
});

test('simple ko, suicide and occupied points', () => {
  const map = emptySignMap(9);
  placeKo(map, 2, 2, 'A');
  let board = new Board(map);
  const positions = new Set([hashSignMap(map)]);
  const take = playGo(board, 1, [4, 3], positions);
  if (!('board' in take)) throw new Error('capture rejected');
  board = take.board;
  positions.add(hashSignMap(board.signMap));
  expect(playGo(board, -1, [3, 3], positions)).toEqual({ error: 'ko' });
  expect(playGo(board, -1, [4, 3], positions)).toEqual({ error: 'illegal' });
  const corner = emptySignMap(9);
  corner[0]![1] = 1;
  corner[1]![0] = 1;
  expect(playGo(new Board(corner), -1, [0, 0], new Set())).toEqual({ error: 'suicide' });
});

test('area score counts stones and single-colour regions, dame for nobody', () => {
  const map = emptySignMap(9);
  for (let y = 0; y < 9; y++) {
    map[y]![3] = 1;
    map[y]![5] = -1;
  }
  const s = areaScore(map, [], 7.5);
  expect(s.score.black).toEqual({ stones: 9, territory: 27, total: 36 });
  expect(s.score.white).toEqual({ stones: 9, territory: 27, komi: 7.5, total: 43.5 });
  expect(s.winner).toBe('white');
  expect(s.margin).toBe(7.5);
  expect(s.territory[0]![4]).toBe(0); // dame column
  map[0]![7] = 1; // a dead black stone inside white's area
  const withDead = areaScore(map, ['H9'], 7.5);
  expect(withDead.score.white.territory).toBe(27);
  expect(withDead.territory[0]![7]).toBe(-1);
});

test('toggling a chain marks every stone of it', () => {
  const map = emptySignMap(9);
  map[0]![0] = 1;
  map[0]![1] = 1;
  map[1]![1] = 1;
  const dead = toggleDeadChain(map, [], 'A9')!;
  expect(dead.sort()).toEqual(['A9', 'B8', 'B9']);
  expect(toggleDeadChain(map, dead, 'B8')).toEqual([]);
  expect(toggleDeadChain(map, [], 'E5')).toBeNull();
});
