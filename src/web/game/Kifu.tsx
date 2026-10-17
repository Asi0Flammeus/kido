import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ChessMoveView, GameView, GoMoveView } from '../../shared/types';

interface Props {
  view: GameView;
  shownPly: number; // moves shown on the board
  stacked: boolean;
  onSelect: (ply: number) => void;
}

/** DESIGN 5.2 Kifu: <ol> of buttons; a vertical list in the side panel, a strip on the cover screen. */
export function Kifu({ view, shownPly, stacked, onSelect }: Props) {
  const listRef = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const count = view.moves.length;

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (stacked) el.scrollLeft = el.scrollWidth;
    else if (pinned.current) el.scrollTop = el.scrollHeight;
    else setShowLatest(true);
  }, [count, stacked]);

  useEffect(() => {
    if (shownPly === count) return;
    listRef.current?.querySelector<HTMLElement>('.cell.current')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [shownPly, count]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el || stacked) return;
    pinned.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
    if (pinned.current) setShowLatest(false);
  };

  const cell = (ply: number, label: ComponentChildren, aria: string) => (
    <button
      type="button"
      class={`cell${shownPly === ply + 1 && count > 0 ? ' current' : ''}`}
      aria-current={shownPly === ply + 1 ? 'step' : undefined}
      aria-label={aria}
      onClick={() => onSelect(ply + 1)}
    >
      {label}
    </button>
  );

  let items: ComponentChildren;
  if (count === 0) {
    items = <li><span class="empty">No moves yet</span></li>;
  } else if (view.kind === 'chess') {
    const moves = view.moves as ChessMoveView[];
    if (stacked) {
      items = moves.map((m) => (
        <li key={m.ply}>{cell(m.ply, m.ply % 2 === 0 ? `${m.ply / 2 + 1}. ${m.san}` : m.san, `Move ${m.ply + 1}, ${m.san}`)}</li>
      ));
    } else {
      const rows: ChessMoveView[][] = [];
      for (let i = 0; i < moves.length; i += 2) rows.push(moves.slice(i, i + 2));
      items = rows.map((pair, i) => (
        <li key={i}>
          <span class="num">{i + 1}.</span>
          {cell(pair[0]!.ply, pair[0]!.san, `Move ${pair[0]!.ply + 1}, ${pair[0]!.san}`)}
          {pair[1] ? cell(pair[1].ply, pair[1].san, `Move ${pair[1].ply + 1}, ${pair[1].san}`) : <span />}
        </li>
      ));
    }
  } else {
    const moves = view.moves as GoMoveView[];
    items = moves.map((m) => (
      <li key={m.ply}>
        {cell(
          m.ply,
          <>
            <span class="num">{m.ply + 1}.</span>
            <span class={`mini-stone ${m.color}`} aria-hidden="true" />
            <span>{m.vertex}</span>
          </>,
          `Move ${m.ply + 1}, ${m.color} ${m.vertex}`,
        )}
      </li>
    ));
  }

  if (stacked) {
    return (
      <ol class="kifu-strip" ref={listRef} aria-label="Moves">
        {items}
      </ol>
    );
  }
  return (
    <div class="kifu-wrap">
      <ol class={`kifu ${view.kind}`} ref={listRef} onScroll={onScroll} aria-label="Moves">
        {items}
      </ol>
      {showLatest && (
        <button
          type="button"
          class="latest-pill"
          onClick={() => {
            pinned.current = true;
            setShowLatest(false);
            listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
          }}
        >
          Latest <span aria-hidden="true">↓</span>
        </button>
      )}
    </div>
  );
}
