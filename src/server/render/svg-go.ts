// Go position -> SVG string, DESIGN palette (ARCHITECTURE 8).
import { COLS, parseGtp, type Vertex } from '../../shared/gtp';
import { hoshiPoints } from '../games/go';

const KAYA = '#e5b568';
const GRID = '#492b0f';
const SHU = '#d33e25';
const U = 100; // one vertex

export interface GoSvgInput {
  signMap: number[][];
  lastMove: Vertex | null;
  coords: boolean;
  dead: string[];
  territory: number[][] | null;
}

export function goSvg({ signMap, lastMove, coords, dead, territory }: GoSvgInput): string {
  const size = signMap.length;
  const pad = coords ? U * 1.1 : U * 0.6;
  const extent = (size - 1) * U + 2 * pad;
  const px = (i: number) => pad + i * U;
  const deadSet = new Set(dead.map((g) => parseGtp(g, size)?.join(',')));
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" width="${extent}" height="${extent}">`,
    '<defs>',
    '<radialGradient id="b" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#3a3b3f"/><stop offset="1" stop-color="#151618"/></radialGradient>',
    '<radialGradient id="w" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fcfaf6"/><stop offset="1" stop-color="#e2dbd0"/></radialGradient>',
    '</defs>',
    `<rect width="${extent}" height="${extent}" fill="${KAYA}"/>`,
    `<g stroke="${GRID}" stroke-width="3">`,
  ];
  for (let i = 0; i < size; i++) {
    parts.push(`<line x1="${px(0)}" y1="${px(i)}" x2="${px(size - 1)}" y2="${px(i)}"/>`);
    parts.push(`<line x1="${px(i)}" y1="${px(0)}" x2="${px(i)}" y2="${px(size - 1)}"/>`);
  }
  parts.push('</g>');
  for (const [x, y] of hoshiPoints(size)) parts.push(`<circle cx="${px(x)}" cy="${px(y)}" r="9" fill="${GRID}"/>`);
  if (coords) {
    parts.push(`<g font-family="DejaVu Sans Mono" font-size="38" fill="${GRID}" text-anchor="middle">`);
    for (let i = 0; i < size; i++) {
      const letter = COLS[i];
      const num = size - i;
      parts.push(`<text x="${px(i)}" y="${pad * 0.55}">${letter}</text>`);
      parts.push(`<text x="${px(i)}" y="${extent - pad * 0.3}">${letter}</text>`);
      parts.push(`<text x="${pad * 0.42}" y="${px(i) + 13}">${num}</text>`);
      parts.push(`<text x="${extent - pad * 0.42}" y="${px(i) + 13}">${num}</text>`);
    }
    parts.push('</g>');
  }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const s = signMap[y]![x];
      if (s === 0) continue;
      const isDead = deadSet.has(`${x},${y}`);
      parts.push(
        `<circle cx="${px(x)}" cy="${px(y)}" r="${U * 0.48}" fill="url(#${s === 1 ? 'b' : 'w'})"${isDead ? ' opacity="0.6"' : ''}/>`,
      );
    }
  if (territory) {
    const half = U * 0.2;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const t = territory[y]![x];
        if (!t) continue;
        const fill = t === 1 ? '#151618' : '#f5f1ea';
        parts.push(`<rect x="${px(x) - half}" y="${px(y) - half}" width="${2 * half}" height="${2 * half}" fill="${fill}" fill-opacity="0.85"/>`);
      }
  }
  for (const key of deadSet) {
    if (!key) continue;
    const [x, y] = key.split(',').map(Number) as Vertex;
    const d = U * 0.22;
    parts.push(
      `<path d="M${px(x) - d} ${px(y) - d}L${px(x) + d} ${px(y) + d}M${px(x) + d} ${px(y) - d}L${px(x) - d} ${px(y) + d}" stroke="${SHU}" stroke-width="8"/>`,
    );
  }
  if (lastMove) parts.push(`<circle cx="${px(lastMove[0])}" cy="${px(lastMove[1])}" r="${U * 0.14}" fill="${SHU}"/>`);
  parts.push('</svg>');
  return parts.join('');
}
