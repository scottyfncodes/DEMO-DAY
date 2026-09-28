import type { App, ScreenInstance } from '../../app';
import type { ChargeType, Direction } from '../../core/types';
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
import { Camera } from '../../render/camera';
import { Effects } from '../../render/effects';
import { Renderer, type SceneState } from '../../render/renderer';
import { Simulation, type SimEvent } from '../../sim/simulation';
import { buildBuilding, type Member } from '../../structure/building';
import { computeLoads } from '../../structure/support';
import { h, wait } from '../dom';
import { attachInput } from '../input';

type Phase = 'plan' | 'armed' | 'countdown' | 'collapse' | 'settled';

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
  let sim: Simulation | undefined;
  let disposed = false;
  let raf = 0;
  let lastFrame = performance.now();
  let simAccumulator = 0;
  let countdownSkip = false;
  let settledAt = 0;

  // ---------------------------------------------------------------- DOM
  const canvas = h('canvas', { 'aria-label': 'Building view. Tap a component to inspect it.', role: 'img' });
  const stage = h('div', { class: 'job-stage' }, canvas);
  const title = h('div', { class: 'title' }, h('h2', { text: contract.title }), h('div', { class: 'sub', text: `Job ${String(contract.jobNumber).padStart(2, '0')} · ${CONTRACT_TYPE_LABEL[contract.type]}` }));
  const phasePill = h('span', { class: 'pill', text: 'Inspection' });
  const backButton = h('button', { class: 'btn btn-icon', 'aria-label': 'Back to contract', onClick: () => { app.play('tap'); app.go('contract', { id: contract.id }); } }, '‹');
  const top = h('div', { class: 'job-top' }, backButton, title, phasePill);

  const fitButton = h('button', { class: 'btn btn-icon', 'aria-label': 'Fit building in view', onClick: () => { app.play('tap'); fitBuilding(true); } }, '⤢');
  const scannerButton = h('button', { class: `btn btn-icon${scannerOn ? ' btn-primary' : ''}`, 'aria-label': 'Toggle structural scanner', onClick: () => { scannerOn = !scannerOn; scannerButton.classList.toggle('btn-primary', scannerOn); app.play('inspect'); } }, '⌗');
  const fab = h('div', { class: 'job-fab' }, fitButton, scannerOwned ? scannerButton : null);

  const info = h('div', { class: 'job-info' });
  const tray = h('div', { class: 'tray', role: 'group', 'aria-label': 'Demolition loadout' });
  const actions = h('div', { class: 'actions' });
  const sheet = h('div', { class: 'job-sheet' }, info, tray, actions);
  const overlay = h('div', { class: 'overlay', style: 'display:none' });
  const el = h('section', { class: 'screen job' }, stage, top, fab, sheet, overlay);

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
    camera.insetTop = 70;
    camera.insetBottom = phase === 'plan' ? Math.min(hgt * 0.5, sheet.offsetHeight || 260) : 40;
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
    if (sim && (phase === 'collapse' || phase === 'settled')) {
      simAccumulator += dt;
      const events: SimEvent[] = [];
      while (simAccumulator >= 1 / 60 && !sim.done) {
        events.push(...sim.step(1 / 60));
        simAccumulator -= 1 / 60;
      }
      if (events.length) {
        effects.ingest(events);
        soundFor(events);
      }
      if (sim.done && phase === 'collapse') {
        phase = 'settled';
        settledAt = now;
        void finishJob();
      }
    }
    effects.update(dt);
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
    };
    renderer.draw(state, camera, effects);
    raf = requestAnimationFrame(frame);
  };

  const soundFor = (events: SimEvent[]): void => {
    for (const e of events) {
      switch (e.type) {
        case 'detonate':
          app.play('detonate', e.strength);
          app.buzz([30, 20, 60]);
          break;
        case 'break':
        case 'shatter':
          app.play('crumble', e.strength);
          break;
        case 'crush':
          app.play('crumble', 1);
          break;
        case 'impact':
          app.play('impact', e.strength);
          if (e.strength > 0.5) app.buzz(15);
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
        h('span', { class: 'n', text: `${left}` }),
        h('span', { class: 't', text: def.short }),
        h('i', { class: 'bar' }),
      );
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
        h('div', { class: 'name' }, 'Inspection', h('small', { text: `${plan.totalUsed()} / ${plan.totalAvailable()} charges placed` })),
        h('div', { class: 'note', text: 'Tap a component to see what it carries and what holds it up. Select a charge, then place it.' }),
        h('div', { class: 'hint', text: contract.hints[0] ?? '' }),
      );
    } else {
      const mat = MATERIALS[m.material];
      const carries = m.carries.map((id) => building.members.get(id)?.label ?? id);
      const restsOn = m.grounded ? ['Ground'] : m.restsOn.map((l) => building.members.get(l.id)?.label ?? l.id);
      const anchors = m.anchors?.map((id) => building.members.get(id)?.label ?? id) ?? [];
      const integrity = Math.max(0, 1 - (m.damage ?? 0));
      const ratio = ratios.get(m.id) ?? 0;
      const name = h('div', { class: 'name' }, m.label ?? m.id, h('small', { text: `${mat.name} ${KIND_LABEL[m.kind]}` }));
      if (m.protect) name.append(h('span', { class: 'pill ok', text: 'Protected' }));
      else if (carries.length > 0) name.append(h('span', { class: 'pill', text: `Carries ${carries.length}` }));
      info.append(name);
      const bar = h('div', { class: 'integrity', 'aria-label': `Integrity ${Math.round(integrity * 100)}%` }, h('i', { class: integrity < 0.4 ? 'bad' : integrity < 0.8 ? 'warn' : '', style: `width:${Math.round(integrity * 100)}%` }));
      info.append(bar);
      if (m.note) info.append(h('div', { class: 'note', text: m.note }));
      const links = h('div', { class: 'links' });
      links.append('Rests on ', h('b', { text: restsOn.join(', ') || 'nothing' }), '. ');
      if (anchors.length) links.append('Fastened to ', h('b', { text: anchors.join(', ') }), '. ');
      if (carries.length) links.append('Carries ', h('b', { class: 'carry', text: carries.join(', ') }), '. ');
      else if (!m.anchors) links.append('Carries nothing. ');
      if (scannerOn && ratio > 0.55) links.append(h('b', { class: 'carry', text: ` Load at ${Math.round(ratio * 100)}% of capacity.` }));
      info.append(links);
      if (!m.protect) {
        const preview = previewCharge(building, plan.charges, chargeType, m.id, powerMul, direction);
        const cls = preview.warnings.length ? 'effect warn' : preview.target.destroyed ? 'effect good' : 'effect';
        const effect = h('div', { class: cls }, h('b', { text: `${def.name}: ` }), preview.summary);
        for (const w of preview.warnings) effect.append(h('div', { text: `⚠ ${w}` }));
        const splashDamaged = preview.splash.filter((s) => !s.destroyed && s.fraction >= 0.2);
        if (splashDamaged.length) effect.append(h('div', { text: `Also damages ${splashDamaged.map((s) => `${s.label} (${Math.round(s.fraction * 100)}%)`).join(', ')}.` }));
        info.append(effect);
      } else {
        info.append(h('div', { class: 'effect warn', text: 'Contract requires this to stay standing. No charges here.' }));
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
            onClick: () => {
              if (plan.removeLastOn(m.id)) {
                app.play('remove');
                app.buzz(8);
                renderTray();
                renderInfo();
              }
            },
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
    resize();
  };

  const placeCharge = (type: ChargeType, memberId: string): void => {
    const result = plan.place(type, memberId, direction);
    if (!result.ok) {
      app.play('error');
      app.toast(result.reason, true, el);
      return;
    }
    app.play('place');
    app.buzz([12, 40, 18]);
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
    app.play('arm');
    app.buzz([20, 40, 20, 40, 60]);
    sheet.style.display = 'none';
    fab.style.display = 'none';
    backButton.style.display = 'none';
    phasePill.textContent = 'Armed';
    phasePill.className = 'pill danger';
    resize();
    camera.animateFit(wideBounds(), 1.2, 1400, performance.now());
    const quick = app.reducedMotion;
    showOverlay(h('div', { class: 'big', text: 'Everything is set.' }));
    await wait(quick ? 400 : 1500);
    if (disposed) return;
    showOverlay(h('div', { class: 'big accent', text: 'Welcome to Demo Day.' }), h('div', { class: 'sub', text: 'Get clear.' }));
    await wait(quick ? 400 : 1700);
    if (disposed) return;
    phase = 'countdown';
    phasePill.textContent = 'Countdown';
    overlay.classList.add('clear');
    overlay.style.pointerEvents = 'auto';
    const skipHandler = (): void => {
      countdownSkip = true;
    };
    overlay.addEventListener('pointerdown', skipHandler);
    let n = quick ? 3 : 10;
    while (n >= 1) {
      if (disposed) return;
      showOverlay(
        h('div', { class: 'status', text: 'Demo Day' }),
        h('div', { class: 'count', text: String(n) }),
        n > 3 ? h('div', { class: 'sub', text: 'Tap to skip ahead' }) : h('div', { class: 'sub', text: n === 1 ? 'Brace' : 'Get clear' }),
      );
      app.play(n <= 3 ? 'tickFinal' : 'tick');
      app.buzz(n <= 3 ? 30 : 10);
      await wait(quick ? 350 : n <= 3 ? 800 : 650);
      if (countdownSkip && n > 3) {
        n = 3;
        countdownSkip = false;
        continue;
      }
      n--;
    }
    overlay.removeEventListener('pointerdown', skipHandler);
    if (disposed) return;
    showOverlay(h('div', { class: 'count go', text: 'Detonate' }));
    detonate();
    await wait(quick ? 300 : 700);
    if (disposed) return;
    overlay.style.display = 'none';
  };

  const detonate = (): void => {
    phase = 'collapse';
    phasePill.textContent = 'Detonation';
    sim = new Simulation(building, plan.charges, { powerMultiplier: powerMul });
    simAccumulator = 0;
    if (!app.reducedMotion) {
      const flash = h('div', { class: 'flash' });
      el.append(flash);
      window.setTimeout(() => flash.remove(), 600);
    }
  };

  const finishJob = async (): Promise<void> => {
    if (!sim) return;
    const result = sim.result();
    const report = scoreRun(result, contract, plan.totalUsed(), plan.totalAvailable());
    const payout = computePayout(report, contract);
    const outcome = applyRun(app.save, contract, report, payout);
    app.persist();
    app.lastResult = { contract, building, simResult: result, report, payout, outcome };
    phasePill.textContent = 'Dust settling';
    phasePill.className = 'pill';
    showOverlay(h('div', { class: 'status', text: report.success ? 'Demolition complete' : 'Contract incomplete' }));
    overlay.classList.add('clear');
    const linger = app.reducedMotion ? 600 : 2600;
    await wait(Math.max(0, linger - (performance.now() - settledAt)));
    if (disposed) return;
    app.go('report');
  };

  // ------------------------------------------------------------ mount
  renderTray();
  renderInfo();
  const onResize = (): void => {
    resize();
  };
  window.addEventListener('resize', onResize);
  requestAnimationFrame(() => {
    fitBuilding(false);
    raf = requestAnimationFrame(frame);
  });

  const debugHooks = {
    place: (type: ChargeType, memberId: string, dir?: Direction): boolean => {
      if (dir) direction = dir;
      const r = plan.place(type, memberId, dir);
      renderTray();
      renderInfo();
      return r.ok;
    },
    select: (memberId: string): void => {
      selectedId = memberId;
      renderInfo();
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
