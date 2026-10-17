// Every visible string (DESIGN 7). Sentence case, no dashes, middle dot as separator.
import type { ErrorCode, GameView, ResultView } from '../shared/types';

export const MESSAGES: Partial<Record<ErrorCode | 'network', string>> = {
  notYourTurn: 'Not your turn',
  illegal: "That move isn't legal",
  ko: "Ko: you can't retake there yet",
  suicide: "Suicide isn't allowed",
  stale: 'Out of sync, reloading the game',
  wrongPhase: 'Out of sync, reloading the game',
  gameOver: 'The game is over',
  network: "Couldn't reach the server",
};

const REASONS: Record<ResultView['reason'], string> = {
  checkmate: 'by checkmate',
  resignation: 'by resignation',
  timeout: 'on time',
  agreement: 'by agreement',
  stalemate: 'by stalemate',
  repetition: 'by repetition',
  fiftyMoves: 'by the fifty-move rule',
  insufficientMaterial: 'insufficient material',
  score: 'by points',
};

export function resultLines(view: GameView): { headline: string; sub: string } {
  const result = view.result!;
  const headline = result.winner ? `${view.players[result.winner].name} wins` : 'Draw';
  const sub = result.reason === 'score' ? `by ${(result.margin ?? 0).toFixed(1)} points` : REASONS[result.reason];
  return { headline, sub };
}

function minutes(ms: number): string {
  const m = ms / 60_000;
  return Number.isInteger(m) ? String(m) : m.toFixed(1).replace(/\.0$/, '');
}

export function metaLine(view: GameView): string {
  const time = view.clock ? `${minutes(view.clock.baseMs)} + ${view.clock.incrementMs / 1000}` : 'untimed';
  const parts = view.kind === 'chess' ? ['Chess', time] : ['Go', `${view.boardSize}×${view.boardSize}`, time];
  return parts.join(' · ') + (view.you === null ? ' · watching' : '');
}

const PIECES: Record<string, string> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight' };

/** "knight f3", "pawn takes d5", "castles kingside", "queen takes h7, checkmate". */
export function spellSan(san: string): string {
  const suffix = san.endsWith('#') ? ', checkmate' : san.endsWith('+') ? ', check' : '';
  const core = san.replace(/[+#]$/, '');
  if (core === 'O-O') return `castles kingside${suffix}`;
  if (core === 'O-O-O') return `castles queenside${suffix}`;
  const m = /^([KQRBN])?([a-h]?[1-8]?)(x)?([a-h][1-8])(?:=([QRBN]))?$/.exec(core);
  if (!m) return san;
  const piece = m[1] ? PIECES[m[1]]! : 'pawn';
  const promo = m[5] ? ` promotes to ${PIECES[m[5]]}` : '';
  return `${piece} ${m[3] ? 'takes ' : ''}${m[4]}${promo}${suffix}`;
}

