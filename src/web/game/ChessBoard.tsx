import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Color, Key } from '@lichess-org/chessground/types';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

interface Props {
  size: number;
  fen: string;
  orientation: Color;
  turnColor: Color;
  lastMove: [Key, Key] | null;
  check: boolean;
  /** Your colour and legal destinations when you may move now, else null. */
  movable: { color: Color; dests: Map<Key, Key[]> } | null;
  animate: boolean;
  onMove: (from: Key, to: Key) => void;
  children?: ComponentChildren;
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** DESIGN 3.1: chessground with the iteration-1 config; the app owns legality and promotion. */
export function ChessBoard({ size, fen, orientation, turnColor, lastMove, check, movable, animate, onMove, children }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const cg = useRef<Api | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  useEffect(() => {
    cg.current = Chessground(el.current!, {
      coordinates: true,
      coordinatesOnSquares: false,
      animation: { enabled: !reducedMotion(), duration: 200 },
      highlight: { lastMove: true, check: true },
      movable: { free: false, showDests: true, events: { after: (orig, dest) => onMoveRef.current(orig, dest) } },
      draggable: { enabled: true, showGhost: true },
      selectable: { enabled: true },
      premovable: { enabled: false },
      drawable: { enabled: false },
    });
    return () => cg.current?.destroy();
  }, []);

  useEffect(() => {
    cg.current!.set({
      animation: { enabled: animate && !reducedMotion(), duration: 200 },
      fen,
      orientation,
      turnColor,
      lastMove: lastMove ?? undefined,
      check: check ? turnColor : false,
      movable: { color: movable?.color, dests: movable?.dests ?? new Map() },
    });
  }, [fen, orientation, turnColor, lastMove?.[0], lastMove?.[1], check, movable, animate]);

  useEffect(() => {
    cg.current!.redrawAll();
  }, [size]);

  return (
    <div class="board" role="group" tabIndex={0} aria-label="Chess board" style={{ width: `${size}px`, height: `${size}px` }}>
      <div ref={el} style={{ width: `${size}px`, height: `${size}px` }} />
      {children}
    </div>
  );
}

const ROLES = ['queen', 'knight', 'rook', 'bishop'] as const;
export type PromotionRole = (typeof ROLES)[number];

/** DESIGN 5.2 Promotion picker: a column on the promotion file, from the back rank toward the centre. */
export function PromotionPicker({
  size,
  file,
  color,
  orientation,
  onPick,
  onCancel,
}: {
  size: number;
  file: number;
  color: Color;
  orientation: Color;
  onPick: (role: PromotionRole) => void;
  onCancel: () => void;
}) {
  const sq = size / 8;
  const col = orientation === 'white' ? file : 7 - file;
  return (
    <div class="cg-wrap promotion-host">
      <div class="promotion-backdrop" onClick={onCancel} />
      <div class="promotion" style={{ left: `${col * sq}px`, top: '0px', width: `${sq}px` }} role="group" aria-label="Promote to">
        {ROLES.map((role) => (
          <button key={role} type="button" style={{ height: `${sq}px` }} aria-label={role} onClick={() => onPick(role)}>
            <piece class={`${role} ${color}`} />
          </button>
        ))}
      </div>
    </div>
  );
}
