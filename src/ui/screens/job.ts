import type { App, ScreenInstance } from '../../app';
import { hashString } from '../../core/rng';
import type { ChargeType, Direction, PlacedCharge } from '../../core/types';
import { getBuilding } from '../../data/buildings';
import { CHARGES, CHARGE_ORDER } from '../../data/charges';
import { CONTRACT_TYPE_LABEL, getContract } from '../../data/contracts';
import { effectiveLoadout, hasScanner, powerMultiplier } from '../../data/equipment';
import { MATERIALS } from '../../data/materials';
import { computePayout } from '../../game/payout';
import { Plan } from '../../game/placement';
import { previewCharge } from '../../game/preview';
import { applyRun } from '../../game/progression';
import { scoreRun } from '../../game/scoring';
import { CHAIN_WINDOW, STRAIN_LEAD, isNearPerfect, precomputeCollapse, type CollapseTimeline, type Failure } from '../../game/timeline';
import { Camera, type Bounds } from '../../render/camera';
import { paintChargeIcon } from '../../render/charges';
import { Effects } from '../../render/effects';
import { ARM_STAGGER, Renderer, type RemovedCharge, type SceneState } from '../../render/renderer';
import { Simulation, type SimEvent } from '../../sim/simulation';
import { buildBuilding, chargePoint, type Member } from '../../structure/building';
import { computeLoads } from '../../structure/support';
import { h, wait } from '../dom';
import { attachInput } from '../input';

type Phase = 'plan' | 'armed' | 'countdown' | 'collapse' | 'settled';

const DETONATION_PRIORITY: ChargeType[] = ['heavy', 'directional', 'shaped', 'small'];

const CAUSE_VERB: Record<Failure['cause'], string> = {
  blast: 'blasted',
  crush: 'crushed',
  drop: 'drops',
  topple: 'tips over',
  impact: 'smashed',
};

const KIND_LABEL: Record<Member['kind'], string> = {
  column: 'Column',
  beam: 'Beam',
  slab: 'Floor Slab',
  wall: 'Wall',
  core: 'Core',
  roof: 'Roof',
};

/**
 * The job screen: inspect the structure, place charges from a finite
 * loadout, arm the job, sit through the countdown and watch it come down.
 */
