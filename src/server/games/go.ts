// Go adapter over shared/go-rules.ts (ARCHITECTURE 4.4): replay, SGF export, ASCII diagram.
import Board from '@sabaki/go-board';
import { stringify } from '@sabaki/sgf';
import { emptySignMap, hashSignMap, seatSign } from '../../shared/go-rules';
import { parseGtp, toSgfPoint, type Vertex } from '../../shared/gtp';
import type { GameRow, MoveRow } from '../repo';

export interface GoState {
  board: Board;
  positions: Set<string>;
}

export function replayGo(size: number, moves: readonly MoveRow[], upTo = moves.length): GoState {
  let board = Board.fromDimensions(size);
  const positions = new Set([hashSignMap(emptySignMap(size))]);
  for (const m of moves.slice(0, upTo)) {
    if (m.notation === 'pass') continue;
    board = board.makeMove(seatSign(m.seat), parseGtp(m.notation, size)!);
    positions.add(hashSignMap(board.signMap));
  }
  return { board, positions };
}

export function hoshiPoints(size: number): Vertex[] {
  const lines = size === 9 ? [2, 6] : size === 13 ? [3, 9] : [3, 9, 15];
  const mid = (size - 1) / 2;
  const points: Vertex[] = [[mid, mid]];
  for (const x of lines) for (const y of lines) points.push([x, y]);
  if (size === 19) for (const v of [3, 15]) points.push([v, 9], [9, v]);
  return points;
}

export function goAscii(row: GameRow, board: Board, moves: readonly MoveRow[], dead: readonly string[]): string {
  const size = row.board_size!;
  const cols = 'ABCDEFGHJKLMNOPQRST'.slice(0, size).split('').join(' ');
  const hoshi = new Set(hoshiPoints(size).map(([x, y]) => `${x},${y}`));
  const deadSet = new Set(dead.map((g) => parseGtp(g, size)!.join(',')));
  const last = moves.at(-1);
  const lastV = last && last.notation !== 'pass' ? parseGtp(last.notation, size) : null;
  const lines = [`    ${cols}`];
  for (let y = 0; y < size; y++) {
    let line = '';
    for (let x = 0; x < size; x++) {
      const s = board.signMap[y]![x];
      const isDead = deadSet.has(`${x},${y}`);
      const c = s === 1 ? (isDead ? 'x' : 'X') : s === -1 ? (isDead ? 'o' : 'O') : hoshi.has(`${x},${y}`) ? '+' : '.';
      const sep = lastV && lastV[1] === y && lastV[0] === x ? '(' : lastV && lastV[1] === y && lastV[0] === x - 1 ? ')' : ' ';
      line += sep + c;
    }
    line += lastV && lastV[1] === y && lastV[0] === size - 1 ? ')' : ' ';
    const n = String(size - y).padStart(2, ' ');
    lines.push(`${n} ${line} ${n}`);
  }
  lines.push(`    ${cols}`);
  return lines.join('\n');
}

export function goSgf(row: GameRow, moves: readonly MoveRow[]): string {
  const size = row.board_size!;
  const root: Record<string, string[]> = {
    GM: ['1'],
    FF: ['4'],
    CA: ['UTF-8'],
    AP: ['Kido:1'],
    SZ: [String(size)],
    KM: [String(row.komi)],
    RU: ['Chinese'],
    PB: [row.black_name],
    PW: [row.white_name],
    DT: [new Date(row.created_at).toISOString().slice(0, 10)],
  };
  if (row.status === 'over' && row.result_winner) {
    const w = row.result_winner === 'black' ? 'B' : 'W';
    const how =
      row.result_reason === 'score' ? String(row.result_margin) : row.result_reason === 'timeout' ? 'T' : 'R';
    root.RE = [`${w}+${how}`];
  }
  if (row.base_ms !== null) {
    root.TM = [String(row.base_ms / 1000)];
    root.OT = [`${(row.increment_ms ?? 0) / 1000} increment`];
  }
  type Node = { id: number; data: Record<string, string[]>; parentId: number | null; children: Node[] };
  const rootNode: Node = { id: 0, data: root, parentId: null, children: [] };
  let tail = rootNode;
  moves.forEach((m, i) => {
    const key = m.seat === 'black' ? 'B' : 'W';
    const value = m.notation === 'pass' ? '' : toSgfPoint(parseGtp(m.notation, size)!);
    const node: Node = { id: i + 1, data: { [key]: [value] }, parentId: tail.id, children: [] };
    tail.children.push(node);
    tail = node;
  });
  return stringify([rootNode]);
}
