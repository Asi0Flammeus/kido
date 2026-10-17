// Every game action: load, settle the clock, validate, persist, bump version, publish (ARCHITECTURE 4, 6).
import { areaScore, hashSignMap, playGo, seatSign, toggleDeadChain } from '../../shared/go-rules';
import { parseGtp, toGtp, type Vertex } from '../../shared/gtp';
import {
  type CreateGameBody,
  type CreateGameResponse,
  type ErrorCode,
  type GameStatus,
  type GameView,
  type ResultReason,
  type Seat,
  other,
} from '../../shared/types';
import { randomToken } from '../auth';
import type { Hub } from '../realtime/hub';
import type { GameRow, MoveRow, Repo } from '../repo';
import { applyChessMove, cannotMate, chessEnd, sameChessMove } from './chess';
import { chargeMove, flagTime, stopClock, zeroClock } from './clock';
import { type GameRuntime, type ScoringState, buildRuntime, scoringOf, turnOf } from './runtime';
import { buildView } from './view';

const STATUS: Record<ErrorCode, number> = {
  badRequest: 400,
  unauthorized: 401,
  notFound: 404,
  notYourTurn: 409,
  stale: 409,
  gameOver: 409,
  wrongPhase: 409,
  illegal: 422,
  ko: 422,
  suicide: 422,
};

const MESSAGES: Record<ErrorCode, string> = {
  badRequest: 'The request is malformed.',
  unauthorized: 'This action needs a valid token.',
  notFound: 'No such game.',
  notYourTurn: 'It is not your turn.',
  stale: 'The game has moved on since that view; refetch the state.',
  gameOver: 'The game is over.',
  wrongPhase: 'That action is not valid in the current phase of the game.',
  illegal: 'That move is not legal.',
  ko: 'Ko: that move repeats an earlier position.',
  suicide: 'Suicide is not allowed.',
};

export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string = MESSAGES[code],
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export interface Estimator {
  guess(signMap: number[][]): Promise<Vertex[]>;
}

const UCI_OR_SAN_MAX = 12;

export class GameService {
  private readonly runtimes = new Map<string, GameRuntime>();

  constructor(
    private readonly repo: Repo,
    private readonly hub: Hub,
    private readonly publicUrl: string,
    private readonly estimator: Estimator,
  ) {}

  /** Settles or re-arms every running clock and restarts interrupted dead-stone estimates. */
  boot(now = Date.now()): void {
    for (const id of this.repo.runningClockGameIds()) {
      const rt = this.load(id)!;
      this.settle(rt, now);
      this.armTimer(rt);
    }
    for (const row of this.repo.listGames('scoring', 1000)) {
      if (scoringOf(row)?.estimating) this.startEstimate(this.load(row.id)!);
    }
  }

  close(): void {
    for (const rt of this.runtimes.values()) clearTimeout(rt.timer ?? undefined);
  }

  load(id: string): GameRuntime | null {
    const cached = this.runtimes.get(id);
    if (cached) return cached;
    const row = this.repo.getGame(id);
    if (!row) return null;
    const rt = buildRuntime(row, this.repo.moves(id));
    this.runtimes.set(id, rt);
    return rt;
  }

  view(rt: GameRuntime, seat: Seat | null, now = Date.now()): GameView {
    return buildView(rt, seat, now, this.publicUrl);
  }

  links(row: GameRow): { william: string; maia: string; spectator: string | null } {
    const base = `${this.publicUrl}/g/${row.id}`;
    const maiaToken = row.maia_seat === 'white' ? row.white_token : row.black_token;
    const williamToken = row.maia_seat === 'white' ? row.black_token : row.white_token;
    return {
      william: `${base}?s=${williamToken}`,
      maia: `${base}?s=${maiaToken}`,
      spectator: row.spectators ? base : null,
    };
  }

