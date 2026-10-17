// GTP vertices ("D4") <-> [x, y] with y counted from the top (go-board and Shudan convention).
// Columns skip I; rows are numbered from the bottom, so A1 is the bottom-left corner.

export const COLS = 'ABCDEFGHJKLMNOPQRST';
export type Vertex = [number, number];

const GTP_RE = /^([A-HJ-T])(1[0-9]|[1-9])$/i;

export function parseGtp(text: string, size: number): Vertex | null {
  const m = GTP_RE.exec(text.trim());
  if (!m) return null;
  const x = COLS.indexOf(m[1]!.toUpperCase());
  const row = Number(m[2]);
  if (x < 0 || x >= size || row < 1 || row > size) return null;
  return [x, size - row];
}

export function toGtp([x, y]: Vertex, size: number): string {
  return `${COLS[x]}${size - y}`;
}

/** SGF point: two letters a..s from the top-left. */
export function toSgfPoint([x, y]: Vertex): string {
  return String.fromCharCode(97 + x) + String.fromCharCode(97 + y);
}
