// Builds the web app with Bun's HTML bundler, then:
// - self-hosts IBM Plex (Fontsource, DESIGN 2.2): the latin and latin-ext faces of the five
//   weights are copied to dist/web/fonts with a generated stylesheet (Bun would inline every
//   subset of every weight as base64 into the main CSS);
// - adds the head links that point at public/ files (the bundler would try to resolve them);
// - preloads ibm-plex-sans-latin-400 and ibm-plex-mono-latin-500 (the clock face).
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = join(import.meta.dir, '..');
const outdir = join(root, 'dist', 'web');
rmSync(outdir, { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: [join(root, 'src', 'web', 'index.html')],
  outdir,
  minify: true,
  sourcemap: 'linked',
  publicPath: '/',
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const FACES = [
  ['@fontsource/ibm-plex-sans', '400'],
  ['@fontsource/ibm-plex-sans', '500'],
  ['@fontsource/ibm-plex-sans', '600'],
  ['@fontsource/ibm-plex-mono', '400'],
  ['@fontsource/ibm-plex-mono', '500'],
] as const;
const fontsDir = join(outdir, 'fonts');
mkdirSync(fontsDir, { recursive: true });
let fontCss = '';
for (const [pkg, weight] of FACES) {
  const cssPath = Bun.resolveSync(`${pkg}/${weight}.css`, root);
  const blocks = readFileSync(cssPath, 'utf8').split(/(?=\/\* )/);
  for (const block of blocks) {
    const name = /\/\* (\S+) \*\//.exec(block)?.[1];
    if (!name || !(name.includes('-latin-') || name.includes('-latin-ext-'))) continue;
    copyFileSync(join(dirname(cssPath), 'files', `${name}.woff2`), join(fontsDir, `${name}.woff2`));
    fontCss += block
      .replace(/src: url\(\.\/files\/([^)]+\.woff2)\) format\('woff2'\), url\([^)]+\) format\('woff'\);/, "src: url(/fonts/$1) format('woff2');")
      .trim();
    fontCss += '\n';
  }
}
const fontCssName = `fonts-${Bun.hash(fontCss).toString(36)}.css`;
writeFileSync(join(outdir, fontCssName), fontCss);

const preloads = ['ibm-plex-sans-latin-400-normal', 'ibm-plex-mono-latin-500-normal'].map(
  (stem) => `<link rel="preload" href="/fonts/${stem}.woff2" as="font" type="font/woff2" crossorigin>`,
);
const head = [
  '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
  '<link rel="icon" href="/favicon-32.png" sizes="32x32">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon-180.png">',
  '<link rel="manifest" href="/manifest.webmanifest">',
  ...preloads,
  `<link rel="stylesheet" href="/${fontCssName}">`,
];
const indexPath = join(outdir, 'index.html');
writeFileSync(indexPath, readFileSync(indexPath, 'utf8').replace('</head>', `${head.join('')}</head>`));
console.log(`built ${readdirSync(outdir).length} entries into dist/web, ${readdirSync(fontsDir).length} font files`);
