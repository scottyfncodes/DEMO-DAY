/* Plays through DEMO DAY in headless Chromium at iPhone size and saves
 * screenshots of every stage to smoke-output/. Fails on console errors.
 * Requires a server: `pnpm preview` (default http://localhost:4173/DEMO-DAY/). */
import { existsSync, mkdirSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:4173/DEMO-DAY/';
const OUT = 'smoke-output';
mkdirSync(OUT, { recursive: true });

const errors = [];
let shot = 0;
async function snap(page, name) {
  shot++;
  await page.screenshot({ path: `${OUT}/${String(shot).padStart(2, '0')}-${name}.png` });
  console.log(`  ✓ ${name}`);
}

async function main() {
  const executablePath = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const context = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'no-preference' });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  console.log(`Opening ${BASE}`);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu');
  await snap(page, 'menu');

  await page.getByRole('button', { name: /Start Demolition/i }).click();
  await page.waitForSelector('text=Accept Contract');
  await snap(page, 'contract');

  await page.getByRole('button', { name: /Accept Contract/i }).click();
  await page.waitForSelector('.job-sheet');
  await page.waitForTimeout(600);
  await snap(page, 'job-inspect');

  // Tap the left post by hitting its screen position via the debug hook.
  await page.evaluate(() => window.__demoDayJob.select('post_l'));
  await page.waitForTimeout(200);
  await snap(page, 'job-selected');

  await page.getByRole('button', { name: /Place SMALL/i }).click();
  await page.evaluate(() => window.__demoDayJob.select('post_r'));
  await page.getByRole('button', { name: /Place SMALL/i }).click();
  await page.waitForTimeout(300);
  await snap(page, 'job-placed');

  await page.getByRole('button', { name: /Arm ·/i }).click();
  await page.waitForTimeout(1700);
  await snap(page, 'demo-day-welcome');
  await page.waitForSelector('.count');
  await snap(page, 'countdown');
  await page.evaluate(() => window.__demoDayJob.skip());
  await page.waitForFunction(() => window.__demoDayJob && window.__demoDayJob.phase() === 'collapse', null, { timeout: 15000 });
  await page.waitForTimeout(350);
  await snap(page, 'collapse');
  await page.waitForTimeout(1200);
  await snap(page, 'collapse-late');

  await page.waitForSelector('.report', { timeout: 30000 });
  await page.waitForSelector('text=Continue to payout', { timeout: 15000 });
  await page.waitForTimeout(500);
  await snap(page, 'report');
  await page.getByRole('button', { name: /Continue to payout/i }).click();
  await page.waitForSelector('.total.in', { timeout: 15000 });
  await page.waitForTimeout(2200);
  await snap(page, 'payout');

  const save = await page.evaluate(() => localStorage.getItem('demo-day:save'));
  if (!save || !save.includes('job01')) throw new Error('Save data was not persisted');
  console.log('  ✓ save persisted');

  await page.getByRole('button', { name: /Main Menu/i }).click();
  await page.waitForSelector('.menu');
  await page.getByRole('button', { name: /Contracts/i }).click();
  await page.waitForSelector('text=Job 02', { timeout: 5000 }).catch(() => undefined);
  await snap(page, 'contracts');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Equipment/i }).click();
  await snap(page, 'equipment');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: /Records/i }).click();
  await snap(page, 'records');

  // Manifest and icons resolve.
  for (const path of ['manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png', 'sw.js', 'favicon.svg']) {
    const res = await page.request.get(BASE + path);
    if (!res.ok()) throw new Error(`${path} returned ${res.status()}`);
  }
  console.log('  ✓ PWA assets reachable');

  await browser.close();
  if (errors.length) {
    console.error('Console errors:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('Smoke test passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
