import { timingSafeEqual } from 'node:crypto';
import type { Seat } from '../shared/types';
import type { GameRow } from './repo';

export function requestToken(req: Request, url: URL): string | null {
  const header = req.headers.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7).trim() || null;
  return url.searchParams.get('s') || null;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * ARCHITECTURE 5: a matching token gives that seat; otherwise the viewer is a spectator when the
 * game allows it. `undefined` means "behave as if the game does not exist" (404).
 */
export function resolveViewer(row: GameRow, token: string | null): { seat: Seat | null } | undefined {
  if (token) {
    if (safeEqual(token, row.white_token)) return { seat: 'white' };
    if (safeEqual(token, row.black_token)) return { seat: 'black' };
  }
  return row.spectators ? { seat: null } : undefined;
}

export function randomToken(bytes: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url');
}
