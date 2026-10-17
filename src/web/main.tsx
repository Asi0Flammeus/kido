// Router: "/" landing, "/g/:id" game, anything else the invalid-link state (DESIGN 4.1).
import { render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { GamePage } from './game/GamePage';
import { Mark } from './game/ui';
import { Header } from './Header';

function Landing() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <>
      <Header meta={null} />
      <main class="center landing" ref={ref} tabIndex={-1}>
        <div class="empty-state">
          <Mark size={48} />
          <h1>kido</h1>
          <p>Go and chess, played slowly. Open a game link to play.</p>
        </div>
      </main>
    </>
  );
}

function App() {
  const path = location.pathname;
  if (path === '/' || path === '') return <Landing />;
  const match = /^\/g\/([A-Za-z0-9_-]+)\/?$/.exec(path);
  const token = new URLSearchParams(location.search).get('s');
  return <GamePage id={match ? match[1]! : 'nope'} token={token} />;
}

render(<App />, document.getElementById('app')!);