  create(body: CreateGameBody, now = Date.now()): CreateGameResponse {
    if (body?.kind !== 'chess' && body?.kind !== 'go') throw new ApiError('badRequest', 'kind must be "chess" or "go".');
    const maiaChoice = body.maiaSeat ?? 'random';
    if (!['white', 'black', 'random'].includes(maiaChoice)) throw new ApiError('badRequest', 'maiaSeat is invalid.');
    const maiaSeat: Seat =
      maiaChoice === 'random' ? (crypto.getRandomValues(new Uint8Array(1))[0]! & 1 ? 'white' : 'black') : maiaChoice;
    let baseMs: number | null = null;
    let incrementMs: number | null = null;
    if (body.timeControl != null) {
      const { baseSec, incrementSec } = body.timeControl;
      if (!Number.isInteger(baseSec) || baseSec < 1 || baseSec > 10800) throw new ApiError('badRequest', 'baseSec must be 1..10800.');
      if (!Number.isInteger(incrementSec) || incrementSec < 0 || incrementSec > 180)
        throw new ApiError('badRequest', 'incrementSec must be 0..180.');
      baseMs = baseSec * 1000;
      incrementMs = incrementSec * 1000;
    }
    let boardSize: 9 | 13 | 19 | null = null;
    let komi: 6.5 | 7.5 | null = null;
    if (body.kind === 'go') {
      boardSize = body.go?.boardSize ?? 19;
      komi = body.go?.komi ?? 7.5;
      if (![9, 13, 19].includes(boardSize)) throw new ApiError('badRequest', 'boardSize must be 9, 13 or 19.');
      if (![6.5, 7.5].includes(komi)) throw new ApiError('badRequest', 'komi must be 6.5 or 7.5.');
    } else if (body.go !== undefined) {
      throw new ApiError('badRequest', 'go options are only for Go games.');
    }
    if (body.spectators !== undefined && typeof body.spectators !== 'boolean')
      throw new ApiError('badRequest', 'spectators must be a boolean.');

    const row: GameRow = {
      id: randomToken(12),
      kind: body.kind,
      created_at: now,
      updated_at: now,
      version: 1,
      white_name: maiaSeat === 'white' ? 'Maïa' : 'William',
      black_name: maiaSeat === 'black' ? 'Maïa' : 'William',
      maia_seat: maiaSeat,
      white_token: randomToken(24),
      black_token: randomToken(24),
      spectators: body.spectators ? 1 : 0,
      base_ms: baseMs,
      increment_ms: incrementMs,
      board_size: boardSize,
      komi,
      status: 'playing',
      white_ms: baseMs,
      black_ms: baseMs,
      turn_started_at: null,
      draw_offer: null,
      go_resume_ply: 0,
      scoring_json: null,
      result_winner: null,
      result_reason: null,
      result_margin: null,
      ended_at: null,
    };
    this.repo.insertGame(row);
    const rt = this.load(row.id)!;
    return {
      id: row.id,
      links: this.links(row),
      maiaToken: maiaSeat === 'white' ? row.white_token : row.black_token,
      williamToken: maiaSeat === 'white' ? row.black_token : row.white_token,
      state: this.view(rt, maiaSeat, now),
    };
  }

