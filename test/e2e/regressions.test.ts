import { afterAll, beforeAll, expect, test } from 'bun:test';
import { type Browser, chromium } from 'playwright';
import { startTestServer, type TestServer } from '../helpers/server';

const INNER = {
  viewport: { width: 968, height: 875 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  colorScheme: 'dark' as const,
};

let srv: TestServer;
let browser: Browser;

beforeAll(async () => {
  srv = await startTestServer(undefined, undefined, 44_000 + Math.floor(Math.random() * 1000));
  browser = await chromium.launch();
}, 300_000);

afterAll(async () => {
  await browser?.close();
  await srv?.stop();
}, 300_000);

test(
  'each app route has one h1',
  async () => {
    const game = await srv.create({ kind: 'chess', maiaSeat: 'black' });
    const context = await browser.newContext(INNER);
    const page = await context.newPage();

    for (const [path, ready] of [
      ['/', '.landing'],
      ['/g/nope', '.empty-state'],
      [game.links.william.replace('https://kido.wmmw.sh', ''), 'main[aria-busy="false"]'],
    ]) {
      await page.goto(`${srv.url}${path}`);
      await page.locator(ready).waitFor();
      await expect(page.locator('h1').count()).resolves.toBe(1);
    }

    await context.close();
  },
  120_000,
);

test(
  'confirming a sheet does not raise a page error',
  async () => {
    const game = await srv.create({ kind: 'chess', maiaSeat: 'black' });
    const context = await browser.newContext(INNER);
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(game.links.william.replace('https://kido.wmmw.sh', srv.url));
    await page.locator('main[aria-busy="false"]').waitFor();

    await page.getByRole('button', { name: 'Resign' }).click();
    await page.locator('dialog.sheet[open]').waitFor();
    await page.locator('dialog.sheet').getByRole('button', { name: 'Resign' }).click();
    await page.locator('.result').waitFor();

    expect(pageErrors).toEqual([]);
    await context.close();
  },
  120_000,
);
