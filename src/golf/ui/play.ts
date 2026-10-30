import type { App, ScreenInstance } from '../../app';
import { h } from '../../ui/dom';
import { ICON } from '../../ui/icons';
import { sheet } from '../../ui/screens/common';
import { clampYaw, isCancel, pullFrom, shotFor, yawStep } from '../game/controls';
import { getHouse, houseLevel, type HouseDef } from '../game/houses';
import { TAG_LABEL, TAG_ORDER, TAG_REASON, type ShotTag, type Tier } from '../game/quality';
import { REWARD, SPECIALS, applyShot, type ShotReward, type SpecialId } from '../game/rewards';
import { solvePull } from '../game/solve';
import { GolfRenderer, type ViewState } from '../render/scene';
import { predict, type Prediction } from '../sim/aim';
import { BALLS, BALL_ORDER, type BallId } from '../sim/balls';
import { CAMPAIGN, POWERUPS, SANDBOX, getLevel, objectiveText, type LevelDef, type Objective, type PowerUpId } from '../sim/levels';
import { MATERIALS } from '../sim/materials';
import { PartState, type Part } from '../sim/parts';
import { Session, type ShotReport } from '../sim/session';
import { DT, World, type SimEvent } from '../sim/world';
import { GICON, ballSwatch } from './icons';

/**
 * The play screen for every mode: a campaign house (PLAY), the Daily Demo,
 * the sandbox and the challenges. Press anywhere and pull back to aim and
 * set power; let go to shoot. Everything that changes the game goes through
 * Session; this file reads it, draws the HUD and plays the feedback.
 */

type Kind = 'house' | 'daily' | 'sandbox' | 'challenge';

const POWERUP_ORDER: PowerUpId[] = ['drive', 'ricochet', 'precision', 'golfers'];
/** Most sounds started in one frame: a collapse should rumble, not machine-gun. */
const SOUND_BUDGET = 7;

function levelFor(id: string): LevelDef {
  if (id === 'sandbox') {
    const balls: LevelDef['balls'] = {};
    for (const b of SPECIALS) balls[b] = Infinity;
    return { ...SANDBOX, balls };
  }
  return getLevel(id);
}

/** Parts to pin for an objective: the things the player has to hit. */
function pinsFor(session: Session): number[] {
  const P = session.world.parts;
  const out: number[] = [];
  for (const o of session.level.objectives) {
    if (o.kind === 'target') for (const p of P) if (p.tags.includes(o.tag)) out.push(p.id);
    if (o.kind === 'collapse' && o.what === 'porch') for (const p of P) if (p.kind === 'column' && p.tags.includes('porch') && p.state === PartState.Intact) out.push(p.id);
    if (o.kind === 'collapse' && o.what === 'chimney') {
      const base = P.filter((p) => p.tags.includes('chimney') && p.kind === 'brick' && p.state === PartState.Intact).sort((a, b) => a.y - b.y)[0];
      if (base) out.push(base.id);
    }
  }
  return out.slice(0, 6);
}

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

