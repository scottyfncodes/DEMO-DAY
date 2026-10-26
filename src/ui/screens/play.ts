import type { App, ScreenInstance } from '../../app';
import { formatMoney } from '../../core/format';
import { CONTRACTS, getContract } from '../../data/contracts';
import { MACHINES, isMachineId, type MachineId } from '../../data/fleet';
import { Job, type MovePlan, type PlanOptions } from '../../game/moves';
import { applyRun, defaultLoadout, isUnlocked, kitOf } from '../../game/progression';
import { computePayout, objectives, type Payout } from '../../game/scoring';
import type { Bounds } from '../../render/camera';
import { Camera } from '../../render/camera';
import { KX, KY } from '../../render/paint';
import { SceneRenderer, type Floater } from '../../render/scene';
import { WreckFx } from '../../wreck/fx';
import { siteStatus, type SiteStatus } from '../../wreck/job';
import { DT, HEIGHTMAP, PIECE_STANDING, prepare, type WreckEvent } from '../../wreck/sim';
import type { PieceDef } from '../../wreck/structure';
import type { ChargeKind } from '../../wreck/tools';
import { h } from '../dom';
import { ICON, MACHINE_ICON } from '../icons';
import { attachInput } from '../input';
import { buildingBounds } from '../view';
import { sheet, stars } from './common';

const VERB: Record<MovePlan['action'], string> = { swing: 'Swing', drop: 'Drop', charge: 'Set charge', uncharge: 'Take it off', detonate: 'Fire', excavate: 'Crunch', push: 'Push', scoop: 'Scoop' };

const HINT: Record<MachineId, string> = {
  ball: 'Tap the part of the building to hit. Low, load-bearing parts do the most.',
  charges: 'Tap a column, wall or slab to set a charge. Fire them all at once when you are ready.',
  excavator: 'Tap a spot within reach: the excavator drives over and takes three bites.',
  dozer: 'Tap the rubble to push it. The arrow shows where the pile ends up.',
  loader: 'Tap a heap or a piece of salvage to scoop it and haul it off.',
};

const ACTING: Record<MachineId, string> = { ball: 'Swinging', charges: 'Fuses burning', excavator: 'Crunching', dozer: 'Pushing', loader: 'Hauling' };

interface Step {
  text: string;
  done: () => boolean;
  focus?: 'ball' | 'dozer' | 'confirm' | 'pier';
}

