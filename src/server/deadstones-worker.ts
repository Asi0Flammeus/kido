// Bun Worker wrapping @sabaki/deadstones so the Monte Carlo estimate never blocks requests (4.4).
import { guess } from '@sabaki/deadstones';

declare const self: Worker;

self.onmessage = async (event: MessageEvent<{ id: number; signMap: number[][] }>) => {
  const { id, signMap } = event.data;
  try {
    const dead = await guess(signMap, { finished: true, iterations: 100 });
    postMessage({ id, dead });
  } catch (error) {
    postMessage({ id, dead: [], error: String(error) });
  }
};
