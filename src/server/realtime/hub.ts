// Per-game subscribers: SSE streams and long-poll waiters (ARCHITECTURE 7.1, 6.4).
import type { Seat } from '../../shared/types';

export interface Subscriber {
  seat: Seat | null;
  /** Called after every committed change; projects and sends the view for this viewer. */
  notify(): void;
}

export class Hub {
  private readonly games = new Map<string, Set<Subscriber>>();

  subscribe(gameId: string, sub: Subscriber): () => void {
    let set = this.games.get(gameId);
    if (!set) this.games.set(gameId, (set = new Set()));
    set.add(sub);
    return () => {
      set.delete(sub);
      if (set.size === 0) this.games.delete(gameId);
    };
  }

  publish(gameId: string): void {
    for (const sub of this.games.get(gameId) ?? []) sub.notify();
  }
}
