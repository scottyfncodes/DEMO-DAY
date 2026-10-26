import type { App, ScreenInstance } from '../../app';
import { clamp } from '../../core/format';
import { Camera, type Bounds } from '../../render/camera';
import { paintChargeIcon } from '../../render/charges';
import { Crew, type Strategy } from '../../wreck/autoplay';
import { WreckFx } from '../../wreck/fx';
import { CLEAR_AT, DOWN_AT, PAR, SHIFT, fmtClock, jobStatus, roots, scoreJob, type JobScore, type JobStatus } from '../../wreck/job';
import { WreckRenderer } from '../../wreck/render';
import type { Floater } from '../../wreck/render-site';
import { BALL_MASS, BALL_R, DT, PIECE_STANDING, craneHook, halden, WreckSim, type Command, type Prediction, type RootRecord, type WreckEvent, type WreckState } from '../../wreck/sim';
import type { PieceDef } from '../../wreck/structure';
import { CHARGE_KINDS, FLAWS, SITE_LAYOUT, distToRect, vaultBlock, type ChargeKind, type Tool } from '../../wreck/tools';
import { h } from '../dom';

export { planSwing } from '../../wreck/autoplay';

type Mode = 'play' | 'result' | 'replay';
type Hold = 'ball' | 'hook' | 'pan' | 'pinch' | 'tap' | 'machine' | undefined;

interface Logged {
  tick: number;
  cmd: Command;
}

interface Snapshot {
  root: number;
  state: WreckState;
  logIndex: number;
}

const SAVE_KEY = 'demo-day-job-v1';
const HINT_KEY = 'demo-day-hints-v1';

interface Record_ {
  best: number;
  grade: string;
  runs: number;
  feats: string[];
}

function loadRecord(): Record_ {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Record_>;
      return {
        best: typeof v.best === 'number' ? v.best : 0,
        grade: typeof v.grade === 'string' ? v.grade : '',
        runs: typeof v.runs === 'number' ? v.runs : 0,
        feats: Array.isArray(v.feats) ? v.feats.filter((f): f is string => typeof f === 'string') : [],
      };
    }
  } catch {
    // Private mode or bad data: start fresh.
  }
  return { best: 0, grade: '', runs: 0, feats: [] };
}

function saveRecord(r: Record_): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(r));
  } catch {
    // Private mode: the record just will not persist.
  }
}

