// Minimal declarations for the two Sabaki packages that ship no types.

declare module '@sabaki/deadstones' {
  /** Monte Carlo guess of dead stones; vertices are [x, y] from the top-left. */
  export function guess(
    signMap: number[][],
    options?: { finished?: boolean; iterations?: number },
  ): Promise<[number, number][]>;
}

declare module '@sabaki/sgf' {
  export interface SgfNode {
    id: number | string;
    data: Record<string, string[]>;
    parentId: number | string | null;
    children: SgfNode[];
  }
  export function parse(contents: string): SgfNode[];
  export function stringify(nodes: SgfNode[], options?: { linebreak?: string; indent?: string }): string;
}