  list(status: GameStatus | null, limit: number) {
    return this.repo.listGames(status, limit).map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      players: { white: { name: row.white_name }, black: { name: row.black_name } },
      result: row.result_reason ? { winner: row.result_winner, reason: row.result_reason, margin: row.result_margin ?? undefined } : null,
      links: this.links(row),
      maiaToken: row.maia_seat === 'white' ? row.white_token : row.black_token,
    }));
  }

  // ---------------------------------------------------------------- actions

  move(rt: GameRuntime, seat: Seat, body: { ply?: unknown; move?: unknown }, now = Date.now()): void {
    const ply = requirePly(body.ply);
    if (typeof body.move !== 'string' || body.move.length === 0 || body.move.length > UCI_OR_SAN_MAX)
      throw new ApiError('badRequest', 'move must be a UCI, SAN or GTP string.');
    const text = body.move.trim();
    this.settle(rt, now);
    const last = rt.moves.at(-1);
    if (ply === rt.moves.length - 1 && last && last.seat === seat) {
      const same = rt.row.kind === 'chess' ? sameChessMove(last, text) : last.notation === text.toUpperCase();
      if (same) return;
    }
    this.guardTurn(rt, seat, ply);
    const plyAfter = rt.moves.length + 1;

    if (rt.row.kind === 'chess') {
      const chess = rt.chess!;
      const played = applyChessMove(chess, text);
      if (!played) throw new ApiError('illegal');
      const draft = { ...rt.row };
      try {
        const clock = chargeMove(draft, seat, now, plyAfter);
        if (draft.draw_offer === other(seat)) draft.draw_offer = null;
        const end = chessEnd(chess, seat);
        if (end) endGame(draft, end.winner, end.reason, now);
        this.commit(rt, draft, {
          game_id: draft.id,
          ply: rt.moves.length,
          seat,
          notation: played.san,
          uci: played.lan,
          fen_after: chess.fen(),
          ...clock,
          created_at: now,
        });
      } catch (error) {
        chess.undo();
        throw error;
      }
      return;
    }

    const size = rt.row.board_size!;
    const vertex = parseGtp(text, size);
    if (!vertex) throw new ApiError('badRequest', `move must be a vertex on the ${size}×${size} board, like D4.`);
    const go = rt.go!;
    const outcome = playGo(go.board, seatSign(seat), vertex, go.positions);
    if ('error' in outcome) throw new ApiError(outcome.error);
    const draft = { ...rt.row };
    const clock = chargeMove(draft, seat, now, plyAfter);
    this.commit(rt, draft, {
      game_id: draft.id,
      ply: rt.moves.length,
      seat,
      notation: toGtp(vertex, size),
      uci: null,
      fen_after: null,
      ...clock,
      created_at: now,
    });
    go.board = outcome.board;
    go.positions.add(hashSignMap(outcome.board.signMap));
  }

  pass(rt: GameRuntime, seat: Seat, body: { ply?: unknown }, now = Date.now()): void {
    const ply = requirePly(body.ply);
    if (rt.row.kind !== 'go') throw new ApiError('wrongPhase', 'Pass is a Go action.');
    this.settle(rt, now);
    const last = rt.moves.at(-1);
    if (ply === rt.moves.length - 1 && last?.seat === seat && last.notation === 'pass') return;
    this.guardTurn(rt, seat, ply);
    const draft = { ...rt.row };
    const clock = chargeMove(draft, seat, now, rt.moves.length + 1);
    const previous = rt.moves.at(-1);
    const endsPlay = previous !== undefined && previous.notation === 'pass' && previous.ply >= draft.go_resume_ply;
    if (endsPlay) {
      draft.status = 'scoring';
      draft.turn_started_at = null;
      const scoring: ScoringState = {
        dead: [],
        accepted: { white: false, black: false },
        scoringVersion: 1,
        estimating: true,
      };
      draft.scoring_json = JSON.stringify(scoring);
    }
    this.commit(rt, draft, {
      game_id: draft.id,
      ply: rt.moves.length,
      seat,
      notation: 'pass',
      uci: null,
      fen_after: null,
      ...clock,
      created_at: now,
    });
    if (endsPlay) this.startEstimate(rt);
  }

  resign(rt: GameRuntime, seat: Seat, now = Date.now()): void {
    this.settle(rt, now);
    if (rt.row.status === 'over') throw new ApiError('gameOver');
    const draft = { ...rt.row };
    stopClock(draft, turnOf(draft, rt.moves.length), now);
    endGame(draft, other(seat), 'resignation', now);
    this.commit(rt, draft);
  }

  draw(rt: GameRuntime, seat: Seat, body: { action?: unknown }, now = Date.now()): void {
    const action = body.action;
    if (action !== 'offer' && action !== 'accept' && action !== 'decline')
      throw new ApiError('badRequest', 'action must be "offer", "accept" or "decline".');
    if (rt.row.kind !== 'chess') throw new ApiError('wrongPhase', 'Draw offers are a chess action.');
    this.settle(rt, now);
    if (rt.row.status === 'over') throw new ApiError('gameOver');
    const draft = { ...rt.row };
    const offeredByThem = draft.draw_offer === other(seat);
    if (action === 'offer' && draft.draw_offer === seat) throw new ApiError('wrongPhase', 'You already offered a draw.');
    if (action !== 'offer' && !offeredByThem) throw new ApiError('wrongPhase', 'There is no draw offer to answer.');
    if (action === 'decline') {
      draft.draw_offer = null;
    } else if (offeredByThem) {
      stopClock(draft, turnOf(draft, rt.moves.length), now);
      endGame(draft, null, 'agreement', now);
    } else {
      draft.draw_offer = seat;
    }
    this.commit(rt, draft);
  }

  markDead(rt: GameRuntime, seat: Seat, body: { vertex?: unknown }): void {
    void seat;
    const scoring = this.guardScoring(rt);
    if (typeof body.vertex !== 'string') throw new ApiError('badRequest', 'vertex must be a GTP vertex like B8.');
    const dead = toggleDeadChain(rt.go!.board.signMap, scoring.dead, body.vertex);
    if (!dead) throw new ApiError('badRequest', 'There is no stone on that vertex.');
    const draft = { ...rt.row };
    const next: ScoringState = {
      ...scoring,
      dead,
      accepted: { white: false, black: false },
      scoringVersion: scoring.scoringVersion + 1,
    };
    draft.scoring_json = JSON.stringify(next);
    this.commit(rt, draft);
  }

  acceptScore(rt: GameRuntime, seat: Seat, body: { scoringVersion?: unknown }, now = Date.now()): void {
    if (!Number.isInteger(body.scoringVersion)) throw new ApiError('badRequest', 'scoringVersion must be an integer.');
    const scoring = this.guardScoring(rt);
    if (body.scoringVersion !== scoring.scoringVersion) throw new ApiError('stale');
    const draft = { ...rt.row };
    const next: ScoringState = { ...scoring, accepted: { ...scoring.accepted, [seat]: true } };
    draft.scoring_json = JSON.stringify(next);
    if (next.accepted.white && next.accepted.black) {
      const area = areaScore(rt.go!.board.signMap, next.dead, draft.komi!);
      endGame(draft, area.winner, 'score', now, area.margin);
    }
    this.commit(rt, draft);
  }

  resume(rt: GameRuntime, seat: Seat, now = Date.now()): void {
    void seat;
    this.guardScoring(rt);
    const draft = { ...rt.row };
    draft.status = 'playing';
    draft.scoring_json = null;
    draft.go_resume_ply = rt.moves.length;
    draft.turn_started_at = draft.base_ms !== null && rt.moves.length >= 2 ? now : null;
    rt.estimateSeq++;
    this.commit(rt, draft);
  }

  // ---------------------------------------------------------------- internals

  private guardTurn(rt: GameRuntime, seat: Seat, ply: number): void {
    if (rt.row.status === 'over') throw new ApiError('gameOver');
    if (rt.row.status === 'scoring') throw new ApiError('wrongPhase', 'The game is in scoring.');
    if (turnOf(rt.row, rt.moves.length) !== seat) throw new ApiError('notYourTurn');
    if (ply !== rt.moves.length) throw new ApiError('stale');
  }

  private guardScoring(rt: GameRuntime): ScoringState {
    if (rt.row.kind !== 'go') throw new ApiError('wrongPhase', 'Scoring is a Go action.');
    if (rt.row.status === 'over') throw new ApiError('gameOver');
    if (rt.row.status !== 'scoring') throw new ApiError('wrongPhase', 'The game is not in scoring.');
    return scoringOf(rt.row)!;
  }

  /** Ends the game on time when the running clock has reached zero. Every request calls it first. */
  settle(rt: GameRuntime, now = Date.now()): void {
    const turn = turnOf(rt.row, rt.moves.length);
    const flagAt = flagTime(rt.row, turn);
    if (flagAt === null || flagAt > now) return;
    const draft = { ...rt.row };
    zeroClock(draft, turn);
    const winner = other(turn);
    if (draft.kind === 'chess' && cannotMate(rt.chess!, winner)) endGame(draft, null, 'insufficientMaterial', flagAt);
    else endGame(draft, winner, 'timeout', flagAt);
    this.commit(rt, draft);
  }

  private armTimer(rt: GameRuntime): void {
    clearTimeout(rt.timer ?? undefined);
    rt.timer = null;
    const flagAt = flagTime(rt.row, turnOf(rt.row, rt.moves.length));
    if (flagAt === null) return;
    rt.timer = setTimeout(
      () => {
        rt.timer = null;
        if (this.runtimes.get(rt.row.id) !== rt) return;
        this.settle(rt, Date.now());
        this.armTimer(rt);
      },
      Math.max(0, flagAt - Date.now()) + 5,
    );
  }

  private startEstimate(rt: GameRuntime): void {
    const seq = ++rt.estimateSeq;
    const signMap = rt.go!.board.signMap;
    const size = rt.row.board_size!;
    this.estimator
      .guess(signMap)
      .catch(() => [] as Vertex[])
      .then((vertices) => {
        if (this.runtimes.get(rt.row.id) !== rt || rt.estimateSeq !== seq || rt.row.status !== 'scoring') return;
        const scoring = scoringOf(rt.row)!;
        const next: ScoringState = { ...scoring, estimating: false };
        if (scoring.scoringVersion === 1) {
          next.dead = vertices.map((v) => toGtp(v, size));
          next.scoringVersion = 2;
        }
        const draft = { ...rt.row, scoring_json: JSON.stringify(next) };
        this.commit(rt, draft);
      });
  }

  private commit(rt: GameRuntime, draft: GameRow, move?: MoveRow): void {
    draft.version = rt.row.version + 1;
    draft.updated_at = Date.now();
    try {
      this.repo.transaction(() => {
        if (move) this.repo.insertMove(move);
        this.repo.saveGame(draft);
      });
    } catch (error) {
      this.runtimes.delete(rt.row.id);
      throw error;
    }
    rt.row = draft;
    if (move) rt.moves.push(move);
    this.armTimer(rt);
    queueMicrotask(() => this.hub.publish(draft.id));
  }
}

function requirePly(ply: unknown): number {
  if (!Number.isInteger(ply) || (ply as number) < 0) throw new ApiError('badRequest', 'ply must be a non-negative integer.');
  return ply as number;
}

function endGame(draft: GameRow, winner: Seat | null, reason: ResultReason, at: number, margin?: number): void {
  draft.status = 'over';
  draft.result_winner = winner;
  draft.result_reason = reason;
  draft.result_margin = margin ?? null;
  draft.ended_at = at;
  draft.turn_started_at = null;
  draft.draw_offer = null;
}
