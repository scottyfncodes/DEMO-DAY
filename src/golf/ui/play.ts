import type { App, ScreenInstance } from '../../app';
import { h } from '../../ui/dom';
import { ICON } from '../../ui/icons';
import { sheet } from '../../ui/screens/common';
import { GolfRenderer, type ViewState } from '../render/scene';
import { predict, solveAim, type Prediction } from '../sim/aim';
import { BALLS, BALL_ORDER, type BallId } from '../sim/balls';
import { CAMPAIGN, POWERUPS, getLevel, objectiveText, type LevelDef, type Objective, type PowerUpId } from '../sim/levels';
import { MATERIALS } from '../sim/materials';
import type { Part } from '../sim/parts';
import { Session, type ShotReport } from '../sim/session';
import { DT, type SimEvent } from '../sim/world';
import { GICON, ballSwatch } from './icons';

/**
 * The golf play screen: the 3D lot, touch aiming, power, ball and power-up
 * selection, the HUD, shot cards and results. Everything that changes the
 * game goes through Session; this file only reads it and draws.
 */

const YAW_MAX = 38;
const PITCH_MIN = -3;
const PITCH_MAX = 62;
const POWERUP_ORDER: PowerUpId[] = ['drive', 'ricochet', 'precision', 'golfers'];

function levelFor(app: App, id: string): LevelDef {
  const base = getLevel(id);
  if (base.mode !== 'sandbox') return base;
  // The sandbox carries every ball met so far in the campaign.
  const balls: LevelDef['balls'] = {};
  for (const b of app.golf.unlockedBalls()) if (b !== 'standard') balls[b] = Infinity;
  return { ...base, balls };
}

/** Parts to pin for an objective: the things the player has to hit. */
function pinsFor(session: Session): number[] {
  const P = session.world.parts;
  const out: number[] = [];
  for (const o of session.level.objectives) {
    if (o.kind === 'target') for (const p of P) if (p.tags.includes(o.tag)) out.push(p.id);
    if (o.kind === 'collapse' && o.what === 'porch') for (const p of P) if (p.kind === 'column' && p.tags.includes('porch')) out.push(p.id);
    if (o.kind === 'collapse' && o.what === 'chimney') {
      const base = P.filter((p) => p.tags.includes('chimney') && p.kind === 'brick').sort((a, b) => a.y - b.y)[0];
      if (base) out.push(base.id);
    }
  }
  return out.slice(0, 6);
}

