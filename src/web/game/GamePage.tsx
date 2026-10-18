// The game screen: state from the server, optimistic actions, review, connection (DESIGN 4 to 6).
import Board from '@sabaki/go-board';
import type { Key } from '@lichess-org/chessground/types';
import type { Vertex } from '@sabaki/shudan';
import { Chess } from 'chess.js';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { displayRemaining } from '../../shared/clock';
import { areaScore, seatSign, type SignMap, toggleDeadChain } from '../../shared/go-rules';
import { parseGtp, toGtp } from '../../shared/gtp';
import {
  type ChessMoveView,
  type ClockView,
  type GameView,
  type GoMoveView,
  type Seat,
  other,
} from '../../shared/types';
import { type Connection, GameClient } from '../api';
import { MESSAGES, metaLine, resultLines, spellSan } from '../copy';
import { Header } from '../Header';
import { ActionBar, type BarState, ResultPanel } from './ActionBar';
import { Banner } from './Banner';
import { ChessBoard, PromotionPicker, type PromotionRole } from './ChessBoard';
import { GoBoard } from './GoBoard';
import { Kifu } from './Kifu';
import { PlayerRow, type RowStatus } from './PlayerRow';
import { ScorePanel } from './ScorePanel';
import { Sheet } from './Sheet';
import { Button, Icon, Mark } from './ui';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const SIDE_QUERY = '(min-width: 760px) and (min-aspect-ratio: 1/1)';
const ROLE_LETTER: Record<PromotionRole, string> = { queen: 'q', knight: 'n', rook: 'r', bishop: 'b' };

type Source = 'server' | 'optimistic' | 'catchup';

