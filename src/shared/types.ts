// Shapes shared by the server and the web client (ARCHITECTURE 6.3). No Node or DOM APIs here.

export type Seat = 'white' | 'black';
export type GameKind = 'chess' | 'go';
export type GameStatus = 'playing' | 'scoring' | 'over';
export type PlayerName = 'Maïa' | 'William';
export type ResultReason =
  | 'checkmate'
  | 'stalemate'
  | 'resignation'
  | 'timeout'
  | 'agreement'
  | 'repetition'
  | 'fiftyMoves'
  | 'insufficientMaterial'
  | 'score';
export type Action =
  | 'move'
  | 'pass'
  | 'resign'
  | 'offerDraw'
  | 'acceptDraw'
  | 'declineDraw'
  | 'markDead'
  | 'acceptScore'
  | 'resumePlay';

export type ErrorCode =
  | 'badRequest'
  | 'unauthorized'
  | 'notFound'
  | 'notYourTurn'
  | 'stale'
  | 'gameOver'
  | 'wrongPhase'
  | 'illegal'
  | 'ko'
  | 'suicide';

export interface ChessMoveView {
  ply: number;
  by: Seat;
  san: string;
  uci: string;
  fenAfter: string;
  remainingMs: number | null;
}

export interface GoMoveView {
  ply: number;
  color: Seat;
  vertex: string; // "D4" | "pass"
  remainingMs: number | null;
}

export interface ClockView {
  baseMs: number;
  incrementMs: number;
  remainingMs: Record<Seat, number>;
  running: Seat | null;
  serverNow: number;
}

export interface ScoreLine {
  stones: number;
  territory: number;
  komi?: number;
  total: number;
}

export interface ScoringView {
  dead: string[];
  territory: number[][];
  score: Record<Seat, ScoreLine>;
  accepted: Record<Seat, boolean>;
  scoringVersion: number;
  estimating: boolean;
}

export interface ResultView {
  winner: Seat | null;
  reason: ResultReason;
  margin?: number;
}

export interface GameView {
  id: string;
  kind: GameKind;
  version: number;
  ply: number;
  boardSize?: 9 | 13 | 19;
  komi?: 6.5 | 7.5;
  rules?: 'area';
  players: Record<Seat, { name: PlayerName }>;
  you: Seat | null;
  yourTurn: boolean;
  actions: Action[];
  turn: Seat;
  status: GameStatus;
  clock: ClockView | null;
  moves: ChessMoveView[] | GoMoveView[];
  lastMove: ChessMoveView | GoMoveView | null;
  position: string | number[][];
  fen?: string;
  legalMoves?: string[];
  check?: boolean;
  pgn?: string;
  sgf?: string;
  captures?: Record<Seat, number>;
  ascii: string;
  draw: 'none' | 'offeredByYou' | 'offeredByThem';
  drawOfferedBy: Seat | null;
  scoring?: ScoringView;
  result?: ResultView;
  links?: { pgn?: string; sgf?: string; png: string };
}

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
  state?: GameView;
}

export interface CreateGameBody {
  kind: GameKind;
  maiaSeat?: Seat | 'random';
  timeControl?: { baseSec: number; incrementSec: number } | null;
  go?: { boardSize?: 9 | 13 | 19; komi?: 6.5 | 7.5 };
  spectators?: boolean;
}

export interface CreateGameResponse {
  id: string;
  links: { william: string; maia: string; spectator: string | null };
  maiaToken: string;
  williamToken: string;
  state: GameView;
}

export interface WaitResponse {
  changed: boolean;
  state: GameView;
}

export const other = (seat: Seat): Seat => (seat === 'white' ? 'black' : 'white');
