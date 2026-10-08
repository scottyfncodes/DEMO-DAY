import type { App, ScreenInstance } from '../../app';
import { formatMoney } from '../../core/format';
import { hashString } from '../../core/rng';
import type { ContractDef } from '../../core/types';
import { getBuilding } from '../../data/buildings';
import { CONTRACTS } from '../../data/contracts';
import { showcasePlan } from '../../data/showcase';
import { isUnlocked, recommendedContract } from '../../game/progression';
import { STRAIN_LEAD, precomputeCollapse } from '../../game/timeline';
import { Camera } from '../../render/camera';
import { Effects } from '../../render/effects';
import { Renderer, type SceneState } from '../../render/renderer';
import { Simulation, type SimEvent } from '../../sim/simulation';
import { getSite } from '../../data/sites';
import { buildBuilding } from '../../structure/building';
import { generateWorld } from '../../world/world';
import { h } from '../dom';

type HeroPhase = 'armed' | 'collapse' | 'settled' | 'reset';

/** How long the charges blink before they go, how long the dust hangs, and the fade back to standing. */
const ARMED_TIME = 2.4;
const SETTLED_TIME = 2.2;
const RESET_TIME = 0.9;
const CRUMBLE_TIME = 0.35;

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
 * The hero: the next job's building, drawn by the game's own renderer, with
 * a showcase plan's charges blinking on it. Every few seconds it comes down
 * for real (the same simulation a job runs), settles into dust and stands
 * back up. With reduced motion it holds the armed frame instead.
 */
