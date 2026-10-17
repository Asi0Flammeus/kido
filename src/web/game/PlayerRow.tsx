import { useEffect, useState } from 'preact/hooks';
import { displayRemaining, formatClock } from '../../shared/clock';
import type { ClockView, Seat } from '../../shared/types';

export type RowStatus = 'your turn' | 'to play' | 'passed' | 'offered a draw' | 'accepted the score' | null;

interface Props {
  seat: Seat;
  name: string;
  status: RowStatus;
  turnRing: boolean;
  clock: ClockView | null;
  clockOffset: number;
  own: boolean;
  class: string;
}

/** DESIGN 5.2 Player row: seat stone with turn ring, name, one status word, clock. */
export function PlayerRow({ seat, name, status, turnRing, clock, clockOffset, own, class: cls }: Props) {
  return (
    <section class={`player ${cls}`} aria-label={`${name}, ${seat}`} tabIndex={0}>
      <span class={`seat-stone ${seat}${turnRing ? ' turn' : ''}`} aria-hidden="true" />
      <div class="who">
        <span class="name">{name}</span>
        <span class="status">{status ?? ''}</span>
      </div>
      {clock && <Clock clock={clock} seat={seat} offset={clockOffset} active={turnRing} own={own} />}
    </section>
  );
}

function Clock({ clock, seat, offset, active, own }: { clock: ClockView; seat: Seat; offset: number; active: boolean; own: boolean }) {
  const running = clock.running === seat;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [running]);
  const remaining = displayRemaining(clock, seat, running ? now : clock.serverNow - offset, offset);
  const low = own && running && remaining < 10_000;
  const cls = `clock${active ? ' active' : ''}${low ? ' low' : ''}${remaining <= 0 ? ' expired' : ''}`;
  return (
    <span class={cls} role="timer" aria-label={`${formatClock(remaining)} left`}>
      {formatClock(remaining)}
    </span>
  );
}
