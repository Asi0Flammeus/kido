import type { Connection } from '../api';
import { Icon } from './ui';

/** DESIGN 6.3 connection banner; height animates open between header and main. */
export function Banner({ connection }: { connection: Connection }) {
  const open = connection !== 'live';
  return (
    <div class={`banner-wrap${open ? ' open' : ''}`}>
      <div>
        <div class="banner" role="status">
          {connection === 'offline' ? (
            <>
              <Icon name="wifiSlash" size={16} />
              <span>Offline. The game will resume when you're back online.</span>
            </>
          ) : connection === 'reconnecting' ? (
            <>
              <Icon name="arrowsClockwise" size={16} class="spin" />
              <span>Reconnecting…</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
