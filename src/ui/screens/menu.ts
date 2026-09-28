import type { App, ScreenInstance } from '../../app';
import { formatMoney } from '../../core/format';
import { CONTRACTS } from '../../data/contracts';
import { recommendedContract } from '../../game/progression';
import { h } from '../dom';

/** Draws a slow, moody skyline with one building mid-collapse behind the title. */
function menuArt(app: App): { el: HTMLElement; stop: () => void } {
  const canvas = h('canvas');
  const wrap = h('div', { class: 'menu-art', 'aria-hidden': 'true' }, canvas);
  const ctx = canvas.getContext('2d');
  let raf = 0;
  let running = true;
  const dust: Array<{ x: number; y: number; r: number; v: number; a: number }> = [];
  for (let i = 0; i < 40; i++) dust.push({ x: Math.random(), y: Math.random(), r: 2 + Math.random() * 10, v: 0.01 + Math.random() * 0.03, a: 0.05 + Math.random() * 0.12 });
  const start = performance.now();

  const draw = (now: number): void => {
    if (!running || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = wrap.clientWidth;
    const hgt = wrap.clientHeight;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(hgt * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(hgt * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const t = (now - start) / 1000;
    const groundY = hgt * 0.62;
    // Skyline.
    ctx.fillStyle = 'rgba(16, 22, 32, 0.9)';
    for (let i = 0; i < 18; i++) {
      const bw = 30 + ((i * 53) % 50);
      const bh = 40 + ((i * 71) % 120);
      const x = ((i * 131) % (w + 120)) - 60;
      ctx.fillRect(x, groundY - bh, bw, bh);
    }
    // Hero building: left half stands, right half is dropping.
    const bx = w * 0.5 - 90;
    const by = groundY - 220;
    ctx.fillStyle = '#c9cbcf';
    ctx.fillRect(bx, by, 90, 220);
    ctx.fillStyle = '#1a2331';
    for (let r = 0; r < 6; r++) for (let c = 0; c < 2; c++) ctx.fillRect(bx + 14 + c * 36, by + 16 + r * 34, 22, 20);
    const drop = app.reducedMotion ? 60 : (Math.sin(t * 0.6) * 0.5 + 0.5) * 90;
    const lean = app.reducedMotion ? 0.12 : 0.05 + (Math.sin(t * 0.6) * 0.5 + 0.5) * 0.18;
    ctx.save();
    ctx.translate(bx + 90, groundY);
    ctx.rotate(lean);
    ctx.translate(0, drop);
    ctx.fillStyle = '#b7b9bd';
    ctx.fillRect(0, -220, 90, 220);
    ctx.fillStyle = '#1a2331';
    for (let r = 0; r < 6; r++) for (let c = 0; c < 2; c++) ctx.fillRect(14 + c * 36, -220 + 16 + r * 34, 22, 20);
    ctx.restore();
    // Rubble.
    ctx.fillStyle = '#3b3230';
    ctx.beginPath();
    ctx.moveTo(bx + 60, groundY);
    ctx.quadraticCurveTo(bx + 140, groundY - 60 - drop * 0.3, bx + 260, groundY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#17130f';
    ctx.fillRect(0, groundY, w, hgt - groundY);
    ctx.fillStyle = '#5a4a3a';
    ctx.fillRect(0, groundY - 1, w, 3);
    // Dust.
    for (const d of dust) {
      d.y -= d.v * 0.016;
      if (d.y < 0.3) d.y = 0.75;
      ctx.fillStyle = `rgba(190, 170, 140, ${d.a})`;
      ctx.beginPath();
      ctx.arc(d.x * w, d.y * hgt, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  return {
    el: wrap,
    stop: () => {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}

export function menuScreen(app: App): ScreenInstance {
  const art = menuArt(app);
  const next = recommendedContract(app.save);
  const completed = app.save.completed.length;
  const el = h(
    'section',
    { class: 'screen menu' },
    art.el,
    h(
      'div',
      { class: 'menu-title' },
      h('h1', {}, 'DEMO ', h('span', { text: 'DAY' })),
      h('p', { text: 'You demolish buildings for money.' }),
    ),
    h(
      'div',
      { class: 'menu-stats' },
      h('div', {}, 'Balance ', h('b', { text: formatMoney(app.save.money) })),
      h('div', {}, 'Jobs ', h('b', { text: `${completed} / ${CONTRACTS.length}` })),
    ),
    h(
      'button',
      {
        class: 'btn btn-primary btn-block',
        onClick: () => {
          app.play('select');
          app.go('contract', { id: next.id });
        },
      },
      completed === 0 ? 'Start Demolition' : `Next Job · ${next.title}`,
    ),
    h(
      'div',
      { class: 'menu-grid' },
      h('button', { class: 'btn', onClick: () => { app.play('tap'); app.go('contracts'); } }, 'Contracts'),
      h('button', { class: 'btn', onClick: () => { app.play('tap'); app.go('equipment'); } }, 'Equipment'),
      h('button', { class: 'btn', onClick: () => { app.play('tap'); app.go('records'); } }, 'Records'),
      h('button', { class: 'btn', onClick: () => { app.play('tap'); app.go('settings'); } }, 'Settings'),
    ),
  );
  return { el, destroy: art.stop };
}
