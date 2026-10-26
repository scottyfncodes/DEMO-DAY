import type { App, ScreenInstance } from '../../app';
import { formatMoney } from '../../core/format';
import type { ContractDef } from '../../core/types';
import { CONTRACTS } from '../../data/contracts';
import { isUnlocked, recommendedContract } from '../../game/progression';
import { Camera } from '../../render/camera';
import { WreckFx } from '../../wreck/fx';
import { WreckRenderer } from '../../wreck/render';
import { DT, WreckSim, craneHook } from '../../wreck/sim';
import { h } from '../dom';

const ICONS = {
  contracts:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2.5h6v3H9z"/><path d="M9 11h6M9 15h4"/></svg>',
  equipment:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8V5h6v3M3 13h18"/></svg>',
  records:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6"/></svg>',
  settings:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h10M18 7h2M4 12h3M11 12h9M4 17h12"/><circle cx="16" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="18" cy="17" r="2"/></svg>',
};

/**
 * The hero: the Halden Exchange and the crane, drawn by the game's own
 * renderer from a live simulation. The ball sways on its cable, short of the
 * building; nothing is canned. With reduced motion it holds still.
 */
function heroScene(app: App): { el: HTMLElement; stop: () => void } {
  const canvas = h('canvas');
  const wrap = h('div', { class: 'menu-hero', 'aria-hidden': 'true' }, canvas);
  const renderer = new WreckRenderer(canvas);
  const camera = new Camera();
  camera.minScale = 1;
  const fx = new WreckFx();
  const sim = new WreckSim();
  // Pull the ball out a little and let it go: it swings in front of the tower without reaching it.
  const hook = craneHook(sim.state.crane);
  sim.aim(hook.x - 7, hook.y - 15);
  sim.release();
  let raf = 0;
  let running = true;
  let last = performance.now();
  let acc = 0;

  const resize = (): void => {
    const w = Math.floor(wrap.clientWidth);
    const hh = Math.floor(wrap.clientHeight);
    if (w === renderer.width && hh === renderer.height) return;
    renderer.resize(w, hh);
    camera.setViewport(w, hh);
    camera.insetTop = 8;
    camera.insetBottom = 30;
    camera.fit({ minX: -4, maxX: 50, minY: 0, maxY: 66 }, 1);
  };

  const draw = (now: number): void => {
    renderer.draw(sim, camera, fx, { time: now / 1000, stressView: false, handles: false });
  };

  const frame = (now: number): void => {
    if (!running) return;
    resize();
    acc += Math.min(0.05, (now - last) / 1000);
    last = now;
    while (acc >= DT) {
      sim.step();
      acc -= DT;
    }
    draw(now);
    raf = requestAnimationFrame(frame);
  };

  const still = (): void => {
    if (!running) return;
    resize();
    draw(0);
  };

  if (app.reducedMotion) {
    raf = requestAnimationFrame(still);
    window.addEventListener('resize', still);
  } else raf = requestAnimationFrame(frame);
  return {
    el: wrap,
    stop: () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', still);
    },
  };
}

/** One pip per contract: done, next up, unlocked or still locked. */
function jobPips(app: App, next: ContractDef): HTMLElement {
  return h(
    'span',
    { class: 'menu-pips', 'aria-hidden': 'true' },
    ...CONTRACTS.map((c) => {
      const cls = app.save.completed.includes(c.id) ? 'done' : c.id === next.id ? 'next' : isUnlocked(c, app.save) ? 'open' : undefined;
      return h('i', { class: cls });
    }),
  );
}

function navButton(app: App, label: string, icon: keyof typeof ICONS, go: () => void): HTMLElement {
  return h(
    'button',
    {
      class: 'menu-nav-btn',
      onClick: () => {
        app.play('tap');
        go();
      },
    },
    h('span', { class: 'ico', html: ICONS[icon] }),
    h('span', { text: label }),
  );
}

export function menuScreen(app: App): ScreenInstance {
  const next = recommendedContract(app.save);
  const hero = heroScene(app);
  const completed = app.save.completed.length;
  // All-zero stats say nothing to a new player; they appear once there is something to show.
  const returning = completed > 0 || app.save.money > 0 || Object.keys(app.save.records).length > 0;
  const el = h(
    'section',
    { class: 'screen menu' },
    hero.el,
    h(
      'div',
      { class: 'menu-body' },
      h(
        'div',
        { class: 'menu-title' },
        h('h1', {}, 'DEMO ', h('span', { text: 'DAY' })),
        h('p', { text: 'One crane. One ball. Fifteen storeys.' }),
      ),
      returning
        ? h(
            'div',
            { class: 'menu-stats' },
            h('div', {}, 'Balance ', h('b', { text: formatMoney(app.save.money) })),
            h('div', {}, 'Jobs ', h('b', { text: `${completed} / ${CONTRACTS.length}` }), jobPips(app, next)),
          )
        : null,
      h(
        'button',
        {
          class: 'btn btn-primary btn-block menu-cta',
          onClick: () => {
            app.play('select');
            app.go('wreck');
          },
        },
        h('span', { class: 'menu-cta-next' }, 'Swing', h('small', { text: 'The Halden Exchange' })),
      ),
      h(
        'nav',
        { class: 'menu-nav', 'aria-label': 'More' },
        navButton(app, 'Contracts', 'contracts', () => app.go('contracts')),
        navButton(app, 'Equipment', 'equipment', () => app.go('equipment')),
        navButton(app, 'Records', 'records', () => app.go('records')),
        navButton(app, 'Settings', 'settings', () => app.go('settings')),
      ),
    ),
  );
  return { el, destroy: hero.stop };
}