function heroScene(app: App, contract: ContractDef): { el: HTMLElement; stop: () => void } {
  const canvas = h('canvas');
  const wrap = h('div', { class: 'menu-hero', 'aria-hidden': 'true' }, canvas);
  const building = buildBuilding(getBuilding(contract.buildingId));
  const charges = showcasePlan(contract.buildingId);
  const world = generateWorld(building.def, getSite(contract.buildingId));
  const renderer = new Renderer(canvas);
  const camera = new Camera();
  const effects = new Effects();
  effects.reducedMotion = app.reducedMotion;
  const timeline = precomputeCollapse(building, charges).timeline;

  let phase: HeroPhase = 'armed';
  let phaseStart = 0;
  let sim: Simulation | undefined;
  let simAccumulator = 0;
  let armedAt = 0;
  let burn = 0;
  let raf = 0;
  let running = true;
  let lastFrame = performance.now();
  const strain = new Map<string, number>();
  const crumbleAt = new Map<string, number>();
  const crumble = new Map<string, number>();
  const clock = (): number => performance.now() / 1000;

  /**
   * Frames the building itself, big, with room above for the collapse and
   * the ground sitting low in the frame. Debris and neighbours may run off
   * the edges; the building is the subject.
   */
  const frameSite = (): void => {
    const b = building.bounds;
    const w = camera.viewportWidth;
    const hgt = camera.viewportHeight;
    // The building is the subject, but leave room for the street and the lots either side.
    const byWidth = w / (b.maxX - b.minX + 9);
    const byHeight = (hgt * 0.55) / (b.maxY - b.minY + 0.6);
    camera.scale = Math.min(byWidth, byHeight, 60);
    camera.x = (b.minX + b.maxX) / 2;
    // Ground line at 82% of the hero's height.
    const centreY = camera.insetTop + (hgt - camera.insetTop - camera.insetBottom) / 2;
    camera.y = (hgt * 0.82 - centreY) / camera.scale;
  };

  const resize = (): boolean => {
    const w = Math.floor(wrap.clientWidth);
    const hgt = Math.floor(wrap.clientHeight);
    if (w === renderer.width && hgt === renderer.height) return false;
    renderer.resize(w, hgt);
    camera.setViewport(w, hgt);
    camera.insetTop = 8;
    camera.insetBottom = 24;
    frameSite();
    return true;
  };

  /** Back to a standing building with nothing on the ground. */
  const rebuild = (): void => {
    sim = undefined;
    simAccumulator = 0;
    burn = 0;
    strain.clear();
    crumbleAt.clear();
    crumble.clear();
    effects.clear();
    effects.rubble = undefined;
  };

  const arm = (): void => {
    phase = 'armed';
    phaseStart = clock();
    armedAt = phaseStart + 0.25;
  };

  const detonate = (): void => {
    phase = 'collapse';
    phaseStart = clock();
    burn = 1;
    sim = new Simulation(building, charges.map((c) => ({ ...c })));
    effects.initRubble(sim.groundMinX, (sim.groundMaxX - sim.groundMinX) / (sim.heightmap.length - 1 || 1), sim.heightmap.length);
    effects.now = 0;
    simAccumulator = 0;
  };

  /** Members about to fail shudder and crack a beat before they go. */
  const updateStrain = (t: number): void => {
    strain.clear();
    for (const f of timeline.failures) {
      if (f.cause === 'blast') continue;
      const lead = f.t - t;
      if (lead <= 0 || lead > STRAIN_LEAD) continue;
      strain.set(f.memberId, 1 - lead / STRAIN_LEAD);
    }
  };

  /** Pieces resting on the ground break up into the rubble heap a beat after they land. */
  const updateCrumble = (): void => {
    if (!sim) return;
    const now = effects.now;
    for (const c of sim.chunks) {
      if (c.state === 'falling') {
        crumbleAt.delete(c.id);
        crumble.delete(c.id);
        continue;
      }
      if (c.state !== 'resting') continue;
      const start = crumbleAt.get(c.id);
      if (start === undefined) {
        const onStructure = c.restingOn.some((r) => r !== 'ground' && sim?.chunkById.get(r)?.state === 'standing');
        if (onStructure) continue;
        const jitter = (hashString(c.id) % 100) / 100;
        crumbleAt.set(c.id, now + (c.isFragment ? 0.15 + jitter * 0.35 : 0.3 + jitter * 0.3));
        continue;
      }
      if (now < start) continue;
      if (!crumble.has(c.id)) {
        const cs = Math.abs(Math.cos(c.angle));
        const sn = Math.abs(Math.sin(c.angle));
        const halfW = (c.w * cs + c.h * sn) / 2;
        effects.crumble(c.cx - halfW, c.cx + halfW, c.w * c.h, c.material, c.cx, c.cy);
      }
      crumble.set(c.id, Math.min(1, (now - start) / CRUMBLE_TIME));
    }
  };

  const draw = (now: number): void => {
    const state: SceneState = {
      building,
      sim,
      charges,
      showAllLinks: false,
      mode: sim ? 'sim' : 'plan',
      time: now / 1000,
      armedAt: sim ? undefined : armedAt,
      burn,
      strain,
      crumble,
      world,
    };
    renderer.draw(state, camera, effects);
  };

  const frame = (now: number): void => {
    if (!running) return;
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    resize();
    const t = clock();
    const age = t - phaseStart;
    switch (phase) {
      case 'armed':
        // Fuses burn down, lights race, then everything goes at once.
        burn = Math.min(1, Math.max(0, (age - 0.5) / (ARMED_TIME - 0.5)));
        if (age >= ARMED_TIME) detonate();
        break;
      case 'collapse':
      case 'settled': {
        const s = sim as Simulation;
        simAccumulator += dt;
        const events: SimEvent[] = [];
        while (simAccumulator >= 1 / 60 && !s.done) {
          events.push(...s.step(1 / 60));
          simAccumulator -= 1 / 60;
        }
        if (events.length) effects.ingest(events);
        if (phase === 'collapse') updateStrain(s.time);
        updateCrumble();
        if (s.done && phase === 'collapse') {
          phase = 'settled';
          phaseStart = t;
          strain.clear();
          effects.settleHaze(timeline.settledBounds.minX, timeline.settledBounds.maxX);
        } else if (phase === 'settled' && age >= SETTLED_TIME) {
          phase = 'reset';
          phaseStart = t;
        }
        break;
      }
      case 'reset': {
        // Dip to dark on the rubble, stand the building back up, come back in.
        const k = Math.min(1, age / RESET_TIME);
        if (k >= 0.5 && sim) rebuild();
        wrap.style.setProperty('--fade', (1 - Math.abs(k * 2 - 1)).toFixed(3));
        if (k >= 1) {
          wrap.style.removeProperty('--fade');
          arm();
        }
        break;
      }
    }
    effects.update(dt);
    camera.punch = effects.punch;
    if (effects.shake > 0) {
      const s = effects.shake * 9;
      camera.shakeX = (Math.random() - 0.5) * s;
      camera.shakeY = (Math.random() - 0.5) * s;
    } else {
      camera.shakeX = 0;
      camera.shakeY = 0;
    }
    draw(now);
    raf = requestAnimationFrame(frame);
  };

  /** Reduced motion: one still of the armed building, redrawn only when the size changes. */
  const still = (): void => {
    if (!running) return;
    if (resize()) {
      armedAt = -10;
      burn = 0.4;
      draw(0);
    }
    raf = requestAnimationFrame(still);
  };

  arm();
  raf = requestAnimationFrame(app.reducedMotion ? still : frame);
  return {
    el: wrap,
    stop: () => {
      running = false;
      cancelAnimationFrame(raf);
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
  const hero = heroScene(app, next);
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
        h('p', { text: 'You demolish buildings for money.' }),
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
          'aria-label': completed === 0 ? undefined : `Next Job · ${next.title}`,
          onClick: () => {
            app.play('select');
            app.go('contract', { id: next.id });
          },
        },
        completed === 0 ? 'Start Demolition' : h('span', { class: 'menu-cta-next' }, 'Next Job', h('small', { text: next.title })),
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
