/* Plays the Halden job in headless Chromium at iPhone size and saves
 * screenshots to smoke-output/. Every tool is used by touch first (charges,
 * a real swing, a held crunch, a dozer push); then the automated crew
 * finishes the job at speed so the result sheet, replay and restart can be
 * checked. Fails on console errors or if the job never completes.
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
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  const w = (fn, arg) => page.evaluate(fn, arg);

  console.log(`Opening ${BASE}`);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu');
  await page.waitForTimeout(600);
  await snap(page, 'menu');

  await page.getByRole('button', { name: /Start the job/ }).click();
  await page.waitForSelector('.wk-brief');
  await snap(page, 'job-sheet');
  await page.locator('.wk-brief .btn').click();
  await page.waitForTimeout(900);

  // Charges: three cutters on the tower's street-level columns and a blast charge, by tapping.
  const tapPiece = async (label) => {
    const p = await w((l) => {
      const x = window.__wreck;
      const pc = x.sim.def.pieces.find((q) => q.label === l);
      return x.camera.worldToScreen(pc.x + pc.w / 2, pc.y + pc.h * 0.5);
    }, label);
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForTimeout(220);
  };
  await tapPiece('Column E · floor 1');
  await tapPiece('Column F · floor 1');
  await tapPiece('Column G · floor 1');
  await page.locator('.wk-kind').nth(1).click();
  await tapPiece('Column H · floor 2');
  check((await w(() => window.__wreck.sim.state.charges.length)) === 4, 'charges were not placed by tapping');
  await snap(page, 'charges-set');
  await page.locator('.wk-action').click();
  await page.waitForTimeout(1600);
  await snap(page, 'volley');
  await page.waitForTimeout(6000);
  await snap(page, 'after-volley');

  // Ball: a real drag on the ball.
  await page.locator('.wk-tool').nth(1).click();
  await page.waitForTimeout(1500);
  const ball = await w(() => {
    const x = window.__wreck;
    const b = x.sim.state.ball;
    return x.camera.worldToScreen(b.x, b.y);
  });
  await page.mouse.move(ball.x, ball.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(ball.x - i * 6, ball.y - i * 2);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(250);
  await snap(page, 'aim');
  await page.mouse.up();
  await page.waitForTimeout(2500);
  check((await w(() => window.__wreck.sim.state.swing)) >= 1, 'the swing was not released');

  // Excavator: tap where the jaws go, hold Crunch.
  await page.locator('.wk-tool').nth(2).click();
  await page.waitForTimeout(1200);
  const jawAt = await w(() => {
    const x = window.__wreck;
    const s = x.sim.state;
    const low = x.sim.def.pieces.filter((p) => s.status[p.id] === 0 && p.y < 3).sort((a, b) => b.x - a.x)[0];
    const pt = low ? { x: low.x + low.w / 2, y: low.y + 1.5 } : { x: 45, y: 2 };
    return x.camera.worldToScreen(pt.x, pt.y);
  });
  await page.touchscreen.tap(jawAt.x, jawAt.y);
  await page.waitForTimeout(4000);
  const crunch = await page.locator('.wk-action').boundingBox();
  await page.mouse.move(crunch.x + crunch.width / 2, crunch.y + crunch.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2200);
  await snap(page, 'crunch');
  await page.mouse.up();
  check((await w(() => window.__wreck.sim.state.tally.bites)) > 0, 'holding Crunch did not bite');

  // Dozer: touch ahead of the blade to drive.
  await page.locator('.wk-tool').nth(3).click();
  await page.waitForTimeout(800);
  const startX = await w(() => window.__wreck.sim.state.dozer.x);
  for (let i = 0; i < 6; i++) {
    const p = await w(() => {
      const x = window.__wreck;
      const d = x.sim.state.dozer;
      return x.camera.worldToScreen(d.x + 3.25 + 10, 1);
    });
    await page.touchscreen.tap(Math.min(370, p.x), p.y);
    await page.waitForTimeout(500);
  }
  await snap(page, 'dozer');
  check((await w(() => window.__wreck.sim.state.dozer.x)) > startX + 5, 'the dozer did not drive');

  // The crew finishes the job at speed.
  await w(() => {
    window.__wreck.speed(8);
    window.__wreck.autoplay('mixed');
  });
  for (let i = 0; i < 240; i++) {
    if ((await w(() => window.__wreck.mode)) === 'result') break;
    await page.waitForTimeout(1000);
    if (i % 15 === 7) await snap(page, `crew-${i}`);
  }
  await page.waitForSelector('.wk-sheet.open', { timeout: 30000 });
  await page.waitForTimeout(1600);
  await snap(page, 'result');
  const status = await w(() => window.__wreck.status);
  check(status.down, 'the building never came down');
  check((await page.locator('.wk-grade').textContent())?.length === 1, 'no grade on the result sheet');

  await page.getByRole('button', { name: /Watch it again/ }).click();
  await page.waitForTimeout(1500);
  await snap(page, 'replay');
  await page.waitForSelector('.wk-sheet.open', { timeout: 40000 });

  await page.getByRole('button', { name: /Try another way/ }).click();
  await page.waitForTimeout(700);
  await snap(page, 'fresh-building');
  const fresh = await w(() => ({ charges: window.__wreck.sim.state.charges.length, standing: window.__wreck.status.standing, clock: window.__wreck.sim.clock }));
  check(fresh.charges === 0 && fresh.standing === 1 && fresh.clock === 0, 'restart did not stand the building back up');

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
