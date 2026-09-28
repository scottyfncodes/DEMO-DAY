/* Renders the DEMO DAY icon SVG to the PNG sizes the PWA manifest and iOS need.
 * Uses the Chromium that Playwright ships with. Run: pnpm icons */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'public', 'favicon.svg'), 'utf8');
const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

// Maskable icons must survive a circular crop: no rounded corners, artwork
// scaled into the central 80% safe zone.
const maskable = svg
  .replace(/<rect width="512" height="512" rx="112" fill="url\(#bg\)"\/>/, '<rect width="512" height="512" fill="#182231"/><rect width="512" height="512" fill="url(#bg)"/>')
  .replace('<circle cx="352"', '<g transform="translate(256 256) scale(0.82) translate(-256 -256)"><circle cx="352"')
  .replace('</svg>', '</g></svg>');

// iOS squares the corners itself and shows black behind transparency, so the
// touch icon is full-bleed with the artwork slightly inset.
const apple = svg
  .replace(/<rect width="512" height="512" rx="112" fill="url\(#bg\)"\/>/, '<rect width="512" height="512" fill="url(#bg)"/>')
  .replace('<circle cx="352"', '<g transform="translate(256 256) scale(0.92) translate(-256 -256)"><circle cx="352"')
  .replace('</svg>', '</g></svg>');

const targets = [
  { file: 'icon-512.png', size: 512, source: svg },
  { file: 'icon-192.png', size: 192, source: svg },
  { file: 'icon-maskable-512.png', size: 512, source: maskable },
  { file: 'apple-touch-icon.png', size: 180, source: apple },
  { file: 'favicon-32.png', size: 32, source: svg },
];

function pageHtml(source, size) {
  return `<!doctype html><html><body style="margin:0;background:transparent">
    <div style="width:${size}px;height:${size}px">${source.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div>
  </body></html>`;
}

async function main() {
  const candidates = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].filter(Boolean);
  let launchOptions = {};
  for (const c of candidates) {
    if (existsSync(c)) {
      launchOptions = { executablePath: c };
      break;
    }
  }
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  for (const t of targets) {
    await page.setViewportSize({ width: t.size, height: t.size });
    await page.setContent(pageHtml(t.source, t.size));
    const buffer = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: t.size, height: t.size } });
    writeFileSync(join(outDir, t.file), buffer);
    console.log(`wrote icons/${t.file} (${t.size}px)`);
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
