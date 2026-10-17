// chess.js adapter (ARCHITECTURE 4.3): apply a move, detect the end, export PGN, draw ASCII.
import { Chess, type Move } from 'chess.js';
import type { ResultReason, Seat } from '../../shared/types';
import type { GameRow, MoveRow } from '../repo';

const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export function replayChess(moves: readonly MoveRow[]): Chess {
  const chess = new Chess();
  for (const m of moves) chess.move(uciToMove(m.uci!));
  return chess;
}

function uciToMove(uci: string) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] };
}

/** Plays UCI or SAN; null when chess.js rejects it (it throws on illegal moves in 1.x). */
export function applyChessMove(chess: Chess, text: string): Move | null {
  try {
    return UCI_RE.test(text) ? chess.move(uciToMove(text)) : chess.move(text);
  } catch {
    return null;
  }
}

/** Is `notation` (UCI or SAN) the stored move? Used for the idempotent retry rule (6.2). */
export const sameChessMove = (stored: MoveRow, text: string): boolean =>
  text === stored.uci || text === stored.notation;

/** End checks in the spec's order, after `mover` moved. */
export function chessEnd(chess: Chess, mover: Seat): { winner: Seat | null; reason: ResultReason } | null {
  if (chess.isCheckmate()) return { winner: mover, reason: 'checkmate' };
  if (chess.isStalemate()) return { winner: null, reason: 'stalemate' };
  if (chess.isInsufficientMaterial()) return { winner: null, reason: 'insufficientMaterial' };
  if (chess.isThreefoldRepetition()) return { winner: null, reason: 'repetition' };
  if (chess.isDrawByFiftyMoves()) return { winner: null, reason: 'fiftyMoves' };
  return null;
}

/** True when `seat` has only a king, king + bishop or king + knight: it can never mate. */
export function cannotMate(chess: Chess, seat: Seat): boolean {
  const color = seat === 'white' ? 'w' : 'b';
  const pieces = chess
    .board()
    .flat()
    .filter((p) => p !== null && p.color === color)
    .map((p) => p!.type)
    .filter((t) => t !== 'k');
  return pieces.length === 0 || (pieces.length === 1 && (pieces[0] === 'b' || pieces[0] === 'n'));
}

const RESULT_TOKEN = (row: GameRow): string => {
  if (row.status !== 'over') return '*';
  if (row.result_winner === null) return '1/2-1/2';
  return row.result_winner === 'white' ? '1-0' : '0-1';
};

export function chessPgn(chess: Chess, row: GameRow, publicUrl: string): string {
  const date = new Date(row.created_at).toISOString().slice(0, 10).replaceAll('-', '.');
  chess.setHeader('Event', 'Kido');
  chess.setHeader('Site', `${publicUrl}/g/${row.id}`);
  chess.setHeader('Date', date);
  chess.setHeader('White', row.white_name);
  chess.setHeader('Black', row.black_name);
  chess.setHeader('Result', RESULT_TOKEN(row));
  chess.setHeader(
    'TimeControl',
    row.base_ms === null ? '-' : `${row.base_ms / 1000}+${(row.increment_ms ?? 0) / 1000}`,
  );
  chess.setHeader(
    'Termination',
    row.status !== 'over' ? 'unterminated' : row.result_reason === 'timeout' ? 'time forfeit' : 'normal',
  );
  return chess.pgn();
}

export function chessAscii(chess: Chess): string {
  const lines = ['  a b c d e f g h'];
  chess.board().forEach((rank, i) => {
    const cells = rank.map((p) => (p === null ? '.' : p.color === 'w' ? p.type.toUpperCase() : p.type));
    lines.push(`${8 - i} ${cells.join(' ')} ${8 - i}`);
  });
  lines.push('  a b c d e f g h');
  lines.push(`${chess.turn() === 'w' ? 'white' : 'black'} to move${chess.inCheck() ? ', check' : ''}`);
  return lines.join('\n');
}