/** Board box per DESIGN 4.2/4.3, recomputed on resize; written to --board-box. */
function useLayout(main: { current: HTMLElement | null }) {
  const measure = () => {
    const stacked = !matchMedia(SIDE_QUERY).matches;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const box = stacked ? Math.min(w, 600) : Math.floor(Math.min(h - 56 - 32, w - 32 - 16 - 300));
    return { stacked, box, board: box - (stacked ? 8 : 16) };
  };
  const [layout, setLayout] = useState(measure);
  useLayoutEffect(() => {
    const update = () => setLayout((prev) => {
      const next = measure();
      return prev.box === next.box && prev.stacked === next.stacked ? prev : next;
    });
    const ro = new ResizeObserver(update);
    ro.observe(document.documentElement);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);
  useLayoutEffect(() => {
    main.current?.style.setProperty('--board-box', `${layout.box}px`);
  });
  return layout;
}

/** Replays Go moves into go-board instances (simple-ko info included), one per ply. */
function replayGoBoards(size: number, moves: GoMoveView[]): Board[] {
  const boards = [Board.fromDimensions(size)];
  for (const m of moves) {
    const prev = boards.at(-1)!;
    boards.push(m.vertex === 'pass' ? prev : prev.makeMove(seatSign(m.color), parseGtp(m.vertex, size)!));
  }
  return boards;
}

export function GamePage({ id, token }: { id: string; token: string | null }) {
  const client = useMemo(() => new GameClient(id, token), [id, token]);
  const mainRef = useRef<HTMLElement>(null);
  const layout = useLayout(mainRef);
  const [phase, setPhase] = useState<'loading' | 'invalid' | 'unreachable' | 'ready'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<GameView | null>(null);
  const [offset, setOffset] = useState(0);
  const [connection, setConnection] = useState<Connection>('live');
  const [reviewPly, setReviewPly] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'resign' | 'pass' | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [preview, setPreview] = useState<Vertex | null>(null);
  const [promotion, setPromotion] = useState<{ from: Key; to: Key } | null>(null);
  const [animate, setAnimate] = useState(false);
  const [boardReset, setBoardReset] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const viewRef = useRef<GameView | null>(null);
  const serverVersion = useRef(0);
  const degraded = useRef(false);
  const messageTimer = useRef<ReturnType<typeof setTimeout>>();

  const applyView = useCallback((next: GameView, source: Source) => {
    if (source !== 'optimistic') {
      if (next.version < serverVersion.current) return;
      serverVersion.current = next.version;
    }
    const prev = viewRef.current;
    if (prev && source === 'server') {
      const said: string[] = [];
      const opponent = next.you === null ? null : other(next.you);
      if (next.ply > prev.ply) {
        const last = next.lastMove;
        const by = last && ('by' in last ? last.by : last.color);
        if (last && opponent && by === opponent) {
          const name = next.players[opponent].name;
          if ('san' in last) said.push(`${name} played ${spellSan(last.san)}`);
          else said.push(last.vertex === 'pass' ? `${name} passed` : `${name} played ${last.vertex}`);
        }
        if (next.check) said.push('Check');
      }
      if (opponent && next.draw === 'offeredByThem' && prev.draw !== 'offeredByThem') said.push(`${next.players[opponent].name} offers a draw`);
      if (next.status === 'scoring' && prev.status !== 'scoring') said.push('Scoring. Tap groups to mark them dead or alive.');
      if (next.yourTurn && !prev.yourTurn) said.push('Your turn');
      if (next.result && !prev.result) {
        const { headline, sub } = resultLines(next);
        said.push(`${headline}, ${sub}`);
      }
      if (said.length) setAnnouncement(said.join('. '));
      if (next.ply > prev.ply) {
        setReviewPly(null);
        setPreview(null);
        setPromotion(null);
      }
    }
    if (next.status !== 'scoring' && prev?.status === 'scoring') setPreview(null);
    setAnimate(source !== 'catchup' && prev !== null && next.ply === prev.ply + 1);
    if (next.clock && source !== 'optimistic') setOffset(next.clock.serverNow - Date.now());
    viewRef.current = next;
    setView(next);
  }, []);

  // Load, then live channel.
  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    const start = async () => {
      const r = await client.load();
      if (cancelled) return;
      if (!r.ok) {
        setPhase(r.reason);
        return;
      }
      applyView(r.view, 'catchup');
      setPhase('ready');
      stop = client.connect(
        (v) => {
          applyView(v, degraded.current ? 'catchup' : 'server');
          degraded.current = false;
        },
        (c) => {
          if (c !== 'live') degraded.current = true;
          setConnection(c);
        },
      );
    };
    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [client, attempt]);

  useEffect(() => {
    if (phase === 'ready') mainRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (!view) return;
    document.title = view.yourTurn ? 'Kido · your turn' : view.kind === 'go' ? 'Kido · Go' : 'Kido · Chess';
  }, [view?.yourTurn, view?.kind]);

  const showMessage = useCallback((text: string, ms: number) => {
    clearTimeout(messageTimer.current);
    setMessage(text);
    messageTimer.current = setTimeout(() => setMessage(null), ms);
  }, []);

  const goBoards = useMemo(
    () => (view?.kind === 'go' ? replayGoBoards(view.boardSize!, view.moves as GoMoveView[]) : []),
    [view?.kind, view?.boardSize, view?.moves],
  );
  const chess = useMemo(() => (view?.kind === 'chess' ? new Chess(view.fen!) : null), [view?.fen]);

  // Keyboard review (DESIGN 6.0 S5) and Esc for the Go preview (G3).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (sheet || promotion || event.defaultPrevented) return;
      const v = viewRef.current;
      if (!v) return;
      const at = reviewPly ?? v.ply;
      const go = (ply: number) => {
        const clamped = Math.max(0, Math.min(v.ply, ply));
        setReviewPly(clamped === v.ply ? null : clamped);
      };
      if (event.key === 'ArrowLeft') go(at - 1);
      else if (event.key === 'ArrowRight') go(at + 1);
      else if (event.key === 'Home') go(0);
      else if (event.key === 'End') go(v.ply);
      else if (event.key === 'Escape') {
        if (preview) setPreview(null);
        else setReviewPly(null);
      } else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (phase === 'invalid' || phase === 'unreachable') {
    const invalid = phase === 'invalid';
    return (
      <>
        <Header meta={null} />
        <main class="center" ref={mainRef} tabIndex={-1}>
          <div class="empty-state">
            <Mark size={64} />
            <h1>{invalid ? "This game link isn't valid." : "Couldn't load the game."}</h1>
            <p>{invalid ? 'Ask Maïa for a new one.' : 'Check your connection and try again.'}</p>
            {invalid ? (
              <a class="btn btn-secondary" href="/">
                Home
              </a>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  setPhase('loading');
                  setAttempt((n) => n + 1);
                }}
              >
                Retry
              </Button>
            )}
          </div>
        </main>
      </>
    );
  }

  if (!view) return <Skeleton mainRef={mainRef} layout={layout} />;

  const you = view.you;
  const live = connection === 'live';
  const clockExpired = (c: ClockView | null) => !!c && c.running !== null && displayRemaining(c, c.running, Date.now(), offset) <= 0;
  const canMove = view.yourTurn && live && reviewPly === null && pending === null && !clockExpired(view.clock);
  const shownPly = reviewPly ?? view.ply;
  const moveDuration = view.kind === 'chess' ? 3000 : 2000;

  // ------------------------------------------------------------------ actions
  async function act(name: string, path: string, body: unknown, optimistic?: GameView) {
    const before = viewRef.current!;
    setPending(name);
    if (optimistic) applyView(optimistic, 'optimistic');
    const r = await client.post(path, body);
    setPending(null);
    if (r.ok) {
      applyView(r.view, 'server');
      return;
    }
    if (r.code === 'unauthorized' || r.code === 'notFound') {
      setPhase('invalid');
      return;
    }
    showMessage(MESSAGES[r.code] ?? MESSAGES.network!, moveDuration);
    if (r.code !== 'network' && r.state) {
      serverVersion.current = 0;
      applyView(r.state, 'catchup');
    } else {
      viewRef.current = before;
      setView(before);
    }
    setBoardReset((n) => n + 1);
    if (r.code === 'stale' || r.code === 'wrongPhase' || r.code === 'gameOver') {
      const fresh = await client.load();
      if (fresh.ok) applyView(fresh.view, 'catchup');
    }
  }

  function optimisticClock(v: GameView): ClockView | null {
    if (!v.clock || !you) return v.clock;
    const c = v.clock;
    const now = Date.now();
    const mine = displayRemaining(c, you, now, offset) + (c.running === you ? c.incrementMs : 0);
    return {
      ...c,
      remainingMs: { ...c.remainingMs, [you]: mine },
      running: v.ply + 1 >= 2 ? other(you) : null,
      serverNow: now + offset,
    };
  }

  function sendChessMove(from: Key, to: Key, promo?: string) {
    const c = new Chess(view!.fen!);
    let mv;
    try {
      mv = c.move({ from, to, promotion: promo });
    } catch {
      setBoardReset((n) => n + 1);
      return;
    }
    const moveView: ChessMoveView = { ply: view!.ply, by: you!, san: mv.san, uci: mv.lan, fenAfter: c.fen(), remainingMs: null };
    const optimistic: GameView = {
      ...view!,
      ply: view!.ply + 1,
      moves: [...(view!.moves as ChessMoveView[]), moveView],
      lastMove: moveView,
      position: c.fen(),
      fen: c.fen(),
      turn: other(you!),
      yourTurn: false,
      check: c.inCheck(),
      draw: view!.draw === 'offeredByThem' ? 'none' : view!.draw,
      drawOfferedBy: view!.draw === 'offeredByThem' ? null : view!.drawOfferedBy,
      clock: optimisticClock(view!),
    };
    void act('move', 'move', { ply: view!.ply, move: mv.lan }, optimistic);
  }

  function onChessMove(from: Key, to: Key) {
    if (!canMove || !chess) {
      setBoardReset((n) => n + 1);
      return;
    }
    const isPromotion = chess.moves({ verbose: true }).some((m) => m.from === from && m.to === to && m.promotion);
    if (isPromotion) setPromotion({ from, to });
    else sendChessMove(from, to);
  }

  function playGo(vertex: Vertex) {
    const board = goBoards.at(-1)!;
    const sign = seatSign(you!);
    const next = board.makeMove(sign, vertex);
    const gtp = toGtp(vertex, view!.boardSize!);
    const moveView: GoMoveView = { ply: view!.ply, color: you!, vertex: gtp, remainingMs: null };
    setPreview(null);
    void act('move', 'move', { ply: view!.ply, move: gtp }, {
      ...view!,
      ply: view!.ply + 1,
      moves: [...(view!.moves as GoMoveView[]), moveView],
      lastMove: moveView,
      position: next.signMap,
      captures: { black: next.getCaptures(1), white: next.getCaptures(-1) },
      turn: other(you!),
      yourTurn: false,
      clock: optimisticClock(view!),
    });
  }

  function onGoVertex(vertex: Vertex) {
    if (reviewPly !== null || !live || pending !== null || !you) return;
    const signMap = view!.position as SignMap;
    const sign = signMap[vertex[1]]![vertex[0]]!;
    if (view!.status === 'scoring') {
      if (sign === 0) return;
      const gtp = toGtp(vertex, view!.boardSize!);
      const scoring = view!.scoring!;
      const dead = toggleDeadChain(signMap, scoring.dead, gtp) ?? scoring.dead;
      const area = areaScore(signMap, dead, view!.komi!);
      void act('dead', 'scoring/dead', { vertex: gtp }, {
        ...view!,
        scoring: { ...scoring, dead, territory: area.territory, score: area.score, accepted: { black: false, white: false } },
      });
      return;
    }
    if (!canMove) return;
    if (preview && preview[0] === vertex[0] && preview[1] === vertex[1]) {
      playGo(vertex);
      return;
    }
    if (sign !== 0) return;
    const analysis = goBoards.at(-1)!.analyzeMove(seatSign(you), vertex);
    if (analysis.ko || analysis.suicide) {
      setPreview(null);
      showMessage(MESSAGES[analysis.ko ? 'ko' : 'suicide']!, 2000);
      return;
    }
    if (analysis.overwrite) return;
    setPreview(vertex);
  }

  function pass() {
    const moves = view!.moves as GoMoveView[];
    let trailing = 0;
    for (let i = moves.length - 1; i >= 0 && moves[i]!.vertex === 'pass'; i--) trailing++;
    if (trailing % 2 === 1) {
      setSheet('pass');
      return;
    }
    sendPass();
  }

  function sendPass() {
    const moveView: GoMoveView = { ply: view!.ply, color: you!, vertex: 'pass', remainingMs: null };
    setPreview(null);
    void act('pass', 'pass', { ply: view!.ply }, {
      ...view!,
      ply: view!.ply + 1,
      moves: [...(view!.moves as GoMoveView[]), moveView],
      lastMove: moveView,
      turn: other(you!),
      yourTurn: false,
      clock: optimisticClock(view!),
    });
  }

  // ------------------------------------------------------------------ derived UI state
  const bottomSeat: Seat = you ?? (view.kind === 'chess' ? 'white' : 'black');
  const topSeat = other(bottomSeat);
  const moves = view.moves;
  const lastBy = (seat: Seat) => {
    const last = moves.at(-1) as ChessMoveView | GoMoveView | undefined;
    return last && ('by' in last ? last.by : last.color) === seat ? last : undefined;
  };
  const rowStatus = (seat: Seat): RowStatus => {
    if (view.status === 'over') return null;
    if (view.status === 'scoring') return view.scoring?.accepted[seat] ? 'accepted the score' : null;
    if (view.drawOfferedBy === seat || (seat === you && view.draw === 'offeredByYou')) return 'offered a draw';
    if (view.turn === seat) return seat === you ? 'your turn' : 'to play';
    const last = lastBy(seat);
    if (last && 'vertex' in last && last.vertex === 'pass') return 'passed';
    return null;
  };
  const ring = (seat: Seat) => view.status === 'playing' && view.turn === seat;

  let bar: BarState | null = null;
  if (you && view.status !== 'over') {
    const off = !live;
    if (message) bar = { kind: 'message', text: message };
    else if (view.kind === 'chess') {
      const resign = { label: 'Resign', variant: 'secondary' as const, icon: 'flag' as const, disabled: off, onClick: () => setSheet('resign') };
      if (view.draw === 'offeredByThem') {
        bar = {
          kind: 'buttons',
          id: 'draw-offered',
          buttons: [
            { label: 'Accept draw', variant: 'primary', disabled: off, loading: pending === 'accept', onClick: () => void act('accept', 'draw', { action: 'accept' }) },
            { label: 'Decline', variant: 'secondary', disabled: off, loading: pending === 'decline', onClick: () => void act('decline', 'draw', { action: 'decline' }, { ...view, draw: 'none', drawOfferedBy: null }) },
          ],
        };
      } else if (view.draw === 'offeredByYou') {
        bar = { kind: 'buttons', id: 'draw-sent', buttons: [{ label: 'Draw offered', variant: 'secondary', icon: 'handshake', disabled: true }, resign] };
      } else {
        bar = {
          kind: 'buttons',
          id: 'default',
          buttons: [
            { label: 'Draw', variant: 'secondary', icon: 'handshake', disabled: off, loading: pending === 'draw', onClick: () => void act('draw', 'draw', { action: 'offer' }, { ...view, draw: 'offeredByYou', drawOfferedBy: you }) },
            resign,
          ],
        };
      }
    } else if (view.status === 'scoring') {
      const accepted = view.scoring!.accepted[you];
      bar = {
        kind: 'buttons',
        id: accepted ? 'score-accepted' : 'scoring',
        buttons: [
          accepted
            ? { label: 'Score accepted', variant: 'primary', disabled: true }
            : {
                label: 'Accept score',
                variant: 'primary',
                disabled: off || view.scoring!.estimating,
                loading: pending === 'acceptScore',
                onClick: () =>
                  void act('acceptScore', 'scoring/accept', { scoringVersion: view.scoring!.scoringVersion }, {
                    ...view,
                    scoring: { ...view.scoring!, accepted: { ...view.scoring!.accepted, [you]: true } },
                  }),
              },
          { label: 'Resume play', variant: 'secondary', disabled: off, loading: pending === 'resume', onClick: () => void act('resume', 'scoring/resume', {}) },
        ],
      };
    } else if (preview) {
      bar = {
        kind: 'buttons',
        id: 'preview',
        buttons: [
          { label: `Play ${toGtp(preview, view.boardSize!)}`, variant: 'primary', disabled: off, onClick: () => playGo(preview) },
          { label: 'Cancel', variant: 'quiet', onClick: () => setPreview(null) },
        ],
      };
    } else {
      bar = {
        kind: 'buttons',
        id: 'default',
        buttons: [
          { label: 'Pass', variant: 'secondary', icon: 'skipForward', disabled: off || !view.yourTurn, loading: pending === 'pass', onClick: pass },
          { label: 'Resign', variant: 'secondary', icon: 'flag', disabled: off, onClick: () => setSheet('resign') },
        ],
      };
    }
  }

  // Board content for the shown ply.
  let board;
  const reviewing = reviewPly !== null;
  if (view.kind === 'chess') {
    const cm = moves as ChessMoveView[];
    const fen = reviewing ? (shownPly === 0 ? START_FEN : cm[shownPly - 1]!.fenAfter) : view.fen!;
    const shownMove = shownPly > 0 ? cm[shownPly - 1] : undefined;
    const shownChess = reviewing ? new Chess(fen) : chess!;
    const dests = new Map<Key, Key[]>();
    if (canMove && view.status === 'playing') {
      for (const m of chess!.moves({ verbose: true })) {
        const list = dests.get(m.from as Key) ?? [];
        if (!list.includes(m.to as Key)) list.push(m.to as Key);
        dests.set(m.from as Key, list);
      }
    }
    const orientation = you ?? 'white';
    board = (
      <ChessBoard
        key={boardReset}
        size={layout.board}
        fen={fen}
        orientation={orientation}
        turnColor={shownChess.turn() === 'w' ? 'white' : 'black'}
        lastMove={shownMove ? [shownMove.uci.slice(0, 2) as Key, shownMove.uci.slice(2, 4) as Key] : null}
        check={shownChess.inCheck()}
        movable={canMove && view.status === 'playing' ? { color: you!, dests } : null}
        animate={animate && !reviewing}
        onMove={onChessMove}
      >
        {promotion && (
          <PromotionPicker
            size={layout.board}
            file={promotion.to.charCodeAt(0) - 97}
            color={you!}
            orientation={orientation}
            onPick={(role) => {
              const p = promotion;
              setPromotion(null);
              sendChessMove(p.from, p.to, ROLE_LETTER[role]);
            }}
            onCancel={() => {
              setPromotion(null);
              setBoardReset((n) => n + 1);
            }}
          />
        )}
        {reviewing && <ReviewPill ply={shownPly} total={view.ply} onLive={() => setReviewPly(null)} />}
      </ChessBoard>
    );
  } else {
    const gm = moves as GoMoveView[];
    const signMap = reviewing ? goBoards[shownPly]!.signMap : (view.position as SignMap);
    const shownMove = shownPly > 0 ? gm[shownPly - 1] : undefined;
    const lastVertex = shownMove && shownMove.vertex !== 'pass' ? parseGtp(shownMove.vertex, view.boardSize!) : null;
    const scoring = view.scoring && !reviewing && view.status !== 'playing' ? view.scoring : null;
    board = (
      <GoBoard
        size={layout.board}
        signMap={signMap}
        lastMove={lastVertex}
        preview={preview && !reviewing ? { vertex: preview, sign: seatSign(you!) } : null}
        dead={scoring?.dead ?? []}
        territory={scoring?.territory ?? null}
        onVertex={onGoVertex}
      >
        {reviewing && <ReviewPill ply={shownPly} total={view.ply} onLive={() => setReviewPly(null)} />}
      </GoBoard>
    );
  }

  const result = view.status === 'over' && view.result ? resultLines(view) : null;
  const download =
    view.kind === 'chess'
      ? { href: client.withToken(view.links!.pgn!), label: 'Download PGN' }
      : { href: client.withToken(view.links!.sgf!), label: 'Download SGF' };
  const showScore = view.kind === 'go' && view.scoring && (view.status === 'scoring' || view.result?.reason === 'score') && !reviewing;

  return (
    <>
      <Header meta={metaLine(view)} />
      <Banner connection={connection} />
      <main class="game fade-in" ref={mainRef} tabIndex={-1} aria-busy="false">
        <h1 class="visually-hidden">{view.kind === 'chess' ? 'Chess game' : `Go ${view.boardSize}×${view.boardSize} game`}</h1>
        <div class="board-col">
          <div class="board-frame" style={{ width: `${layout.box}px` }}>
            {board}
          </div>
        </div>
        <div class="panel">
          <PlayerRow
            class="row-opponent"
            seat={topSeat}
            name={view.players[topSeat].name}
            status={rowStatus(topSeat)}
            turnRing={ring(topSeat)}
            clock={view.clock}
            clockOffset={offset}
            own={false}
          />
          <div class="divider" />
          <div class="kifu-slot">
            {showScore ? (
              <ScorePanel view={view} />
            ) : (
              <Kifu view={view} shownPly={shownPly} stacked={layout.stacked} onSelect={(ply) => setReviewPly(ply === view.ply ? null : ply)} />
            )}
          </div>
          <div class="divider" />
          <PlayerRow
            class="row-you"
            seat={bottomSeat}
            name={view.players[bottomSeat].name}
            status={rowStatus(bottomSeat)}
            turnRing={ring(bottomSeat)}
            clock={view.clock}
            clockOffset={offset}
            own={you === bottomSeat}
          />
          {result ? (
            <div class="action-slot">
              <ResultPanel
                headline={result.headline}
                sub={result.sub}
                download={download}
                onReview={() => {
                  const cells = document.querySelectorAll<HTMLElement>('.kifu .cell, .kifu-strip .cell');
                  cells[cells.length - 1]?.focus();
                }}
              />
            </div>
          ) : (
            bar && (
              <div class="action-slot">
                <ActionBar state={bar} />
              </div>
            )
          )}
        </div>
        <div class="visually-hidden" aria-live="polite">
          {announcement}
        </div>
      </main>
      {sheet === 'resign' && (
        <Sheet
          title="Resign this game?"
          sentence={`${view.players[other(you!)].name} will win by resignation.`}
          confirm="Resign"
          onCancel={() => setSheet(null)}
          onConfirm={() => {
            setSheet(null);
            void act('resign', 'resign', {});
          }}
        />
      )}
      {sheet === 'pass' && (
        <Sheet
          title="Pass and end the game?"
          sentence={`${view.players[other(you!)].name} passed. Passing now ends play and starts scoring.`}
          confirm="Pass"
          onCancel={() => setSheet(null)}
          onConfirm={() => {
            setSheet(null);
            sendPass();
          }}
        />
      )}
    </>
  );
}