/** A job in progress: the site, the fleet bar, and one move at a time. */
export function playScreen(app: App, params: Record<string, string>): ScreenInstance {
  const save = app.save;
  const contract = getContract(params.id ?? 'corner');
  if (!isUnlocked(contract, save)) {
    queueMicrotask(() => app.go('jobs'));
    return { el: h('main', { class: 'screen' }) };
  }
  const asked = (params.crew ?? '').split(',').filter(isMachineId);
  const owned = asked.filter((m) => contract.fixed?.includes(m) || save.fleet.includes(m)).slice(0, contract.slots);
  const crew: MachineId[] = contract.fixed ?? (owned.length ? owned : defaultLoadout(contract, save));
  const hd = prepare(contract.building);
  const job = new Job(contract, crew, hd, kitOf(save));
  const sim = job.sim;
  const D = hd.building.depth;

  // ------------------------------------------------------------- state
  let machine: MachineId | undefined;
  let plan: MovePlan | undefined;
  let lastTap: { x: number; y: number } | undefined;
  let chargeKind: ChargeKind = 'cutter';
  let drop = false;
  let dirOverride: 1 | -1 | undefined;
  let inspect = -1;
  let stress = false;
  let speed = 1;
  let finished = false;
  let finishAt = 0;
  let status: SiteStatus = siteStatus(sim);
  let floaters: Floater[] = [];
  let lastUserCam = 0;
  let hitstop = 0;
  let lastPush = 0;
  const chainShown = new Map<number, number>();
  let flawsSeen = 0;
  let tutorialOn = !!contract.tutorial && !save.tutorialDone;
  let stepIndex = 0;

  // --------------------------------------------------------------- DOM
  const canvas = h('canvas', { class: 'play-canvas' });
  const renderer = new SceneRenderer(canvas);
  const camera = new Camera();
  camera.minScale = 1.5;
  camera.maxScale = 80;
  const fx = new WreckFx();
  fx.reducedMotion = app.reducedMotion;

  const downFill = h('i');
  const clearFill = h('i');
  const downText = h('b');
  const clearText = h('b');
  const bonusText = h('span', { class: 'bonus-count' });
  const objBtn = h(
    'button',
    { class: 'obj-strip', 'aria-label': 'Objectives', onClick: () => openObjectives() },
    h('span', { class: 'obj-title', text: `${contract.number} · ${contract.title}` }),
    h('span', { class: 'meter' }, h('span', { class: 'meter-label', text: 'Down' }), h('span', { class: 'bar' }, downFill, h('em', { style: `left:${(1 - contract.downAt) * 100}%` })), downText),
    h('span', { class: 'meter' }, h('span', { class: 'meter-label', text: 'Clear' }), h('span', { class: 'bar' }, clearFill, h('em', { style: `left:${contract.clearAt * 100}%` })), clearText),
    bonusText,
  );
  const inspectBtn = h('button', { class: 'icon-btn', 'aria-label': 'Show loads', 'aria-pressed': 'false', html: ICON.inspect, onClick: () => toggleStress() });
  const frameBtn = h('button', { class: 'icon-btn', 'aria-label': 'Frame the site', html: ICON.frame, onClick: () => reframe(true) });
  const top = h('header', { class: 'hud-top' }, h('button', { class: 'icon-btn', 'aria-label': 'Pause', html: ICON.pause, onClick: () => openPause() }), objBtn, h('div', { class: 'hud-tools' }, inspectBtn, frameBtn));

  const finishBar = h('div', { class: 'finish-bar hidden' }, h('span', { text: 'Job done. Finish now, or keep working for bonuses.' }), h('button', { class: 'btn primary sm', text: 'Finish', onClick: () => finish() }));
  const coach = h('div', { class: 'coach hidden', role: 'status' });
  const panel = h('div', { class: 'action-panel' });
  const bar = h('div', { class: `machine-bar${crew.length >= 4 ? ' many' : ''}` });
  const tiles = new Map<MachineId, HTMLButtonElement>();
  for (const m of crew) {
    const tile = h(
      'button',
      { class: 'machine-tile', 'aria-label': MACHINES[m].name, onClick: () => select(m) },
      h('span', { class: 'mt-icon', html: MACHINE_ICON[m] }),
      h('span', { class: 'mt-name', text: MACHINES[m].short }),
      h('span', { class: 'mt-count' }),
      h('span', { class: 'mt-pips' }),
    );
    tiles.set(m, tile);
    bar.append(tile);
  }
  const bottom = h('footer', { class: 'hud-bottom' }, coach, finishBar, panel, bar);
  const el = h('main', { class: 'screen play' }, canvas, top, bottom);

  // ----------------------------------------------------------- helpers
  const floater = (text: string, x: number, y: number, tone: Floater['tone'] = 'gold', big = false): void => {
    floaters.push({ text, x: x + D * 0.3 * KX, y: y + D * 0.3 * KY, born: performance.now(), tone, big });
    if (floaters.length > 12) floaters.shift();
  };

  function select(m: MachineId): void {
    if (finished) return;
    if (machine === m) {
      machine = undefined;
      clearPlan();
    } else {
      machine = m;
      clearPlan();
      inspect = -1;
      if (job.left(m) <= 0 && !(m === 'charges' && job.placedCharges > 0)) app.toast(`No ${MACHINES[m].moves} left.`);
    }
    app.play('select');
    app.buzz(8);
    render();
  }

  function clearPlan(): void {
    plan = undefined;
    lastTap = undefined;
    dirOverride = undefined;
  }

  function opts(): PlanOptions {
    return { charge: chargeKind, drop, dir: dirOverride };
  }

  function replan(): void {
    if (!machine || !lastTap) return;
    plan = job.plan(machine, lastTap.x, lastTap.y, opts());
  }

  /** Screen tap → a point on the building face or on the ground. */
  function worldAt(sx: number, sy: number): { x: number; y: number; piece: number } {
    const w = camera.screenToWorld(sx, sy);
    const ground = machine === 'dozer' || machine === 'loader';
    if (ground) {
      // On the ground plane (or a heap): back the depth out of the projection.
      const z = Math.max(-2, Math.min(D * 0.55, w.y / KY));
      return { x: w.x - z * KX, y: 0, piece: -1 };
    }
    for (const z of [0, D * 0.25, D * 0.5, D * 0.75, D]) {
      const x = w.x - z * KX;
      const y = w.y - z * KY;
      const piece = job.pieceAt(x, y);
      if (piece >= 0) return { x, y, piece };
    }
    return { x: w.x, y: w.y, piece: -1 };
  }

  function onTap(sx: number, sy: number): void {
    if (finished) return;
    const at = worldAt(sx, sy);
    if (!machine) {
      inspect = at.piece;
      if (inspect >= 0) app.play('inspect');
      render();
      return;
    }
    lastTap = { x: at.x, y: at.y };
    dirOverride = undefined;
    plan = job.plan(machine, at.x, at.y, { ...opts(), piece: machine === 'charges' && at.piece >= 0 ? at.piece : undefined });
    if (plan.ok) {
      app.play('tap');
      app.buzz(6);
      if (plan.release) followAction(plan);
    } else {
      app.play('error');
      app.buzz([10, 30, 10]);
    }
    render();
  }

  function confirm(): void {
    if (!plan || finished) return;
    if (!job.ready && plan.action !== 'charge' && plan.action !== 'uncharge') {
      app.toast('Wait for the site to settle.');
      return;
    }
    const p = plan;
    const r = job.commit(p);
    if (!r.ok) {
      app.play('error');
      app.toast(r.reason ?? 'That will not work.', 'bad');
      replan();
      render();
      return;
    }
    const tile = tiles.get(p.machine);
    if (p.cost > 0 && tile) {
      tile.classList.remove('spent');
      void tile.offsetWidth;
      tile.classList.add('spent');
      const chip = h('span', { class: 'spend-chip', text: `−${p.cost}` });
      tile.append(chip);
      window.setTimeout(() => chip.remove(), 900);
    }
    app.play(p.action === 'charge' ? 'place' : p.action === 'uncharge' ? 'remove' : p.action === 'detonate' ? 'arm' : 'lock', 1, p.action === 'charge' ? 'heavy' : undefined);
    app.buzz(14);
    if (p.action === 'charge' || p.action === 'uncharge') {
      plan = undefined;
      lastTap = undefined;
    } else {
      plan = undefined;
      lastTap = undefined;
      followAction(p);
    }
    render();
  }

  function fire(): void {
    plan = job.planDetonate();
    confirm();
  }

  // ------------------------------------------------------------- camera
  function workBounds(): Bounds {
    const b = buildingBounds(hd, 3.5);
    const hm = sim.state.heightmap;
    const L = hd.site;
    let lo = b.minX;
    let hi = b.maxX;
    for (let i = 0; i < hm.length; i++) {
      if ((hm[i] as number) < 0.15) continue;
      const x = HEIGHTMAP.minX + i * HEIGHTMAP.cell;
      if (x < L.lotMin - 4 || x > L.lotMax + 4) continue;
      lo = Math.min(lo, x - 3);
      hi = Math.max(hi, x + D * KX + 3);
    }
    if (sim.standingFraction < 0.5) b.maxY = Math.max(14, b.maxY * 0.6);
    return { ...b, minX: lo, maxX: hi };
  }

  function union(a: Bounds, xs: number[]): Bounds {
    return { ...a, minX: Math.min(a.minX, ...xs.map((x) => x - 4)), maxX: Math.max(a.maxX, ...xs.map((x) => x + 4 + D * KX * 0.5)) };
  }

  function followAction(p: MovePlan): void {
    if (performance.now() - lastUserCam < 2500) return;
    let b = workBounds();
    if (p.release) b = union(b, [p.release.bx]);
    if (p.arrow) b = union(b, [p.arrow.from, p.arrow.stop]);
    if (p.scoop) b = union(b, [p.scoop.x, p.scoop.dumpX, sim.state.loader.x]);
    if (p.jaw) b = union(b, [p.jaw.standX]);
    camera.animateFit(b, 0, app.reducedMotion ? 1 : 700, performance.now());
  }

  function reframe(force = false): void {
    if (!force && performance.now() - lastUserCam < 4000) return;
    camera.animateFit(workBounds(), 0, app.reducedMotion ? 1 : 600, performance.now());
  }

  const detach = attachInput(canvas, {
    onTap,
    onPan: (dx, dy) => {
      lastUserCam = performance.now();
      camera.panBy(dx, dy);
    },
    onZoom: (x, y, f) => {
      lastUserCam = performance.now();
      camera.zoomAt(x, y, f);
    },
    onPanEnd: (vx, vy) => camera.fling(vx, vy, performance.now()),
  });

  // ------------------------------------------------------------- render
  function pips(m: MachineId): void {
    const tile = tiles.get(m);
    const b = job.budgets[m];
    if (!tile || !b) return;
    const count = tile.querySelector('.mt-count') as HTMLElement;
    const pipsEl = tile.querySelector('.mt-pips') as HTMLElement;
    count.textContent = String(b.left);
    if (pipsEl.childElementCount !== b.max) {
      pipsEl.textContent = '';
      for (let i = 0; i < b.max; i++) pipsEl.append(h('i'));
    }
    [...pipsEl.children].forEach((pip, i) => pip.classList.toggle('used', i >= b.left));
    tile.classList.toggle('selected', machine === m);
    tile.classList.toggle('empty', b.left <= 0 && !(m === 'charges' && job.placedCharges > 0));
    tile.setAttribute('aria-pressed', String(machine === m));
    tile.setAttribute('aria-label', `${MACHINES[m].name}, ${b.left} ${b.left === 1 ? MACHINES[m].move : MACHINES[m].moves} left`);
  }

  function render(): void {
    for (const m of crew) pips(m);
    panel.textContent = '';
    const busy = !job.ready;
    if (finished) return;
    if (busy && !plan) {
      const acting = job.phase === 'acting';
      const who = job.moves[job.moves.length - 1]?.machine;
      panel.append(
        h('div', { class: 'ap-row' }, h('div', { class: 'ap-text' }, h('strong', { text: acting && who ? `${ACTING[who]}…` : 'Settling…' }), h('span', { class: 'muted', text: 'The next move is ready when the dust settles.' })), h('button', { class: `btn ghost ff${speed > 1 ? ' on' : ''}`, 'aria-pressed': String(speed > 1), onClick: () => toggleSpeed() }, h('span', { class: 'icon', html: ICON.ff }), h('span', { text: speed > 1 ? '3×' : 'Speed up' }))),
      );
      return;
    }
    if (!machine) {
      if (inspect >= 0) {
        const p = hd.def.pieces[inspect] as PieceDef;
        const load = sim.solution.load[inspect] as number;
        const st = sim.solution.pieceStress[inspect] as number;
        const flaw = sim.state.flaw[inspect] === 2 ? hd.building.flaws.find((f) => f.label === p.label)?.note : undefined;
        const text = p.carriesOthers ? `Carries ${Math.round(load)} t, at ${Math.round(st * 100)}% of its limit.${flaw ? ` Weak point: ${flaw}.` : ''}` : `Cladding: carries nothing, just hangs on the frame.${flaw ? ` Weak point: ${flaw}.` : ''}`;
        panel.append(h('div', { class: 'ap-text' }, h('strong', { text: p.label }), h('span', { text })));
      } else panel.append(h('div', { class: 'ap-text' }, h('strong', { text: 'Pick a machine' }), h('span', { class: 'muted', text: 'Or tap the building to see what each part carries.' })));
      return;
    }
    const m = machine;
    const extras: HTMLElement[] = [];
    if (m === 'charges') {
      const kinds: Array<[ChargeKind, string]> = [
        ['cutter', 'Cutter'],
        ['blast', 'Blast'],
      ];
      if (sim.state.kit.shaped) kinds.push(['shaped', 'Shaped ×2']);
      extras.push(
        h(
          'div',
          { class: 'seg', role: 'group', 'aria-label': 'Charge type' },
          ...kinds.map(([k, t]) =>
            h('button', {
              class: chargeKind === k ? 'on' : '',
              'aria-pressed': String(chargeKind === k),
              text: t,
              onClick: () => {
                chargeKind = k;
                app.play('tap');
                replan();
                render();
              },
            }),
          ),
        ),
      );
      if (job.placedCharges > 0) extras.push(h('button', { class: 'btn fire', disabled: busy, onClick: () => fire() }, h('span', { class: 'icon', html: ICON.fire }), h('span', { text: `Fire ${job.placedCharges}` })));
    }
    if (m === 'ball' && sim.state.kit.drop) {
      extras.push(
        h(
          'div',
          { class: 'seg', role: 'group', 'aria-label': 'Strike' },
          ...([false, true] as const).map((d) =>
            h('button', {
              class: drop === d ? 'on' : '',
              'aria-pressed': String(drop === d),
              text: d ? 'Drop' : 'Swing',
              onClick: () => {
                drop = d;
                app.play('tap');
                replan();
                render();
              },
            }),
          ),
        ),
      );
    }
    if (!plan) {
      const left = job.left(m);
      panel.append(h('div', { class: 'ap-text' }, h('strong', { text: `${MACHINES[m].name} · ${left} ${left === 1 ? MACHINES[m].move : MACHINES[m].moves} left` }), h('span', { class: 'muted', text: left > 0 || (m === 'charges' && job.placedCharges) ? HINT[m] : `Out of ${MACHINES[m].moves}. Pick another machine.` })));
      if (extras.length) panel.append(h('div', { class: 'ap-extras' }, ...extras));
      return;
    }
    const p = plan;
    if (!p.ok) {
      panel.append(h('div', { class: 'ap-row' }, h('div', { class: 'ap-text bad' }, h('strong', { text: 'Can’t do that' }), h('span', { text: p.reason ?? '' })), h('button', { class: 'btn ghost', text: 'OK', onClick: () => (clearPlan(), render()) })));
      if (extras.length) panel.append(h('div', { class: 'ap-extras' }, ...extras));
      return;
    }
    const costText = p.cost > 0 ? `${p.cost} ${p.cost === 1 ? MACHINES[p.machine].move : MACHINES[p.machine].moves}` : p.cost < 0 ? `+${-p.cost} back` : 'free';
    const actions = h('div', { class: 'ap-actions' });
    if (p.machine === 'dozer' && p.arrow) {
      actions.append(
        h('button', {
          class: 'btn ghost icon-only',
          'aria-label': 'Push the other way',
          html: ICON.flip,
          onClick: () => {
            const cur = Math.sign(p.arrow!.stop - p.arrow!.from) as 1 | -1;
            dirOverride = (cur > 0 ? -1 : 1) as 1 | -1;
            replan();
            app.play('tap');
            render();
          },
        }),
      );
    }
    actions.append(h('button', { class: 'btn ghost', text: 'Cancel', onClick: () => (clearPlan(), app.play('tap'), render()) }));
    const go = h('button', { class: `btn primary confirm${tutorialFocus() === 'confirm' ? ' pulse' : ''}`, disabled: busy && p.action !== 'charge' && p.action !== 'uncharge', onClick: () => confirm() }, h('span', { text: VERB[p.action] }), h('span', { class: 'cost', text: costText }));
    actions.append(go);
    panel.append(h('div', { class: 'ap-text' }, h('strong', { text: p.title }), h('span', { text: p.detail })), actions);
    if (extras.length) panel.append(h('div', { class: 'ap-extras' }, ...extras));
  }

  function toggleSpeed(): void {
    speed = speed > 1 ? 1 : 3;
    app.play('tap');
    render();
  }

  function toggleStress(): void {
    stress = !stress;
    inspectBtn.classList.toggle('on', stress);
    inspectBtn.setAttribute('aria-pressed', String(stress));
    app.play('tap');
    app.toast(stress ? 'Showing loads: yellow is working hard, red is about to go.' : 'Loads hidden.');
  }

  function updateHud(): void {
    const down = 1 - status.standing;
    downFill.style.transform = `scaleX(${Math.max(0, Math.min(1, down)).toFixed(3)})`;
    clearFill.style.transform = `scaleX(${status.clear.toFixed(3)})`;
    downText.textContent = `${Math.round(down * 100)}%`;
    clearText.textContent = `${Math.round(status.clear * 100)}%`;
    objBtn.classList.toggle('down-ok', status.standing <= contract.downAt);
    objBtn.classList.toggle('clear-ok', status.clear >= contract.clearAt);
    const obs = objectives(contract, status, job.used);
    const bonus = obs.filter((o) => !o.primary);
    bonusText.textContent = bonus.length ? `${bonus.filter((o) => o.done).length}/${bonus.length}` : '';
    const primaryDone = obs.filter((o) => o.primary).every((o) => o.done);
    finishBar.classList.toggle('hidden', !primaryDone || finished || (tutorialOn && stepIndex < STEPS.length - 1));
  }

  // ------------------------------------------------------------ sheets
  function openObjectives(): void {
    app.play('tap');
    const obs = objectives(contract, status, job.used);
    const list = h('ul', { class: 'obj-list live' });
    for (const o of obs) list.append(h('li', { class: `${o.primary ? 'primary' : 'bonus'}${o.done ? ' got' : ''}${o.failed ? ' failed' : ''}` }, h('span', { class: 'tick', html: o.done ? ICON.check : '' }), h('span', { text: o.label }), h('em', { text: o.reward && !o.done ? `${o.progress} · +${formatMoney(o.reward)}` : o.progress })));
    const s = sheet(
      h(
        'div',
        { class: 'sheet-body' },
        h('h2', { text: contract.title }),
        h('p', { class: 'muted', text: contract.tip }),
        list,
        h('p', { class: 'muted small', text: `${job.used} moves used. Unused moves pay ${formatMoney(350)} each on a finished job.` }),
        h('div', { class: 'sheet-actions' }, h('button', { class: 'btn ghost', text: 'Back to work', onClick: () => s.close() }), h('button', { class: 'btn primary', text: 'Finish the job', onClick: () => (s.close(), finish()) })),
      ),
    );
  }

  function openPause(): void {
    app.play('tap');
    const toggle = (labelText: string, key: 'sound' | 'haptics' | 'reducedMotion'): HTMLElement => {
      const btn = h('button', {
        class: `toggle${save.settings[key] ? ' on' : ''}`,
        role: 'switch',
        'aria-checked': String(save.settings[key]),
        onClick: () => {
          save.settings[key] = !save.settings[key];
          app.persist();
          app.applySettings();
          fx.reducedMotion = app.reducedMotion;
          btn.classList.toggle('on', save.settings[key]);
          btn.setAttribute('aria-checked', String(save.settings[key]));
        },
      });
      return h('label', { class: 'setting-row' }, h('span', { text: labelText }), btn);
    };
    const s = sheet(
      h(
        'div',
        { class: 'sheet-body' },
        h('h2', { text: 'Paused' }),
        toggle('Sound', 'sound'),
        toggle('Vibration', 'haptics'),
        toggle('Reduce motion', 'reducedMotion'),
        h(
          'div',
          { class: 'sheet-actions stack' },
          h('button', { class: 'btn primary', text: 'Back to the job', onClick: () => s.close() }),
          h('button', { class: 'btn ghost', text: 'Restart this job', onClick: () => (s.close(), app.go('play', { id: contract.id, crew: crew.join(',') })) }),
          h('button', { class: 'btn ghost', text: 'Leave (nothing is paid)', onClick: () => (s.close(), app.go('brief', { id: contract.id })) }),
        ),
      ),
    );
  }

  // ------------------------------------------------------------ finish
  function finish(): void {
    if (finished) return;
    const primary = objectives(contract, status, job.used).filter((o) => o.primary);
    if (!primary.every((o) => o.done) && !job.outOfMoves) {
      const s = sheet(
        h(
          'div',
          { class: 'sheet-body' },
          h('h2', { text: 'Finish now?' }),
          h('p', { text: 'The job is not done yet, so there is no contract fee. You keep any salvage.' }),
          h('div', { class: 'sheet-actions' }, h('button', { class: 'btn ghost', text: 'Keep working', onClick: () => s.close() }), h('button', { class: 'btn danger', text: 'Finish anyway', onClick: () => (s.close(), settleUp()) })),
        ),
      );
      return;
    }
    settleUp();
  }

  function settleUp(): void {
    if (finished) return;
    finished = true;
    machine = undefined;
    plan = undefined;
    render();
    status = siteStatus(sim);
    const prior = save.records[contract.id];
    const payout = computePayout(job, { completions: prior?.completions ?? 0, bonuses: prior?.bonuses ?? [] });
    const outcome = applyRun(save, contract, payout);
    if (contract.tutorial && payout.success) tutorialOn = false;
    app.persist();
    showResults(payout, outcome.unlocked.map((u) => u.id), outcome.newBest);
  }

  function showResults(p: Payout, unlocked: string[], newBest: boolean): void {
    app.play(p.success ? 'total' : 'fail');
    const lines = h('ul', { class: 'pay-lines' });
    const totalEl = h('b', { class: 'pay-total', text: formatMoney(0) });
    const why = !p.success ? whyFailed(p.status) : '';
    p.lines.forEach((l, i) => {
      const li = h('li', { class: `${l.amount < 0 ? 'neg' : ''}${l.repeat ? ' repeat' : ''}`, style: `--i:${i}` }, h('span', { class: 'pl-label' }, h('span', { text: l.label }), h('small', { text: l.detail })), h('b', { text: l.repeat ? 'paid' : formatMoney(l.amount) }));
      lines.append(li);
    });
    const nextId = unlocked[0] ?? CONTRACTS[CONTRACTS.findIndex((x) => x.id === contract.id) + 1]?.id;
    const next = nextId && isUnlocked(getContract(nextId), save) ? getContract(nextId) : undefined;
    const tutorialDone = contract.tutorial && p.success;
    const actions = h('div', { class: 'sheet-actions stack' });
    if (tutorialDone) actions.append(h('button', { class: 'btn primary', text: 'Go to the garage', onClick: () => app.go('garage', { hint: '1' }) }));
    else if (p.success && next) actions.append(h('button', { class: 'btn primary', text: `Next job: ${next.title}`, onClick: () => app.go('brief', { id: next.id }) }));
    actions.append(h('button', { class: `btn ${p.success && !tutorialDone ? 'ghost' : tutorialDone ? 'ghost' : 'primary'}`, text: p.success ? 'Replay for a better score' : 'Try again', onClick: () => app.go('play', { id: contract.id, crew: crew.join(',') }) }));
    if (!tutorialDone) actions.append(h('button', { class: 'btn ghost', text: 'Garage', onClick: () => app.go('garage') }));
    actions.append(h('button', { class: 'btn ghost', text: 'Contracts', onClick: () => app.go('jobs') }));
    const body = h(
      'div',
      { class: `sheet-body results ${p.success ? 'win' : 'lose'}` },
      h('p', { class: 'eyebrow', text: `${contract.number} · ${contract.title}` }),
      h('h2', { text: p.success ? 'Job done' : 'Job not finished' }),
      p.success ? stars(p.stars) : h('p', { class: 'why', text: why }),
      h('p', { class: 'muted small', text: `${p.used} moves · ${Math.round((1 - p.status.standing) * 100)}% down · ${Math.round(p.status.clear * 100)}% clear${p.status.collateral > 0.05 ? ` · ${p.status.collateral.toFixed(1)} m² next door` : ''}` }),
      lines,
      h('div', { class: 'pay-sum' }, h('span', { text: 'Paid' }), totalEl),
      newBest ? h('p', { class: 'good small', text: 'New best for this job.' }) : null,
      unlocked.length ? h('p', { class: 'good small', text: `Unlocked: ${unlocked.map((id) => getContract(id).title).join(', ')}.` }) : null,
      tutorialDone ? h('p', { class: 'small', text: 'Your first pay. The excavator is waiting in the garage: precision for the next job.' }) : null,
      actions,
    );
    sheet(body, undefined, false);
    // Count the total up (skipped with reduced motion).
    const target = p.total;
    if (app.reducedMotion) totalEl.textContent = formatMoney(target);
    else {
      const t0 = performance.now();
      const step = (now: number): void => {
        const k = Math.min(1, (now - t0) / 1100);
        totalEl.textContent = formatMoney(Math.round(target * (1 - Math.pow(1 - k, 3))));
        if (k < 1) requestAnimationFrame(step);
        else if (target > 0) app.play('cash');
      };
      requestAnimationFrame(step);
    }
  }

  function whyFailed(st: SiteStatus): string {
    if (contract.maxCollateral !== undefined && st.collateral > contract.maxCollateral) return `Too much came down on ${hd.building.neighbour.name}. Fell it the other way: cut the side away from them first.`;
    if (st.standing > contract.downAt) return `${Math.round(st.standing * 100)}% is still standing. Hit the load-bearing parts low down; the rest follows.`;
    return `The lot is ${Math.round(st.clear * 100)}% clear and needs ${Math.round(contract.clearAt * 100)}%. Push rubble into the pit or onto the pad.`;
  }

  // ----------------------------------------------------------- tutorial
  const pier = hd.def.pieces.find((p) => p.label === 'Column A · floor 1')?.id ?? -1;
  const STEPS: Step[] = [
    { text: 'This is the Corner Store. Tap the brick pier on the left corner to see what it carries.', done: () => inspect === pier, focus: 'pier' },
    { text: 'That pier holds up the whole corner. Pick the crane below.', done: () => machine === 'ball' || job.moves.length > 0, focus: 'ball' },
    { text: 'Tap the pier to aim the wrecking ball.', done: () => (!!plan && plan.ok && plan.machine === 'ball') || job.moves.length > 0, focus: 'pier' },
    { text: 'The preview shows where the ball lands and what it will do. Swing.', done: () => job.moves.length > 0, focus: 'confirm' },
    { text: 'One swing spent, shown on the crane’s counter. Watch what that pier was holding.', done: () => job.ready },
    { text: 'Bring the rest down. Aim low, at whatever still carries the roof.', done: () => status.standing <= contract.downAt },
    { text: 'Down. Now clear the lot: pick the dozer.', done: () => machine === 'dozer' || job.moves.some((m) => m.machine === 'dozer'), focus: 'dozer' },
    { text: 'Tap the rubble and push it into the haul pit on the right.', done: () => job.moves.some((m) => m.machine === 'dozer') },
    { text: `Keep pushing until the lot is ${Math.round(contract.clearAt * 100)}% clear.`, done: () => status.clear >= contract.clearAt },
    { text: 'Job done. Tap Finish to get paid.', done: () => finished },
  ];

  function tutorialFocus(): Step['focus'] {
    return tutorialOn ? STEPS[stepIndex]?.focus : undefined;
  }

  function updateCoach(): void {
    if (!tutorialOn) {
      coach.classList.add('hidden');
      return;
    }
    let changed = false;
    while (stepIndex < STEPS.length - 1 && (STEPS[stepIndex] as Step).done()) {
      stepIndex++;
      changed = true;
    }
    const step = STEPS[stepIndex] as Step;
    // The last step is the Finish bar itself; no need to say it twice.
    if (stepIndex === STEPS.length - 1) {
      coach.classList.add('hidden');
      return;
    }
    if (changed || coach.classList.contains('hidden')) {
      coach.textContent = '';
      coach.append(
        h('span', { class: 'coach-step', text: `${stepIndex + 1}/${STEPS.length}` }),
        h('p', { text: step.text }),
        h('button', {
          class: 'link',
          text: 'Skip tutorial',
          onClick: () => {
            tutorialOn = false;
            save.tutorialDone = true;
            app.persist();
            updateCoach();
            render();
          },
        }),
      );
      coach.classList.remove('hidden');
      if (changed) app.play('select', 0.5);
      for (const [m, t] of tiles) t.classList.toggle('pulse', step.focus === m);
      render();
    }
  }

  // ------------------------------------------------------------- events
  function react(events: WreckEvent[]): void {
    fx.ingest(events, sim);
    for (const e of events) {
      switch (e.type) {
        case 'hit': {
          const k = Math.min(1, e.energy / 700);
          app.play('impact', 0.3 + k * 0.7);
          if (e.material === 'glass') app.play('glass', k);
          else app.play('crack', 0.4 + k * 0.6, e.material === 'steel' ? 'steel' : e.material === 'brick' ? 'brick' : e.material === 'wood' ? 'wood' : 'concrete');
          if (e.energy > 160) {
            hitstop = Math.max(hitstop, 0.04 + k * 0.07);
            app.buzz(Math.round(18 + k * 40));
          }
          if (e.destroyed && e.piece >= 0 && e.energy > 100) floater('Smashed', e.x, e.y + 1.5, 'white');
          break;
        }
        case 'crack':
          app.play('crack', 0.25 + e.strength * 0.4, e.material === 'steel' ? 'steel' : e.material === 'brick' ? 'brick' : 'concrete');
          break;
        case 'creak':
          app.play('creak', e.strength);
          break;
        case 'shatter':
          if (e.material === 'glass') app.play('glass', 0.35);
          break;
        case 'detach':
          if (e.mass > 120) {
            app.play('failMajor', 1, 'concrete');
            app.buzz([30, 30, 60]);
          } else if (e.mass > 20) app.play('topple', 0.6);
          if (e.mass > 400) app.play('rumble', Math.min(1, e.mass / 1200));
          break;
        case 'land':
          if (e.mass > 100) {
            app.play('heavyLanding', 1);
            app.buzz(50);
          } else if (e.mass > 12) app.play('impact', Math.min(1, e.mass / 100));
          else app.play('crumble', 0.3);
          break;
        case 'arm':
          app.play('fuse');
          break;
        case 'blast':
          app.play('detonate', e.kind === 'blast' ? 1 : 0.8, e.kind === 'blast' ? 'heavy' : 'shaped');
          app.buzz(e.kind === 'blast' ? [40, 20, 60] : 40);
          hitstop = Math.max(hitstop, 0.06);
          if (e.cause === 'ball') floater('The ball set it off', e.x, e.y + 2, 'gold', true);
          else if (e.cause === 'debris') floater('Debris set it off', e.x, e.y + 2);
          break;
        case 'reveal': {
          app.play('reveal');
          const p = hd.def.pieces[e.piece] as PieceDef;
          floater('Weak point found', p.x + p.w / 2, p.y + p.h + 1, 'gold');
          break;
        }
        case 'bite':
          if (e.target === 'air') app.play('push', 0.2);
          else {
            app.play('bite', e.target === 'vault' ? 0.5 : 0.9);
            app.buzz(14);
          }
          if (e.target === 'vault') floater('Careful: that is the prize', e.x, e.y + 1.5, 'red');
          break;
        case 'blockBreak':
          app.play('crack', 0.9, e.material === 'steel' ? 'steel' : 'concrete');
          floater(e.material === 'steel' ? 'Cut' : 'Split', e.x, e.y + 1, 'white');
          break;
        case 'ram':
          app.play('impact', 0.35);
          break;
        case 'scoop':
          app.play('push', 0.5);
          break;
        case 'dump':
          app.play('crumble', 0.5);
          if (e.area > 0.2) floater(`${e.area.toFixed(1)} m² hauled`, e.x, e.y + 1, 'white');
          break;
        case 'salvage':
          if (e.kind === 'vault') {
            if (e.where === 'pad') {
              floater(`${hd.building.prize?.label ?? 'Prize'} recovered`, e.x, e.y + 2.5, 'gold', true);
              app.play('newBest');
            } else {
              floater('Lost in the pit', e.x, e.y + 2, 'red', true);
              app.play('fail');
            }
          } else if (e.kind === 'steel') {
            if (e.where === 'pad') {
              floater(`+${formatMoney(e.value * 140)} steel`, e.x, e.y + 2);
              app.play('cash');
            } else floater('Steel scrapped', e.x, e.y + 2, 'white');
          } else app.play('crumble', 0.5);
          break;
        case 'chargeLost':
          floater('Charge lost', e.x, e.y + 1, 'white');
          break;
        case 'machineHit':
          app.play('warning');
          app.buzz([60, 40, 60]);
          floater(`${e.machine === 'dozer' ? 'Dozer' : e.machine === 'loader' ? 'Loader' : 'Excavator'} hit: repair bill`, e.x, e.y + 2, 'red', true);
          break;
        default:
          break;
      }
    }
  }

  function chains(): void {
    const s = sim.state;
    for (const rec of s.roots) {
      if (!rec || rec.chain < 5) continue;
      const step = Math.floor(rec.chain / 5) * 5;
      if ((chainShown.get(rec.swing) ?? 0) >= step) continue;
      chainShown.set(rec.swing, step);
      floater(`Chain ×${step}`, rec.hitX || hd.def.bounds.maxX / 2, (rec.hitY || 6) + 3, 'gold', step >= 15);
      if (step >= 10) app.play('bonus');
    }
    if (s.tally.flawsExploited > flawsSeen) {
      flawsSeen = s.tally.flawsExploited;
      floater('Weak point used', hd.def.bounds.maxX / 2, 8, 'gold');
    }
  }

  // -------------------------------------------------------------- loop
  let raf = 0;
  let last = performance.now();
  let acc = 0;
  let frameNo = 0;
  let wasReady = true;
  function frame(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const w = canvas.clientWidth || window.innerWidth;
    const hh = canvas.clientHeight || window.innerHeight;
    if (renderer.width !== w || renderer.height !== hh) {
      renderer.resize(w, hh);
      camera.setViewport(w, hh);
      camera.insetTop = top.offsetHeight + 8;
      camera.insetBottom = bottom.offsetHeight + 6;
      camera.limits = { minX: -95, maxX: 130, minY: -8, maxY: 110 };
      camera.fit(workBounds(), 0);
    }
    camera.insetBottom = bottom.offsetHeight + 6;
    if (hitstop > 0) hitstop -= dt;
    else {
      acc += dt * speed;
      let steps = 0;
      while (acc >= DT && steps < 4 * speed) {
        react(job.step());
        acc -= DT;
        steps++;
      }
      if (acc > DT * 4 * speed) acc = 0;
    }
    const d = sim.state.dozer;
    if (d.bladeDown && Math.abs(d.speed) > 0.5 && d.load > 0.4 && now - lastPush > 300) {
      lastPush = now;
      app.play('push', Math.min(1, d.load / 12));
      app.play('engine', Math.min(1, d.load / 12));
    }
    if (frameNo++ % 8 === 0) {
      status = siteStatus(sim);
      updateHud();
      chains();
    }
    // Back to ready: refresh the stale preview and the panel.
    if (job.ready !== wasReady) {
      wasReady = job.ready;
      if (job.ready) {
        if (plan) replan();
        if (speed > 1 && !app.reducedMotion) speed = 1;
        reframe();
        app.play('settled', 0.4);
      }
      render();
    }
    if (!finished && job.ready && job.outOfMoves) {
      if (!finishAt) {
        finishAt = now + 900;
        app.toast('Out of moves.');
      } else if (now > finishAt) settleUp();
    }
    updateCoach();
    floaters = floaters.filter((f) => now - f.born < 1900);
    fx.update(dt, sim);
    camera.update(now);
    camera.punch = app.reducedMotion ? 0 : fx.punch;
    if (fx.shake > 0 && !app.reducedMotion) {
      camera.shakeX = (Math.random() - 0.5) * fx.shake * 6;
      camera.shakeY = (Math.random() - 0.5) * fx.shake * 6;
    } else {
      camera.shakeX = 0;
      camera.shakeY = 0;
    }
    const focusPier = tutorialFocus() === 'pier' && stepIndex === 0 ? pier : -1;
    renderer.draw(sim, camera, fx, {
      time: now / 1000,
      now,
      machine,
      plan,
      stress,
      inspect: inspect >= 0 ? inspect : focusPier,
      floaters,
      clear: status.clear,
      machines: crew,
    });
    raf = requestAnimationFrame(frame);
  }

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      if (plan) {
        clearPlan();
        render();
      } else openPause();
    } else if (ev.key === 'Enter' && plan?.ok) confirm();
    else if (/^[1-5]$/.test(ev.key)) {
      const m = crew[Number(ev.key) - 1];
      if (m) select(m);
    }
  };
  window.addEventListener('keydown', onKey);
  render();
  updateHud();
  raf = requestAnimationFrame(frame);

  // Automation hook for the smoke test.
  (window as unknown as { __play?: unknown }).__play = { job, camera, select, onTap, confirm: () => confirm(), plan: () => plan, finish: () => finish(), worldToScreen: (x: number, y: number) => camera.worldToScreen(x, y), standing: () => sim.standingFraction, PIECE_STANDING };

  return {
    el,
    destroy: () => {
      cancelAnimationFrame(raf);
      detach();
      window.removeEventListener('keydown', onKey);
      document.querySelectorAll('.sheet-wrap').forEach((s) => s.remove());
    },
  };
}
