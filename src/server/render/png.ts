// resvg wrapper + small LRU (ARCHITECTURE 8).
import { Resvg } from '@resvg/resvg-js';
import { parseGtp } from '../../shared/gtp';
import { areaScore } from '../../shared/go-rules';
import type { Seat } from '../../shared/types';
import { replayGo } from '../games/go';
import { type GameRuntime, scoringOf } from '../games/runtime';
import { loadPieces } from './pieces';
import { chessSvg } from './svg-chess';
import { goSvg } from './svg-go';

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf';
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const LRU_SIZE = 64;

export class BoardRenderer {
  private readonly pieces = loadPieces();
  private readonly cache = new Map<string, Uint8Array>();

  render(rt: GameRuntime, viewer: Seat | null, ply: number, size: number, coords: boolean): Uint8Array {
    const orientation: Seat = rt.row.kind === 'chess' && viewer === 'black' ? 'black' : 'white';
    const key = `${rt.row.id}|${rt.row.version}|${ply}|${size}|${coords}|${orientation}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const png = this.renderSvg(this.svg(rt, orientation, ply, coords), size);
    this.cache.set(key, png);
    if (this.cache.size > LRU_SIZE) this.cache.delete(this.cache.keys().next().value!);
    return png;
  }

  private svg(rt: GameRuntime, orientation: Seat, ply: number, coords: boolean): string {
    const { row, moves } = rt;
    const last = ply > 0 ? moves[ply - 1]! : null;
    if (row.kind === 'chess') {
      return chessSvg({
        fen: last?.fen_after ?? START_FEN,
        orientation,
        lastMove: last?.uci ?? null,
        coords,
        pieces: this.pieces,
      });
    }
    const size = row.board_size!;
    const signMap = ply === moves.length ? rt.go!.board.signMap : replayGo(size, moves, ply).board.signMap;
    const scoring = ply === moves.length && row.status === 'scoring' ? scoringOf(row) : null;
    return goSvg({
      signMap,
      lastMove: last && last.notation !== 'pass' ? parseGtp(last.notation, size) : null,
      coords,
      dead: scoring?.dead ?? [],
      territory: scoring ? areaScore(signMap, scoring.dead, row.komi!).territory : null,
    });
  }

  private renderSvg(svg: string, size: number): Uint8Array {
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: size },
      font: { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans Mono' },
    });
    return resvg.render().asPng();
  }
}
