import type { App, ScreenInstance } from '../../app';
import { clamp } from '../../core/format';
import { Camera, type Bounds } from '../../render/camera';
import { WreckFx } from '../../wreck/fx';
import { WreckRenderer } from '../../wreck/render';
import { BALL_MASS, BALL_R, DT, PIECE_STANDING, craneHook, halden, WreckSim, type Prediction, type RootRecord, type WreckEvent, type WreckState } from '../../wreck/sim';
import type { PieceDef } from '../../wreck/structure';
import { h } from '../dom';

type Mode = 'play' | 'result' | 'replay';
type Hold = 'ball' | 'hook' | 'pan' | 'pinch' | undefined;

interface Input {
  tick: number;
  kind: 'hook' | 'release';
  x: number;
  y: number;
  cable: number;
}

/** Below this share of the building still standing, the job is done. */
const DOWN_AT = 0.12;
const BEST_KEY = 'demo-day-wreck-v1';

interface Best {
  swings: number;
  runs: number;
}

function loadBest(): Best | undefined {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (!raw) return undefined;
    const v = JSON.parse(raw) as Partial<Best>;
    if (typeof v.swings !== 'number' || v.swings <= 0) return undefined;
    return { swings: v.swings, runs: typeof v.runs === 'number' ? v.runs : 1 };
  } catch {
    return undefined;
  }
}

function saveBest(b: Best): void {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(b));
  } catch {
    // Private mode: the record just will not persist.
  }
}

const KIND_VERB: Record<RootRecord['firstFailKind'], string> = {
  buckled: 'buckled under the load',
  'tore loose': 'tore loose from its supports',
  crushed: 'was crushed',
  tipped: 'became the pivot as the block overturned',
  '': '',
};

/**
 * Searches crane positions and pulls for the hardest hit on the most heavily
 * loaded piece in reach. Automation only: the smoke test plays with it.
 */
export function planSwing(sim: WreckSim): { hx: number; hy: number; px: number; py: number; piece: number } | undefined {
  let best: { s: number; hx: number; hy: number; px: number; py: number; piece: number } | undefined;
  for (let hx = -8; hx <= 40; hx += 3) {
    for (let hy = 24; hy <= 62; hy += 4) {
      const probe = new WreckSim(structuredClone(sim.state), sim.h);
      probe.setHookTarget(hx, hy);
      probe.settleCrane();
      const hk = craneHook(probe.state.crane);
      for (const L of [10, 16, 22, 28]) {
        for (const ang of [-0.6, -0.9, -1.2]) {
          probe.aim(hk.x + Math.sin(ang) * L, hk.y - Math.cos(ang) * L);
          const pr = probe.predict();
          if (pr.hitPiece < 0) continue;
          const e = 0.5 * BALL_MASS * pr.speed * pr.speed;
          const p = sim.def.pieces[pr.hitPiece] as PieceDef;
          const sc = (p.carriesOthers ? (probe.solution.load[pr.hitPiece] as number) : 1) * Math.min(1, e / 600);
          if (!best || sc > best.s) best = { s: sc, hx, hy, px: probe.state.ball.x - hk.x, py: probe.state.ball.y - hk.y, piece: pr.hitPiece };
        }
      }
    }
  }
  return best;
}

const ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';

