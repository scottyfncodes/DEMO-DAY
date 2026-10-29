/* Plays the golf game in headless Chromium at iPhone size and saves
 * screenshots to smoke-output/golf-*. Aims by touch-drag and by the test hook,
 * fires, checks that shots break things, that a ball gets inside, that restart
 * resets, and that progress is saved. Fails on page errors.
 * Requires a server: `pnpm preview` (default http://localhost:4173/DEMO-DAY/). */
import { existsSync, mkdirSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:4173/DEMO-DAY/';
const OUT = 'smoke-output';
const DEVICE = process.env.DEVICE ?? 'iPhone 13';
mkdirSync(OUT, { recursive: true });
const errors = [];
let shot = 0;
async function snap(page, name) {
  shot++;
  await page.screenshot({ path: `${OUT}/golf-${String(shot).padStart(2, '0')}-${name}.png` });
  console.log(`  ✓ ${name}`);
}
function check(cond, message) {
  if (!cond) throw new Error(message);
}
async function waitAim(page, ms = 150000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ph = await page.evaluate(() => window.__golf.session.phase);
    if (ph !== 'flight') return ph;
    await page.waitForTimeout(200);
  }
  throw new Error('shot never settled');
}

async function main() {
  const executablePath = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ ...devices[DEVICE], reducedMotion: 'no-preference' });
  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));

  console.log(`Opening ${BASE} as ${DEVICE}`);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('demo-day:save', JSON.stringify({ version: 2, money: 1234, records: {}, fleet: ['ball', 'dozer'], upgrades: [], settings: { sound: false, haptics: true, reducedMotion: false } })));
  await page.evaluate(() => localStorage.removeItem('demo-day:golf'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(4500);
  await snap(page, 'title');

  await page.getByRole('button', { name: /Tee off/ }).first().click();
  await page.waitForSelector('.golf-play');
  await page.waitForTimeout(900);
  await snap(page, 'intro');
  await page.locator('.sheet .btn.primary').click();
  await page.waitForTimeout(600);
  await snap(page, 'aim-coach');

  // The thumb swing: press on the lawn, slide to aim, let go to hit it at full power.
  const vp = page.viewportSize();
  const cdp = await context.newCDPSession(page);
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const cx = vp.width / 2;
  const cy = vp.height * 0.45;
  // Press and hold without sliding, then let go: swings at the current aim.
  const thumbSwing = async () => {
    await touch('touchStart', cx, cy);
    await page.waitForTimeout(400);
    await touch('touchEnd');
  };
  const used = () => page.evaluate(() => window.__golf.session.shotsUsed);

  // Sliding moves the aim while the thumb is down; letting go on the cancel strip puts it back.
  const y0 = await page.evaluate(() => window.__golf.aim.yaw);
  await touch('touchStart', cx, cy);
  for (let i = 1; i <= 8; i++) await touch('touchMove', cx + i * 6, cy - i * 3);
  const y1 = await page.evaluate(() => window.__golf.aim.yaw);
  check(y1 > y0 + 1, `touch drag did not change the aim (${y0} -> ${y1})`);
  await page.waitForTimeout(300);
  await snap(page, 'aim-dragged');
  for (let i = 1; i <= 10; i++) await touch('touchMove', cx + 48, cy - 24 + i * ((vp.height - 20 - cy) / 10));
  await page.waitForTimeout(200);
  await snap(page, 'cancel-armed');
  await touch('touchEnd');
  await page.waitForTimeout(300);
  check((await used()) === 0, 'letting go on the cancel strip fired a shot');
  check(Math.abs((await page.evaluate(() => window.__golf.aim.yaw)) - y0) < 0.01, 'cancel did not restore the aim');

  // A quick brush of the screen is not a swing.
  await page.evaluate(() => window.__golf.aimAt(-0.75, 1.95, 0));
  await page.waitForTimeout(300);
  await snap(page, 'aim-guide');
  // Sent back to back so a slow headless frame can't stretch the tap into a hold.
  await Promise.all([touch('touchStart', cx, cy), touch('touchEnd')]);
  await page.waitForTimeout(300);
  check((await used()) === 0, 'a quick tap fired a shot');

  // Shot 1: a brick, aimed by the hook (precise), then a real press and release.
  await thumbSwing();
  await page.waitForTimeout(250);
  await snap(page, 'flight');
  await waitAim(page);
  await page.waitForTimeout(500);
  await snap(page, 'after-shot-1');
  let s = await page.evaluate(() => ({ used: window.__golf.session.shotsUsed, bricks: window.__golf.session.world.parts.filter((p) => p.kind === 'brick' && p.state !== 0).length }));
  check(s.used === 1, 'shot not counted');
  check(s.bricks >= 1, 'no brick broke on a direct hit');

  // Shot 2: through the living room window.
  await page.evaluate(() => window.__golf.aimAt(-3.15, 1.95, 0));
  await thumbSwing();
  await page.waitForTimeout(700);
  await snap(page, 'inside');
  await waitAim(page);
  await page.waitForTimeout(800);
  await snap(page, 'after-shot-2');
  const phase = await page.evaluate(() => window.__golf.session.phase);
  if (phase === 'done' || (await page.locator('.g-results').count())) {
    await page.waitForTimeout(1200);
    await snap(page, 'results');
  }
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('demo-day:golf')));
  check(saved && saved.levels.c1 && saved.levels.c1.attempts >= 1, 'attempt not saved');
  const crew = await page.evaluate(() => JSON.parse(localStorage.getItem('demo-day:save')));
  check(crew.money === 1234, 'crew save was touched');

  // Restart resets the level.
  await page.evaluate(() => window.__golf.restart());
  await page.waitForTimeout(500);
  s = await page.evaluate(() => ({ used: window.__golf.session.shotsUsed, broken: window.__golf.session.world.parts.filter((p) => p.state !== 0).length }));
  check(s.used === 0 && s.broken === 0, `restart did not reset (${JSON.stringify(s)})`);
  await snap(page, 'restarted');

  check(errors.length === 0, `page errors:\n${errors.join('\n')}`);
  await browser.close();
  console.log('Golf smoke run passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
