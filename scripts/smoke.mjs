/* Plays DEMO DAY in headless Chromium at iPhone size and saves screenshots to
 * smoke-output/. The training job is played by touch (inspect, crane, swing,
 * dozer, finish), a purchase is made in the garage, and the save is checked
 * after a reload. Fails on page errors, a double-spent move or a lost save.
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

function check(cond, message) {
  if (!cond) throw new Error(message);
}

async function main() {
  const executablePath = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const context = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'no-preference' });
  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));

  console.log(`Opening ${BASE}`);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await snap(page, 'title');

  await page.getByRole('button', { name: /Take the first call/ }).click();
  await page.waitForSelector('.brief');
  await snap(page, 'job-sheet');
  await page.getByRole('button', { name: 'Start the job' }).click();
  await page.waitForSelector('.play');
  await page.waitForTimeout(1200);

  const screenOf = (label, fy) =>
    page.evaluate(([l, f]) => {
      const P = window.__play;
      const pc = P.job.sim.def.pieces.find((q) => q.label === l);
      return P.worldToScreen(pc.x + pc.w / 2, pc.y + pc.h * f);
    }, [label, fy]);
  const ready = async () => {
    for (let i = 0; i < 120; i++) {
      if (await page.evaluate(() => window.__play.job.ready)) return;
      await page.waitForTimeout(250);
    }
    throw new Error('site never settled');
  };

  let p = await screenOf('Column A · floor 1', 0.5);
  await page.touchscreen.tap(p.x, p.y);
  await page.locator('.machine-tile', { hasText: 'Crane' }).tap();
  await page.waitForTimeout(800);
  p = await screenOf('Column A · floor 1', 0.4);
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForTimeout(300);
  await snap(page, 'swing-preview');
  const confirm = await page.locator('.confirm').boundingBox();
  await page.touchscreen.tap(confirm.x + 20, confirm.y + 20);
  await page.touchscreen.tap(confirm.x + 24, confirm.y + 24);
  await page.waitForTimeout(400);
  check((await page.evaluate(() => window.__play.job.left('ball'))) === 2, 'a double tap spent two swings');
  await page.waitForTimeout(1600);
  await snap(page, 'collapse');
  await ready();

  await page.locator('.machine-tile', { hasText: 'Dozer' }).tap();
  await page.waitForTimeout(800);
  for (let i = 0; i < 4; i++) {
    if (await page.locator('.finish-bar:not(.hidden)').count()) break;
    const g = await page.evaluate(() => window.__play.worldToScreen(-1 + 0.63, 0.51));
    await page.touchscreen.tap(g.x, g.y);
    await page.waitForTimeout(300);
    if (i === 0) await snap(page, 'push-preview');
    if (!(await page.locator('.confirm').count())) break;
    await page.locator('.confirm').tap();
    await ready();
  }
  await snap(page, 'cleared');
  await page.locator('.finish-bar .btn').tap();
  await page.waitForSelector('.results');
  await page.waitForTimeout(1500);
  await snap(page, 'results');
  const money = await page.evaluate(() => JSON.parse(localStorage.getItem('demo-day:save')).money);
  check(money >= 7000, `training job paid ${money}`);

  await page.getByRole('button', { name: 'Go to the garage' }).click();
  await page.waitForSelector('.garage');
  const buy = page.locator('.machine-card .btn');
  await buy.tap();
  await buy.tap();
  await page.waitForTimeout(400);
  await snap(page, 'garage');
  await page.reload({ waitUntil: 'networkidle' });
  const save = await page.evaluate(() => JSON.parse(localStorage.getItem('demo-day:save')));
  check(save.fleet.includes('excavator') && save.tutorialDone, 'excavator purchase or tutorial flag did not persist');
  check(save.records.corner?.completions === 1, 'completion did not persist');

  check(errors.length === 0, `page errors:\n${errors.join('\n')}`);
  await browser.close();
  console.log('Smoke run passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
