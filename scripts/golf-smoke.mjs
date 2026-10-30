/* Plays DEMO DAY in headless Chromium at iPhone size and saves screenshots to
 * smoke-output/golf-*. Pulls back and lets go by touch, checks that a short
 * pull cancels, that shots break things and fill the reward meter, that a
 * house keeps its damage across a reload, and that the other modes open.
 * Fails on page errors.
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
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('demo-day:golf')).forEach((k) => localStorage.removeItem(k)));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await snap(page, 'title');

  await page.locator('.dd-play').click();
  await page.waitForSelector('.golf-play');
  await page.waitForTimeout(1500);
  await snap(page, 'house-1');

  const vp = page.viewportSize();
  const cdp = await context.newCDPSession(page);
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const cx = vp.width / 2;
  const cy = vp.height * 0.42;
  const used = () => page.evaluate(() => window.__golf.session.shotsUsed);

  // A press without a pull is not a shot, and sideways movement turns the aim.
  const y0 = await page.evaluate(() => window.__golf.aim.yaw);
  await touch('touchStart', cx, cy);
  for (let i = 1; i <= 6; i++) await touch('touchMove', cx - i * 8, cy + 2);
  await touch('touchEnd');
  await page.waitForTimeout(300);
  check((await used()) === 0, 'a sideways slide fired a shot');
  check((await page.evaluate(() => window.__golf.aim.yaw)) > y0 + 0.5, 'pulling left did not turn the aim right');

  // Pull back: the power ring and the guide show while the thumb is down.
  await page.evaluate(() => (window.__golf.aim.yaw = -4));
  await touch('touchStart', cx, cy);
  for (let i = 1; i <= 10; i++) await touch('touchMove', cx, cy + i * 14);
  await page.waitForTimeout(400);
  await snap(page, 'pulling');
  const pull = await page.evaluate(() => window.__golf.aim.pull);
  check(pull > 0.4, `pulling back did not build power (${pull})`);
  await touch('touchEnd');
  await page.waitForTimeout(250);
  check((await used()) === 1, 'letting go of a pull did not shoot');
  await snap(page, 'flight');
  await waitAim(page);
  await page.waitForTimeout(600);
  await snap(page, 'after-shot-1');

  // A few aimed shots at the soft front wall.
  for (const [x, y] of [[-1.5, 1.4], [-0.9, 1.0], [2.0, 1.3], [3.0, 1.0], [-3.0, 1.3]]) {
    await page.evaluate(([x, y]) => window.__golf.aimAt(x, y, 0.02), [x, y]);
    await page.evaluate(() => window.__golf.fire());
    await waitAim(page);
  }
  await page.waitForTimeout(900);
  await snap(page, 'after-shots');
  const st = await page.evaluate(() => ({ broken: window.__golf.session.world.parts.filter((p) => p.state !== 0 && p.house).length, meter: window.__golf.store.data.economy.meter, inv: window.__golf.store.data.economy.inventory }));
  check(st.broken > 3, `shots broke too little (${st.broken})`);
  console.log(`    broken ${st.broken}, meter ${st.meter.toFixed(1)}, inventory ${JSON.stringify(st.inv)}`);

  // Damage persists: reload and come back to the same house.
  await page.evaluate(() => window.__golf.persist());
  const before = st.broken;
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await snap(page, 'title-after');
  await page.locator('.dd-play').click();
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => window.__golf.session.world.parts.filter((p) => p.state !== 0 && p.house).length);
  check(after === before, `house damage did not survive a reload (${before} -> ${after})`);
  await snap(page, 'house-restored');

  // Pause menu.
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.waitForTimeout(400);
  await snap(page, 'pause');
  await page.getByRole('button', { name: 'All houses' }).click();
  await page.waitForTimeout(500);
  await snap(page, 'houses');

  // The other modes open.
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Daily Demo' }).click();
  await page.waitForTimeout(1500);
  await snap(page, 'daily');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Sandbox' }).click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__golf.selectBall('blast'));
  await page.evaluate(() => window.__golf.aimAt(0.3, 1.5, 1.95));
  await page.evaluate(() => window.__golf.fire());
  await page.waitForTimeout(900);
  await snap(page, 'sandbox-charge');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Challenges' }).click();
  await page.waitForTimeout(500);
  await snap(page, 'challenges');

  const crew = await page.evaluate(() => JSON.parse(localStorage.getItem('demo-day:save')));
  check(crew.money === 1234, 'crew save was touched');
  check(errors.length === 0, `page errors:\n${errors.join('\n')}`);
  await browser.close();
  console.log('Golf smoke run passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
