// Extracts the 12 cburnett piece SVGs (base64) from chessground's CSS at boot (ARCHITECTURE 8).
import { readFileSync } from 'node:fs';

const CSS_PATH = Bun.resolveSync('@lichess-org/chessground/assets/chessground.cburnett.css', import.meta.dir);
const PIECE_RE = /piece\.([a-z]+)\.(white|black)\s*\{\s*background-image:\s*url\(['"]?data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g;

/** Key: `${color}-${role}`, e.g. `white-queen`. Value: base64 SVG. */
export function loadPieces(): Map<string, string> {
  const css = readFileSync(CSS_PATH, 'utf8');
  const pieces = new Map<string, string>();
  for (const [, role, color, b64] of css.matchAll(PIECE_RE)) pieces.set(`${color}-${role}`, b64!);
  if (pieces.size < 12) throw new Error(`chessground.cburnett.css yielded ${pieces.size} pieces, expected 12`);
  return pieces;
}
