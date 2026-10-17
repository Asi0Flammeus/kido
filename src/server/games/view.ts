// GameRuntime -> GameView for one viewer (ARCHITECTURE 6.3).
import { areaScore } from '../../shared/go-rules';
import { type Action, type ChessMoveView, type GameView, type GoMoveView, type Seat, other } from '../../shared/types';
import { chessAscii, chessPgn } from './chess';
import { clockView } from './clock';
import { goAscii, goSgf } from './go';
import { type GameRuntime, scoringOf, turnOf } from './runtime';

export function buildView(rt: GameRuntime, you: Seat | null, now: number, publicUrl: string): GameView {
  const { row, moves } = rt;
  const ply = moves.length;
  const turn = turnOf(row, ply);
  const yourTurn = you !== null && you === turn && row.status === 'playing';
  const base = `/api/games/${row.id}`;
  const actions: Action[] = [];
  if (you !== null) {
    if (row.status === 'playing') {
      if (yourTurn) actions.push('move');
      if (yourTurn && row.kind === 'go') actions.push('pass');
      actions.push('resign');
      if (row.kind === 'chess') {
        if (row.draw_offer === null) actions.push('offerDraw');
        if (row.draw_offer === other(you)) actions.push('acceptDraw', 'declineDraw');
      }
    } else if (row.status === 'scoring') {
      actions.push('markDead');
      if (!scoringOf(row)!.accepted[you]) actions.push('acceptScore');
      actions.push('resumePlay', 'resign');
    }
  }
  const view: GameView = {
    id: row.id,
    kind: row.kind,
    version: row.version,
    ply,
    players: { white: { name: row.white_name }, black: { name: row.black_name } },
    you,
    yourTurn,
    actions,
    turn,
    status: row.status,
    clock: clockView(row, turn, now),
    moves: [],
    lastMove: null,
    position: '',
    ascii: '',
    draw: row.draw_offer === null || you === null ? 'none' : row.draw_offer === you ? 'offeredByYou' : 'offeredByThem',
    drawOfferedBy: row.draw_offer,
  };
  if (row.result_reason !== null) {
    view.result = { winner: row.result_winner, reason: row.result_reason };
    if (row.result_margin !== null) view.result.margin = row.result_margin;
  }

  if (row.kind === 'chess') {
    const chess = rt.chess!;
    const chessMoves: ChessMoveView[] = moves.map((m) => ({
      ply: m.ply,
      by: m.seat,
      san: m.notation,
      uci: m.uci!,
      fenAfter: m.fen_after!,
      remainingMs: m.remaining_ms,
    }));
    view.moves = chessMoves;
    view.lastMove = chessMoves.at(-1) ?? null;
    view.position = view.fen = chess.fen();
    view.check = chess.inCheck();
    if (yourTurn) view.legalMoves = chess.moves({ verbose: true }).map((m) => m.lan);
    view.pgn = chessPgn(chess, row, publicUrl);
    view.ascii = chessAscii(chess);
    view.links = { pgn: `${base}/pgn`, png: `${base}/board.png` };
    return view;
  }

  const { board } = rt.go!;
  const goMoves: GoMoveView[] = moves.map((m) => ({
    ply: m.ply,
    color: m.seat,
    vertex: m.notation,
    remainingMs: m.remaining_ms,
  }));
  const scoring = scoringOf(row);
  view.boardSize = row.board_size!;
  view.komi = row.komi!;
  view.rules = 'area';
  view.moves = goMoves;
  view.lastMove = goMoves.at(-1) ?? null;
  view.position = board.signMap;
  view.captures = { black: board.getCaptures(1), white: board.getCaptures(-1) };
  view.sgf = goSgf(row, moves);
  view.ascii = goAscii(row, board, moves, scoring?.dead ?? []);
  view.links = { sgf: `${base}/sgf`, png: `${base}/board.png` };
  if (scoring) {
    const area = areaScore(board.signMap, scoring.dead, row.komi!);
    view.scoring = {
      dead: scoring.dead,
      territory: area.territory,
      score: area.score,
      accepted: scoring.accepted,
      scoringVersion: scoring.scoringVersion,
      estimating: scoring.estimating,
    };
  }
  return view;
}
