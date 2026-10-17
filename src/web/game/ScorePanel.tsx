import type { GameView, Seat } from '../../shared/types';

/** DESIGN 5.2 Score panel: replaces the kifu during Go scoring. */
export function ScorePanel({ view }: { view: GameView }) {
  const scoring = view.scoring!;
  const { black, white } = scoring.score;
  const opponent: Seat | null = view.you === null ? null : view.you === 'black' ? 'white' : 'black';
  const head = (seat: Seat) => (
    <span class="head">
      <span class={`mini-stone ${seat}`} aria-hidden="true" />
      {view.players[seat].name}
    </span>
  );
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const acceptedLine = (seat: Seat) => `${view.players[seat].name} accepted`;
  return (
    <div class="score">
      <table>
        <thead>
          <tr>
            <th scope="col">
              <span class="visually-hidden">Score</span>
            </th>
            <th scope="col">{head('black')}</th>
            <th scope="col">{head('white')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Stones</td>
            <td>{black.stones}</td>
            <td>{white.stones}</td>
          </tr>
          <tr>
            <td>Territory</td>
            <td>{black.territory}</td>
            <td>{white.territory}</td>
          </tr>
          <tr>
            <td>Komi</td>
            <td />
            <td>{fmt(white.komi ?? 0)}</td>
          </tr>
          <tr class="total">
            <td>Total</td>
            <td>{fmt(black.total)}</td>
            <td>{fmt(white.total)}</td>
          </tr>
        </tbody>
      </table>
      {view.status === 'scoring' && <p class="hint">Tap a group to mark it dead or alive.</p>}
      {view.status === 'scoring' &&
        (opponent ? (
          scoring.accepted[opponent] && <p class="accepted">{acceptedLine(opponent)}</p>
        ) : (
          (['black', 'white'] as const).filter((s) => scoring.accepted[s]).map((s) => <p class="accepted" key={s}>{acceptedLine(s)}</p>)
        ))}
    </div>
  );
}
