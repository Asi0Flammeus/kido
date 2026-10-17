import { BoundedGoban, type Marker, type GhostStone, type Vertex } from '@sabaki/shudan';
import { useMemo } from 'preact/hooks';
import { parseGtp } from '../../shared/gtp';
import type { ComponentChildren } from 'preact';

interface Props {
  size: number; // px
  signMap: number[][];
  lastMove: Vertex | null;
  preview: { vertex: Vertex; sign: 1 | -1 } | null;
  dead: string[];
  territory: number[][] | null;
  onVertex: (vertex: Vertex) => void;
  children?: ComponentChildren;
}

/** DESIGN 3.2: Shudan BoundedGoban, maps built from game state. */
export function GoBoard({ size, signMap, lastMove, preview, dead, territory, onVertex, children }: Props) {
  const n = signMap.length;
  const deadVertices = useMemo(() => dead.map((g) => parseGtp(g, n)).filter((v): v is Vertex => v !== null), [dead, n]);
  const markerMap = useMemo(() => {
    const map: (Marker | null)[][] = signMap.map((row) => row.map(() => null));
    if (lastMove) map[lastMove[1]]![lastMove[0]] = { type: 'point' };
    for (const [x, y] of deadVertices) map[y]![x] = { type: 'cross' };
    if (preview) map[preview.vertex[1]]![preview.vertex[0]] = { type: 'circle' };
    return map;
  }, [signMap, lastMove?.[0], lastMove?.[1], deadVertices, preview]);
  const ghostStoneMap = useMemo(() => {
    const map: (GhostStone | null)[][] = signMap.map((row) => row.map(() => null));
    if (preview) map[preview.vertex[1]]![preview.vertex[0]] = { sign: preview.sign, type: null };
    return map;
  }, [signMap, preview]);

  return (
    <div class="board" role="group" tabIndex={0} aria-label="Go board" style={{ width: `${size}px`, height: `${size}px`, background: 'var(--kaya)' }}>
      <BoundedGoban
        maxWidth={size}
        maxHeight={size}
        showCoordinates={size >= 500}
        fuzzyStonePlacement={false}
        animateStonePlacement={false}
        signMap={signMap as (0 | 1 | -1)[][]}
        markerMap={markerMap}
        ghostStoneMap={ghostStoneMap}
        paintMap={(territory ?? undefined) as (0 | 1 | -1)[][] | undefined}
        dimmedVertices={deadVertices}
        onVertexClick={(_event, vertex) => onVertex(vertex)}
        style={{ margin: '0 auto' }}
      />
      {children}
    </div>
  );
}
