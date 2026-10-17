// Chess position -> SVG string, DESIGN palette (ARCHITECTURE 8).
import { Chess } from 'chess.js';
import type { Seat } from '../../shared/types';

const KAYA = '#e5b568';
const WALNUT = '#97653d';
const GRID = '#492b0f';
const SHU = '#d33e25';
const STONE_WHITE = '#f5f1ea';
const ROLES: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const SQ = 100;

export interface ChessSvgInput {
  fen: string;
  orientation: Seat;
  lastMove: string | null; // UCI
  coords: boolean;
  pieces: Map<string, string>;
}

export function chessSvg({ fen, orientation, lastMove, coords, pieces }: ChessSvgInput): string {
  const chess = new Chess(fen);
  const flip = orientation === 'black';
  // Screen position of a square: col 0..7 left to right, row 0..7 top to bottom.
  const at = (file: number, rank: number) => (flip ? { col: 7 - file, row: rank } : { col: file, row: 7 - rank });
  const sq = (name: string) => at(name.charCodeAt(0) - 97, Number(name[1]) - 1);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">`,
    `<defs><radialGradient id="check"><stop offset="0" stop-color="${SHU}"/><stop offset="0.25" stop-color="${SHU}" stop-opacity="0.9"/><stop offset="0.89" stop-color="${SHU}" stop-opacity="0"/></radialGradient></defs>`,
    `<rect width="800" height="800" fill="${KAYA}"/>`,
  ];
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 8; col++)
      if ((row + col) % 2 === 1) parts.push(`<rect x="${col * SQ}" y="${row * SQ}" width="${SQ}" height="${SQ}" fill="${WALNUT}"/>`);

  if (chess.inCheck()) {
    const color = chess.turn();
    for (const rank of chess.board())
      for (const p of rank)
        if (p && p.type === 'k' && p.color === color) {
          const { col, row } = sq(p.square);
          parts.push(`<rect x="${col * SQ}" y="${row * SQ}" width="${SQ}" height="${SQ}" fill="url(#check)"/>`);
        }
  }
  if (lastMove) {
    for (const name of [lastMove.slice(0, 2), lastMove.slice(2, 4)]) {
      const { col, row } = sq(name);
      parts.push(`<circle cx="${col * SQ + 50}" cy="${row * SQ + 50}" r="11" fill="${SHU}" fill-opacity="0.9"/>`);
    }
  }
  if (coords) {
    parts.push(`<g font-family="DejaVu Sans Mono" font-size="15" font-weight="bold">`);
    for (let i = 0; i < 8; i++) {
      const rankLabel = flip ? i + 1 : 8 - i;
      const fileLabel = String.fromCharCode(97 + (flip ? 7 - i : i));
      // Labels sit on column 0 (ranks) and row 7 (files); dark squares get light text.
      const rankFill = i % 2 === 1 ? STONE_WHITE : GRID;
      const fileFill = i % 2 === 0 ? STONE_WHITE : GRID;
      parts.push(`<text x="5" y="${i * SQ + 17}" fill="${rankFill}" fill-opacity="0.8">${rankLabel}</text>`);
      parts.push(`<text x="${i * SQ + 86}" y="793" fill="${fileFill}" fill-opacity="0.8">${fileLabel}</text>`);
    }
    parts.push('</g>');
  }
  for (const rank of chess.board())
    for (const p of rank) {
      if (!p) continue;
      const { col, row } = sq(p.square);
      const b64 = pieces.get(`${p.color === 'w' ? 'white' : 'black'}-${ROLES[p.type]}`);
      parts.push(`<image x="${col * SQ}" y="${row * SQ}" width="${SQ}" height="${SQ}" href="data:image/svg+xml;base64,${b64}"/>`);
    }
  parts.push('</svg>');
  return parts.join('');
}