export function jobScreen(app: App, params: Record<string, string>): ScreenInstance {
  const contract = getContract(params.id ?? 'job01');
  const building = buildBuilding(getBuilding(contract.buildingId));
  const loadout = effectiveLoadout(contract.loadout, app.save.equipment);
  const plan = new Plan(building, loadout);
  const powerMul = powerMultiplier(app.save.equipment);
  const scannerOwned = hasScanner(app.save.equipment);

  let phase: Phase = 'plan';
  let selectedId: string | undefined;
  let chargeType: ChargeType = CHARGE_ORDER.find((t) => (loadout[t] ?? 0) > 0) ?? 'small';
  let direction: Direction = 'left';
  let scannerOn = scannerOwned;
  /** Full notes and support lists, off by default so the building keeps the screen. */
  let detailsOpen = false;
  let sim: Simulation | undefined;
  let disposed = false;
  let raf = 0;
  let lastFrame = performance.now();
  let simAccumulator = 0;
  let countdownSkip = false;
  const placedAt = new Map<string, number>();
  const removed: RemovedCharge[] = [];
  let armedAt: number | undefined;
  let burn = 0;
  let timeline: CollapseTimeline | undefined;
  const strain = new Map<string, number>();
  const crackPlayed = new Set<string>();
  const seenFailures = new Set<string>();
  const recentCascade: number[] = [];
  let chainLevel = 0;
  let lastLanding = -1;
  let totalMass = 0;
  for (const m of building.members.values()) totalMass += m.stats.mass;
  const clock = (): number => performance.now() / 1000;
  /** Replay mode: re-run the last armed plan at half speed, then return to the report. */
  const watching = params.watch === '1' && app.lastPlan?.contractId === contract.id && !!app.lastResult;
  const baseSpeed = watching ? 0.55 : 1;

  // Presentation clock: hit-stop and slow motion. The simulation still takes
  // identical fixed 1/60 s steps, so the outcome never changes; only how fast
  // those steps are shown.
  let slow: { start: number; hold: number; factor: number; dur: number; ramp: number } | undefined;
  let slowDips = 0;
  const slowMo = (hold: number, factor: number, dur: number, ramp: number): void => {
    if (app.reducedMotion) return;
    if (slow && timeScale() <= factor * baseSpeed) return;
    slow = { start: clock(), hold, factor, dur, ramp };
  };
  const timeScale = (): number => {
    if (!slow) return baseSpeed;
    const t = clock() - slow.start;
    if (t < slow.hold) return 0;
    const t2 = t - slow.hold;
    if (t2 < slow.dur) return baseSpeed * slow.factor;
    const k = (t2 - slow.dur) / slow.ramp;
    if (k >= 1) {
      slow = undefined;
      return baseSpeed;
    }
    return baseSpeed * (slow.factor + (1 - slow.factor) * k * k);
  };

  // ---------------------------------------------------------------- DOM
  const canvas = h('canvas', { 'aria-label': 'Building view. Tap a component to inspect it.', role: 'img' });
  const stage = h('div', { class: 'job-stage' }, canvas);
  const title = h('div', { class: 'title' }, h('h2', { text: contract.title }), h('div', { class: 'sub', text: `Job ${String(contract.jobNumber).padStart(2, '0')} · ${CONTRACT_TYPE_LABEL[contract.type]}` }));
  const backButton = h('button', { class: 'btn btn-icon', 'aria-label': 'Back to contract', onClick: () => { app.play('tap'); app.go('contract', { id: contract.id }); } }, '‹');
  const top = h('div', { class: 'job-top' }, backButton, title);

  const fitButton = h('button', { class: 'btn btn-icon', 'aria-label': 'Fit building in view', onClick: () => { app.play('tap'); fitBuilding(true); } }, '⤢');
  const scannerButton = h('button', { class: `btn btn-icon${scannerOn ? ' btn-primary' : ''}`, 'aria-label': 'Toggle structural scanner', onClick: () => { scannerOn = !scannerOn; scannerButton.classList.toggle('btn-primary', scannerOn); app.play('inspect'); } }, '⌗');
  const resetButton = h('button', { class: 'btn btn-icon', 'aria-label': 'Clear every charge', onClick: () => clearPlan() }, '↺');
  const fab = h('div', { class: 'job-fab' }, fitButton, scannerOwned ? scannerButton : null, resetButton);

  const info = h('div', { class: 'job-info' });
  const tray = h('div', { class: 'tray', role: 'group', 'aria-label': 'Demolition loadout' });
  const actions = h('div', { class: 'actions' });
  const sheet = h('div', { class: 'job-sheet' }, info, tray, actions);
  const overlay = h('div', { class: 'overlay', style: 'display:none' });
  const chain = h('div', { class: 'chain', 'aria-live': 'polite' });
  // Live destruction meter: the number climbs as the building comes down.
  const meterValue = h('b', { text: '0%' });
  const meter = h(
    'div',
    { class: 'meter', 'aria-live': 'off' },
    h('span', { class: 'k', text: 'Down' }),
    meterValue,
    h('small', { text: `Need ${Math.round(contract.requiredDestruction * 100)}%` }),
  );
  // Landed debris breaks up into a rubble heap (cosmetic): id -> effects-clock start time.
  const crumbleAt = new Map<string, number>();
  const crumble = new Map<string, number>();
  const CRUMBLE_TIME = 0.35;
  let meterShown = -1;
  let meterMet = false;
  let meterFrame = 0;
  const replayTag = h('div', { class: 'replay-tag', text: 'Replay · ½ speed' });
  const letterbox = h('div', { class: 'letterbox', 'aria-hidden': 'true' }, h('i'), h('i'));
  const el = h('section', { class: 'screen job' }, stage, chain, meter, letterbox, top, fab, sheet, overlay);
  if (watching) el.append(replayTag);

  // ------------------------------------------------------------ render
  const renderer = new Renderer(canvas);
  const camera = new Camera();
  const effects = new Effects();
  effects.reducedMotion = app.reducedMotion;

  const resize = (): void => {
    const w = stage.clientWidth || window.innerWidth;
    const hgt = stage.clientHeight || window.innerHeight;
    renderer.resize(w, hgt);
    camera.setViewport(w, hgt);
    const showtime = phase !== 'plan';
    camera.insetTop = showtime ? 44 : 62;
    camera.insetBottom = showtime ? 44 : Math.min(hgt * 0.5, sheet.offsetHeight || 260);
  };

  const sceneBounds = (): { minX: number; maxX: number; minY: number; maxY: number } => {
    const b = { ...building.bounds };
    b.minY = Math.min(b.minY, -1);
    return b;
  };

  const wideBounds = (): { minX: number; maxX: number; minY: number; maxY: number } => {
    const b = sceneBounds();
    const z = building.def.footprint;
    b.minX = Math.min(b.minX, z.x);
    b.maxX = Math.max(b.maxX, z.x + z.w);
    for (const n of building.def.neighbors ?? []) {
      b.minX = Math.min(b.minX, n.x);
      b.maxX = Math.max(b.maxX, n.x + n.w);
      b.maxY = Math.max(b.maxY, n.h);
    }
    b.maxY += 1;
    return b;
  };

  /** Building plus any neighbour close enough to matter, unless that makes the view too wide. */
  const inspectBounds = (): { minX: number; maxX: number; minY: number; maxY: number } => {
    const b = sceneBounds();
    const width = b.maxX - b.minX;
    const wide = { ...b };
    for (const n of building.def.neighbors ?? []) {
      const gap = Math.max(n.x - b.maxX, b.minX - (n.x + n.w));
      if (gap > 6) continue;
      wide.minX = Math.min(wide.minX, n.x);
      wide.maxX = Math.max(wide.maxX, n.x + n.w);
      wide.maxY = Math.max(wide.maxY, n.h);
    }
    return wide.maxX - wide.minX <= width * 2.4 ? wide : b;
  };

  /** Everything the collapse will touch: site, neighbours and the settled debris. */
  const showtimeBounds = (): Bounds => {
    const b = wideBounds();
    if (timeline) {
      const d = timeline.settledBounds;
      b.minX = Math.min(b.minX, d.minX - 1);
      b.maxX = Math.max(b.maxX, d.maxX + 1);
    }
    return b;
  };

  /**
   * Frames the whole site for the show. On a tall phone screen the fit is
   * limited by width, so sit the ground low and give the sky to the collapse.
   */
  const showtimeTarget = (): { x: number; y: number; scale: number } => {
    const b = showtimeBounds();
    const t = camera.fitTarget(b, 1.2);
    const halfH = Math.max(1, camera.viewportHeight - camera.insetTop - camera.insetBottom) / 2 / t.scale;
    // Centre high enough that the ground sits about three quarters down, never losing it off-screen.
    t.y = Math.max(t.y, Math.min(halfH * 0.5, halfH - 1.5));
    return t;
  };

  /** Keeps the member being inspected clear of the bottom sheet (which grows when something is selected). */
  const ensureVisible = (id: string): void => {
    const m = building.members.get(id);
    if (!m) return;
    const pt = chargePoint(m);
    const p = camera.worldToScreen(pt.x, pt.y);
    const visibleTop = camera.insetTop + 30;
    const visibleBottom = camera.viewportHeight - (sheet.offsetHeight || camera.insetBottom) - 30;
    if (p.y >= visibleTop && p.y <= visibleBottom) return;
    const target = (visibleTop + Math.max(visibleTop, visibleBottom)) / 2;
    camera.animateTo({ x: camera.x, y: camera.y - (p.y - target) / camera.scale, scale: camera.scale }, 300, performance.now());
  };

  const fitBuilding = (animate: boolean): void => {
    resize();
    if (animate) camera.animateFit(inspectBounds(), 1.4, 500, performance.now());
    else camera.fit(inspectBounds(), 1.4);
  };

  const loadRatios = (): Map<string, number> => {
    const loads = computeLoads(building, () => true);
    const out = new Map<string, number>();
    for (const [id, load] of loads) {
      const m = building.members.get(id) as Member;
      out.set(id, m.stats.capacity > 0 ? load / m.stats.capacity : 0);
    }
    return out;
  };
  const ratios = loadRatios();

  const frame = (now: number): void => {
    if (disposed) return;
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    camera.update(now);
    const scale = sim ? timeScale() : 1;
    if (sim && (phase === 'collapse' || phase === 'settled')) {
      simAccumulator += dt * scale;
      const events: SimEvent[] = [];
      while (simAccumulator >= 1 / 60 && !sim.done) {
        events.push(...sim.step(1 / 60));
        simAccumulator -= 1 / 60;
      }
      if (events.length) {
        effects.ingest(events);
        soundFor(events);
        readFailures(events);
      }
      updateStrain(sim.time);
      if (++meterFrame % 3 === 0 || sim.done) updateMeter();
      updateCrumble();
      if (sim.done && phase === 'collapse') {
        phase = 'settled';
        strain.clear();
        if (timeline) effects.settleHaze(timeline.settledBounds.minX, timeline.settledBounds.maxX);
        void finishJob();
      }
    }
    effects.update(dt * scale);
    camera.punch = app.reducedMotion ? 0 : effects.punch;
    if (!app.reducedMotion && effects.shake > 0) {
      const s = effects.shake * 9;
      camera.shakeX = (Math.random() - 0.5) * s;
      camera.shakeY = (Math.random() - 0.5) * s;
    } else {
      camera.shakeX = 0;
      camera.shakeY = 0;
    }
    const state: SceneState = {
      building,
      sim,
      charges: plan.charges,
      selectedId: phase === 'plan' ? selectedId : undefined,
      showAllLinks: phase === 'plan' && scannerOn,
      loadRatio: phase === 'plan' && scannerOn ? ratios : undefined,
      mode: sim ? 'sim' : 'plan',
      time: now / 1000,
      placedAt,
      removed,
      armedAt,
      burn,
      strain,
      crumble,
    };
    renderer.draw(state, camera, effects);
    raf = requestAnimationFrame(frame);
  };

  const soundFor = (events: SimEvent[]): void => {
    const detonations = events.filter((e) => e.type === 'detonate');
    if (detonations.length) {
      // Every charge fires on the same tick: one layered boom, voiced by the biggest charge.
      const types = new Set(detonations.map((e) => e.chargeType));
      const lead = DETONATION_PRIORITY.find((t) => types.has(t)) ?? 'small';
      app.play('detonate', Math.min(2, detonations.length / 2 + 0.5), lead);
      app.buzz(lead === 'heavy' ? [60, 30, 120] : [30, 20, 60]);
    }
    for (const e of events) {
      switch (e.type) {
        case 'break':
        case 'shatter':
          if (e.t > 0) app.play('crumble', e.strength);
          break;
        case 'crush':
          app.play('crumble', 1);
          break;
        case 'impact':
          if (!e.fragment && (e.mass ?? 0) >= totalMass * 0.14 && e.strength > 0.5 && sim && sim.time - lastLanding > 0.4) {
            // A big chunk of the building meeting the ground: the payoff hit.
            lastLanding = sim.time;
            effects.heavyLanding(e.x, e.y, e.material);
            app.play('heavyLanding');
            // Let the big hit breathe: a short slow-motion dip, at most twice per run.
            if (slowDips < 2) {
              slowDips++;
              slowMo(0.04, 0.35, 0.22, 0.4);
            }
            app.buzz([40, 20, 90]);
          } else {
            app.play('impact', e.strength);
            if (e.strength > 0.5) app.buzz(15);
          }
          break;
        case 'topple':
          app.play('topple');
          break;
        case 'settled':
          app.play('settle');
          break;
      }
    }
  };

  /**
   * Pieces that have come to rest low on the ground (not on the standing
   * structure, not on a neighbour's roof) crumble into the rubble heap a beat
   * after they land. What is still a clean block is what is still standing.
   */
  const updateCrumble = (): void => {
    if (!sim) return;
    const now = effects.now;
    for (const c of sim.chunks) {
      if (c.state === 'falling') {
        // Knocked loose again: bring it back as a block.
        if (crumbleAt.has(c.id)) {
          crumbleAt.delete(c.id);
          crumble.delete(c.id);
        }
        continue;
      }
      if (c.state !== 'resting') continue;
      const start = crumbleAt.get(c.id);
      if (start === undefined) {
        const onStructure = c.restingOn.some((r) => r !== 'ground' && sim?.chunkById.get(r)?.state === 'standing');
        if (onStructure) continue;
        // Debris on a neighbour's roof stays visible as blocks: that is the collateral.
        const cs = Math.abs(Math.cos(c.angle));
        const sn = Math.abs(Math.sin(c.angle));
        const bottom = c.cy - (c.w * sn + c.h * cs) / 2;
        const onNeighbor = bottom > 0.6 && (building.def.neighbors ?? []).some((n) => c.cx >= n.x && c.cx <= n.x + n.w && bottom >= n.h - 0.6);
        if (onNeighbor) continue;
        // Stagger by id so a heap breaks up piece by piece rather than all at once.
        const jitter = (hashString(c.id) % 100) / 100;
        crumbleAt.set(c.id, now + (c.isFragment ? 0.15 + jitter * 0.35 : 0.3 + jitter * 0.3));
        continue;
      }
      if (now < start) continue;
      const k = app.reducedMotion ? 1 : Math.min(1, (now - start) / CRUMBLE_TIME);
      if (!crumble.has(c.id)) {
        const cs = Math.abs(Math.cos(c.angle));
        const sn = Math.abs(Math.sin(c.angle));
        const halfW = (c.w * cs + c.h * sn) / 2;
        effects.crumble(c.cx - halfW, c.cx + halfW, c.w * c.h, c.material, c.cx, c.cy);
        if (!c.isFragment) app.play('crumble', Math.min(1, c.mass / 6 + 0.3));
      }
      crumble.set(c.id, k);
    }
  };

  const updateMeter = (): void => {
    if (!sim) return;
    let fraction: number;
    if (sim.done) {
      // Final number is the official one.
      const r = sim.result();
      fraction = r.targetMass > 0 ? r.removedMass / r.targetMass : 0;
    } else {
      // While it is coming down, count what has actually hit the ground (or been blown apart),
      // so the number climbs with the impacts instead of jumping the moment things start to fall.
      let down = 0;
      let total = 0;
      for (const id of building.order) {
        const m = building.members.get(id) as Member;
        if (m.protect) continue;
        total += m.stats.mass;
        const c = sim.chunkById.get(id);
        if (!c) continue;
        if (c.state === 'gone') down += m.stats.mass;
        else if (c.state === 'resting' && !c.restingOn.some((r) => r !== 'ground' && sim?.chunkById.get(r)?.state === 'standing')) down += m.stats.mass;
      }
      fraction = total > 0 ? down / total : 0;
    }
    const pct = Math.min(100, Math.floor(fraction * 100 + 1e-6));
    if (pct === meterShown) return;
    const up = pct > meterShown;
    meterShown = pct;
    meterValue.textContent = `${pct}%`;
    if (up && !app.reducedMotion) {
      meter.classList.remove('bump');
      void meter.offsetWidth;
      meter.classList.add('bump');
    }
    const met = pct / 100 + 1e-9 >= contract.requiredDestruction;
    if (met && !meterMet) {
      // Crossing the contract's bar is its own little win.
      meterMet = true;
      meter.classList.add('met');
      app.play('reveal');
      app.buzz(12);
    }
    meter.classList.toggle('full', pct >= 100);
  };

  /** Members about to fail shudder and crack a beat before they go. */
  const updateStrain = (t: number): void => {
    strain.clear();
    if (!timeline || phase !== 'collapse') return;
    for (const f of timeline.failures) {
      if (f.cause === 'blast') continue;
      const lead = f.t - t;
      if (lead <= 0 || lead > STRAIN_LEAD) continue;
      strain.set(f.memberId, 1 - lead / STRAIN_LEAD);
      if (lead < 0.14 && !crackPlayed.has(f.memberId)) {
        crackPlayed.add(f.memberId);
        app.play(f.major ? 'failMajor' : 'crack', f.major ? 1 : 0.6, f.material);
        if (f.major) app.buzz(12);
      }
    }
  };

  /** Turns failures in the event stream into load-transfer flashes, the chain readout and escalation. */
  const readFailures = (events: SimEvent[]): void => {
    if (!timeline || !sim) return;
    for (const e of events) {
      if (!e.memberId || e.fragment || seenFailures.has(e.memberId)) continue;
      const f = timeline.byMember.get(e.memberId);
      if (!f || Math.abs(f.t - e.t) > 1e-6) continue;
      seenFailures.add(f.memberId);
      // The load it carried has nowhere to go: light those members up.
      for (const id of f.carried) {
        if (sim.chunkById.get(id)?.state === 'standing') effects.markStress(id, 'load');
      }
      addChainLink(f);
      if (f.cause === 'blast') continue;
      recentCascade.push(f.t);
      while (recentCascade.length && f.t - (recentCascade[0] as number) > CHAIN_WINDOW) recentCascade.shift();
      const n = recentCascade.length;
      const level = n >= 8 ? 3 : n >= 5 ? 2 : n >= 3 ? 1 : 0;
      if (level > chainLevel) {
        // Things are going faster than planned: let the ground say so.
        chainLevel = level;
        if (level >= 2 && slowDips < 2) {
          slowDips++;
          slowMo(0, 0.5, 0.25, 0.35);
        }
        app.play('rumble', level / 3);
        effects.shake = Math.max(effects.shake, 0.5 + level * 0.25);
        addChainNote(`Chain reaction ×${n}`);
      }
    }
  };

  let lastLinkAt = -1;
  let lastLink: HTMLElement | undefined;
  let lastLinkExtra = 0;
  const addChainLink = (f: Failure): void => {
    const t = clock();
    if (lastLink && t - lastLinkAt < 0.18) {
      // Several at once read as one line, not a wall of text.
      lastLinkExtra++;
      const more = lastLink.querySelector('.more') ?? lastLink.appendChild(h('span', { class: 'more' }));
      more.textContent = ` +${lastLinkExtra}`;
      return;
    }
    lastLinkAt = t;
    lastLinkExtra = 0;
    lastLink = h('div', { class: `link ${f.cause}${f.major ? ' major' : ''}` }, h('b', { text: f.label }), ` ${CAUSE_VERB[f.cause]}`);
    chain.append(lastLink);
    while (chain.children.length > 5) chain.firstElementChild?.remove();
  };
  let chainNote: HTMLElement | undefined;
  const addChainNote = (text: string): void => {
    // One escalating note, not a stack of them.
    chainNote?.remove();
    chainNote = h('div', { class: 'link note', text });
    chain.append(chainNote);
    lastLink = undefined;
    while (chain.children.length > 5) chain.firstElementChild?.remove();
  };

  // ------------------------------------------------------------- sheet
  const renderTray = (): void => {
    tray.replaceChildren();
    for (const type of CHARGE_ORDER) {
      const def = CHARGES[type];
      const total = plan.available(type);
      const left = plan.remaining(type);
      const button = h(
        'button',
        {
          class: `charge${type === chargeType ? ' active' : ''}${left === 0 ? ' empty' : ''}${total === 0 ? ' hidden' : ''}`,
          style: `--c:${def.color}`,
          'aria-label': `${def.name}, ${left} of ${total} remaining`,
          'aria-pressed': String(type === chargeType),
          onClick: () => {
            chargeType = type;
            app.play('select');
            renderTray();
            renderInfo();
          },
        },
        h('canvas', { class: 'icon', 'aria-hidden': 'true' }),
        h('span', { class: 'n', text: `${left}` }),
        h('span', { class: 't', text: def.short }),
        h('i', { class: 'bar' }),
      );
      paintChargeIcon(button.querySelector('canvas') as HTMLCanvasElement, type, 26);
      tray.append(button);
    }
  };

  const renderInfo = (): void => {
    info.replaceChildren();
    actions.replaceChildren();
    const m = selectedId ? building.members.get(selectedId) : undefined;
    const def = CHARGES[chargeType];
    if (!m) {
      info.append(
        h('div', { class: 'name' }, 'Inspection', h('small', { text: `${plan.totalUsed()} / ${plan.totalAvailable()} charges · tap a component` })),
        h('div', { class: 'hint clamp', text: contract.hints[0] ?? '' }),
      );
    } else {
      const mat = MATERIALS[m.material];
      const label = (id: string): string => building.members.get(id)?.label ?? id;
      const carries = m.carries.map(label);
      const restsOn = m.grounded ? ['Ground'] : m.restsOn.map((l) => label(l.id));
      const anchors = m.anchors?.map(label) ?? [];
      const integrity = Math.max(0, 1 - (m.damage ?? 0));
      const ratio = ratios.get(m.id) ?? 0;
      const name = h('div', { class: 'name' }, h('span', { class: 'label', text: m.label ?? m.id }), h('small', { text: `${mat.name} ${KIND_LABEL[m.kind]}` }));
      if (m.protect) name.append(h('span', { class: 'pill ok', text: 'Protected' }));
      else if (carries.length > 0) name.append(h('span', { class: 'pill', text: `Carries ${carries.length}` }));
      const hasDetails = !!m.note || carries.length > 1 || restsOn.length > 1 || anchors.length > 0;
      if (hasDetails) {
        name.append(
          h(
            'button',
            {
              class: `details-toggle${detailsOpen ? ' on' : ''}`,
              'aria-expanded': String(detailsOpen),
              'aria-label': detailsOpen ? 'Hide details' : 'Show details',
              onClick: () => {
                detailsOpen = !detailsOpen;
                app.play('tap');
                renderInfo();
              },
            },
            detailsOpen ? 'Less' : 'More',
          ),
        );
      }
      info.append(name);
      // One line that always fits: what holds it up, what it holds, how sound it is.
      const summary = h('div', { class: 'summary' });
      const more = (list: string[]): string => (list.length > 1 ? `${list[0]} +${list.length - 1}` : list[0] ?? '');
      summary.append(anchors.length ? 'Fastened to ' : 'On ', h('b', { text: anchors.length ? more(anchors) : more(restsOn) || 'nothing' }));
      if (carries.length) summary.append(' · Carries ', h('b', { class: 'carry', text: more(carries) }));
      if (integrity < 0.95) summary.append(' · ', h('b', { class: integrity < 0.4 ? 'bad' : 'warn', text: `${Math.round(integrity * 100)}% sound` }));
      if (scannerOn && ratio > 0.55) summary.append(' · ', h('b', { class: 'carry', text: `Load ${Math.round(ratio * 100)}%` }));
      if (!(detailsOpen && hasDetails)) info.append(summary);
      if (detailsOpen && hasDetails) {
        const details = h('div', { class: 'details' });
        if (m.note) details.append(h('div', { class: 'note', text: m.note }));
        const links = h('div', { class: 'links' });
        links.append('Rests on ', h('b', { text: restsOn.join(', ') || 'nothing' }), '. ');
        if (anchors.length) links.append('Fastened to ', h('b', { text: anchors.join(', ') }), '. ');
        if (carries.length) links.append('Carries ', h('b', { class: 'carry', text: carries.join(', ') }), '.');
        details.append(links);
        info.append(details);
      }
      if (!m.protect) {
        const preview = previewCharge(building, plan.charges, chargeType, m.id, powerMul, direction);
        const cls = preview.warnings.length ? 'effect warn' : preview.target.destroyed ? 'effect good' : 'effect';
        const effect = h('div', { class: cls }, h('b', { text: `${def.short}: ` }), preview.summary);
        const splashDamaged = preview.splash.filter((s) => !s.destroyed && s.fraction >= 0.2);
        if (splashDamaged.length) effect.append(` Damages ${splashDamaged.map((s) => `${s.label} (${Math.round(s.fraction * 100)}%)`).join(', ')}.`);
        for (const w of preview.warnings) effect.append(h('div', { class: 'w', text: `⚠ ${w}` }));
        info.append(effect);
      } else {
        info.append(h('div', { class: 'effect warn', text: 'Must stay standing. No charges here.' }));
      }
    }

    // Actions.
    const onMember = m ? plan.chargesOn(m.id) : [];
    if (m && !m.protect) {
      if (def.directional) {
        const toggle = h(
          'div',
          { class: 'dir-toggle', role: 'group', 'aria-label': 'Push direction' },
          h('button', { class: `btn${direction === 'left' ? ' on' : ''}`, onClick: () => { direction = 'left'; app.play('tap'); renderInfo(); } }, '◀ Push Left'),
          h('button', { class: `btn${direction === 'right' ? ' on' : ''}`, onClick: () => { direction = 'right'; app.play('tap'); renderInfo(); } }, 'Push Right ▶'),
        );
        toggle.classList.add('wide');
        actions.append(toggle);
      }
      const canPlace = plan.remaining(chargeType) > 0;
      actions.append(
        h(
          'button',
          {
            class: 'btn btn-primary',
            disabled: !canPlace,
            onClick: () => placeCharge(chargeType, m.id),
          },
          canPlace ? `Place ${def.short}` : `No ${def.short} left`,
        ),
        h(
          'button',
          {
            class: 'btn',
            disabled: onMember.length === 0,
            onClick: () => removeCharge(m.id),
          },
          onMember.length > 1 ? `Remove (${onMember.length})` : 'Remove',
        ),
      );
    }
    const armButton = h(
      'button',
      {
        class: 'btn btn-danger wide',
        disabled: plan.totalUsed() === 0,
        onClick: () => void arm(),
      },
      plan.totalUsed() === 0 ? 'Place a charge to arm' : `Arm · ${plan.totalUsed()} charge${plan.totalUsed() === 1 ? '' : 's'} · Demo Day`,
    );
    actions.append(armButton);
    resetButton.style.display = plan.totalUsed() > 0 && phase === 'plan' ? '' : 'none';
    resize();
  };

  const placeCharge = (type: ChargeType, memberId: string): void => {
    const result = plan.place(type, memberId, direction);
    if (!result.ok) {
      app.play('error');
      app.toast(result.reason, true, el);
      return;
    }
    placedAt.set(result.charge.id, clock());
    app.play('place', 1, type);
    window.setTimeout(() => {
      if (!disposed) app.play('lock');
    }, 150);
    app.buzz([12, 40, 18]);
    renderTray();
    renderInfo();
  };

  const ghost = (c: PlacedCharge): void => {
    const m = building.members.get(c.memberId);
    if (!m) return;
    const pt = chargePoint(m);
    removed.push({ type: c.type, direction: c.direction, x: pt.x, y: pt.y, at: clock() });
    while (removed.length > 8) removed.shift();
  };

  const removeCharge = (memberId: string): void => {
    const on = plan.chargesOn(memberId);
    const last = on[on.length - 1];
    if (!last || !plan.remove(last.id)) return;
    ghost(last);
    placedAt.delete(last.id);
    app.play('remove');
    app.buzz(8);
    renderTray();
    renderInfo();
  };

  const clearPlan = (): void => {
    if (phase !== 'plan' || plan.totalUsed() === 0) return;
    for (const c of plan.charges) ghost(c);
    plan.clear();
    placedAt.clear();
    app.play('remove');
    app.buzz(10);
    renderTray();
    renderInfo();
  };

  // ------------------------------------------------------------- input
  const detachInput = attachInput(canvas, {
    onTap: (x, y) => {
      if (phase !== 'plan') return;
      const id = renderer.hitTest(building, camera, x, y);
      if (id && id !== selectedId) {
        selectedId = id;
        app.play('inspect');
      } else if (!id) {
        selectedId = undefined;
        app.play('tap');
      }
      renderInfo();
      if (selectedId) ensureVisible(selectedId);
    },
    onPan: (dx, dy) => camera.panBy(dx, dy),
    onZoom: (x, y, f) => camera.zoomAt(x, y, f),
  });

  // ---------------------------------------------------------- demo day
  const showOverlay = (...children: HTMLElement[]): void => {
    overlay.replaceChildren(...children);
    overlay.style.display = '';
  };

  const arm = async (): Promise<void> => {
    if (phase !== 'plan' || plan.totalUsed() === 0) return;
    phase = 'armed';
    plan.lock();
    selectedId = undefined;
    app.lastPlan = { contractId: contract.id, charges: plan.charges.map((c) => ({ ...c })) };
    // Same plan, same seed, same outcome: know the collapse before it happens.
    timeline = precomputeCollapse(building, plan.charges, { powerMultiplier: powerMul }).timeline;
    const quick = app.reducedMotion;
    const count = plan.totalUsed();

    // 1. Charges go live one after another; the planning UI gets out of the way.
    armedAt = clock();
    el.classList.add('showtime');
    app.play('arm');
    app.buzz([20, 40, 20, 40, 60]);
    for (let i = 0; i < count; i++) {
      window.setTimeout(() => {
        if (disposed) return;
        app.play('armClick', count > 1 ? i / (count - 1) : 1);
        app.buzz(8);
      }, 120 + i * ARM_STAGGER * 1000);
    }
    window.setTimeout(() => {
      if (disposed) return;
      app.play('fuse');
      app.play('warning');
    }, 160 + count * ARM_STAGGER * 1000);
    // 2. Pull back to show the whole site, including where the debris will go.
    resize();
    camera.animateTo(showtimeTarget(), quick ? 300 : 1200, performance.now());

    // 3. The "this is happening" beat.
    overlay.classList.add('clear');
    showOverlay(h('div', { class: 'big', text: 'Everything is set.' }));
    await wait(quick ? 400 : 1200);
    if (disposed) return;
    showOverlay(h('div', { class: 'big accent', text: 'Welcome to Demo Day.' }), h('div', { class: 'sub', text: 'Get clear.' }));
    await wait(quick ? 400 : 1400);
    if (disposed) return;

    // 4. Countdown: fuses burn down, lights race, the pulse climbs.
    phase = 'countdown';
    overlay.style.pointerEvents = 'auto';
    const skipHandler = (): void => {
      countdownSkip = true;
    };
    overlay.addEventListener('pointerdown', skipHandler);
    const from = quick ? 3 : 5;
    let n = from;
    while (n >= 1) {
      if (disposed) return;
      const tension = (from - n) / from;
      burn = tension;
      el.style.setProperty('--tension', tension.toFixed(2));
      showOverlay(
        h('div', { class: 'count', text: String(n) }),
        h('div', { class: 'sub', text: n > 3 ? 'Tap to skip ahead' : n === 1 ? 'Brace' : 'Get clear' }),
      );
      app.play(n <= 3 ? 'tickFinal' : 'tick', tension);
      app.play('heartbeat', tension);
      app.buzz(n <= 3 ? 30 : 10);
      await wait(quick ? 300 : n <= 3 ? 720 : 620);
      if (countdownSkip && n > 3) {
        n = 3;
        countdownSkip = false;
        continue;
      }
      n--;
    }
    overlay.removeEventListener('pointerdown', skipHandler);
    if (disposed) return;
    // 5. A breath of silence, then everything at once.
    burn = 1;
    el.classList.add('hold');
    overlay.style.display = 'none';
    await wait(quick ? 80 : 320);
    if (disposed) return;
    el.classList.remove('hold');
    detonate();
  };

  const detonate = (): void => {
    phase = 'collapse';
    armedAt = undefined;
    el.style.setProperty('--tension', '0');
    sim = new Simulation(building, plan.charges, { powerMultiplier: powerMul });
    effects.initRubble(sim.groundMinX, (sim.groundMaxX - sim.groundMinX) / (sim.heightmap.length - 1 || 1), sim.heightmap.length);
    simAccumulator = 0;
    effects.now = 0;
    el.classList.add('live');
    // Hit-stop on the flash, then the first beat of the blast in slow motion.
    slowMo(0.08, 0.3, 0.42, 0.55);
    if (!app.reducedMotion) {
      const heavy = plan.charges.some((c) => c.type === 'heavy');
      const flash = h('div', { class: `flash${heavy ? ' big' : ''}` });
      el.append(flash);
      window.setTimeout(() => flash.remove(), 700);
    }
  };

  const finishJob = async (): Promise<void> => {
    if (!sim) return;
    if (watching) {
      // A replay never scores or pays twice.
      await wait(app.reducedMotion ? 300 : 1600);
      if (!disposed) app.go('report', { instant: '1' });
      return;
    }
    const result = sim.result();
    const report = scoreRun(result, contract, plan.totalUsed(), plan.totalAvailable());
    const payout = computePayout(report, contract);
    const outcome = applyRun(app.save, contract, report, payout);
    app.persist();
    app.lastResult = { contract, building, simResult: result, report, payout, outcome };
    const quick = app.reducedMotion;
    // Let the dust hang in near silence, drifting in slightly.
    if (!quick) camera.animateTo({ x: camera.x, y: camera.y, scale: camera.scale * 1.04 }, 3200, performance.now());
    await wait(quick ? 150 : 850);
    if (disposed) return;
    const clean = report.success && isNearPerfect(report.removed, report.efficiency);
    overlay.classList.add('clear');
    overlay.style.pointerEvents = 'auto';
    showOverlay(
      h('div', { class: `settled${clean ? ' clean' : ''}`, text: 'Settled' }),
      h('div', { class: `sub${report.success ? '' : ' fail'}`, text: report.success ? 'Demolition complete' : 'Contract incomplete' }),
    );
    app.play('settled');
    let leave = false;
    overlay.addEventListener('pointerdown', () => {
      leave = true;
    }, { once: true });
    const linger = quick ? 600 : 1700;
    const start = performance.now();
    while (!leave && performance.now() - start < linger) {
      await wait(50);
      if (disposed) return;
    }
    if (disposed) return;
    app.go('report');
  };

  /** Replay: straight to showtime with the last plan, no planning, no countdown. */
  const startWatch = async (): Promise<void> => {
    phase = 'armed';
    plan.lock();
    timeline = precomputeCollapse(building, plan.charges, { powerMultiplier: powerMul }).timeline;
    el.classList.add('showtime');
    resize();
    const t = showtimeTarget();
    camera.x = t.x;
    camera.y = t.y;
    camera.scale = t.scale;
    armedAt = clock();
    const leave = (): void => {
      if (!disposed) app.go('report', { instant: '1' });
    };
    el.addEventListener('pointerdown', leave, { once: true });
    await wait(900);
    if (disposed) return;
    burn = 1;
    app.play('fuse');
    await wait(350);
    if (disposed) return;
    detonate();
  };

  // ------------------------------------------------------------ mount
  if (params.watch === '1' && !watching) {
    window.setTimeout(() => app.go('report'), 0);
  }
  if (watching && app.lastPlan) {
    for (const c of app.lastPlan.charges) plan.place(c.type, c.memberId, c.direction);
  }
  if (params.replay === '1' && app.lastPlan?.contractId === contract.id) {
    // Run it again: start from the last plan so one change is one tap away.
    const t0 = clock() + 0.35;
    app.lastPlan.charges.forEach((c, i) => {
      const r = plan.place(c.type, c.memberId, c.direction);
      if (r.ok) placedAt.set(r.charge.id, t0 + i * 0.07);
    });
    if (plan.totalUsed() > 0) {
      window.setTimeout(() => {
        if (!disposed) app.toast('Last plan loaded · tweak it or ↺ clear', false, el);
      }, 300);
    }
  }
  renderTray();
  renderInfo();
  const onResize = (): void => {
    resize();
  };
  window.addEventListener('resize', onResize);
  requestAnimationFrame(() => {
    fitBuilding(false);
    raf = requestAnimationFrame(frame);
    if (watching) void startWatch();
  });

  const debugHooks = {
    place: (type: ChargeType, memberId: string, dir?: Direction): boolean => {
      if (dir) direction = dir;
      const r = plan.place(type, memberId, dir);
      if (r.ok) placedAt.set(r.charge.id, clock());
      renderTray();
      renderInfo();
      return r.ok;
    },
    select: (memberId: string): void => {
      selectedId = memberId;
      renderInfo();
      ensureVisible(memberId);
    },
    arm: (): void => void arm(),
    skip: (): void => {
      countdownSkip = true;
    },
    phase: (): Phase => phase,
    plan,
  };
  (window as unknown as { __demoDayJob?: typeof debugHooks }).__demoDayJob = debugHooks;

  return {
    el,
    destroy: () => {
      disposed = true;
      cancelAnimationFrame(raf);
      detachInput();
      window.removeEventListener('resize', onResize);
      delete (window as unknown as { __demoDayJob?: unknown }).__demoDayJob;
    },
  };
}
