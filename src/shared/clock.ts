import type { ClockView, Seat } from './types';

/**
 * Remaining time for `seat` at local time `now`, extrapolated from the server's snapshot.
 * `offset` = serverNow - Date.now() measured when the view arrived. Floored at 0; the client
 * never ends a game from this value (ARCHITECTURE 7.2).
 */
export function displayRemaining(clock: ClockView, seat: Seat, now: number, offset: number): number {
  const base = clock.remainingMs[seat];
  if (clock.running !== seat) return base;
  return Math.max(0, base - (now + offset - clock.serverNow));
}

/** DESIGN 5.2: m:ss under an hour, 0:07.4 under ten seconds, h:mm:ss at or above an hour. */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < 10_000) {
    const tenths = Math.floor(clamped / 100);
    return `0:0${Math.floor(tenths / 10)}.${tenths % 10}`;
  }
  const totalSec = Math.floor(clamped / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