function ReviewPill({ ply, total, onLive }: { ply: number; total: number; onLive: () => void }) {
  return (
    <div class="review-pill">
      <Icon name="arrowUUpLeft" size={16} />
      <span>
        Move {ply} of {total}
      </span>
      <Button variant="quiet" onClick={onLive}>
        Live
      </Button>
    </div>
  );
}

function Skeleton({ mainRef, layout }: { mainRef: { current: HTMLElement | null }; layout: { box: number; board: number } }) {
  const row = (cls: string) => (
    <section class={`player ${cls}`}>
      <span class="seat-stone" aria-hidden="true" style={{ background: 'var(--table-3)' }} />
      <div class="who">
        <span class="skeleton-bar" style={{ width: '120px', height: '16px' }} />
      </div>
      <span class="skeleton-bar" style={{ width: '72px', height: '28px' }} />
    </section>
  );
  return (
    <>
      <Header meta={null} />
      <main class="game" ref={mainRef} tabIndex={-1} aria-busy="true">
        <h1 class="visually-hidden">Game</h1>
        <div class="board-col">
          <div class="board-frame" style={{ width: `${layout.box}px` }}>
            <div class="board" style={{ width: `${layout.board}px`, height: `${layout.board}px` }}>
              <div class="skeleton-board chess" />
            </div>
          </div>
        </div>
        <div class="panel">
          {row('row-opponent')}
          <div class="divider" />
          <div class="kifu-slot" />
          <div class="divider" />
          {row('row-you')}
        </div>
      </main>
    </>
  );
}
