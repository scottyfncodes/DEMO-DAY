/* Plays the wrecking-ball slice in headless Chromium at iPhone size and saves
 * screenshots to smoke-output/. Fails on console errors or if the building
 * never comes down. Requires a server: `pnpm preview`
 * (default http://localhost:4173/DEMO-DAY/). */
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
  await page.waitForTimeout(600);
  await snap(page, 'menu');

  await page.getByRole('button', { name: /Swing/ }).click();
  await page.waitForSelector('.wk');
  await page.waitForTimeout(800);
  await snap(page, 'site');

  // A real drag on the ball: pull it back and hold to see the aim line.
  const ball = await page.evaluate(() => {
    const w = window.__wreck;
    const b = w.sim.state.ball;
    return w.camera.worldToScreen(b.x, b.y);
  });
  await page.mouse.move(ball.x, ball.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(ball.x - i * 8, ball.y - i * 2);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(250);
  await snap(page, 'aim');
  await page.mouse.up();
  await page.waitForTimeout(2200);
  await snap(page, 'first-hit');

  // Then play it out with the planner, the way a careful player would.
  for (let i = 0; i < 20; i++) {
    if (await page.locator('.wk-sheet.open').count()) break;
    const plan = await page.evaluate(() => window.__wreck.plan());
    if (!plan) break;
    await page.evaluate((p) => window.__wreck.hook(p.hx, p.hy), plan);
    await page.waitForTimeout(3500);
    await page.evaluate((p) => window.__wreck.swing(p.px, p.py), plan);
    await page.waitForTimeout(2400);
    await snap(page, `swing-${i + 2}`);
    await page.waitForTimeout(2600);
  }
  await page.waitForSelector('.wk-sheet.open', { timeout: 20000 });
  await page.waitForTimeout(500);
  await snap(page, 'result');

  await page.getByRole('button', { name: /Watch the hit/ }).click();
  await page.waitForTimeout(1500);
  await snap(page, 'replay-swing');
  await page.waitForTimeout(2500);
  await snap(page, 'replay-collapse');
  await page.waitForSelector('.wk-sheet.open', { timeout: 30000 });

  await page.getByRole('button', { name: /Try another way/ }).click();
  await page.waitForTimeout(600);
  await snap(page, 'fresh-building');

  await browser.close();
  if (errors.length) {
    console.error('Console errors:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('Smoke test passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