/**
 * The wrecking-ball job: one big building, one crane, as many swings as it
 * takes. Every swing is recorded, so the hit that started the collapse can be
 * found and replayed.
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
  let inputs: Input[] = [];
  let snapshots: Array<{ swing: number; state: WreckState; inputIndex: number }> = [];
  let hold: Hold;
  let prediction: Prediction | undefined;
  let stressView = false;
  let siteView = false;
  let manualUntil = 0;
  let hitstop = 0;
  let accumulator = 0;
  let raf = 0;
  let disposed = false;
  let lastFrame = performance.now();
  let downAt = 0;
  let lastBigHit = 0;
  let replay: { swing: number; sim: WreckSim; inputs: Input[]; cursor: number; endTick: number; record: RootRecord; slow: number } | undefined;
  let focus: { x: number; y: number; until: number } | undefined;
  let best = loadBest();
  let lastHookInput = { x: NaN, y: NaN };

  // ------------------------------------------------------------------ DOM

  const swingEl = h('b', { text: '0' });
  const standEl = h('b', { text: '100%' });
  const meterFill = h('i');
  const caption = h('div', { class: 'wk-caption', role: 'status' });
  const ticker = h('div', { class: 'wk-ticker', 'aria-live': 'polite' });
  const replayTag = h('div', { class: 'wk-replay-tag', hidden: true });
  const sheet = h('div', { class: 'wk-sheet', hidden: true });

  const siteBtn = h('button', { class: 'wk-chip', 'aria-pressed': 'false', text: 'Site' });
  const loadsBtn = h('button', { class: 'wk-chip', 'aria-pressed': 'false', text: 'Loads' });
  const resetBtn = h('button', { class: 'wk-chip', text: 'Restart' });
  siteBtn.addEventListener('click', () => {
    siteView = !siteView;
    siteBtn.setAttribute('aria-pressed', String(siteView));
    manualUntil = 0;
    app.play('tap');
  });
  loadsBtn.addEventListener('click', () => {
    stressView = !stressView;
    loadsBtn.setAttribute('aria-pressed', String(stressView));
    app.play('tap');
    setCaption(stressView ? 'Loads: amber parts are working hard, red parts are failing.' : '');
  });
  resetBtn.addEventListener('click', () => {
    app.play('tap');
    restart();
  });

  const top = h(
    'header',
    { class: 'wk-top' },
    h('button', { class: 'wk-back', 'aria-label': 'Back to menu', html: ICON_BACK, onClick: () => app.go('menu') }),
    h(
      'div',
      { class: 'wk-title' },
      h('span', { class: 'wk-name', text: H.def.name }),
      h('span', { class: 'wk-stats' }, h('span', {}, 'Swing ', swingEl), h('span', {}, 'Standing ', standEl)),
      h('span', { class: 'wk-meter', 'aria-hidden': 'true' }, meterFill),
    ),
  );
  const tools = h('div', { class: 'wk-tools' }, siteBtn, loadsBtn, resetBtn);
  const stage = h('div', { class: 'wk-stage' }, canvas);
  const el = h('section', { class: 'screen wk' }, stage, top, tools, replayTag, ticker, caption, sheet);

  function setCaption(text: string): void {
    if (caption.textContent !== text) caption.textContent = text;
    caption.classList.toggle('show', text.length > 0);
  }

  const tickerLines: Array<{ el: HTMLElement; at: number }> = [];
  function tick(text: string, swing: number, strong = false): void {
    const line = h('div', { class: `wk-tick${strong ? ' strong' : ''}` }, h('span', { class: 'wk-tick-s', text: `S${swing}` }), h('span', { text }));
    ticker.append(line);
    tickerLines.push({ el: line, at: performance.now() });
    while (tickerLines.length > 3) tickerLines.shift()?.el.remove();
  }

  // --------------------------------------------------------------- camera

  const SITE: Bounds = { minX: -6, maxX: 51, minY: 0, maxY: 66 };

  function resize(): boolean {
    const w = Math.floor(stage.clientWidth);
    const hh = Math.floor(stage.clientHeight);
    if (w === renderer.width && hh === renderer.height) return false;
    renderer.resize(w, hh);
    camera.setViewport(w, hh);
    camera.insetTop = 112;
    camera.insetBottom = 76;
    const t = camera.fitTarget(siteBounds(), 1);
    camera.x = t.x;
    camera.y = t.y;
    camera.scale = t.scale;
    return true;
  }

  function siteBounds(s: WreckSim = sim): Bounds {
    const hook = craneHook(s.state.crane);
    return { minX: Math.min(SITE.minX, hook.x - 5, s.state.ball.x - 4), maxX: SITE.maxX, minY: SITE.minY, maxY: Math.max(SITE.maxY, hook.y + 2) };
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
    // Never move the view under a finger that is aiming or steering.
    if (manual || hold === 'ball' || hold === 'hook') return;
    if (mode === 'replay' && replay) {
      target = replayTarget(s, now);
    } else if (action || siteView || mode === 'result') {
      // Collapses always play out on the whole site: the point is to see all of it go.
      target = camera.fitTarget(unionBounds(siteBounds(s), action), 2);
    } else if (focus && now < focus.until) {
      // A gentle push toward where the ball will land, never so close that the building leaves the frame.
      const site = camera.fitTarget(siteBounds(s), 2);
      const close = camera.fitTarget({ minX: focus.x - 19, maxX: focus.x + 19, minY: Math.max(0, focus.y - 24), maxY: focus.y + 24 }, 1);
      target = { x: (site.x + close.x * 2) / 3, y: (site.y + close.y * 2) / 3, scale: Math.min(close.scale, site.scale * 1.7) };
    } else {
      target = camera.fitTarget(siteBounds(s), 2);
    }
    if (!target) return;
    const k = 1 - Math.exp(-dt * (action ? 1.8 : 2.2));
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

  function onDown(ev: PointerEvent): void {
    if (mode !== 'play') {
      if (mode === 'replay') endReplay();
      return;
    }
    canvas.setPointerCapture?.(ev.pointerId);
    const p = local(ev);
    pointers.set(ev.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (hold === 'ball') release();
      hold = 'pinch';
      return;
    }
    hold = grabTarget(p.x, p.y);
    if (hold === 'ball') {
      const w = camera.screenToWorld(p.x, p.y);
      sim.aim(w.x, w.y);
      prediction = sim.predict();
      app.play('select');
    } else if (hold === 'hook') {
      app.play('tap');
    }
    ev.preventDefault();
  }

  function onMove(ev: PointerEvent): void {
    const prev = pointers.get(ev.pointerId);
    if (!prev) return;
    const p = local(ev);
    pointers.set(ev.pointerId, p);
    if (hold === 'ball') {
      const w = camera.screenToWorld(p.x, p.y);
      sim.aim(w.x, w.y);
      prediction = sim.predict();
    } else if (hold === 'hook') {
      const w = camera.screenToWorld(p.x, p.y);
      setHook(w.x, w.y);
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
    if (pointers.size === 0) hold = undefined;
    ev.preventDefault();
  }

  function onWheel(ev: WheelEvent): void {
    const r = canvas.getBoundingClientRect();
    camera.zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * 0.0015));
    manualUntil = performance.now() + 4500;
    ev.preventDefault();
  }

  function setHook(x: number, y: number): void {
    if (Math.abs(x - lastHookInput.x) < 0.05 && Math.abs(y - lastHookInput.y) < 0.05) return;
    lastHookInput = { x, y };
    sim.setHookTarget(x, y);
    inputs.push({ tick: sim.state.tick, kind: 'hook', x, y, cable: 0 });
  }

  function release(): void {
    const s = sim.state;
    if (!s.ball.aiming) return;
    const p = prediction;
    prediction = undefined;
    snapshots.push({ swing: s.swing + 1, state: sim.snapshot(), inputIndex: inputs.length });
    inputs.push({ tick: s.tick, kind: 'release', x: s.ball.x, y: s.ball.y, cable: s.ball.cable });
    sim.release();
    app.play('swing', clamp((p?.speed ?? 6) / 18, 0.2, 1));
    if (p && p.hitPiece >= 0) {
      focus = { x: p.hitX, y: p.hitY, until: performance.now() + 2600 };
    }
    setCaption('');
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

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
          if (live && e.energy > 120 && performance.now() - lastBigHit > 500) {
            lastBigHit = performance.now();
            const dead = e.destroyed ? ' smashed' : ` hit, ${Math.round(e.energy)} kJ`;
            tick(`${label(e.piece)}${dead}`, e.swing);
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
            if (live) tick(`${Math.round(e.mass)} t came loose`, e.root, true);
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
        default:
          break;
      }
    }
  }

  function noteFailures(before: Map<number, number>, s: WreckSim): void {
    for (const rec of s.state.roots) {
      if (!rec || rec.firstFailPiece < 0) continue;
      if (before.get(rec.swing) === rec.firstFailPiece) continue;
      tick(`${label(rec.firstFailPiece)} ${KIND_VERB[rec.firstFailKind]}`, rec.swing, true);
    }
  }

  // ---------------------------------------------------------------- result

  function finish(): void {
    mode = 'result';
    const swings = sim.state.swing;
    const isBest = !best || swings < best.swings;
    best = { swings: isBest ? swings : (best as Best).swings, runs: (best?.runs ?? 0) + 1 };
    saveBest(best);
    app.play(isBest ? 'newBest' : 'settled');
    setCaption('');
    hold = undefined;
    prediction = undefined;
    buildSheet(isBest);
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('open'));
  }

  function buildSheet(isBest: boolean): void {
    sheet.replaceChildren();
    const swings = sim.state.swing;
    const rec = sim.decisiveSwing();
    const total = H.def.totalMass;
    const roots = sim.state.roots.filter(Boolean) as RootRecord[];
    const maxMass = Math.max(1, ...roots.map((r) => r.mass));
    const strip = h(
      'div',
      { class: 'wk-strip', role: 'img', 'aria-label': 'Tonnes brought down by each swing' },
      ...roots.map((r) =>
        h(
          'span',
          { class: `wk-bar${rec && r.swing === rec.swing ? ' key' : ''}` },
          h('i', { style: `height:${Math.max(4, (r.mass / maxMass) * 100)}%` }),
          h('small', { text: String(r.swing) }),
        ),
      ),
    );
    const story: HTMLElement[] = [];
    if (rec) {
      const hit = rec.hitPiece >= 0 ? `${label(rec.hitPiece)}, ${rec.hitSpeed.toFixed(1)} m/s` : 'a glancing blow';
      story.push(h('p', { class: 'wk-hit' }, h('b', { text: `Swing ${rec.swing}` }), ` struck ${hit}.`));
      if (rec.firstFailPiece >= 0) {
        const delay = Math.max(0, rec.firstFailT - rec.hitT);
        const when = delay < 0.4 ? 'at once' : `${delay.toFixed(1)} s later`;
        const same = rec.firstFailPiece === rec.hitPiece;
        story.push(h('p', { text: `${same ? 'It' : label(rec.firstFailPiece)} ${KIND_VERB[rec.firstFailKind]} ${when}.` }));
      }
      story.push(h('p', { text: `${Math.round(rec.mass).toLocaleString('en-US')} t came down from that one swing, ${Math.round((rec.mass / total) * 100)}% of the building.` }));
    }
    sheet.append(
      h('div', { class: 'wk-grip', 'aria-hidden': 'true' }),
      h('h2', {}, `Down in ${swings} swing${swings === 1 ? '' : 's'}`),
      h('p', { class: 'wk-best', text: isBest ? (best && best.runs > 1 ? 'New best.' : 'First demolition on the books.') : `Best: ${best?.swings} swings.` }),
      h('div', { class: 'wk-story' }, h('h3', { text: 'The hit that did it' }), ...story),
      strip,
      h(
        'div',
        { class: 'wk-actions' },
        rec
          ? h('button', {
              class: 'btn btn-block',
              text: 'Watch the hit',
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
  }

  function restart(): void {
    endReplay(false);
    sim = new WreckSim(undefined, H);
    inputs = [];
    snapshots = [];
    mode = 'play';
    downAt = 0;
    hold = undefined;
    prediction = undefined;
    focus = undefined;
    lastHookInput = { x: NaN, y: NaN };
    fx.clear();
    sheet.classList.remove('open');
    sheet.hidden = true;
    ticker.replaceChildren();
    tickerLines.length = 0;
    replayTag.hidden = true;
    manualUntil = 0;
    setCaption(FIRST_HINT);
  }

  // ---------------------------------------------------------------- replay

  function startReplay(swing: number): void {
    const snap = snapshots.find((sn) => sn.swing === swing);
    const rec = sim.state.roots[swing];
    if (!snap || !rec) return;
    const rsim = new WreckSim(structuredClone(snap.state), H);
    // Play the swing and its consequences, but stop before the next swing is let go.
    const own = inputs.slice(snap.inputIndex);
    const nextRelease = own.findIndex((inp, i) => i > 0 && inp.kind === 'release');
    const replayInputs = nextRelease > 0 ? own.slice(0, nextRelease) : own;
    const stopAt = nextRelease > 0 ? (own[nextRelease] as Input).tick : Infinity;
    const endTick = Math.min(stopAt, snap.state.tick + Math.round(16 / DT), Math.round((Math.max(rec.lastT, rec.hitT) + 3.5) / DT));
    replay = { swing, sim: rsim, inputs: replayInputs, cursor: 0, endTick, record: rec, slow: 0 };
    tools.hidden = true;
    mode = 'replay';
    fx.clear();
    sheet.classList.remove('open');
    sheet.hidden = true;
    replayTag.hidden = false;
    replayTag.textContent = `Replay · swing ${swing}`;
    ticker.replaceChildren();
    tickerLines.length = 0;
    manualUntil = 0;
    setCaption('Tap to skip');
  }

  function endReplay(showSheet = true): void {
    if (!replay) return;
    replay = undefined;
    replayTag.hidden = true;
    tools.hidden = false;
    fx.clear();
    setCaption('');
    if (showSheet && mode === 'replay') {
      mode = 'result';
      sheet.hidden = false;
      requestAnimationFrame(() => sheet.classList.add('open'));
    }
  }

  function applyInputs(r: NonNullable<typeof replay>): void {
    const st = r.sim.state;
    while (r.cursor < r.inputs.length && (r.inputs[r.cursor] as Input).tick <= st.tick) {
      const inp = r.inputs[r.cursor] as Input;
      if (inp.kind === 'hook') r.sim.setHookTarget(inp.x, inp.y);
      else {
        st.ball.x = inp.x;
        st.ball.y = inp.y;
        st.ball.cable = inp.cable;
        st.ball.vx = 0;
        st.ball.vy = 0;
        st.ball.aiming = true;
        r.sim.release();
      }
      r.cursor++;
    }
  }

  function replayTarget(s: WreckSim, _now: number): { x: number; y: number; scale: number } {
    const r = replay as NonNullable<typeof replay>;
    const action = actionBounds(s);
    if (action && s.movingMass() > 60) return camera.fitTarget(unionBounds(siteBounds(s), action), 2);
    const t = s.state.time;
    if (t < r.record.hitT + 0.6) {
      const hook = craneHook(s.state.crane);
      return camera.fitTarget(span([hook.x, s.state.ball.x, r.record.hitX + 6], [r.record.hitY - 6, r.record.hitY + 6, s.state.ball.y], 24), 2);
    }
    return camera.fitTarget({ minX: r.record.hitX - 16, maxX: r.record.hitX + 16, minY: Math.max(0, r.record.hitY - 20), maxY: r.record.hitY + 20 }, 1);
  }

  // ------------------------------------------------------------------ loop

  const FIRST_HINT = 'Drag the ball back and let go to swing. Drag the boom tip to move the crane.';

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
    setCaption(`${p.label}${carries} · ${intact}% intact · hits at ${pr.speed.toFixed(1)} m/s (${Math.round(energy)} kJ)`);
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
      // Slow motion around the strike, real time for the fall.
      const t = r.sim.state.time;
      const nearHit = Math.abs(t - r.record.hitT) < 0.5;
      const rate = nearHit ? 0.3 : 1;
      accumulator += dt * rate;
      while (accumulator >= DT) {
        applyInputs(r);
        const ev = r.sim.step();
        react(ev, r.sim, false);
        accumulator -= DT;
        if (r.sim.state.tick >= r.endTick) break;
      }
      if (r.sim.state.tick >= r.endTick || (r.sim.state.time > r.record.hitT + 2 && r.sim.state.quietFor > 1.5)) endReplay();
    } else {
      accumulator += dt;
      let steps = 0;
      const before = new Map<number, number>();
      for (const rec of sim.state.roots) if (rec) before.set(rec.swing, rec.firstFailPiece);
      while (accumulator >= DT && steps < 4) {
        const ev = sim.step();
        react(ev, sim, true);
        accumulator -= DT;
        steps++;
      }
      if (accumulator > DT * 4) accumulator = 0;
      noteFailures(before, sim);
      if (hold === 'ball') {
        prediction = sim.predict();
        aimCaption();
      }
      if (mode === 'play') {
        const frac = sim.standingFraction;
        if (frac <= DOWN_AT && sim.state.quietFor > 1.2) {
          if (!downAt) downAt = now;
          if (now - downAt > 900) finish();
        }
      }
    }

    // HUD.
    const s = active.state;
    swingEl.textContent = String(s.swing);
    const frac = active.standingFraction;
    standEl.textContent = `${Math.round(frac * 100)}%`;
    meterFill.style.transform = `scaleX(${frac.toFixed(3)})`;
    for (const line of tickerLines) {
      const age = now - line.at;
      if (age > 4200) line.el.classList.add('fade');
    }

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
      handles: mode === 'play' && !(Math.hypot(s.ball.vx, s.ball.vy) > 3 && hold !== 'hook'),
      holding: hold === 'ball' || hold === 'hook' ? hold : undefined,
      highlight: mode === 'replay' && replay ? replay.record.hitPiece : undefined,
    });
    raf = requestAnimationFrame(frame);
  }

  setCaption(FIRST_HINT);
  raf = requestAnimationFrame(frame);

  // Debug and automation hook (the smoke test drives swings through it).
  (window as unknown as { __wreck?: unknown }).__wreck = {
    get sim() {
      return sim;
    },
    camera,
    swing(pullX: number, pullY: number) {
      const hook = craneHook(sim.state.crane);
      sim.aim(hook.x + pullX, hook.y + pullY);
      prediction = sim.predict();
      release();
    },
    hook(x: number, y: number) {
      setHook(x, y);
    },
    finish,
    /** Plans the hardest hit on the most heavily loaded piece in reach (used by the smoke test). */
    plan() {
      return planSwing(sim);
    },
  };

  return {
    el,
    destroy: () => {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
}