export function golfPlayScreen(app: App, params: Record<string, string>): ScreenInstance {
  const store = app.golf;
  const econ = store.data.economy;
  const asked = getHouse(params.id ?? '');
  // A house that is not open yet sends the player to the one they are on.
  const houseDef: HouseDef | undefined = asked ? (store.houseOpen(asked.id) ? asked : store.currentHouse) : params.id ? undefined : store.currentHouse;
  const id = houseDef?.id ?? params.id ?? 'sandbox';
  const kind: Kind = houseDef ? 'house' : id.startsWith('daily-') ? 'daily' : id === 'sandbox' ? 'sandbox' : 'challenge';
  const level = houseDef ? houseLevel(houseDef) : levelFor(id);
  const houseRec = houseDef ? store.houseRec(houseDef.id) : null;
  const gift = houseDef ? store.enterHouse(houseDef) : {};

  const build = (): Session => {
    if (houseDef) {
      const world = new World(level.house, level.yard, 7);
      const snap = store.loadHouse(houseDef.id);
      // A snapshot that does not fit this house (an old build) is dropped, and the house starts fresh.
      if (snap && !world.restore(snap)) store.clearHouse(houseDef.id);
      return new Session(level, 7, { world, ammo: econ.inventory as Partial<Record<BallId, number>>, fastResolve: true });
    }
    return new Session(level, 7, { fastResolve: true });
  };
  let session = build();
  if (kind !== 'house') store.started(level);

  const lowPower = (navigator.hardwareConcurrency ?? 8) <= 4;
  const canvas = h('canvas', { class: 'golf-canvas', 'aria-label': 'The house and the tee. Press anywhere, pull back to aim and set power, let go to shoot.' });
  const renderer = new GolfRenderer(canvas, session.world, { lowPower, reducedMotion: app.reducedMotion });

  const aim = { yaw: 0, pull: 0.6 };
  let ball: BallId = 'standard';
  let peek = false;
  let prediction: Prediction | null = null;
  let predDirty = true;
  let slowmo = 0;
  let paused = false;
  let modal = kind === 'challenge';
  let resultShown = false;
  let pins = pinsFor(session);
  let weak: number[] = [];
  let weakDirty = true;
  let snapDirty = false;
  /** Keyboard aiming shows the guide without a thumb on the glass. */
  let keyAim = false;

  // ---------------------------------------------------------------- HUD

  const pauseBtn = h('button', { class: 'dd-icon', 'aria-label': 'Pause', html: ICON.pause, onClick: () => openPause() });
  const peekBtn = h('button', { class: 'dd-icon', 'aria-label': 'See inside', 'aria-pressed': 'false', html: GICON.peek, onClick: () => togglePeek() });
  const titleEl = h('div', { class: 'dd-hud-title' });
  const objText = h('span', { class: 'dd-obj-text' });
  const objCount = h('b', { class: 'dd-obj-count' });
  const objFill = h('i', { class: 'dd-obj-fill' });
  const objBar = h('div', { class: 'dd-obj-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, objFill);
  const hint = h('p', { class: 'dd-hint' });
  const card = h('div', { class: 'dd-card' }, titleEl, h('div', { class: 'dd-obj' }, objText, objCount), objBar, hint);
  const top = h('header', { class: 'dd-top' }, pauseBtn, card, peekBtn);

  const meterFill = h('i', { class: 'dd-meter-fill' });
  const meterLabel = h('span', { class: 'dd-meter-label', text: 'Next special ball' });
  const meterGain = h('span', { class: 'dd-meter-gain' });
  const meter = h('div', { class: `dd-meter${kind === 'house' ? '' : ' hidden'}`, role: 'progressbar', 'aria-label': 'Reward meter', 'aria-valuemin': '0', 'aria-valuemax': String(REWARD.meterSize) }, h('div', { class: 'dd-meter-track' }, meterFill), meterLabel, meterGain);
  const scoreEl = h('div', { class: `dd-score${kind === 'house' || kind === 'sandbox' ? ' hidden' : ''}` });
  const tray = h('div', { class: 'dd-tray', role: 'radiogroup', 'aria-label': 'Ball' });
  const puRow = h('div', { class: 'dd-powerups' });
  const caption = h('p', { class: 'dd-caption', 'aria-live': 'polite' });
  // Screen readers and switch controls have no thumb to pull: this shoots at the current aim.
  const fireBtn = h('button', { class: 'dd-sr', text: 'Shoot', onClick: () => fire() });
  const bottom = h('div', { class: 'dd-bottom' }, caption, meter, scoreEl, h('div', { class: 'dd-tray-row' }, tray, puRow), fireBtn);

  const headline = h('div', { class: 'dd-headline', 'aria-live': 'polite' });
  const banner = h('div', { class: 'dd-banner', role: 'status' });
  const coach = h('div', { class: 'dd-coach hidden', 'aria-hidden': 'true' }, h('span', { class: 'dd-coach-hand' }), h('b', { text: 'Pull back, let go' }));

  // The pull: a band from where the thumb went down to where it is, a power ring, and the number.
  const SVGNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'dd-pull');
  svg.setAttribute('aria-hidden', 'true');
  const band = document.createElementNS(SVGNS, 'line');
  band.setAttribute('class', 'dd-band');
  const ringBack = document.createElementNS(SVGNS, 'circle');
  ringBack.setAttribute('class', 'dd-ring-back');
  ringBack.setAttribute('r', '30');
  const ring = document.createElementNS(SVGNS, 'circle');
  ring.setAttribute('class', 'dd-ring');
  ring.setAttribute('r', '30');
  const knob = document.createElementNS(SVGNS, 'circle');
  knob.setAttribute('class', 'dd-knob');
  knob.setAttribute('r', '9');
  const label = document.createElementNS(SVGNS, 'text');
  label.setAttribute('class', 'dd-pull-label');
  svg.append(band, ringBack, ring, knob, label);
  const RING_LEN = 2 * Math.PI * 30;

  const el = h('main', { class: `screen golf-play dd dd-${kind}` }, canvas, svg, headline, banner, coach, top, bottom);

  // ------------------------------------------------------------ the tray

  const count = (b: BallId): number => (b === 'standard' ? Infinity : (session.ammo[b] ?? 0));
  const trayBalls = (): BallId[] => {
    if (kind === 'house') return ['standard', ...SPECIALS.filter((b) => store.unlockedSpecials().includes(b) || (econ.inventory[b] ?? 0) > 0)];
    return BALL_ORDER.filter((b) => b === 'standard' || b in level.balls);
  };

  const renderTray = (): void => {
    tray.replaceChildren();
    const list = trayBalls();
    if (!session.canUse(ball)) ball = 'standard';
    for (const b of list) {
      const n = count(b);
      const ok = session.canUse(b);
      tray.append(
        h(
          'button',
          {
            class: `dd-ball${b === ball ? ' on' : ''}${ok ? '' : ' empty'}`,
            role: 'radio',
            'aria-checked': String(b === ball),
            'aria-label': `${BALLS[b].name}${b === 'standard' ? ', unlimited' : Number.isFinite(n) ? `, ${n} left` : ''}`,
            disabled: !ok || session.phase !== 'aim',
            'data-ball': b,
            onClick: () => selectBall(b),
          },
          h('span', { class: 'dd-swatch', html: ballSwatch(b, 34) }),
          b !== 'standard' && Number.isFinite(n) ? h('span', { class: 'dd-count', text: String(n) }) : null,
        ),
      );
    }
    puRow.replaceChildren();
    for (const p of POWERUP_ORDER) {
      if (!(p in level.powerups)) continue;
      const n = session.powerups[p] ?? 0;
      const armed = session.armed.has(p);
      const active = p === 'precision' && session.precisionLeft > 0;
      puRow.append(
        h(
          'button',
          { class: `dd-pu${armed || active ? ' on' : ''}`, 'aria-pressed': String(armed), 'aria-label': `${POWERUPS[p].name}${Number.isFinite(n) ? `, ${n} left` : ''}`, disabled: (n <= 0 && !armed) || active || session.phase !== 'aim', onClick: () => togglePowerup(p) },
          h('span', { class: 'icon', html: GICON[p] }),
          Number.isFinite(n) ? h('span', { class: 'dd-count', text: String(n) }) : null,
        ),
      );
    }
    puRow.classList.toggle('hidden', !puRow.childElementCount);
  };

  let captionTimer = 0;
  const say = (text: string, ms = 2600): void => {
    caption.textContent = text;
    caption.classList.add('show');
    window.clearTimeout(captionTimer);
    captionTimer = window.setTimeout(() => caption.classList.remove('show'), ms);
  };

  const selectBall = (b: BallId): void => {
    if (session.phase !== 'aim' || !session.canUse(b)) return;
    ball = b;
    app.play('select');
    say(b === 'standard' ? 'Standard ball. Unlimited.' : `${BALLS[b].name}: ${BALLS[b].hint}.`);
    predDirty = true;
    renderTray();
  };

  const togglePowerup = (p: PowerUpId): void => {
    if (!session.toggle(p)) return app.play('error');
    app.play(session.armed.has(p) ? 'arm' : 'tap');
    if (session.armed.has(p)) say(`${POWERUPS[p].name}: ${POWERUPS[p].blurb}`);
    predDirty = true;
    renderTray();
  };

  const togglePeek = (): void => {
    peek = !peek;
    peekBtn.classList.toggle('on', peek);
    peekBtn.setAttribute('aria-pressed', String(peek));
    app.play('tap');
  };

  // ------------------------------------------------------------ the card

  const renderCard = (): void => {
    const share = session.world.destruction() * 100;
    const d = share > 0 && share < 10 ? share.toFixed(1) : String(Math.floor(share));
    if (kind === 'house' && houseDef) {
      titleEl.replaceChildren(h('span', { class: 'dd-no', text: houseDef.number }), h('b', { text: houseDef.name }), h('span', { class: 'dd-down', text: `${d}% down` }));
      const o = houseDef.objective;
      const [a, b] = session.progress(o);
      const done = session.completed;
      objText.textContent = done ? 'Done. Keep going, or move on.' : objectiveText(o);
      objCount.textContent = done ? '' : progressText(o, a, b);
      objFill.style.transform = `scaleX(${done ? 1 : Math.min(1, b > 0 ? a / b : 0)})`;
      objBar.setAttribute('aria-valuenow', String(Math.round(Math.min(1, b > 0 ? a / b : 0) * 100)));
      card.classList.toggle('done', done);
    } else if (kind === 'daily' || kind === 'sandbox' || level.mode === 'score') {
      titleEl.replaceChildren(h('span', { class: 'dd-no', text: level.number }), h('b', { text: level.title }), h('span', { class: 'dd-down', text: `${d}% down` }));
      objText.textContent = kind === 'sandbox' ? 'No objective. Every ball, as many as you like.' : `${Number.isFinite(session.shotsLeft) ? session.shotsLeft : ''} shot${session.shotsLeft === 1 ? '' : 's'} left`;
      objCount.textContent = '';
      objFill.style.transform = `scaleX(${kind === 'sandbox' ? Math.min(1, share / 100) : Number.isFinite(level.shots) ? session.shotsUsed / level.shots : 0})`;
    } else {
      titleEl.replaceChildren(h('span', { class: 'dd-no', text: level.number }), h('b', { text: level.title }), h('span', { class: 'dd-down', text: `${session.shotsLeft} left` }));
      const o = level.objectives[0] as Objective | undefined;
      if (o) {
        const [a, b] = session.progress(o);
        objText.textContent = objectiveText(o);
        objCount.textContent = progressText(o, a, b);
        objFill.style.transform = `scaleX(${Math.min(1, b > 0 ? a / b : 0)})`;
      }
    }
    scoreEl.replaceChildren(h('b', { text: fmt(session.score) }), h('span', { text: session.streak >= 2 ? `streak x${(1 + 0.25 * (session.streak - 1)).toFixed(2).replace(/0$/, '')}` : 'points' }));
  };

  const progressText = (o: Objective, a: number, b: number): string => {
    if (o.kind === 'target' || o.kind === 'enter' || o.kind === 'through' || (o.kind === 'collapse' && o.what !== 'roof' && o.what !== 'floor')) return a >= b ? 'Done' : '';
    if (o.kind === 'destruction' || o.kind === 'wall') return `${Math.min(a, b)}%`;
    return `${Math.min(a, b)}/${b}`;
  };

  // ---------------------------------------------------------- the meter

  let meterShown = econ.meter;
  let meterQueue: number[] = [];
  const renderMeter = (dt: number): void => {
    if (kind !== 'house') return;
    const target = meterQueue.length ? (meterQueue[0] as number) : econ.meter;
    const before = meterShown;
    meterShown += Math.sign(target - meterShown) * Math.min(Math.abs(target - meterShown), dt * 70);
    if (Math.floor(meterShown / 8) !== Math.floor(before / 8) && meterShown > before) app.play('meter', meterShown / REWARD.meterSize);
    if (meterQueue.length && Math.abs(meterShown - target) < 0.01) {
      meterQueue.shift();
      if (target >= REWARD.meterSize) {
        meter.classList.remove('pop');
        void meter.offsetWidth;
        meter.classList.add('pop');
        meterShown = 0;
      }
    }
    meterFill.style.transform = `scaleX(${Math.min(1, meterShown / REWARD.meterSize)})`;
    meter.setAttribute('aria-valuenow', String(Math.round(econ.meter)));
    meter.classList.toggle('full', econ.meter >= REWARD.meterSize);
  };

  // -------------------------------------------------------------- pulling

  let drag: { id: number; y0: number; x0: number; lastX: number; lastT: number; armed: boolean } | null = null;
  const blocked = (): boolean => modal || paused || resultShown || session.phase !== 'aim' || session.shotsLeft <= 0;

  const drawPull = (x: number, y: number): void => {
    if (!drag) return;
    svg.classList.add('on');
    band.setAttribute('x1', String(drag.x0));
    band.setAttribute('y1', String(drag.y0));
    band.setAttribute('x2', String(x));
    band.setAttribute('y2', String(y));
    for (const c of [ringBack, ring]) {
      c.setAttribute('cx', String(drag.x0));
      c.setAttribute('cy', String(drag.y0));
    }
    knob.setAttribute('cx', String(x));
    knob.setAttribute('cy', String(y));
    ring.setAttribute('stroke-dasharray', `${RING_LEN * aim.pull} ${RING_LEN}`);
    svg.classList.toggle('max', aim.pull >= 0.999);
    svg.classList.toggle('cancel', !drag.armed);
    label.setAttribute('x', String(drag.x0));
    label.setAttribute('y', String(drag.y0 - 44));
    label.textContent = drag.armed ? `${Math.round(aim.pull * 100)}%` : 'Pull back';
  };

  const endPull = (): void => {
    drag = null;
    svg.classList.remove('on', 'max', 'cancel');
    el.classList.remove('pulling');
  };

  canvas.addEventListener('pointerdown', (ev) => {
    if (drag || blocked()) return;
    canvas.setPointerCapture(ev.pointerId);
    keyAim = false;
    drag = { id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, lastX: ev.clientX, lastT: ev.timeStamp, armed: false };
    aim.pull = 0;
    el.classList.add('pulling');
    predDirty = true;
    drawPull(ev.clientX, ev.clientY);
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!drag || drag.id !== ev.pointerId) return;
    const dx = ev.clientX - drag.lastX;
    aim.yaw = clampYaw(aim.yaw + yawStep(dx, ev.timeStamp - drag.lastT));
    drag.lastX = ev.clientX;
    drag.lastT = ev.timeStamp;
    const dy = ev.clientY - drag.y0;
    const was = aim.pull;
    aim.pull = pullFrom(dy, renderer.height || window.innerHeight);
    const armed = !isCancel(dy);
    if (armed && !drag.armed) app.buzz(6);
    if (aim.pull >= 0.999 && was < 0.999) app.buzz(10);
    drag.armed = armed;
    predDirty = true;
    drawPull(ev.clientX, ev.clientY);
  });
  canvas.addEventListener('pointerup', (ev) => {
    if (!drag || drag.id !== ev.pointerId) return;
    const go = drag.armed;
    endPull();
    if (go) fire();
    else predDirty = true;
  });
  canvas.addEventListener('pointercancel', (ev) => {
    if (drag && drag.id === ev.pointerId) endPull();
  });

  const onKey = (ev: KeyboardEvent): void => {
    if (modal || resultShown || paused) {
      if (ev.key === 'Escape' && paused) return;
      return;
    }
    const fine = ev.shiftKey ? 0.1 : 0.6;
    let handled = true;
    switch (ev.key) {
      case 'ArrowLeft':
        aim.yaw = clampYaw(aim.yaw - fine);
        keyAim = true;
        break;
      case 'ArrowRight':
        aim.yaw = clampYaw(aim.yaw + fine);
        keyAim = true;
        break;
      case 'ArrowUp':
        aim.pull = Math.min(1, aim.pull + (ev.shiftKey ? 0.005 : 0.03));
        keyAim = true;
        break;
      case 'ArrowDown':
        aim.pull = Math.max(0, aim.pull - (ev.shiftKey ? 0.005 : 0.03));
        keyAim = true;
        break;
      case ' ':
      case 'Enter':
        if (!ev.repeat) fire();
        break;
      case 'x':
        togglePeek();
        break;
      case 'Escape':
        openPause();
        break;
      default: {
        const n = Number(ev.key);
        const avail = trayBalls();
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

  // Stop the page from scrolling, zooming or swiping back under the game; sheets still scroll.
  const stopTouch = (ev: TouchEvent): void => {
    if (ev.target instanceof Element && ev.target.closest('.sheet')) return;
    ev.preventDefault();
  };
  el.addEventListener('touchmove', stopTouch, { passive: false });
  const stopGesture = (ev: Event): void => ev.preventDefault();
  document.addEventListener('gesturestart', stopGesture);

  // --------------------------------------------------------------- fire

  const fire = (): void => {
    if (blocked()) return;
    const shot = shotFor(ball, aim.yaw, aim.pull);
    session.focus = new Set([...pins, ...weak]);
    if (!session.fire(shot)) {
      app.play('error');
      return;
    }
    app.play(ball === 'standard' ? 'thwack' : 'special', shot.power);
    app.buzz(8);
    keyAim = false;
    shownTag = null;
    headline.classList.remove('show');
    coach.classList.add('hidden');
    hint.classList.add('gone');
    if (houseRec) {
      houseRec.shots++;
      store.save();
    }
    if (!store.data.coached) {
      store.data.coached = true;
      store.save();
    }
    renderAll();
  };

  // ------------------------------------------------------------ headlines

  let shownTag: ShotTag | null = null;
  let headlineTimer = 0;
  const showHeadline = (tag: ShotTag, sub = ''): void => {
    const rank = (t: ShotTag | null): number => (t ? TAG_ORDER.length - TAG_ORDER.indexOf(t) : 0);
    if (rank(tag) < rank(shownTag) || (tag === shownTag && !sub)) return;
    shownTag = tag;
    headline.replaceChildren(h('b', { text: TAG_LABEL[tag] }), ...(sub ? [h('span', { text: sub })] : []));
    headline.className = `dd-headline show t-${tag}`;
    void headline.offsetWidth;
    headline.classList.add('pop');
    window.clearTimeout(headlineTimer);
    headlineTimer = window.setTimeout(() => headline.classList.remove('show', 'pop'), 2200);
  };

  /** The response scales with the shot: small hits tick, criticals slow time, collapses shake the lot. */
  const reactTo = (tier: Tier, tag: ShotTag | null): void => {
    if (tag === 'support') {
      app.play('snap', 1);
      app.buzz(25);
    }
    if (tier >= 3 && !app.reducedMotion) slowmo = Math.max(slowmo, tier === 4 ? 0.95 : 0.5);
    if (tier >= 3) renderer.fx.shake = Math.min(1, renderer.fx.shake + (tier === 4 ? 0.7 : 0.4));
    if (tier === 4) app.buzz([30, 50, 30]);
  };

  let bannerTimer = 0;
  const showBanner = (title: string, line: string, swatch?: BallId): void => {
    banner.replaceChildren(...(swatch ? [h('span', { class: 'dd-swatch', html: ballSwatch(swatch, 40) })] : []), h('div', {}, h('b', { text: title }), h('span', { text: line })));
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');
    window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => banner.classList.remove('show'), 3600);
  };

  // ------------------------------------------------------- sound and feel

  const variant = (p: Part): 'wood' | 'steel' | 'concrete' | 'brick' => {
    const m = MATERIALS[p.mat].sound;
    return m === 'wood' ? 'wood' : m === 'steel' ? 'steel' : m === 'concrete' ? 'concrete' : 'brick';
  };

  const sounds = (events: SimEvent[]): void => {
    const P = session.world.parts;
    let budget = SOUND_BUDGET;
    const play = (...args: Parameters<App['play']>): void => {
      if (budget-- > 0) app.play(...args);
    };
    let glass = 0;
    for (const e of events) {
      switch (e.t) {
        case 'hit': {
          const p = P[e.part] as Part;
          if (p.kind === 'glass' || e.broke) break;
          const s = Math.min(1, e.speed / 22);
          const def = session.world.balls.find((b) => b.id === e.ball)?.def;
          if (def?.id === 'super') play('ping', s);
          else play(MATERIALS[p.mat].sound === 'soft' || MATERIALS[p.mat].sound === 'leaf' ? 'thump' : 'crack', s * 0.6, variant(p));
          break;
        }
        case 'break': {
          const p = P[e.part] as Part;
          const m = MATERIALS[p.mat];
          if (m.sound === 'glass' || m.sound === 'ceramic') {
            // One shatter per frame is enough; more panes only make it louder.
            if (glass++ === 0) play('glass', p.kind === 'glass' ? 0.9 : 0.55);
          } else if (p.kind === 'column' || p.kind === 'beam' || p.kind === 'lintel') play('snap', 0.8);
          else play('crack', 0.7, variant(p));
          break;
        }
        case 'seam':
          play('seam');
          app.buzz([8, 30, 8]);
          renderer.fx.shake = Math.max(renderer.fx.shake, 0.15);
          break;
        case 'ground':
          if (e.speed > 4) play('thump', Math.min(1, e.speed / 15));
          break;
        case 'leaves':
          play('rustle', 0.6);
          break;
        case 'knock':
          play('impact', 0.3);
          break;
        case 'creak':
          play('creak', 0.6);
          break;
        case 'collapse':
          play(e.count > 40 || e.roof ? 'heavyLanding' : 'rumble', Math.min(1, e.count / 60));
          app.buzz([20, 40, 20]);
          break;
        case 'land':
          if (e.speed > 5) play('impact', Math.min(0.8, e.speed / 14));
          break;
        case 'blast':
          play('detonate', 0.8, 'small');
          app.buzz(30);
          break;
        case 'exit':
          play('bonus');
          break;
      }
    }
  };

  // ------------------------------------------------------- shot results

  const onShot = (r: ShotReport): void => {
    const q = r.quality;
    if (q.headline) showHeadline(q.headline, '');
    if (kind === 'house' && houseRec && houseDef) {
      const unlocked: BallId[] = ['standard', ...store.unlockedSpecials()];
      const before = econ.meter;
      const reward: ShotReward = applyShot(econ, q, unlocked, houseRec.done);
      store.save();
      if (reward.gain > 0.5) {
        meterGain.textContent = `+${Math.round(reward.gain)}`;
        meterGain.classList.remove('show');
        void meterGain.offsetWidth;
        meterGain.classList.add('show');
        if (q.headline) showHeadline(q.headline, `+${Math.round(reward.gain)}`);
      }
      // Animate up to each full meter, then on to what is left.
      meterQueue = [...reward.awarded.map(() => REWARD.meterSize), econ.meter];
      if (!reward.awarded.length && econ.meter < before) meterShown = econ.meter;
      if (reward.awarded.length) {
        const b = reward.awarded[0] as SpecialId;
        const why = reward.reason ? `${TAG_LABEL[reward.reason].toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}: ${TAG_REASON[reward.reason]}` : 'Steady damage filled the meter';
        window.setTimeout(() => {
          app.play('earned');
          app.buzz([10, 40, 10, 40, 20]);
          showBanner(reward.awarded.length > 1 ? `${reward.awarded.length} specials earned` : `${BALLS[b].name} earned`, why, b);
          renderTray();
          const chip = tray.querySelector(`[data-ball="${b}"]`);
          chip?.classList.add('fresh');
          window.setTimeout(() => chip?.classList.remove('fresh'), 1400);
        }, 700);
      }
      snapDirty = true;
    } else if (r.points > 0) {
      if (!q.headline) showHeadline('clean', `+${fmt(r.points)}`);
      else showHeadline(q.headline, `+${fmt(r.points)}`);
    }
    weakDirty = true;
    renderAll();
  };

  const onComplete = (): void => {
    if (!houseDef) return;
    const next = store.completeHouse(houseDef);
    persist();
    window.setTimeout(() => {
      app.play('houseDown');
      app.buzz([30, 60, 30, 60, 40]);
      renderer.fx.shake = Math.min(1, renderer.fx.shake + 0.5);
      el.classList.add('celebrate');
      const stamp = h('div', { class: 'dd-stamp', 'aria-hidden': 'true' }, h('b', { text: 'HOUSE DOWN' }), h('span', { text: houseDef.name }));
      el.append(stamp);
      window.setTimeout(() => {
        stamp.remove();
        el.classList.remove('celebrate');
        showHouseDone(next);
      }, 1900);
    }, 900);
  };

  const showHouseDone = (next: HouseDef | undefined): void => {
    if (!houseDef || !houseRec) return;
    modal = true;
    const prize = Object.entries(houseDef.prize) as Array<[SpecialId, number]>;
    const body = h(
      'div',
      { class: 'sheet-body dd dd-sheet' },
      h('p', { class: 'dd-kicker', text: `House ${houseDef.number} finished` }),
      h('h2', { text: houseDef.name }),
      h('p', { class: 'dd-lede', text: `${objectiveText(houseDef.objective)} in ${houseRec.doneIn} shot${houseRec.doneIn === 1 ? '' : 's'}.` }),
      h('div', { class: 'dd-prize' }, h('span', { class: 'dd-prize-label', text: 'Prize' }), ...prize.map(([b, n]) => h('span', { class: 'dd-prize-ball' }, h('span', { class: 'dd-swatch', html: ballSwatch(b, 30) }), h('b', { text: `${n}` }), h('span', { text: n === 1 ? BALLS[b].name : `${BALLS[b].name}s` })))),
      next?.unlocks ? h('p', { class: 'dd-note', text: `Next up: ${next.name}. It brings a new ball, the ${BALLS[next.unlocks].name}.` }) : next ? h('p', { class: 'dd-note', text: `Next up: ${next.name}.` }) : h('p', { class: 'dd-note', text: 'That was the last house on the street. Rebuild any of them from the house list and go again.' }),
    );
    const actions = h('div', { class: 'sheet-actions stack' });
    if (next) actions.append(h('button', { class: 'btn primary lg', onClick: () => (s.close(), app.go('golf', { id: next.id })) }, h('span', { text: `Next house` })));
    actions.append(h('button', { class: `btn ${next ? 'ghost' : 'primary'}`, text: 'Keep smashing this one', onClick: () => s.close() }));
    body.append(actions);
    const s = sheet(body, () => {
      modal = false;
      renderAll();
    });
    renderTray();
  };

  const finishRun = (): void => {
    if (resultShown || !session.result) return;
    resultShown = true;
    const best = store.finish(level, session.result);
    window.setTimeout(() => showResults(best), 800);
  };

  const showResults = (best: { newScore: boolean; newStars: boolean; first: boolean }): void => {
    const r = session.result;
    if (!r) return;
    modal = true;
    const isScore = level.mode === 'score';
    const isDaily = kind === 'daily';
    const title = isDaily ? 'Daily Demo' : isScore ? (r.medal ? ['', 'Bronze', 'Silver', 'Gold'][r.medal] + ' medal' : 'Run over') : r.complete ? 'Challenge done' : 'Out of shots';
    app.play(r.complete && (r.stars > 0 || !isScore) ? 'total' : 'fail');
    if (!best.first && (best.newScore || best.newStars)) window.setTimeout(() => app.play('newBest'), 500);
    const idx = CAMPAIGN.findIndex((l) => l.id === level.id);
    const next = idx >= 0 ? CAMPAIGN[idx + 1] : undefined;
    const rec = store.peek(level);
    const facts: Array<[string, string]> = [
      ['Score', fmt(r.score)],
      ['Destruction', `${Math.floor(session.world.destruction() * 100)}%`],
      ['Shots', level.mode === 'campaign' || level.mode === 'precision' ? `${r.shots} (par ${level.par})` : String(r.shots)],
    ];
    if (rec?.bestScore) facts.push([isDaily ? 'Best today' : 'Personal best', fmt(rec.bestScore)]);
    const starsEl = h('div', { class: 'dd-stars', 'aria-label': `${r.stars} of 3` });
    for (let i = 0; i < 3; i++) starsEl.append(h('span', { class: `star${i < r.stars ? ' on' : ''}`, html: ICON.star }));
    const body = h(
      'div',
      { class: 'sheet-body dd dd-sheet' },
      h('p', { class: 'dd-kicker', text: isDaily ? level.id.slice(6) : level.number }),
      h('h2', { text: title }),
      !isScore && !isDaily && !r.complete ? h('p', { class: 'dd-lede', text: level.objectives.map((o) => `${objectiveText(o)}: ${session.progress(o)[0]} of ${session.progress(o)[1]}`).join(' · ') }) : null,
      (r.complete && !isDaily) || isScore ? starsEl : null,
      !best.first && (best.newScore || best.newStars) ? h('p', { class: 'dd-best', text: best.newStars ? 'New best: more stars' : 'New best score' }) : null,
      h('dl', { class: 'dd-facts' }, ...facts.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
      isDaily ? dailyHistory() : null,
      isScore ? h('p', { class: 'dd-note', text: `Medals: bronze ${fmt(level.medals?.[0] ?? 0)}, silver ${fmt(level.medals?.[1] ?? 0)}, gold ${fmt(level.medals?.[2] ?? 0)}.` }) : null,
      r.complete && !isScore && !isDaily && r.stars < 3 ? h('p', { class: 'dd-note', text: `Three stars: finish in ${level.par} shot${level.par === 1 ? '' : 's'} or fewer.` }) : null,
    );
    const actions = h('div', { class: 'sheet-actions stack' });
    if (r.complete && next && level.mode === 'campaign' && store.isOpen(next)) actions.append(h('button', { class: 'btn primary', text: `Next: ${next.title}`, onClick: () => (s.close(), app.go('golf', { id: next.id })) }));
    actions.append(h('button', { class: `btn ${r.complete && next ? 'ghost' : 'primary'}`, text: isDaily ? 'Play again' : r.complete ? 'Play again' : 'Try again', onClick: () => (s.close(), restart()) }));
    actions.append(h('button', { class: 'btn ghost', text: isDaily ? 'Home' : 'Challenges', onClick: () => (s.close(), app.go(isDaily ? 'title' : 'challenges')) }));
    body.append(actions);
    const s = sheet(body, undefined, false);
  };

  const dailyHistory = (): HTMLElement => {
    const days = Object.entries(store.data.daily)
      .filter(([, r]) => r.bestScore > 0)
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, 7);
    const top = Math.max(1, ...days.map(([, r]) => r.bestScore));
    return h(
      'div',
      { class: 'dd-history' },
      h('h3', { text: 'Your last days' }),
      h('ol', {}, ...days.map(([d, r]) => h('li', {}, h('span', { text: d.slice(5).replace('-', '/') }), h('i', { style: `--w:${(r.bestScore / top).toFixed(3)}` }), h('b', { text: fmt(r.bestScore) })))),
    );
  };

  // ------------------------------------------------------------- intro

  const openIntro = (): void => {
    modal = true;
    const intro = level.introduces;
    const introName = intro ? (intro in BALLS ? `${BALLS[intro as BallId].name} ball` : POWERUPS[intro as PowerUpId].name) : '';
    const introBlurb = intro ? (intro in BALLS ? BALLS[intro as BallId].blurb : POWERUPS[intro as PowerUpId].blurb) : '';
    const body = h(
      'div',
      { class: 'sheet-body dd dd-sheet' },
      h('p', { class: 'dd-kicker', text: level.mode === 'score' ? 'Score Attack' : level.mode === 'precision' ? 'Precision' : `Challenge ${level.number}` }),
      h('h2', { text: level.title }),
      h('p', { class: 'dd-lede', text: level.blurb }),
      level.objectives.length ? h('ul', { class: 'dd-goals' }, ...level.objectives.map((o) => h('li', { text: objectiveText(o) }))) : null,
      Number.isFinite(level.shots) ? h('p', { class: 'dd-note', text: `${level.shots} shots${level.mode === 'score' ? '' : `. Par ${level.par} for three stars`}.` }) : null,
      intro ? h('div', { class: 'dd-new' }, h('b', { text: `New: ${introName}` }), h('span', { text: introBlurb })) : null,
      h('div', { class: 'sheet-actions' }, h('button', { class: 'btn primary lg', text: 'Start', onClick: () => (s.close(), app.play('select')) })),
    );
    const s = sheet(body, () => {
      modal = false;
      if (intro && intro in BALLS) selectBall(intro as BallId);
    });
  };

  const openPause = (): void => {
    if (resultShown || paused) return;
    endPull();
    app.play('tap');
    paused = true;
    const toggle = (text: string, key: 'sound' | 'reducedMotion' | 'haptics'): HTMLElement => {
      const btn = h('button', {
        class: `toggle${app.save.settings[key] ? ' on' : ''}`,
        role: 'switch',
        'aria-checked': String(app.save.settings[key]),
        'aria-label': text,
        onClick: () => {
          app.save.settings[key] = !app.save.settings[key];
          app.persist();
          app.applySettings();
          renderer.reducedMotion = app.reducedMotion;
          btn.classList.toggle('on', app.save.settings[key]);
          btn.setAttribute('aria-checked', String(app.save.settings[key]));
        },
      });
      return h('div', { class: 'setting-row' }, h('b', { text }), btn);
    };
    const actions = h('div', { class: 'sheet-actions stack' }, h('button', { class: 'btn primary', text: 'Resume', onClick: () => s.close() }));
    if (kind === 'house') {
      actions.append(h('button', { class: 'btn ghost', text: 'All houses', onClick: () => (s.close(), app.go('houses')) }));
      actions.append(h('button', { class: 'btn ghost', text: 'Rebuild this house', onClick: () => (s.close(), confirmRebuild()) }));
    } else {
      actions.append(h('button', { class: 'btn ghost', text: kind === 'sandbox' ? 'Rebuild the house' : 'Restart', onClick: () => (s.close(), restart()) }));
      if (kind === 'challenge') actions.append(h('button', { class: 'btn ghost', text: 'Challenges', onClick: () => (s.close(), app.go('challenges')) }));
    }
    actions.append(h('button', { class: 'btn ghost', text: 'Home', onClick: () => (s.close(), app.go('title')) }));
    const body = h('div', { class: 'sheet-body dd dd-sheet' }, h('h2', { text: 'Paused' }), h('p', { class: 'dd-lede', text: houseDef ? `${houseDef.number} · ${houseDef.name}` : level.title }), toggle('Sound', 'sound'), toggle('Vibration', 'haptics'), toggle('Reduce motion', 'reducedMotion'), actions);
    const s = sheet(body, () => {
      paused = false;
    });
  };

  const confirmRebuild = (): void => {
    if (!houseDef) return;
    modal = true;
    const body = h(
      'div',
      { class: 'sheet-body dd dd-sheet' },
      h('h2', { text: 'Rebuild this house?' }),
      h('p', { class: 'dd-lede', text: 'Every brick goes back where it was. Your specials and the reward meter stay as they are.' }),
      h('div', { class: 'sheet-actions stack' }, h('button', { class: 'btn primary', text: 'Rebuild', onClick: () => (s.close(), store.rebuildHouse(houseDef.id), restart()) }), h('button', { class: 'btn ghost', text: 'Keep the damage', onClick: () => s.close() })),
    );
    const s = sheet(body, () => {
      modal = false;
    });
  };

  // ------------------------------------------------------------ restart

  const wire = (): void => {
    session.onShot = onShot;
    session.onComplete = onComplete;
  };
  const restart = (): void => {
    endPull();
    document.querySelectorAll('.sheet-wrap').forEach((s) => s.remove());
    session = build();
    if (kind !== 'house') store.started(level);
    wire();
    renderer.load(session.world);
    pins = pinsFor(session);
    weakDirty = true;
    resultShown = false;
    modal = false;
    paused = false;
    ball = 'standard';
    headline.classList.remove('show');
    predDirty = true;
    app.play('tap');
    renderAll();
  };

  const renderAll = (): void => {
    renderCard();
    renderTray();
    el.classList.toggle('flying', session.phase !== 'aim');
    fireBtn.disabled = blocked();
  };

  // ------------------------------------------------------------ saving

  /** Writes the house as it stands. Anything still moving is settled first. */
  const persist = (): void => {
    if (!houseDef) return;
    store.saveHouse(houseDef.id, session.world.snapshot());
    store.save();
    snapDirty = false;
  };
  const onHide = (): void => {
    if (document.visibilityState === 'hidden') persist();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', persist);

  // --------------------------------------------------------------- loop

  let raf = 0;
  let last = performance.now();
  let acc = 0;
  let liveTier: Tier = 0;
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
    let scale = paused ? 0 : 1;
    if (slowmo > 0) {
      slowmo -= realDt;
      scale *= 0.3;
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
      const q = session.liveQuality();
      if (q) {
        if (q.headline) showHeadline(q.headline);
        if (q.tier > liveTier) reactTo(q.tier, q.headline);
        liveTier = Math.max(liveTier, q.tier) as Tier;
      }
      if (events.some((e) => e.t === 'break' || e.t === 'release' || e.t === 'knock')) renderCard();
    }
    if (session.phase !== 'flight') liveTier = 0;
    const aiming = session.phase === 'aim';
    if (aiming && weakDirty && session.world.pending.size === 0) {
      weak = kind === 'challenge' ? [] : session.world.weakPoints(3).map((x) => x.part);
      pins = pinsFor(session);
      weakDirty = false;
    }
    if (snapDirty && aiming && session.world.settled) persist();
    const showGuide = aiming && !blocked() && (drag?.armed || keyAim);
    if (showGuide && predDirty) {
      prediction = predict(session.world, shotFor(ball, aim.yaw, aim.pull), session.mods(), 4);
      predDirty = false;
    }
    if (session.phase === 'done') finishRun();
    renderMeter(realDt);
    const view: ViewState = {
      phase: session.phase,
      ball,
      yaw: aim.yaw,
      pitch: shotFor(ball, aim.yaw, aim.pull).pitch,
      power: drag || keyAim ? aim.pull : aiming ? 0.1 : 1,
      prediction: showGuide ? prediction : null,
      guideFull: true,
      guideShare: 1,
      golfers: session.armed.has('golfers') || (!aiming && session.world.balls.some((b) => b.golfer > 0 && b.alive)) ? 3 : 1,
      peek,
      zoom: false,
      pins: aiming ? pins : [],
      weak: aiming ? weak : [],
    };
    renderer.update(realDt * scale, view);
    renderer.render();
  };

  wire();
  renderAll();
  if (kind === 'challenge') openIntro();
  if (houseDef) {
    hint.textContent = houseDef.hint;
    const g = Object.entries(gift) as Array<[SpecialId, number]>;
    if (g.length) {
      const [b, n] = g[0] as [SpecialId, number];
      window.setTimeout(() => showBanner(`New ball: ${BALLS[b].name}`, `${n} to try. ${BALLS[b].blurb}`, b), 600);
    } else if (session.completed) hint.textContent = 'Finished. Keep smashing, or pick the next house from the menu.';
  } else if (kind === 'daily') hint.textContent = level.blurb;
  else if (kind === 'sandbox') hint.textContent = 'Every special ball, unlimited. Pause to rebuild the house.';
  if (!store.data.coached && kind === 'house') coach.classList.remove('hidden');
  raf = requestAnimationFrame(frame);

  // Automation hook for the smoke test.
  (window as unknown as { __golf?: unknown }).__golf = {
    get session() {
      return session;
    },
    aim,
    renderer,
    store,
    fire,
    selectBall,
    restart,
    persist,
    togglePowerup,
    /** Points the shot at a world point with the real controls (tests and the smoke run). */
    aimAt(x: number, y: number, z: number): boolean {
      const s = solvePull(session.world, ball, { x, y, z }, session.mods());
      if (!s) return false;
      aim.yaw = s.yaw;
      aim.pull = s.pull;
      keyAim = true;
      predDirty = true;
      return true;
    },
  };

  return {
    el,
    destroy: () => {
      persist();
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', persist);
      document.removeEventListener('gesturestart', stopGesture);
      window.clearTimeout(captionTimer);
      window.clearTimeout(headlineTimer);
      window.clearTimeout(bannerTimer);
      document.querySelectorAll('.sheet-wrap').forEach((s) => s.remove());
      renderer.dispose();
    },
  };
}
