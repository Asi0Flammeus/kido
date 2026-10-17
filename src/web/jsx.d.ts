import 'preact';

declare module 'preact' {
  namespace JSX {
    interface IntrinsicElements {
      /** chessground's piece element; the cburnett CSS draws `.cg-wrap piece.<role>.<color>`. */
      piece: HTMLAttributes<HTMLElement>;
    }
  }
}
