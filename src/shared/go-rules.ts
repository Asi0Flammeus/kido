// Go rules on top of @sabaki/go-board (ARCHITECTURE 4.4): positional superko, chain toggling,
// area scoring. Runs unchanged on the server (authority) and in the client (instant feedback).
import Board from '@sabaki/go-board';
import { parseGtp, toGtp, type Vertex } from './gtp';
import type { ScoreLine, Seat } from './types';

export type Sign = 0 | 1 | -1;
export type SignMap = Sign[][];
export type GoRejection = 'illegal' | 'suicide' | 'ko';

export const emptySignMap = (size: number): SignMap =>
  Array.from({ length: size }, () => Array<Sign>(size).fill(0));

export const hashSignMap = (signMap: SignMap): string => signMap.map((row) => row.join(',')).join('/');

export const seatSign = (seat: Seat): 1 | -1 => (seat === 'black' ? 1 : -1);

/**
 * Plays `sign` at `vertex`. `positions` holds the hash of the empty board and of the position
 * after every earlier non-pass move; a result already in it is a positional superko violation.
 */
export function playGo(
  board: Board,
  sign: 1 | -1,
  vertex: Vertex,
  positions: ReadonlySet<string>,
): { board: Board } | { error: GoRejection } {
  const analysis = board.analyzeMove(sign, vertex);
  if (analysis.overwrite) return { error: 'illegal' };
  if (analysis.suicide) return { error: 'suicide' };
  const next = board.makeMove(sign, vertex);
  if (positions.has(hashSignMap(next.signMap))) return { error: 'ko' };
  return { board: next };
}

/** Toggles every stone of the chain at `gtp` in or out of `dead`; null when the vertex is empty. */
export function toggleDeadChain(signMap: SignMap, dead: readonly string[], gtp: string): string[] | null {
  const size = signMap.length;
  const vertex = parseGtp(gtp, size);
  if (!vertex || signMap[vertex[1]]![vertex[0]] === 0) return null;
  const chain = new Board(signMap).getChain(vertex).map((v) => toGtp(v as Vertex, size));
  const set = new Set(dead);
  const makeDead = !set.has(toGtp(vertex, size));
  for (const v of chain) {
    if (makeDead) set.add(v);
    else set.delete(v);
  }
  return [...set];
}

export interface AreaScore {
  score: Record<Seat, ScoreLine>;
  territory: number[][]; // 1 black area, -1 white area, 0 none; only on empty and dead-stone vertices
  winner: Seat;
  margin: number;
}

/** Area scoring: stones on the board plus empty regions bordered by one colour only, komi to white. */
export function areaScore(signMap: SignMap, dead: readonly string[], komi: number): AreaScore {
  const size = signMap.length;
  const map = signMap.map((row) => row.slice());
  for (const gtp of dead) {
    const v = parseGtp(gtp, size);
    if (v) map[v[1]]![v[0]] = 0;
  }
  const territory = emptySignMap(size);
  const seen = emptySignMap(size);
  let stonesBlack = 0;
  let stonesWhite = 0;
  let areaBlack = 0;
  let areaWhite = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = map[y]![x]!;
      if (s === 1) stonesBlack++;
      else if (s === -1) stonesWhite++;
      if (s !== 0 || seen[y]![x]) continue;
      const region: Vertex[] = [];
      const borders = new Set<number>();
      const stack: Vertex[] = [[x, y]];
      seen[y]![x] = 1;
      while (stack.length > 0) {
        const [cx, cy] = stack.pop()!;
        region.push([cx, cy]);
        for (const [nx, ny] of [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ] as Vertex[]) {
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const ns = map[ny]![nx]!;
          if (ns !== 0) borders.add(ns);
          else if (!seen[ny]![nx]) {
            seen[ny]![nx] = 1;
            stack.push([nx, ny]);
          }
        }
      }
      if (borders.size !== 1) continue;
      const owner = borders.has(1) ? 1 : -1;
      if (owner === 1) areaBlack += region.length;
      else areaWhite += region.length;
      for (const [rx, ry] of region) territory[ry]![rx] = owner;
    }
  }
  const black: ScoreLine = { stones: stonesBlack, territory: areaBlack, total: stonesBlack + areaBlack };
  const white: ScoreLine = { stones: stonesWhite, territory: areaWhite, komi, total: stonesWhite + areaWhite + komi };
  const winner: Seat = black.total > white.total ? 'black' : 'white';
  return { score: { black, white }, territory, winner, margin: Math.abs(black.total - white.total) };
}
