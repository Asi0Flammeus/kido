import { useEffect, useRef } from 'preact/hooks';
import type { IconName } from '../icon-paths';
import { Button, Icon } from './ui';

export interface BarButton {
  label: string;
  variant: 'primary' | 'secondary' | 'quiet';
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
}

export type BarState = { kind: 'message'; text: string } | { kind: 'buttons'; id: string; buttons: BarButton[] };

/** DESIGN 5.2 Action bar: exactly one content state, crossfaded on change, constant 56 px height. */
export function ActionBar({ state }: { state: BarState }) {
  const key = state.kind === 'message' ? `m:${state.text}` : `b:${state.id}`;
  return (
    <div class="action-bar fade" key={key}>
      {state.kind === 'message' ? (
        <p class="action-message" role="alert">
          {state.text}
        </p>
      ) : (
        state.buttons.map((b) => (
          <Button key={b.label} variant={b.variant} icon={b.icon} disabled={b.disabled} loading={b.loading} onClick={b.onClick}>
            {b.label}
          </Button>
        ))
      )}
    </div>
  );
}

/** DESIGN 5.2 Result panel: replaces the action bar once the game is over; receives focus. */
export function ResultPanel({
  headline,
  sub,
  download,
  onReview,
}: {
  headline: string;
  sub: string;
  download: { href: string; label: string };
  onReview: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div class="result" role="status" tabIndex={-1} ref={ref}>
      <h2>{headline}</h2>
      <p>{sub}</p>
      <div class="row">
        <a class="btn btn-secondary" href={download.href} download>
          <Icon name="downloadSimple" />
          <span>{download.label}</span>
        </a>
        <Button variant="quiet" onClick={onReview}>
          Review
        </Button>
      </div>
    </div>
  );
}