export function golfPlayScreen(app: App, params: Record<string, string>): ScreenInstance {
  const level = levelFor(app, params.id ?? 'c1');
  const store = app.golf;
  let session = new Session(level);
  store.started(level);

  const lowPower = (navigator.hardwareConcurrency ?? 8) <= 4;
  const canvas = h('canvas', { class: 'golf-canvas', 'aria-label': 'Golf course and house. Drag to aim.' });
  const renderer = new GolfRenderer(canvas, session.world, { lowPower, reducedMotion: app.reducedMotion });

  const aim = { yaw: 0, pitch: level.fullGuide ? 11 : 9, power: 0.82 };
  let ball: BallId = 'standard';
  let peek = false;
  let zoom = false;
  let prediction: Prediction | null = null;
  let predDirty = true;
  let fast = false;
  let slowmo = 0;
  let introOpen = true;
  let resultShown = false;
  let pins = pinsFor(session);

  // ---------------------------------------------------------------- HUD

  const objList = h('ul', { class: 'g-objectives' });
  const shotsEl = h('b', { class: 'g-shots-n' });
  const shotsBox = h('div', { class: 'g-shots', 'aria-label': 'Shots left' }, shotsEl, h('small', { text: level.mode === 'sandbox' ? 'shots' : 'shots left' }));
  const scoreEl = h('span', { class: 'g-score' });
  const streakEl = h('span', { class: 'g-streak' });
  const levelCard = h(
    'div',
    { class: 'g-card' },
    h('div', { class: 'g-card-head' }, h('span', { class: 'g-no', text: level.number }), h('b', { text: level.title }), scoreEl),
    objList,
    streakEl,
  );
  const pauseBtn = h('button', { class: 'icon-btn', 'aria-label': 'Pause', html: ICON.pause, onClick: () => openPause() });
  const top = h('header', { class: 'g-top' }, pauseBtn, levelCard, shotsBox);

  const windEl = h('div', { class: 'g-wind hidden' });
  if (level.wind && Math.hypot(level.wind.x, level.wind.z) > 0.05) {
    const wx = level.wind.x;
    const strength = Math.abs(wx) < 0.3 ? 'Light' : Math.abs(wx) < 0.7 ? 'Steady' : 'Strong';
    windEl.classList.remove('hidden');
    windEl.append(h('span', { class: 'icon', html: GICON.wind }), h('span', { text: `${strength} wind ${wx > 0 ? 'to the right' : 'to the left'}` }));
  }

  const zoomBtn = h('button', { class: 'icon-btn', 'aria-label': 'Zoom on the house', 'aria-pressed': 'false', html: GICON.zoom, onClick: () => toggleZoom() });
  const peekBtn = h('button', { class: 'icon-btn', 'aria-label': 'See inside', 'aria-pressed': 'false', html: GICON.peek, onClick: () => togglePeek() });
  const restartBtn = h('button', { class: 'icon-btn', 'aria-label': 'Restart level', html: GICON.restart, onClick: () => restart() });
  const side = h('div', { class: 'g-side' }, zoomBtn, peekBtn, restartBtn);

  // Power: a vertical bar on the right edge.
  const powerFill = h('div', { class: 'g-power-fill' });
  const powerKnob = h('div', { class: 'g-power-knob' });
  const powerVal = h('b', { class: 'g-power-val' });
  const powerTrack = h('div', { class: 'g-power-track', role: 'slider', 'aria-label': 'Shot power', 'aria-valuemin': '0', 'aria-valuemax': '100', tabindex: '0' }, powerFill, powerKnob);
  const power = h('div', { class: 'g-power' }, h('small', { text: 'POWER' }), powerTrack, powerVal);

  const ballRow = h('div', { class: 'g-balls', role: 'radiogroup', 'aria-label': 'Ball' });
  const puRow = h('div', { class: 'g-powerups' });
  const ballNote = h('p', { class: 'g-note' });
  const caption = h('p', { class: 'g-caption', 'aria-live': 'polite' });
  const fireBtn = h('button', { class: 'g-fire', 'aria-label': 'Fire' }, h('span', { text: 'FIRE' }));
  const fastBtn = h('button', { class: 'btn ghost sm g-fast hidden', onClick: () => setFast(!fast) }, h('span', { class: 'icon', html: ICON.ff }), h('span', { text: 'Speed up' }));
  const bottom = h('div', { class: 'g-bottom' }, ballNote, h('div', { class: 'g-pick' }, caption, ballRow, puRow), h('div', { class: 'g-controls' }, power, fireBtn), fastBtn);

  const shotCard = h('div', { class: 'g-shotcard', 'aria-live': 'polite' });
  const callouts = h('div', { class: 'g-callouts', 'aria-hidden': 'true' });
  const coach = h('div', { class: 'g-coach hidden', role: 'status' });

  const el = h('main', { class: 'screen golf-play' }, canvas, callouts, top, windEl, side, shotCard, coach, bottom);

  // ------------------------------------------------------------ controls

  const ammoText = (b: BallId): string => {
    if (b === 'standard') return '';
    const n = session.ammo[b] ?? 0;
    return Number.isFinite(n) ? String(n) : '';
  };

  const renderBalls = (): void => {
    ballRow.replaceChildren();
    const available = BALL_ORDER.filter((b) => b === 'standard' || b in level.balls);
    if (!session.canUse(ball)) ball = 'standard';
    for (const b of available) {
      const ok = session.canUse(b);
      const btn = h(
        'button',
        {
          class: `g-ball${b === ball ? ' on' : ''}${ok ? '' : ' empty'}`,
          role: 'radio',
          'aria-checked': String(b === ball),
          'aria-label': `${BALLS[b].name} ball${ammoText(b) ? `, ${ammoText(b)} left` : ''}`,
          disabled: !ok,
          onClick: () => selectBall(b),
        },
        h('span', { class: 'g-swatch', html: ballSwatch(b) }),
        h('span', { class: 'g-ball-name', text: BALLS[b].name }),
        ammoText(b) ? h('span', { class: 'g-count', text: ammoText(b) }) : null,
      );
      ballRow.append(btn);
    }
    ballRow.classList.toggle('single', available.length === 1);
    renderCaption();
  };

  const renderPowerups = (): void => {
    puRow.replaceChildren();
    for (const p of POWERUP_ORDER) {
      if (!(p in level.powerups)) continue;
      const n = session.powerups[p] ?? 0;
      const armed = session.armed.has(p);
      const active = p === 'precision' && session.precisionLeft > 0;
      puRow.append(
        h(
          'button',
          {
            class: `g-pu${armed || active ? ' on' : ''}`,
            'aria-pressed': String(armed),
            'aria-label': `${POWERUPS[p].name}${Number.isFinite(n) ? `, ${n} left` : ''}`,
            disabled: (n <= 0 && !armed) || active,
            onClick: () => togglePowerup(p),
          },
          h('span', { class: 'icon', html: GICON[p] }),
          h('span', { class: 'g-pu-name', text: POWERUPS[p].name }),
          active ? h('span', { class: 'g-count', text: String(session.precisionLeft) }) : Number.isFinite(n) ? h('span', { class: 'g-count', text: String(n) }) : null,
        ),
      );
    }
    puRow.classList.toggle('hidden', !puRow.childElementCount);
    renderCaption();
  };

  // Names the chosen ball and anything armed, so icon-only chips on a phone still say what they do.
  const renderCaption = (): void => {
    const on = POWERUP_ORDER.filter((p) => session.armed.has(p) || (p === 'precision' && session.precisionLeft > 0));
    caption.replaceChildren(
      h('b', { text: BALLS[ball].name }),
      h('span', { text: ` · ${BALLS[ball].hint}` }),
      ...on.map((p) => h('span', { class: 'g-caption-pu', text: ` + ${POWERUPS[p].name}` })),
    );
    caption.classList.toggle('hidden', ballRow.classList.contains('single') && puRow.classList.contains('hidden'));
  };

  let noteTimer = 0;
  const note = (text: string): void => {
    if (!coach.classList.contains('hidden')) return;
    ballNote.textContent = text;
    ballNote.classList.add('show');
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => ballNote.classList.remove('show'), 3200);
  };

  const selectBall = (b: BallId): void => {
    if (session.phase !== 'aim' || !session.canUse(b)) return;
    ball = b;
    app.play('select');
    note(`${BALLS[b].name}: ${BALLS[b].blurb}`);
    predDirty = true;
    renderBalls();
  };

  const togglePowerup = (p: PowerUpId): void => {
    if (!session.toggle(p)) return app.play('error');
    app.play(session.armed.has(p) ? 'arm' : 'tap');
    if (session.armed.has(p)) note(`${POWERUPS[p].name}: ${POWERUPS[p].blurb}`);
    predDirty = true;
    renderPowerups();
  };

  const toggleZoom = (): void => {
    zoom = !zoom;
    zoomBtn.classList.toggle('on', zoom);
    zoomBtn.setAttribute('aria-pressed', String(zoom));
    app.play('tap');
  };
  const togglePeek = (): void => {
    peek = !peek;
    peekBtn.classList.toggle('on', peek);
    peekBtn.setAttribute('aria-pressed', String(peek));
    app.play('tap');
  };

  const setPower = (v: number): void => {
    aim.power = Math.max(0, Math.min(1, Math.round(v * 100) / 100));
    const pct = Math.round(aim.power * 100);
    powerFill.style.width = `${pct}%`;
    powerKnob.style.left = `calc(${pct}% - 14px)`;
    powerVal.textContent = `${pct}%`;
    powerTrack.setAttribute('aria-valuenow', String(pct));
    predDirty = true;
  };
  setPower(aim.power);

  const powerFromEvent = (ev: PointerEvent): void => {
    const r = powerTrack.getBoundingClientRect();
    setPower((ev.clientX - r.left) / r.width);
    advanceCoach('power');
  };
  powerTrack.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    powerTrack.setPointerCapture(ev.pointerId);
    powerFromEvent(ev);
  });
  powerTrack.addEventListener('pointermove', (ev) => {
    if (powerTrack.hasPointerCapture(ev.pointerId)) powerFromEvent(ev);
  });
  powerTrack.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowRight') setPower(aim.power + 0.01);
    else if (ev.key === 'ArrowDown' || ev.key === 'ArrowLeft') setPower(aim.power - 0.01);
    else return;
    ev.preventDefault();
    ev.stopPropagation();
  });

  // Aiming: drag anywhere on the lot. Relative and slow, so it can be precise with a thumb.
  let drag: { id: number; x: number; y: number; yaw: number; pitch: number; moved: number } | null = null;
  canvas.addEventListener('pointerdown', (ev) => {
    if (session.phase !== 'aim' || introOpen) return;
    canvas.setPointerCapture(ev.pointerId);
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, yaw: aim.yaw, pitch: aim.pitch, moved: 0 };
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!drag || drag.id !== ev.pointerId) return;
    const sens = zoom ? 0.035 : 0.07;
    const dx = ev.clientX - drag.x;
    const dy = ev.clientY - drag.y;
    drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
    aim.yaw = Math.max(-YAW_MAX, Math.min(YAW_MAX, drag.yaw + dx * sens));
    aim.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, drag.pitch - dy * sens * 0.9));
    predDirty = true;
    if (drag.moved > 30) advanceCoach('drag');
  });
  const endDrag = (ev: PointerEvent): void => {
    if (drag && drag.id === ev.pointerId) drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  const onKey = (ev: KeyboardEvent): void => {
    if (introOpen || resultShown) return;
    const fine = ev.shiftKey ? 0.05 : 0.4;
    let handled = true;
    switch (ev.key) {
      case 'ArrowLeft':
        aim.yaw = Math.max(-YAW_MAX, aim.yaw - fine);
        break;
      case 'ArrowRight':
        aim.yaw = Math.min(YAW_MAX, aim.yaw + fine);
        break;
      case 'ArrowUp':
        aim.pitch = Math.min(PITCH_MAX, aim.pitch + fine);
        break;
      case 'ArrowDown':
        aim.pitch = Math.max(PITCH_MIN, aim.pitch - fine);
        break;
      case 'w':
      case 'W':
        setPower(aim.power + 0.02);
        break;
      case 's':
      case 'S':
        setPower(aim.power - 0.02);
        break;
      case ' ':
      case 'Enter':
        fire();
        break;
      case 'z':
        toggleZoom();
        break;
      case 'x':
        togglePeek();
        break;
      case 'r':
        restart();
        break;
      default: {
        const n = Number(ev.key);
        const avail = BALL_ORDER.filter((b) => b === 'standard' || b in level.balls);
        if (n >= 1 && n <= avail.length) selectBall(avail[n - 1] as BallId);
        else handled = false;
      }
    }
    if (handled) {
      predDirty = true;
      ev.preventDefault();
    }
  };
  window.addEventListener('keydown', onKey);

  // Stop the page from scrolling or zooming under the game; normal pages are unaffected.
  const stopTouch = (ev: TouchEvent): void => {
    if (ev.target instanceof Element && ev.target.closest('.sheet')) return;
    ev.preventDefault();
  };
  el.addEventListener('touchmove', stopTouch, { passive: false });

  // ---------------------------------------------------------------- fire

  const fire = (): void => {
    if (session.phase !== 'aim' || introOpen) return;
    if (session.shotsLeft <= 0) return;
    const ok = session.fire({ ball, yaw: aim.yaw, pitch: aim.pitch, power: aim.power });
    if (!ok) {
      app.play('error');
      return;
    }
    app.play('thwack', aim.power);
    app.buzz(10);
    advanceCoach('fire');
    renderAll();
  };
  fireBtn.addEventListener('click', fire);

  const setFast = (on: boolean): void => {
    fast = on;
    fastBtn.classList.toggle('on', on);
  };

  // ------------------------------------------------------------ coaching

  const tips = level.tips ?? [];
  let tipIndex = 0;
  const coachKinds: Array<'drag' | 'power' | 'fire' | 'any'> = level.id === 'c1' && !store.data.coached ? ['drag', 'power', 'fire'] : [];
  const showTip = (): void => {
    const t = tips[tipIndex];
    if (!t || introOpen) {
      coach.classList.add('hidden');
      return;
    }
    coach.replaceChildren(h('p', { text: t }), h('button', { class: 'link', text: tipIndex < tips.length - 1 ? 'Next' : 'Got it', onClick: () => advanceCoach('any') }));
    coach.classList.remove('hidden');
  };
  const advanceCoach = (kind: 'drag' | 'power' | 'fire' | 'any'): void => {
    if (tipIndex >= tips.length) return;
    const need = coachKinds[tipIndex] ?? 'any';
    if (kind !== 'any' && need !== kind && kind !== 'fire') return;
    tipIndex = kind === 'fire' ? Math.max(tipIndex + 1, coachKinds.length) : tipIndex + 1;
    if (tipIndex >= tips.length && level.id === 'c1') {
      store.data.coached = true;
      store.save();
    }
    showTip();
  };

  // ---------------------------------------------------------- HUD state

  const renderObjectives = (): void => {
    objList.replaceChildren();
    const objs: Objective[] = level.objectives;
    if (!objs.length) {
      objList.append(h('li', { class: 'g-obj' }, h('span', { text: level.mode === 'sandbox' ? `Destruction ${Math.floor(session.world.destruction() * 100)}%` : `Medals at ${(level.medals ?? []).map((m) => m.toLocaleString('en-US')).join(' / ')}` })));
      return;
    }
    for (const o of objs) {
      const [a, b] = session.progress(o);
      const done = a >= b;
      const prog = o.kind === 'target' || o.kind === 'enter' || o.kind === 'through' || (o.kind === 'collapse' && o.what !== 'roof') ? '' : o.kind === 'destruction' ? `${Math.min(a, b)}%` : o.kind === 'score' ? '' : `${Math.min(a, b)}/${b}`;
      objList.append(h('li', { class: `g-obj${done ? ' done' : ''}` }, h('span', { class: 'g-check', html: done ? ICON.check : '' }), h('span', { text: objectiveText(o) }), prog ? h('b', { text: prog }) : null));
    }
  };

  const renderAll = (): void => {
    shotsEl.textContent = Number.isFinite(session.shotsLeft) ? String(session.shotsLeft) : '∞';
    shotsBox.classList.toggle('low', Number.isFinite(session.shotsLeft) && session.shotsLeft <= 1);
    scoreEl.textContent = session.score.toLocaleString('en-US');
    streakEl.textContent = session.streak >= 2 ? `Streak ${session.streak} · x${(1 + 0.25 * (session.streak - 1)).toFixed(2).replace(/0$/, '')}` : '';
    streakEl.classList.toggle('hidden', session.streak < 2);
    renderObjectives();
    renderBalls();
    renderPowerups();
    const aiming = session.phase === 'aim';
    el.classList.toggle('flying', !aiming);
    fireBtn.disabled = !aiming || session.shotsLeft <= 0;
    fastBtn.classList.toggle('hidden', aiming);
    if (aiming) setFast(false);
  };

  // ------------------------------------------------------------ callouts

  const callout = (text: string, x: number, y: number, z: number, tone: 'big' | 'good' | '' = ''): void => {
    const p = renderer.project(x, y, z);
    if (!p) return;
    if (callouts.childElementCount > 5) callouts.firstElementChild?.remove();
    const c = h('span', { class: `g-callout ${tone}`, text });
    c.style.left = `${Math.max(40, Math.min(renderer.width - 40, p.x))}px`;
    c.style.top = `${Math.max(120, p.y)}px`;
    callouts.append(c);
    window.setTimeout(() => c.remove(), 1300);
  };

  const showShotCard = (r: ShotReport): void => {
    const lines = r.lines.slice(0, 3);
    shotCard.replaceChildren(
      h('div', { class: 'g-shot-points' }, h('b', { text: r.points > 0 ? `+${r.points.toLocaleString('en-US')}` : '0' }), r.multiplier > 1 ? h('span', { text: `x${r.multiplier.toFixed(2).replace(/0$/, '')} streak` }) : null),
      h('ul', {}, ...lines.map((l) => h('li', { text: l }))),
    );
    shotCard.classList.remove('show');
    void shotCard.offsetWidth;
    shotCard.classList.add('show');
    window.setTimeout(() => shotCard.classList.remove('show'), 2600);
    if (r.points > 0) app.play('countTick', 0.6);
  };

  // ------------------------------------------------------- sound and feel

  const sounds = (events: SimEvent[]): void => {
    const P = session.world.parts;
    let breaks = 0;
    for (const e of events) {
      switch (e.t) {
        case 'hit': {
          const p = P[e.part] as Part;
          const m = MATERIALS[p.mat];
          const s = Math.min(1, e.speed / 22);
          if (p.kind === 'glass') break;
          const ballDef = session.world.balls.find((b) => b.id === e.ball)?.def;
          if (ballDef?.id === 'super' && !e.broke) app.play('ping', s);
          else if (!e.broke) app.play(m.sound === 'soft' || m.sound === 'leaf' ? 'thump' : 'crack', s * 0.6, m.sound === 'wood' ? 'wood' : m.sound === 'steel' ? 'steel' : m.sound === 'concrete' ? 'concrete' : 'brick');
          break;
        }
        case 'break': {
          const p = P[e.part] as Part;
          const m = MATERIALS[p.mat];
          breaks++;
          if (breaks > 4) break;
          if (m.sound === 'glass' || m.sound === 'ceramic') app.play('glass', p.kind === 'glass' ? 0.8 : 0.5);
          else app.play('crack', 0.7, m.sound === 'wood' ? 'wood' : m.sound === 'steel' ? 'steel' : m.sound === 'concrete' ? 'concrete' : 'brick');
          break;
        }
        case 'seam':
          app.play('seam');
          callout('SEAM', e.x, e.y + 0.5, e.z, 'big');
          app.buzz([8, 30, 8]);
          break;
        case 'ground':
          app.play('thump', Math.min(1, e.speed / 15));
          break;
        case 'leaves':
          app.play('rustle', 0.6);
          break;
        case 'knock': {
          const p = P[e.part] as Part;
          app.play('impact', 0.3);
          if (p.kind === 'decor' || p.tags.includes('target')) callout(p.label ?? 'Hit', e.x, e.y + 0.8, e.z, 'good');
          break;
        }
        case 'creak':
          app.play('creak', 0.6);
          break;
        case 'collapse':
          app.play(e.count > 40 || e.roof ? 'heavyLanding' : 'rumble', Math.min(1, e.count / 60));
          if (e.roof) callout(e.roof > 1 ? 'ROOF DOWN' : 'ROOF SECTION', e.x, e.y + 1, e.z, 'big');
          else if (e.floor) callout('FLOOR GIVES WAY', e.x, e.y + 1, e.z, 'big');
          else if (e.count >= 20) callout('COLLAPSE', e.x, e.y + 1, e.z, 'big');
          app.buzz([20, 40, 20]);
          if (!app.reducedMotion && (e.count >= 30 || e.roof)) slowmo = Math.max(slowmo, 0.75);
          break;
        case 'land':
          if (e.speed > 5) app.play('impact', Math.min(0.8, e.speed / 14));
          break;
        case 'blast':
          app.play('detonate', 0.8, 'small');
          app.buzz(30);
          break;
        case 'exit':
          app.play('bonus');
          callout('IN AND OUT', session.world.balls.find((b) => b.id === e.ball)?.x ?? 0, 3, -6, 'big');
          break;
        case 'enter':
          break;
        case 'retire':
          if (e.reason === 'out') callout('Out of bounds', Math.max(-12, Math.min(12, e.x)), Math.max(1, Math.min(8, e.y)), Math.max(-12, Math.min(20, e.z)));
          break;
      }
      if (e.t === 'break' || e.t === 'knock') {
        const p = P[e.part] as Part;
        if (p.tags.includes('target')) callout(`${p.label}  +${p.points}`, p.x, p.y + 1, p.z, 'good');
      }
    }
  };

  // ------------------------------------------------------- shot results

  session.onShot = (r) => {
    showShotCard(r);
    renderAll();
  };

  const finishLevel = (): void => {
    if (resultShown || !session.result) return;
    resultShown = true;
    const r = session.result;
    const best = store.finish(level, r);
    window.setTimeout(() => showResults(best), 700);
  };

  const showResults = (best: { newScore: boolean; newStars: boolean; first: boolean }): void => {
    const r = session.result;
    if (!r) return;
    const isScore = level.mode === 'score';
    const title = isScore ? (r.medal ? ['', 'Bronze', 'Silver', 'Gold'][r.medal] + ' medal' : 'Run over') : level.mode === 'sandbox' ? 'Sandbox' : r.complete ? 'Demolished' : 'Out of shots';
    app.play(r.complete && (r.stars > 0 || !isScore) ? 'total' : 'fail');
    if (!best.first && (best.newScore || best.newStars)) window.setTimeout(() => app.play('newBest'), 500);
    const idx = CAMPAIGN.findIndex((l) => l.id === level.id);
    const next = idx >= 0 ? CAMPAIGN[idx + 1] : undefined;
    const starsEl = h('div', { class: 'g-stars', 'aria-label': `${r.stars} of 3` });
    for (let i = 0; i < 3; i++) starsEl.append(h('span', { class: `star${i < r.stars ? ' on' : ''}`, html: ICON.star }));
    const rec = store.peek(level);
    const facts: Array<[string, string]> = [
      ['Score', r.score.toLocaleString('en-US')],
      ['Shots', level.mode === 'campaign' || level.mode === 'precision' ? `${r.shots} (par ${level.par})` : String(r.shots)],
      ['Destruction', `${Math.floor(session.world.destruction() * 100)}%`],
      ['Best streak', String(session.bestStreak)],
    ];
    if (rec?.bestScore) facts.push(['Personal best', rec.bestScore.toLocaleString('en-US')]);
    const body = h(
      'div',
      { class: 'sheet-body g-results' },
      h('h2', { text: title }),
      !isScore && level.mode !== 'sandbox' && !r.complete ? h('p', { class: 'muted', text: level.objectives.map((o) => `${objectiveText(o)}: ${session.progress(o)[0]} of ${session.progress(o)[1]}`).join(' · ') }) : null,
      r.complete || isScore ? starsEl : null,
      !best.first && (best.newScore || best.newStars) ? h('p', { class: 'g-best', text: best.newStars ? 'New best: more stars' : 'New best score' }) : null,
      h('dl', { class: 'g-facts' }, ...facts.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
      isScore ? h('p', { class: 'muted small', text: `Medals: bronze ${(level.medals?.[0] ?? 0).toLocaleString('en-US')}, silver ${(level.medals?.[1] ?? 0).toLocaleString('en-US')}, gold ${(level.medals?.[2] ?? 0).toLocaleString('en-US')}.` }) : null,
      r.complete && !isScore && r.stars < 3 && level.mode !== 'sandbox' ? h('p', { class: 'muted small', text: `Three stars: finish in ${level.par} shot${level.par === 1 ? '' : 's'} or fewer.` }) : null,
    );
    const actions = h('div', { class: 'sheet-actions stack' });
    if (r.complete && next && level.mode === 'campaign') actions.append(h('button', { class: 'btn primary', text: `Next: ${next.title}`, onClick: () => (s.close(), app.go('golf', { id: next.id })) }));
    actions.append(h('button', { class: `btn ${r.complete && next ? 'ghost' : 'primary'}`, text: r.complete ? 'Play again' : 'Try again', onClick: () => (s.close(), restart()) }));
    actions.append(h('button', { class: 'btn ghost', text: 'Levels', onClick: () => (s.close(), app.go('levels')) }));
    body.append(actions);
    const s = sheet(body, undefined, false);
  };

  // ------------------------------------------------------------- intro

  const openIntro = (): void => {
    introOpen = true;
    const intro = level.introduces;
    const introName = intro ? (intro in BALLS ? `${BALLS[intro as BallId].name} ball` : POWERUPS[intro as PowerUpId].name) : '';
    const introBlurb = intro ? (intro in BALLS ? BALLS[intro as BallId].blurb : POWERUPS[intro as PowerUpId].blurb) : '';
    const body = h(
      'div',
      { class: 'sheet-body g-intro' },
      h('p', { class: 'g-intro-no', text: level.mode === 'campaign' ? `Level ${level.number}` : level.title === 'Daily Challenge' ? 'Daily Challenge' : level.mode === 'score' ? 'Score Attack' : level.mode === 'precision' ? 'Precision Challenge' : 'Sandbox' }),
      h('h2', { text: level.mode === 'daily' ? level.blurb.split('.')[0] ?? level.title : level.title }),
      h('p', { text: level.mode === 'daily' ? objectiveText(level.objectives[0] as Objective) : level.blurb }),
      level.objectives.length ? h('ul', { class: 'g-intro-obj' }, ...level.objectives.map((o) => h('li', {}, h('span', { class: 'icon', html: GICON.target }), h('span', { text: objectiveText(o) })))) : null,
      Number.isFinite(level.shots) ? h('p', { class: 'muted', text: `${level.shots} shots${level.mode === 'score' ? '' : `. Par ${level.par} for three stars`}.` }) : null,
      intro ? h('div', { class: 'site-note' }, h('b', { text: `New: ${introName}` }), h('span', { text: introBlurb })) : null,
      h('div', { class: 'sheet-actions' }, h('button', { class: 'btn primary lg', text: 'Tee off', onClick: () => (s.close(), app.play('select')) })),
    );
    const s = sheet(body, () => {
      introOpen = false;
      showTip();
      if (intro && intro in BALLS) selectBall(intro as BallId);
    });
  };

  const openPause = (): void => {
    if (resultShown) return;
    app.play('tap');
    const wasFast = fast;
    paused = true;
    const toggle = (label: string, key: 'sound' | 'reducedMotion'): HTMLElement => {
      const btn = h('button', {
        class: `toggle${app.save.settings[key] ? ' on' : ''}`,
        role: 'switch',
        'aria-checked': String(app.save.settings[key]),
        'aria-label': label,
        onClick: () => {
          app.save.settings[key] = !app.save.settings[key];
          app.persist();
          app.applySettings();
          renderer.reducedMotion = app.reducedMotion;
          btn.classList.toggle('on', app.save.settings[key]);
          btn.setAttribute('aria-checked', String(app.save.settings[key]));
        },
      });
      return h('div', { class: 'setting-row' }, h('b', { text: label }), btn);
    };
    const body = h(
      'div',
      { class: 'sheet-body' },
      h('h2', { text: 'Paused' }),
      h('p', { class: 'muted', text: `${level.number} · ${level.title}` }),
      toggle('Sound', 'sound'),
      toggle('Reduce motion', 'reducedMotion'),
      h(
        'div',
        { class: 'sheet-actions stack' },
        h('button', { class: 'btn primary', text: 'Resume', onClick: () => s.close() }),
        h('button', { class: 'btn ghost', text: 'Restart level', onClick: () => (s.close(), restart()) }),
        h('button', { class: 'btn ghost', text: 'Levels', onClick: () => (s.close(), app.go('levels')) }),
      ),
    );
    const s = sheet(body, () => {
      paused = false;
      setFast(wasFast);
    });
  };

  // ------------------------------------------------------------ restart

  const restart = (): void => {
    if (session.phase === 'flight' && !resultShown) {
      // Restarting mid-shot is allowed: it just throws the attempt away.
    }
    document.querySelectorAll('.sheet-wrap').forEach((s) => s.remove());
    session = new Session(level);
    store.started(level);
    session.onShot = (r) => {
      showShotCard(r);
      renderAll();
    };
    renderer.load(session.world);
    pins = pinsFor(session);
    resultShown = false;
    introOpen = false;
    paused = false;
    ball = 'standard';
    callouts.replaceChildren();
    shotCard.classList.remove('show');
    predDirty = true;
    app.play('tap');
    renderAll();
  };

  // --------------------------------------------------------------- loop

  let paused = false;
  let raf = 0;
  let last = performance.now();
  let acc = 0;
  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame);
    const realDt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    const w = canvas.clientWidth || window.innerWidth;
    const hh = canvas.clientHeight || window.innerHeight;
    if (renderer.width !== w || renderer.height !== hh) {
      renderer.resize(w, hh);
      renderer.snapCamera();
    }
    let scale = paused ? 0 : fast ? 3 : 1;
    if (slowmo > 0 && !fast) {
      slowmo -= realDt;
      scale *= 0.35;
    }
    acc += realDt * scale;
    let steps = 0;
    while (acc >= DT && steps < 12) {
      session.step();
      acc -= DT;
      steps++;
    }
    if (steps >= 12) acc = 0;
    const events = session.takeEvents();
    if (events.length) {
      renderer.ingest(events);
      sounds(events);
      if (session.phase === 'flight' && events.some((e) => e.t === 'break' || e.t === 'release' || e.t === 'knock')) renderObjectives();
    }
    if (session.phase === 'aim' && predDirty) {
      prediction = predict(session.world, { ball, yaw: aim.yaw, pitch: aim.pitch, power: aim.power }, session.mods(), 3.5);
      predDirty = false;
    }
    if (session.phase !== 'aim') predDirty = true;
    if (session.phase === 'done') finishLevel();
    const view: ViewState = {
      phase: introOpen ? 'intro' : session.phase,
      ball,
      yaw: aim.yaw,
      pitch: aim.pitch,
      power: aim.power,
      prediction: session.phase === 'aim' && !introOpen ? prediction : null,
      guideFull: session.guideFull,
      guideShare: BALLS[ball].guide,
      golfers: session.armed.has('golfers') || (session.phase !== 'aim' && session.world.balls.some((b) => b.golfer > 0 && b.alive)) ? 3 : 1,
      peek,
      zoom,
      pins,
    };
    renderer.update(realDt * (paused ? 0 : 1), view);
    renderer.render();
  };

  renderAll();
  openIntro();
  raf = requestAnimationFrame(frame);

  // Automation hook for the smoke test.
  (window as unknown as { __golf?: unknown }).__golf = {
    get session() {
      return session;
    },
    aim,
    renderer,
    fire,
    setPower,
    selectBall,
    restart,
    togglePowerup,
    /** Points the shot at a world point at the given power (tests and the smoke run). */
    aimAt(x: number, y: number, z: number, pw: number): boolean {
      const s = solveAim(session.world, ball, { x, y, z }, pw, session.mods());
      if (!s) return false;
      aim.yaw = s.yaw;
      aim.pitch = s.pitch;
      setPower(pw);
      predDirty = true;
      return true;
    },
  };

  return {
    el,
    destroy: () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(noteTimer);
      document.querySelectorAll('.sheet-wrap').forEach((s) => s.remove());
      renderer.dispose();
    },
  };
}