function loadHints(): Set<string> {
  try {
    const raw = localStorage.getItem(HINT_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // Ignore.
  }
  return new Set();
}

function saveHints(seen: Set<string>): void {
  try {
    localStorage.setItem(HINT_KEY, JSON.stringify([...seen]));
  } catch {
    // Ignore.
  }
}

const KIND_VERB: Record<RootRecord['firstFailKind'], string> = {
  buckled: 'buckled under the load',
  'tore loose': 'tore loose from its supports',
  crushed: 'was crushed',
  tipped: 'became the pivot as the block overturned',
  '': '',
};

const TOOL_NAME: Record<Tool, string> = { charge: 'Charges', ball: 'Ball', excavator: 'Excavator', dozer: 'Dozer' };

/** Drawn for this game: a charge stick with its fuse, the ball on its cable, the crusher arm, the dozer blade. */
const TOOL_ICON: Record<Tool, string> = {
  charge:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="9" width="7" height="12" rx="1.5"/><path d="M10.5 9c0-3 2-5 5-5"/><path d="M17.5 2.5l1 1.5M20 5l-1.6.4M17 6.2l.3 1.4"/></svg>',
  ball: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v9"/><circle cx="12" cy="16.5" r="5.5"/></svg>',
  excavator:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h9"/><path d="M5 17h5v-4H5z"/><path d="M8 13l5-8 6 4"/><path d="M19 9l-2 5M19 9l3 4"/></svg>',
  dozer:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="16" width="13" height="4" rx="2"/><path d="M4 16v-5h6v5M10 13h4l1 3"/><path d="M21 9v11c-2 0-3-1-4-2"/></svg>',
};

const ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';

const HINTS: Record<Tool, string> = {
  charge: 'Tap a column or core wall to set a charge. Tap again to take it off. They fire in order.',
  ball: 'Drag the ball back and let go. Drag the boom tip to move the crane.',
  excavator: 'Touch to place the jaws, then hold Crunch.',
  dozer: 'Touch to drive. Blade first pushes, backing up rides over. Turn to push the other way.',
};

/**
 * The Halden job: one big building and four tools. Charges, the crane and
 * ball, a high-reach excavator and a dozer all act on the same deterministic
 * simulation, and every command is logged, so the action that did the most
 * can be replayed exactly.
 */
export function wreckScreen(app: App): ScreenInstance {
  const H = halden();
  const canvas = h('canvas', { class: 'wk-canvas' });
  const renderer = new WreckRenderer(canvas);
  const camera = new Camera();
  camera.minScale = 2;
  camera.maxScale = 70;
  camera.limits = { minX: -90, maxX: 130, minY: -5, maxY: 110 };
  const fx = new WreckFx();
  fx.reducedMotion = app.reducedMotion;

  let sim = new WreckSim(undefined, H);
  let mode: Mode = 'play';
  let tool: Tool = 'charge';
  let chargeKind: ChargeKind = 'cutter';
  let log: Logged[] = [];
  let snapshots: Snapshot[] = [];
  let hold: Hold;
  let tapStart = { x: 0, y: 0, t: 0 };
  let prediction: Prediction | undefined;
  let stressView = false;
  let manualUntil = 0;
  let hitstop = 0;
  let accumulator = 0;
  let raf = 0;
  let disposed = false;
  let lastFrame = performance.now();
  let lastBigHit = 0;
  let replay: { root: number; sim: WreckSim; log: Logged[]; cursor: number; endTick: number; record: RootRecord } | undefined;
  let focus: { x: number; y: number; until: number } | undefined;
  let record = loadRecord();
  const hintsSeen = loadHints();
  let lastMachineInput = { x: NaN, y: NaN };
  let lastHookInput = { x: NaN, y: NaN };
  let floaters: Floater[] = [];
  let status: JobStatus = jobStatus(sim);
  let lastStatusAt = 0;
  let wasDown = false;
  let shownVault = false;
  let stallSaidAt = 0;
  let finishAt = 0;
  let chainShown = new Map<number, { step: number; at: number }>();
  let flawsSeen = 0;
  let crew: Crew | undefined;
  let lastPushSound = 0;
  /** Automation only: simulation steps per real-time step. */
  let timeScale = 1;

  // ------------------------------------------------------------------ DOM

  const clockEl = h('b', { text: 'PREP' });
  const scoreEl = h('b', { text: '0' });
  const standFill = h('i');
  const lotFill = h('i');
  const caption = h('div', { class: 'wk-caption', role: 'status' });
  const ticker = h('div', { class: 'wk-ticker', 'aria-live': 'polite' });
  const banner = h('div', { class: 'wk-banner', 'aria-hidden': 'true' });
  const replayTag = h('div', { class: 'wk-replay-tag', hidden: true });
  const sheet = h('div', { class: 'wk-sheet', hidden: true });
  const panel = h('div', { class: 'wk-panel', hidden: true });

  const jobBtn = h('button', { class: 'wk-chip wk-job', 'aria-pressed': 'false', 'aria-label': 'Job sheet, loads view and restart', text: 'Job' });
  jobBtn.addEventListener('click', () => {
    app.play('tap');
    togglePanel();
  });

  const top = h(
    'header',
    { class: 'wk-top' },
    h('button', { class: 'wk-back', 'aria-label': 'Back to menu', html: ICON_BACK, onClick: () => app.go('menu') }),
    h(
      'div',
      { class: 'wk-title' },
      h('span', { class: 'wk-name', text: H.def.name }),
      h('span', { class: 'wk-stats' }, h('span', { class: 'wk-clock' }, clockEl), h('span', {}, 'Score ', scoreEl)),
      h(
        'span',
        { class: 'wk-meters' },
        h('span', { class: 'wk-meter-l' }, 'Standing', h('span', { class: 'wk-meter', 'aria-hidden': 'true' }, standFill)),
        h('span', { class: 'wk-meter-l' }, 'Lot clear', h('span', { class: 'wk-meter lot', 'aria-hidden': 'true' }, lotFill)),
      ),
    ),
  );
  const chips = h('div', { class: 'wk-tools' }, jobBtn);

  // Tool bar.
  const toolBtns = new Map<Tool, { el: HTMLButtonElement; badge: HTMLElement }>();
  const toolbar = h('nav', { class: 'wk-toolbar', 'aria-label': 'Tools' });
  for (const t of ['charge', 'ball', 'excavator', 'dozer'] as Tool[]) {
    const badge = h('span', { class: 'wk-tool-badge' });
    const el = h(
      'button',
      { class: 'wk-tool', 'aria-pressed': 'false', onClick: () => selectTool(t) },
      h('span', { class: 'wk-tool-ico', html: TOOL_ICON[t] }),
      h('span', { class: 'wk-tool-name', text: TOOL_NAME[t] }),
      badge,
    ) as HTMLButtonElement;
    toolBtns.set(t, { el, badge });
    toolbar.append(el);
  }

  // Charge type toggle.
  const kindBtns = new Map<ChargeKind, { el: HTMLButtonElement; count: HTMLElement }>();
  const kindRow = h('div', { class: 'wk-kinds', role: 'group', 'aria-label': 'Charge type' });
  for (const k of ['cutter', 'blast'] as ChargeKind[]) {
    const icon = h('canvas', { class: 'wk-kind-ico' }) as HTMLCanvasElement;
    paintChargeIcon(icon, k === 'cutter' ? 'shaped' : 'heavy', 22);
    const count = h('b');
    const el = h(
      'button',
      {
        class: 'wk-kind',
        'aria-pressed': 'false',
        onClick: () => {
          chargeKind = k;
          app.play('tap');
          setCaption(k === 'cutter' ? 'Cutter: cuts the member it is on. Best on loaded columns and core walls.' : 'Blast: weaker on the member, but strips cladding, loosens joints and finds weak points around it.');
          syncTools();
        },
      },
      icon,
      h('span', { text: k === 'cutter' ? 'Cutter' : 'Blast' }),
      count,
    ) as HTMLButtonElement;
    kindBtns.set(k, { el, count });
    kindRow.append(el);
  }

  // The context action: fire, crunch or turn.
  const actionLabel = h('span');
  const actionSub = h('small');
  const actionBtn = h('button', { class: 'wk-action' }, actionLabel, actionSub) as HTMLButtonElement;
  actionBtn.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    if (mode !== 'play') return;
    if (tool === 'excavator') {
      if (sim.state.exc.stunned > 0) return;
      issue({ kind: 'bite', on: true });
      actionBtn.classList.add('held');
    }
  });
  const endCrunch = (): void => {
    actionBtn.classList.remove('held');
    if (sim.state.exc.biting) issue({ kind: 'bite', on: false });
  };
  actionBtn.addEventListener('pointerup', endCrunch);
  actionBtn.addEventListener('pointercancel', endCrunch);
  actionBtn.addEventListener('pointerleave', endCrunch);
  actionBtn.addEventListener('click', () => {
    if (mode !== 'play') return;
    if (tool === 'charge') fire();
    else if (tool === 'dozer') {
      issue({ kind: 'turn' });
      app.play('select');
    }
  });

  const bottom = h('div', { class: 'wk-bottom' }, kindRow, actionBtn, toolbar);
  const stage = h('div', { class: 'wk-stage' }, canvas);
  const el = h('section', { class: 'screen wk' }, stage, top, chips, replayTag, ticker, banner, caption, bottom, panel, sheet);

  let captionUntil = 0;
  /** A one-line prompt over the controls; it clears itself after a while. */
  function setCaption(text: string, ms = 6000): void {
    if (caption.textContent !== text) caption.textContent = text;
    caption.classList.toggle('show', text.length > 0);
    captionUntil = text ? performance.now() + ms : 0;
  }

  const tickerLines: Array<{ el: HTMLElement; at: number }> = [];
  function tick(text: string, tag: string, strong = false): void {
    const line = h('div', { class: `wk-tick${strong ? ' strong' : ''}` }, h('span', { class: 'wk-tick-s', text: tag }), h('span', { text }));
    ticker.append(line);
    tickerLines.push({ el: line, at: performance.now() });
    while (tickerLines.length > 3) tickerLines.shift()?.el.remove();
  }

  function showBanner(text: string, sub = ''): void {
    banner.replaceChildren(h('b', { text }), ...(sub ? [h('span', { text: sub })] : []));
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');
  }

  function floater(text: string, x: number, y: number, tone: Floater['tone'] = 'gold', big = false): void {
    const now = performance.now();
    // Stack on top of any call-out still rising nearby.
    let yy = y;
    for (const f of floaters) if (now - f.at < 1500 && Math.abs(f.x - x) < 10 && Math.abs(f.y - yy) < 2.6) yy = f.y + 2.8;
    floaters.push({ text, x, y: yy, at: now, tone, big });
    if (floaters.length > 24) floaters.shift();
  }

  const tagFor = (rec: RootRecord | undefined): string => {
    if (!rec) return '';
    return rec.tool === 'ball' ? `S${rec.index}` : rec.tool === 'charge' ? `V${rec.index}` : rec.tool === 'excavator' ? `X${rec.index}` : 'D';
  };

  // ---------------------------------------------------------------- tools

  function selectTool(t: Tool): void {
    if (mode !== 'play') return;
    if (tool === 'excavator' && sim.state.exc.biting) issue({ kind: 'bite', on: false });
    if (hold === 'ball') release();
    tool = t;
    hold = undefined;
    manualUntil = 0;
    app.play('select');
    if (!hintsSeen.has(t)) {
      hintsSeen.add(t);
      saveHints(hintsSeen);
    }
    setCaption(HINTS[t]);
    syncTools();
  }

  function syncTools(): void {
    const s = sim.state;
    for (const [t, b] of toolBtns) {
      b.el.setAttribute('aria-pressed', String(t === tool));
      let badge = '';
      if (t === 'charge') badge = `${s.chargesLeft.cutter + s.chargesLeft.blast}`;
      else if (t === 'ball') badge = s.swing ? `${s.swing}` : '';
      else if (t === 'excavator') badge = s.exc.stunned > 0 ? 'Out' : '';
      else badge = s.dozer.stunned > 0 ? 'Out' : '';
      if (b.badge.textContent !== badge) b.badge.textContent = badge;
      b.badge.hidden = badge === '';
    }
    for (const [k, b] of kindBtns) {
      b.el.setAttribute('aria-pressed', String(k === chargeKind));
      const n = String(s.chargesLeft[k]);
      if (b.count.textContent !== n) b.count.textContent = n;
    }
    kindRow.hidden = tool !== 'charge' || mode !== 'play';
    el.classList.toggle('charging', !kindRow.hidden);
    camera.insetBottom = insetBottom();
    const set = s.charges.filter((c) => c.state === 0).length;
    let label = '';
    let sub = '';
    let disabled = false;
    if (tool === 'charge') {
      label = 'Fire';
      sub = set ? `${set} set` : 'none set';
      disabled = set === 0;
    } else if (tool === 'excavator') {
      label = 'Crunch';
      sub = s.exc.stunned > 0 ? 'knocked out' : 'hold';
      disabled = s.exc.stunned > 0;
    } else if (tool === 'dozer') {
      label = 'Turn';
      sub = s.dozer.dir > 0 ? 'facing pit' : 'facing pad';
    }
    actionBtn.hidden = tool === 'ball' || mode !== 'play';
    actionBtn.disabled = disabled;
    actionBtn.classList.toggle('fire', tool === 'charge');
    if (actionLabel.textContent !== label) actionLabel.textContent = label;
    if (actionSub.textContent !== sub) actionSub.textContent = sub;
    toolbar.classList.toggle('off', mode !== 'play');
  }

  /** Applies a command to the live job and logs it for replays. */
  function issue(cmd: Command): string | undefined {
    const s = sim.state;
    const startsAction = cmd.kind === 'release' || cmd.kind === 'detonate' || (cmd.kind === 'bite' && cmd.on);
    if (startsAction && !(cmd.kind === 'detonate' && !s.charges.some((c) => c.state === 0))) {
      snapshots.push({ root: s.actions + 1, state: sim.snapshot(), logIndex: log.length });
      if (snapshots.length > 60) snapshots.splice(0, snapshots.length - 60);
    }
    log.push({ tick: s.tick, cmd });
    return sim.command(cmd);
  }

  function fire(): void {
    const set = sim.state.charges.filter((c) => c.state === 0).length;
    if (!set) {
      app.play('error');
      setCaption('No charges set. Tap a column or core wall to strap one on.');
      return;
    }
    issue({ kind: 'detonate' });
    app.play('arm');
    app.buzz([20, 40, 20]);
    setCaption('');
    syncTools();
  }

  /** The structural member nearest a tap, within a finger's width. */
  function pickPiece(sx: number, sy: number): { piece: PieceDef; y: number } | undefined {
    const w = camera.screenToWorld(sx, sy);
    const s = sim.state;
    const scale = camera.drawScale;
    let best: { piece: PieceDef; score: number } | undefined;
    for (const p of H.def.pieces) {
      if (s.status[p.id] !== PIECE_STANDING || !CHARGE_KINDS.has(p.kind)) continue;
      const dpx = distToRect(w.x, w.y, p.x, p.y, p.w, p.h) * scale;
      if (dpx > 24) continue;
      // Columns and walls beat the slabs they meet.
      const score = dpx + (p.horizontal ? 7 : 0) + (s.charges.some((c) => c.piece === p.id && c.state === 0) ? -4 : 0);
      if (!best || score < best.score) best = { piece: p, score };
    }
    return best ? { piece: best.piece, y: w.y } : undefined;
  }

  function tapCharge(sx: number, sy: number): void {
    const hit = pickPiece(sx, sy);
    if (!hit) {
      setCaption('Tap a column, core wall, slab or the truss.');
      return;
    }
    const p = hit.piece;
    const existing = sim.state.charges.find((c) => c.piece === p.id && c.state === 0);
    if (existing) {
      issue({ kind: 'uncharge', id: existing.id });
      app.play('remove');
      setCaption(`Charge off ${p.label}.`);
      syncTools();
      return;
    }
    let kind = chargeKind;
    if (sim.state.chargesLeft[kind] <= 0) {
      const other: ChargeKind = kind === 'cutter' ? 'blast' : 'cutter';
      if (sim.state.chargesLeft[other] > 0) kind = other;
    }
    const err = issue({ kind: 'charge', piece: p.id, charge: kind, y: hit.y });
    if (err) {
      app.play('error');
      setCaption(err);
      return;
    }
    app.play('place', 1, kind === 'cutter' ? 'shaped' : 'heavy');
    app.buzz(10);
    const n = sim.state.charges.filter((c) => c.state === 0).length;
    const flaw = sim.state.flaw[p.id] === 2 ? ' · weak point, double damage' : '';
    const load = Math.round(sim.solution.load[p.id] as number);
    setCaption(`${kind === 'cutter' ? 'Cutter' : 'Blast'} ${n} on ${p.label} · carries ${load} t${flaw}`);
    syncTools();
  }

  // --------------------------------------------------------------- camera

  const SITE: Bounds = { minX: -6, maxX: 51, minY: 0, maxY: 66 };
  const BUILDING: Bounds = { minX: -3, maxX: 51, minY: 0, maxY: 58 };

  function resize(): boolean {
    const w = Math.floor(stage.clientWidth);
    const hh = Math.floor(stage.clientHeight);
    if (w === renderer.width && hh === renderer.height) return false;
    renderer.resize(w, hh);
    camera.setViewport(w, hh);
    camera.insetTop = 96;
    camera.insetBottom = insetBottom();
    const t = camera.fitTarget(toolBounds(sim), 1);
    camera.x = t.x;
    camera.y = t.y;
    camera.scale = t.scale;
    return true;
  }

  /** Room kept clear at the bottom for the controls and the prompt above them. */
  function insetBottom(): number {
    return mode === 'play' && tool === 'charge' ? 196 : 148;
  }

  function siteBounds(s: WreckSim = sim): Bounds {
    const hook = craneHook(s.state.crane);
    return { minX: Math.min(SITE.minX, hook.x - 5, s.state.ball.x - 4), maxX: SITE.maxX, minY: SITE.minY, maxY: Math.max(SITE.maxY, hook.y + 2) };
  }

  /** What each tool needs to see. */
  function toolBounds(s: WreckSim): Bounds {
    const st = s.state;
    if (tool === 'charge') return BUILDING;
    if (tool === 'excavator') {
      const e = st.exc;
      const tx = e.targetX;
      const minX = Math.min(e.x - 5, e.jawX - 6, tx - 6);
      const maxX = Math.max(e.x + 5, e.jawX + 6, tx + 6);
      const mid = (minX + maxX) / 2;
      const half = Math.max(16, (maxX - minX) / 2);
      return { minX: mid - half, maxX: mid + half, minY: 0, maxY: Math.max(16, e.jawY + 6, e.targetY + 6) };
    }
    if (tool === 'dozer') {
      const d = st.dozer;
      const ahead = d.x + d.dir * 6;
      return { minX: ahead - 19, maxX: ahead + 19, minY: 0, maxY: 12 };
    }
    return siteBounds(s);
  }

  /** Bounds of everything currently moving, plus what still stands. */
  function actionBounds(s: WreckSim): Bounds | undefined {
    let any = false;
    const b = { minX: Infinity, maxX: -Infinity, minY: 0, maxY: -Infinity };
    for (const body of s.state.bodies) {
      if (body.state !== 'moving' || body.mass < 6) continue;
      any = true;
      b.minX = Math.min(b.minX, body.x - body.radius);
      b.maxX = Math.max(b.maxX, body.x + body.radius);
      b.maxY = Math.max(b.maxY, body.y + body.radius);
    }
    if (!any) return undefined;
    for (const p of s.def.pieces) {
      if (s.state.status[p.id] !== PIECE_STANDING) continue;
      b.minX = Math.min(b.minX, p.x);
      b.maxX = Math.max(b.maxX, p.x + p.w);
      b.maxY = Math.max(b.maxY, p.y + p.h);
    }
    return b;
  }

  function direct(dt: number, now: number, s: WreckSim): void {
    let target: { x: number; y: number; scale: number } | undefined;
    const moving = s.movingMass();
    const action = moving > 60 ? actionBounds(s) : undefined;
    const manual = now < manualUntil && !(moving > 300);
    // Never move the view under a finger that is aiming or steering the crane.
    if (manual || hold === 'ball' || hold === 'hook') return;
    if (mode === 'replay' && replay) {
      target = replayTarget(s);
    } else if (action) {
      // Collapses always play out on the whole site: the point is to see all of it go. Keep the tool in shot too.
      target = camera.fitTarget(unionBounds(unionBounds(siteBounds(s), action), mode === 'play' && tool !== 'charge' ? toolBounds(s) : undefined), 2);
    } else if (tool === 'ball' && focus && now < focus.until && mode === 'play') {
      // A gentle push toward where the ball will land, never so close that the building leaves the frame.
      const site = camera.fitTarget(siteBounds(s), 2);
      const close = camera.fitTarget({ minX: focus.x - 19, maxX: focus.x + 19, minY: Math.max(0, focus.y - 24), maxY: focus.y + 24 }, 1);
      target = { x: (site.x + close.x * 2) / 3, y: (site.y + close.y * 2) / 3, scale: Math.min(close.scale, site.scale * 1.7) };
    } else {
      target = camera.fitTarget(mode === 'result' ? { minX: -16, maxX: 64, minY: 0, maxY: 60 } : toolBounds(s), 2);
    }
    // Never spend the screen on what is underground.
    const halfUsable = (renderer.height - camera.insetTop - camera.insetBottom) / 2 / target.scale;
    target.y = Math.max(target.y, halfUsable - 1.5);
    const k = 1 - Math.exp(-dt * (action ? 1.8 : 2.4));
    camera.x += (target.x - camera.x) * k;
    camera.y += (target.y - camera.y) * k;
    camera.scale = Math.exp(Math.log(camera.scale) + (Math.log(target.scale) - Math.log(camera.scale)) * k);
  }

  function unionBounds(a: Bounds, b?: Bounds): Bounds {
    if (!b) return a;
    return { minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minY: Math.min(a.minY, b.minY), maxY: Math.max(a.maxY, b.maxY) };
  }

  function span(xs: number[], ys: number[], minW: number): Bounds {
    let minX = Math.min(...xs);
    let maxX = Math.max(...xs);
    let minY = Math.max(0, Math.min(...ys));
    let maxY = Math.max(...ys);
    if (maxX - minX < minW) {
      const c = (minX + maxX) / 2;
      minX = c - minW / 2;
      maxX = c + minW / 2;
    }
    const minH = minW * 1.2;
    if (maxY - minY < minH) {
      const c = (minY + maxY) / 2;
      minY = Math.max(0, c - minH / 2);
      maxY = minY + minH;
    }
    return { minX, maxX, minY, maxY };
  }

  // ---------------------------------------------------------------- input

  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;
  let pinchMid = { x: 0, y: 0 };

  function local(ev: PointerEvent): { x: number; y: number } {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  function grabTarget(sx: number, sy: number): Hold {
    const ball = sim.state.ball;
    const bs = camera.worldToScreen(ball.x, ball.y);
    const hook = craneHook(sim.state.crane);
    const hs = camera.worldToScreen(hook.x, hook.y);
    const ballR = Math.max(46, BALL_R * camera.drawScale + 26);
    const dBall = Math.hypot(sx - bs.x, sy - bs.y);
    const dHook = Math.hypot(sx - hs.x, sy - hs.y);
    if (dBall < ballR && (dBall <= dHook || dHook > 40)) return 'ball';
    if (dHook < 44) return 'hook';
    return 'pan';
  }

  function steerMachine(sx: number, sy: number): void {
    const w = camera.screenToWorld(sx, sy);
    if (Math.abs(w.x - lastMachineInput.x) < 0.2 && Math.abs(w.y - lastMachineInput.y) < 0.2) return;
    lastMachineInput = { x: w.x, y: w.y };
    if (tool === 'excavator') issue({ kind: 'exc', x: w.x, y: Math.max(0.5, w.y) });
    else {
      // The finger is where the blade should get to.
      const d = sim.state.dozer;
      issue({ kind: 'dozer', x: w.x - d.dir * 3.25 });
    }
  }

  function onDown(ev: PointerEvent): void {
    if (mode !== 'play') {
      if (mode === 'replay') endReplay();
      return;
    }
    if (!panel.hidden) togglePanel(false);
    canvas.setPointerCapture?.(ev.pointerId);
    const p = local(ev);
    pointers.set(ev.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (hold === 'ball') {
        sim.state.ball.aiming = false;
        prediction = undefined;
      }
      hold = 'pinch';
      return;
    }
    if (tool === 'ball') {
      hold = grabTarget(p.x, p.y);
      if (hold === 'ball') {
        const w = camera.screenToWorld(p.x, p.y);
        sim.aim(w.x, w.y);
        prediction = sim.predict();
        app.play('select');
      } else if (hold === 'hook') app.play('tap');
    } else if (tool === 'charge') {
      hold = 'tap';
      tapStart = { x: p.x, y: p.y, t: performance.now() };
    } else {
      const stunned = tool === 'excavator' ? sim.state.exc.stunned > 0 : sim.state.dozer.stunned > 0;
      if (stunned) {
        app.play('error');
        setCaption(`The ${tool} is knocked out for a few seconds.`);
        hold = 'pan';
      } else {
        hold = 'machine';
        steerMachine(p.x, p.y);
      }
    }
    ev.preventDefault();
  }

  function onMove(ev: PointerEvent): void {
    const prev = pointers.get(ev.pointerId);
    if (!prev) return;
    const p = local(ev);
    pointers.set(ev.pointerId, p);
    if (hold === 'tap' && Math.hypot(p.x - tapStart.x, p.y - tapStart.y) > 10) hold = 'pan';
    if (hold === 'ball') {
      const w = camera.screenToWorld(p.x, p.y);
      sim.aim(w.x, w.y);
      prediction = sim.predict();
    } else if (hold === 'hook') {
      const w = camera.screenToWorld(p.x, p.y);
      setHook(w.x, w.y);
    } else if (hold === 'machine') {
      steerMachine(p.x, p.y);
    } else if (hold === 'pan') {
      camera.panBy(p.x - prev.x, p.y - prev.y);
      manualUntil = performance.now() + 4500;
    } else if (hold === 'pinch' && pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (pinchDist > 0) camera.zoomAt(mid.x, mid.y, d / pinchDist);
      camera.panBy(mid.x - pinchMid.x, mid.y - pinchMid.y);
      pinchDist = d;
      pinchMid = mid;
      manualUntil = performance.now() + 4500;
    }
    ev.preventDefault();
  }

  function onUp(ev: PointerEvent): void {
    if (!pointers.has(ev.pointerId)) return;
    pointers.delete(ev.pointerId);
    if (hold === 'ball') release();
    else if (hold === 'tap') {
      const p = local(ev);
      tapCharge(p.x, p.y);
    }
    if (pointers.size === 0) hold = undefined;
    ev.preventDefault();
  }

  function onWheel(ev: WheelEvent): void {
    const r = canvas.getBoundingClientRect();
    camera.zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * 0.0015));
    manualUntil = performance.now() + 4500;
    ev.preventDefault();
  }

  function onKey(ev: KeyboardEvent): void {
    // A focused button already handles its own keys.
    if (mode !== 'play' || ev.target instanceof HTMLButtonElement) return;
    const map: Record<string, Tool> = { '1': 'charge', '2': 'ball', '3': 'excavator', '4': 'dozer' };
    const t = map[ev.key];
    if (t) selectTool(t);
    else if (ev.key === ' ' && tool === 'charge') fire();
  }

  function setHook(x: number, y: number): void {
    if (Math.abs(x - lastHookInput.x) < 0.05 && Math.abs(y - lastHookInput.y) < 0.05) return;
    lastHookInput = { x, y };
    issue({ kind: 'hook', x, y });
  }

  function release(): void {
    const s = sim.state;
    if (!s.ball.aiming) return;
    const p = prediction;
    prediction = undefined;
    issue({ kind: 'release', x: s.ball.x, y: s.ball.y, cable: s.ball.cable });
    app.play('swing', clamp((p?.speed ?? 6) / 18, 0.2, 1));
    if (p && p.hitPiece >= 0) focus = { x: p.hitX, y: p.hitY, until: performance.now() + 2600 };
    setCaption('');
    syncTools();
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKey);

  // ---------------------------------------------------------------- events

  const label = (id: number): string => (H.def.pieces[id] as PieceDef | undefined)?.label ?? 'something';

  function react(events: WreckEvent[], s: WreckSim, live: boolean): void {
    fx.ingest(events, s);
    for (const e of events) {
      switch (e.type) {
        case 'hit': {
          const k = Math.min(1, e.energy / 700);
          app.play('impact', 0.3 + k * 0.7);
          if (e.material === 'glass') app.play('glass', k);
          else app.play('crack', 0.4 + k * 0.6, e.material === 'steel' ? 'steel' : e.material === 'brick' ? 'brick' : e.material === 'wood' ? 'wood' : 'concrete');
          if (e.energy > 160) {
            hitstop = Math.max(hitstop, 0.05 + k * 0.08);
            app.buzz(Math.round(18 + k * 40));
          }
          if (live && e.energy > 120 && e.piece >= 0 && performance.now() - lastBigHit > 500) {
            lastBigHit = performance.now();
            const dead = e.destroyed ? ' smashed' : ` hit, ${Math.round(e.energy)} kJ`;
            tick(`${label(e.piece)}${dead}`, tagFor(s.state.roots[e.swing]));
          }
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
          else if (e.cause === 'overload') app.play('crack', 0.8, e.material === 'steel' ? 'steel' : e.material === 'brick' ? 'brick' : 'concrete');
          break;
        case 'detach': {
          if (e.mass > 140) {
            app.play('failMajor', 1, 'concrete');
            app.buzz([30, 30, 60]);
            if (live) tick(`${Math.round(e.mass)} t came loose`, tagFor(s.state.roots[e.root]), true);
          } else if (e.mass > 25) app.play('topple', 0.6);
          if (e.mass > 400) app.play('rumble', Math.min(1, e.mass / 1200));
          break;
        }
        case 'land': {
          if (e.mass > 120) {
            app.play('heavyLanding', 1);
            app.buzz(50);
          } else if (e.mass > 15) app.play('impact', Math.min(1, e.mass / 120));
          else app.play('crumble', 0.3);
          break;
        }
        case 'arm':
          app.play('fuse');
          if (live) {
            const rec = s.state.roots[e.root];
            showBanner(`Volley ${rec?.index ?? 1}`, `${e.count} charge${e.count === 1 ? '' : 's'}`);
          }
          break;
        case 'blast': {
          app.play('detonate', e.kind === 'blast' ? 1 : 0.8, e.kind === 'blast' ? 'heavy' : 'shaped');
          app.buzz(e.kind === 'blast' ? [40, 20, 60] : 40);
          hitstop = Math.max(hitstop, 0.06);
          if (live) {
            if (e.cause === 'ball') {
              floater('Ball set it off +400', e.x, e.y + 2, 'gold', true);
              app.play('bonus');
            } else if (e.cause === 'debris') floater('Debris set it off +200', e.x, e.y + 2);
            else if (e.cause === 'chain') floater('Sympathetic +200', e.x, e.y + 2);
          }
          break;
        }
        case 'reveal': {
          app.play('reveal');
          if (live) {
            const p = H.def.pieces[e.piece] as PieceDef;
            const note = FLAWS[H.flaws.indexOf(e.piece)]?.note ?? 'weak point';
            tick(`Weak point: ${p.label}, ${note}`, 'Found', true);
            floater('Weak point', p.x + p.w / 2, p.y + p.h + 1, 'gold');
          }
          break;
        }
        case 'bite':
          if (e.target === 'air') app.play('push', 0.2);
          else {
            app.play('bite', e.target === 'block' || e.target === 'structure' ? 0.9 : 0.6);
            app.buzz(14);
          }
          if (live && e.target === 'vault') {
            floater('Careful: that is the vault', e.x, e.y + 1.5, 'red');
            app.play('error');
          }
          break;
        case 'blockBreak':
          app.play('crack', 0.9, e.material === 'steel' ? 'steel' : 'concrete');
          if (live) floater(e.material === 'steel' ? 'Cut' : 'Broken', e.x, e.y + 1, 'white');
          break;
        case 'ram':
          app.play('impact', 0.35);
          break;
        case 'salvage': {
          if (!live) break;
          if (e.kind === 'vault') {
            if (e.where === 'pad') {
              showBanner('Vault recovered', `${Math.round(e.value * 100)}% intact`);
              app.play('newBest');
            } else {
              floater('Vault lost in the pit', e.x, e.y + 2, 'red', true);
              app.play('fail');
            }
          } else if (e.kind === 'steel') {
            if (e.where === 'pad') {
              floater(`+${Math.round(e.value)} t steel`, e.x, e.y + 2);
              app.play('cash');
            } else floater('Steel scrapped', e.x, e.y + 2, 'white');
          } else app.play('crumble', 0.5);
          break;
        }
        case 'chargeLost':
          if (live) floater('Charge lost', e.x, e.y + 1, 'white');
          break;
        case 'machineHit':
          app.play('warning');
          app.buzz([60, 40, 60]);
          if (live) {
            floater(`${e.machine === 'dozer' ? 'Dozer' : 'Excavator'} hit -300`, e.x, e.y + 2, 'red', true);
            setCaption(`The ${e.machine} took a hit and is out for a few seconds. Keep machines clear of anything still falling.`);
          }
          break;
        default:
          break;
      }
    }
  }

  function noteFailures(before: Map<number, number>, s: WreckSim): void {
    for (const rec of s.state.roots) {
      if (!rec || rec.firstFailPiece < 0) continue;
      if (before.get(rec.swing) === rec.firstFailPiece) continue;
      if (rec.tool === 'excavator' || rec.tool === 'dozer') continue;
      tick(`${label(rec.firstFailPiece)} ${KIND_VERB[rec.firstFailKind]}`, tagFor(rec), true);
    }
  }

  /** Chain milestones and weak points used, as they happen. */
  function noteProgress(): void {
    const s = sim.state;
    const now = performance.now();
    for (const rec of s.roots) {
      if (!rec || rec.chain < 5) continue;
      const step = Math.floor(rec.chain / 5) * 5;
      const prev = chainShown.get(rec.swing);
      if (prev && (prev.step >= step || now - prev.at < 800)) continue;
      chainShown.set(rec.swing, { step, at: now });
      const x = rec.hitX || 25;
      const y = rec.hitY || 20;
      floater(`Chain ×${step}`, x, y + 4, 'gold', step >= 15);
      if (step >= 10 && !prev) app.play('bonus');
    }
    if (s.tally.flawsExploited > flawsSeen) {
      flawsSeen = s.tally.flawsExploited;
      floater('Weak point used +250', 25, 30, 'gold');
    }
  }

  // ------------------------------------------------------------ job state

  function updateStatus(now: number): void {
    if (now - lastStatusAt < 250) return;
    lastStatusAt = now;
    status = jobStatus(sim);
    const sc = scoreJob(sim);
    scoreEl.textContent = sc.total.toLocaleString('en-US');
    lotFill.style.transform = `scaleX(${status.clear.toFixed(3)})`;
    if (mode !== 'play') return;
    if (status.down && !wasDown) {
      wasDown = true;
      showBanner('Down', 'Now clear the lot');
      app.play('bonus');
      setCaption('Down. Crunch stumps and heavy slabs, then doze the rubble off the lot.');
    }
    const vs = status.vault;
    if (!shownVault && (vs === 'exposed' || vs === 'buried')) {
      shownVault = true;
      tick('The vault is out of the core', 'Vault', true);
      if (!status.down || tool === 'dozer') setCaption('The vault is out of the core. Push it onto the salvage pad on the left, not into the pit.');
    }
    const d = sim.state.dozer;
    if (tool === 'dozer' && d.stall && now - stallSaidAt > 4000) {
      if (d.stall === 'heavy') setCaption('Too heavy for the blade. Break that slab up with the excavator first.');
      else if (d.stall === 'structure') setCaption('Something is still standing in the way. Ram it, or crunch it with the excavator.');
      else if (d.stall === 'full') setCaption('The blade is full: what it cannot carry spills behind. Back up and take another pass.');
      stallSaidAt = now;
    }
    if (!finishAt && (status.complete || status.overtime)) {
      finishAt = now + (status.complete ? 1600 : 600);
      if (status.complete) {
        showBanner('Lot clear', 'Job done');
        app.play('total');
      } else {
        showBanner('Shift over', status.down ? 'The lot is not clear' : 'It is still standing');
        app.play('fail');
      }
    }
    if (finishAt && now >= finishAt) finish();
    if (!panel.hidden) buildPanel();
  }

  function togglePanel(force?: boolean): void {
    const open = force ?? panel.hidden;
    panel.hidden = !open;
    jobBtn.setAttribute('aria-pressed', String(open));
    if (open) buildPanel();
  }

  function buildPanel(): void {
    const st = status;
    const t = sim.state.tally;
    const row = (done: boolean, text: string, value: string): HTMLElement =>
      h('li', { class: done ? 'done' : '' }, h('i', { 'aria-hidden': 'true' }), h('span', { text }), h('b', { text: value }));
    const vaultText: Record<JobStatus['vault'], string> = { inside: 'in the core', buried: 'buried', exposed: 'out, push it left', saved: `saved, ${Math.round(t.vaultSaved * 100)}%`, scrapped: 'lost' };
    panel.replaceChildren(
      h('h3', { text: 'The job' }),
      h(
        'ul',
        { class: 'wk-objectives' },
        row(st.down, 'Bring the Exchange down', `${Math.round(st.standing * 100)}% up`),
        row(st.cleared, `Clear ${Math.round(CLEAR_AT * 100)}% of the lot`, `${Math.round(st.clear * 100)}%`),
      ),
      h('h3', { text: 'Bonus' }),
      h(
        'ul',
        { class: 'wk-objectives' },
        row(t.vaultSaved >= 0, 'Get the vault onto the salvage pad', vaultText[st.vault]),
        row(st.down && st.collateral < 0.5, 'Keep debris off Pellow’s', st.collateral < 0.5 ? 'clean' : `${st.collateral.toFixed(1)} m²`),
        row(t.steelSalvaged > 0, 'Salvage the steel', `${Math.round(t.steelSalvaged)} t`),
      ),
      h('p', { class: 'wk-panel-note', text: `The clock starts when something moves. Par ${fmtClock(PAR)}, the shift ends at ${fmtClock(SHIFT)}.` }),
      h(
        'div',
        { class: 'wk-panel-row' },
        h('button', {
          class: 'wk-chip',
          'aria-pressed': String(stressView),
          text: 'Loads view',
          onClick: () => {
            stressView = !stressView;
            app.play('tap');
            setCaption(stressView ? 'Loads: amber parts are working hard, red parts are failing.' : '', 5000);
            buildPanel();
          },
        }),
        h('button', {
          class: 'wk-chip',
          text: 'Restart',
          onClick: () => {
            app.play('tap');
            restart();
          },
        }),
      ),
      ...(st.down
        ? [
            h('button', {
              class: 'btn btn-block',
              text: 'Sign off the job now',
              onClick: () => {
                app.play('select');
                togglePanel(false);
                finish();
              },
            }),
          ]
        : []),
    );
  }

  // ---------------------------------------------------------------- result

  function finish(): void {
    if (mode === 'result') return;
    if (sim.state.exc.biting) issue({ kind: 'bite', on: false });
    mode = 'result';
    crew = undefined;
    finishAt = 0;
    const sc = scoreJob(sim);
    const isBest = sc.total > record.best;
    const newFeats = sc.feats.filter((f) => f.earned && !record.feats.includes(f.id)).map((f) => f.id);
    record = {
      best: Math.max(record.best, sc.total),
      grade: isBest ? sc.grade : record.grade,
      runs: record.runs + 1,
      feats: [...record.feats, ...newFeats],
    };
    saveRecord(record);
    app.play(isBest ? 'newBest' : 'settled');
    setCaption('');
    hold = undefined;
    prediction = undefined;
    togglePanel(false);
    buildSheet(sc, isBest, newFeats);
    sheet.hidden = false;
    syncTools();
    requestAnimationFrame(() => sheet.classList.add('open'));
  }

  function decisive(): RootRecord | undefined {
    let best: RootRecord | undefined;
    for (const r of roots(sim)) {
      if (!snapshots.some((sn) => sn.root === r.swing)) continue;
      if (!best || r.mass > best.mass) best = r;
    }
    return best;
  }

  function story(rec: RootRecord): HTMLElement[] {
    const out: HTMLElement[] = [];
    const total = H.def.totalMass;
    const what =
      rec.tool === 'ball'
        ? `Swing ${rec.index}`
        : rec.tool === 'charge'
          ? `Volley ${rec.index}`
          : rec.tool === 'excavator'
            ? `Crunch ${rec.index}`
            : 'The dozer';
    const verb =
      rec.tool === 'ball'
        ? `struck ${rec.hitPiece >= 0 ? `${label(rec.hitPiece)} at ${rec.hitSpeed.toFixed(1)} m/s` : 'a glancing blow'}`
        : rec.tool === 'charge'
          ? `fired ${rec.charges} charge${rec.charges === 1 ? '' : 's'}, starting on ${rec.hitPiece >= 0 ? label(rec.hitPiece) : 'the frame'}`
          : `bit into ${rec.hitPiece >= 0 ? label(rec.hitPiece) : 'the frame'}`;
    out.push(h('p', { class: 'wk-hit' }, h('b', { text: what }), ` ${verb}.`));
    if (rec.firstFailPiece >= 0) {
      const delay = Math.max(0, rec.firstFailT - rec.hitT);
      const when = delay < 0.4 ? 'at once' : `${delay.toFixed(1)} s later`;
      const same = rec.firstFailPiece === rec.hitPiece;
      out.push(h('p', { text: `${same ? 'It' : label(rec.firstFailPiece)} ${KIND_VERB[rec.firstFailKind]} ${when}.` }));
    }
    out.push(h('p', { text: `${Math.round(rec.mass).toLocaleString('en-US')} t came down from it, ${Math.round((rec.mass / total) * 100)}% of the building, in a chain of ${rec.chain}.` }));
    return out;
  }

  function buildSheet(sc: JobScore, isBest: boolean, newFeats: string[]): void {
    sheet.replaceChildren();
    const rec = decisive();
    const totalEl = h('b', { class: 'wk-total', text: '0' });
    const lines = h(
      'ul',
      { class: 'wk-lines' },
      ...sc.lines.map((l, i) =>
        h(
          'li',
          { class: l.points < 0 ? 'neg' : '', style: `animation-delay:${120 + i * 90}ms` },
          h('span', { text: l.label }),
          h('small', { text: l.detail }),
          h('b', { text: `${l.points > 0 ? '+' : ''}${l.points.toLocaleString('en-US')}` }),
        ),
      ),
    );
    const feats = h(
      'ul',
      { class: 'wk-feats' },
      ...sc.feats.map((f) =>
        h(
          'li',
          { class: `${f.earned ? 'earned' : ''}${newFeats.includes(f.id) ? ' new' : ''}${record.feats.includes(f.id) && !f.earned ? ' had' : ''}` },
          h('b', { text: f.name }),
          h('span', { text: f.how }),
        ),
      ),
    );
    const st = sc.status;
    const headline = st.complete ? 'Job done' : st.down ? 'Down, lot not clear' : 'Still standing';
    sheet.append(
      h('div', { class: 'wk-grip', 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'wk-result-head' },
        h('span', { class: `wk-grade g-${sc.grade}`, text: sc.grade }),
        h('div', {}, h('h2', { text: headline }), h('p', { class: 'wk-best', text: isBest ? (record.runs > 1 ? 'New best' : 'First job on the books') : `Best ${record.best.toLocaleString('en-US')}` }), totalEl),
      ),
      h('p', { class: 'wk-summary', text: `${fmtClock(st.clock)} on the clock · ${sim.state.swing} swing${sim.state.swing === 1 ? '' : 's'} · ${sim.state.tally.chargesFired} charge${sim.state.tally.chargesFired === 1 ? '' : 's'} · ${sim.state.tally.bites} bites · lot ${Math.round(st.clear * 100)}% clear` }),
      lines,
      ...(rec ? [h('div', { class: 'wk-story' }, h('h3', { text: 'The move that did the most' }), ...story(rec))] : []),
      h('h3', { class: 'wk-feats-h', text: `Feats ${sc.feats.filter((f) => f.earned || record.feats.includes(f.id)).length}/${sc.feats.length}` }),
      feats,
      h(
        'div',
        { class: 'wk-actions' },
        rec
          ? h('button', {
              class: 'btn btn-block',
              text: 'Watch it again',
              onClick: () => {
                app.play('tap');
                startReplay(rec.swing);
              },
            })
          : null,
        h('button', {
          class: 'btn btn-primary btn-block',
          text: 'Try another way',
          onClick: () => {
            app.play('select');
            restart();
          },
        }),
      ),
    );
    sheet.scrollTop = 0;
    // Count the total up.
    const start = performance.now();
    const dur = 900 + sc.lines.length * 90;
    const count = (now: number): void => {
      if (disposed || sheet.hidden) return;
      const k = Math.min(1, (now - start) / dur);
      const v = Math.round(sc.total * (1 - Math.pow(1 - k, 3)));
      totalEl.textContent = v.toLocaleString('en-US');
      if (k < 1) requestAnimationFrame(count);
    };
    requestAnimationFrame(count);
  }

  function restart(): void {
    endReplay(false);
    sim = new WreckSim(undefined, H);
    log = [];
    snapshots = [];
    mode = 'play';
    hold = undefined;
    prediction = undefined;
    focus = undefined;
    crew = undefined;
    lastHookInput = { x: NaN, y: NaN };
    lastMachineInput = { x: NaN, y: NaN };
    floaters = [];
    chainShown = new Map();
    flawsSeen = 0;
    wasDown = false;
    shownVault = false;
    finishAt = 0;
    status = jobStatus(sim);
    fx.clear();
    sheet.classList.remove('open');
    sheet.hidden = true;
    togglePanel(false);
    ticker.replaceChildren();
    tickerLines.length = 0;
    replayTag.hidden = true;
    manualUntil = 0;
    tool = 'charge';
    setCaption(HINTS.charge);
    syncTools();
  }

  // ---------------------------------------------------------------- replay

  function startReplay(root: number): void {
    const snap = snapshots.find((sn) => sn.root === root);
    const rec = sim.state.roots[root];
    if (!snap || !rec) return;
    const rsim = new WreckSim(structuredClone(snap.state), H);
    // Play the action and its consequences, but stop before the next one starts.
    const own = log.slice(snap.logIndex);
    const isRoot = (c: Command): boolean => c.kind === 'release' || c.kind === 'detonate' || (c.kind === 'bite' && c.on);
    const next = own.findIndex((l, i) => i > 0 && isRoot(l.cmd));
    const replayLog = next > 0 ? own.slice(0, next) : own;
    const stopAt = next > 0 ? (own[next] as Logged).tick : Infinity;
    const endTick = Math.min(stopAt, snap.state.tick + Math.round(18 / DT), Math.round((Math.max(rec.lastT, rec.hitT) + 3.5) / DT));
    replay = { root, sim: rsim, log: replayLog, cursor: 0, endTick, record: rec };
    chips.hidden = true;
    mode = 'replay';
    fx.clear();
    sheet.classList.remove('open');
    sheet.hidden = true;
    replayTag.hidden = false;
    replayTag.textContent = `Replay · ${tagFor(rec)}`;
    ticker.replaceChildren();
    tickerLines.length = 0;
    manualUntil = 0;
    setCaption('Tap to skip');
    syncTools();
  }

  function endReplay(showSheet = true): void {
    if (!replay) return;
    replay = undefined;
    replayTag.hidden = true;
    chips.hidden = false;
    fx.clear();
    setCaption('');
    if (showSheet && mode === 'replay') {
      mode = 'result';
      sheet.hidden = false;
      requestAnimationFrame(() => sheet.classList.add('open'));
    }
    syncTools();
  }

  function applyLog(r: NonNullable<typeof replay>): void {
    const st = r.sim.state;
    while (r.cursor < r.log.length && (r.log[r.cursor] as Logged).tick <= st.tick) {
      r.sim.command((r.log[r.cursor] as Logged).cmd);
      r.cursor++;
    }
  }

  function replayTarget(s: WreckSim): { x: number; y: number; scale: number } {
    const r = replay as NonNullable<typeof replay>;
    const action = actionBounds(s);
    if (action && s.movingMass() > 60) return camera.fitTarget(unionBounds(siteBounds(s), action), 2);
    const t = s.state.time;
    if (r.record.tool === 'ball' && t < r.record.hitT + 0.6) {
      const hook = craneHook(s.state.crane);
      return camera.fitTarget(span([hook.x, s.state.ball.x, r.record.hitX + 6], [r.record.hitY - 6, r.record.hitY + 6, s.state.ball.y], 24), 2);
    }
    return camera.fitTarget({ minX: r.record.hitX - 16, maxX: r.record.hitX + 16, minY: Math.max(0, r.record.hitY - 20), maxY: r.record.hitY + 20 }, 1);
  }

  // ------------------------------------------------------------------ loop

  function aimCaption(): void {
    const pr = prediction;
    if (!pr) return;
    if (pr.hitPiece < 0) {
      setCaption('Misses. Pull further, or move the crane closer.');
      return;
    }
    const p = H.def.pieces[pr.hitPiece] as PieceDef;
    const s = sim.state;
    const intact = p.hp > 0 ? Math.max(0, Math.round(((s.hp[p.id] as number) / p.hp) * 100)) : 100;
    const load = sim.solution.load[p.id] as number;
    const carries = p.carriesOthers ? ` · carries ${Math.round(load)} t` : '';
    const energy = 0.5 * BALL_MASS * pr.speed * pr.speed;
    const charged = s.charges.some((c) => c.piece === p.id && c.state === 0) ? ' · sets off its charge' : '';
    const flaw = s.flaw[p.id] === 2 ? ' · weak point' : '';
    setCaption(`${p.label}${carries} · ${intact}% intact · ${pr.speed.toFixed(1)} m/s (${Math.round(energy)} kJ)${flaw}${charged}`);
  }

  function frame(now: number): void {
    if (disposed) return;
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    resize();
    const active = mode === 'replay' && replay ? replay.sim : sim;

    if (hitstop > 0) {
      hitstop -= dt;
    } else if (mode === 'replay' && replay) {
      const r = replay;
      // Slow motion around the moment it starts, real time for the fall.
      const t = r.sim.state.time;
      const nearHit = Math.abs(t - r.record.hitT) < 0.5;
      accumulator += dt * (nearHit ? 0.3 : 1);
      while (accumulator >= DT) {
        applyLog(r);
        const ev = r.sim.step();
        react(ev, r.sim, false);
        accumulator -= DT;
        if (r.sim.state.tick >= r.endTick) break;
      }
      if (r.sim.state.tick >= r.endTick || (r.sim.state.time > r.record.hitT + 2 && r.sim.state.quietFor > 1.5)) endReplay();
    } else {
      accumulator += dt * timeScale;
      let steps = 0;
      const before = new Map<number, number>();
      for (const rec of sim.state.roots) if (rec) before.set(rec.swing, rec.firstFailPiece);
      while (accumulator >= DT && steps < 4 * timeScale) {
        if (crew && mode === 'play') for (const c of crew.tick(sim)) issue(c);
        const ev = sim.step();
        react(ev, sim, true);
        accumulator -= DT;
        steps++;
      }
      if (accumulator > DT * 4 * timeScale) accumulator = 0;
      noteFailures(before, sim);
      noteProgress();
      if (hold === 'ball') {
        prediction = sim.predict();
        aimCaption();
      }
      const d = sim.state.dozer;
      if (d.bladeDown && Math.abs(d.speed) > 0.5 && d.load > 0.4 && now - lastPushSound > 300) {
        lastPushSound = now;
        app.play('push', Math.min(1, d.load / 12));
        app.play('engine', Math.min(1, d.load / 12));
      }
      updateStatus(now);
    }

    // HUD.
    const s = active.state;
    const frac = active.standingFraction;
    standFill.style.transform = `scaleX(${frac.toFixed(3)})`;
    const clock = active.clock;
    const started = s.tally.clockStart >= 0;
    clockEl.textContent = started ? fmtClock(clock) : 'Prep';
    clockEl.className = !started ? 'prep' : clock > SHIFT - 60 ? 'late' : clock > PAR ? 'over' : '';
    for (const line of tickerLines) {
      if (now - line.at > 4200) line.el.classList.add('fade');
    }
    if (s.tick % 6 === 0) syncTools();
    if (captionUntil && now > captionUntil && hold !== 'ball') setCaption('');
    floaters = floaters.filter((f) => now - f.at < 1900);

    fx.update(dt, active);
    direct(dt, now, active);
    camera.punch = fx.punch;
    if (fx.shake > 0 && !app.reducedMotion) {
      const amp = fx.shake * 7;
      camera.shakeX = (Math.random() - 0.5) * amp;
      camera.shakeY = (Math.random() - 0.5) * amp;
    } else {
      camera.shakeX = 0;
      camera.shakeY = 0;
    }
    renderer.draw(active, camera, fx, {
      time: now / 1000,
      prediction: hold === 'ball' ? prediction : undefined,
      stressView,
      handles: mode === 'play' && !(tool === 'ball' && Math.hypot(s.ball.vx, s.ball.vy) > 3 && hold !== 'hook'),
      holding: hold === 'ball' || hold === 'hook' ? hold : undefined,
      highlight: mode === 'replay' && replay ? replay.record.hitPiece : undefined,
      tool: mode === 'play' ? tool : 'ball',
      floaters,
      now,
    });
    raf = requestAnimationFrame(frame);
  }

  // First visit: a short job sheet. After that, straight in.
  if (!hintsSeen.has('brief')) showBrief();
  else setCaption(HINTS.charge);
  syncTools();
  raf = requestAnimationFrame(frame);

  function showBrief(): void {
    const close = (): void => {
      hintsSeen.add('brief');
      hintsSeen.add('charge');
      saveHints(hintsSeen);
      brief.remove();
      app.play('select');
      setCaption(HINTS.charge);
    };
    const step = (n: string, title: string, text: string): HTMLElement => h('li', {}, h('b', { text: n }), h('div', {}, h('strong', { text: title }), h('span', { text })));
    const brief = h(
      'div',
      { class: 'wk-brief', role: 'dialog', 'aria-label': 'Job sheet' },
      h(
        'div',
        { class: 'wk-brief-card' },
        h('p', { class: 'wk-brief-kicker', text: 'Job sheet' }),
        h('h2', { text: 'The Halden Exchange' }),
        h('p', { text: 'Fifteen storeys on a tight lot. Bring it down, clear the lot, and keep it off the bakery next door.' }),
        h(
          'ol',
          { class: 'wk-brief-steps' },
          step('1', 'Charges', 'Strap them to columns and core walls. They fire in the order you set them.'),
          step('2', 'Ball', 'Finish what the charges started. Hit a charge to set it off.'),
          step('3', 'Excavator', 'Crunch stumps, hung-up sections and slabs too heavy to push.'),
          step('4', 'Dozer', 'Push the rubble into the haul pit. Steel and the vault go to the salvage pad.'),
        ),
        h('p', { class: 'wk-brief-note', text: `The bank vault is inside the core. The clock starts when something moves; par is ${fmtClock(PAR)}.` }),
        h('button', { class: 'btn btn-primary btn-block', text: 'Start the job', onClick: close }),
      ),
    );
    el.append(brief);
  }

  // Debug and automation hook (the smoke test drives the job through it).
  (window as unknown as { __wreck?: unknown }).__wreck = {
    get sim() {
      return sim;
    },
    camera,
    get mode() {
      return mode;
    },
    get status() {
      return jobStatus(sim);
    },
    tool(t: Tool) {
      selectTool(t);
    },
    issue,
    swing(pullX: number, pullY: number) {
      const hook = craneHook(sim.state.crane);
      sim.aim(hook.x + pullX, hook.y + pullY);
      prediction = sim.predict();
      release();
    },
    hook(x: number, y: number) {
      setHook(x, y);
    },
    /** Hands the job to an automated crew, or takes it back. */
    autoplay(strategy: Strategy | false) {
      crew = strategy ? new Crew(strategy) : undefined;
    },
    speed(k: number) {
      timeScale = Math.max(1, Math.min(16, Math.round(k)));
    },
    finish,
    vault() {
      return vaultBlock(sim);
    },
    site: SITE_LAYOUT,
    down: DOWN_AT,
  };

  return {
    el,
    destroy: () => {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    },
  };
}
