import type { App, ScreenInstance } from '../../app';
import { h } from '../../ui/dom';
import { ICON } from '../../ui/icons';
import { sheet } from '../../ui/screens/common';
import { GolfRenderer, type ViewState } from '../render/scene';
import { solveAim } from '../sim/aim';
import { BALLS, type BallId } from '../sim/balls';
import { CAMPAIGN, PRECISION, SANDBOX, SCORE_ATTACK, dailyLevel, objectiveText, type LevelDef } from '../sim/levels';
import { Rng } from '../sim/math';
import { PartState } from '../sim/parts';
import { Session } from '../sim/session';
import { DT } from '../sim/world';
import { MODE_UNLOCK, modeOpen, todayKey } from '../save';
import { GICON, ballSwatch } from './icons';

/** Header with a back button for golf pages. */
function pageHead(app: App, title: string, back: () => void = () => app.go('title')): HTMLElement {
  return h('header', { class: 'page-head' }, h('button', { class: 'icon-btn', 'aria-label': 'Back', html: ICON.back, onClick: () => (app.play('tap'), back()) }), h('h2', { text: title }), h('span'));
}

function starRow(n: number): HTMLElement {
  const el = h('span', { class: 'stars', 'aria-label': `${n} of 3 stars` });
  for (let i = 0; i < 3; i++) el.append(h('span', { class: `star${i < n ? ' on' : ''}`, html: ICON.star }));
  return el;
}

// ------------------------------------------------------------------- title

/**
 * Title: the house on its lot with a golfer taking real shots at it in the
 * background (the same simulation as the game), and the way in up front.
 */
export function golfTitleScreen(app: App): ScreenInstance {
  const store = app.golf;
  const next = store.nextLevel;
  const canvas = h('canvas', { class: 'title-canvas', 'aria-hidden': 'true' });
  const lowPower = (navigator.hardwareConcurrency ?? 8) <= 4;
  const demoLevel: LevelDef = { ...SCORE_ATTACK, shots: Infinity, balls: { power: Infinity, heavy: Infinity, super: Infinity, blast: Infinity } };
  let session = new Session(demoLevel);
  const renderer = new GolfRenderer(canvas, session.world, { lowPower, reducedMotion: app.reducedMotion });
  const rng = new Rng(Date.now() & 0xffff);
  let wait = 1.4;
  let shots = 0;
  let aim = { yaw: 0, power: 0.85, ball: 'standard' as BallId };

  const started = Object.keys(store.data.levels).length > 0;
  const start = h(
    'button',
    { class: 'btn primary xl', onClick: () => (app.play('select'), app.go('golf', { id: next.id })) },
    h('span', { class: 'btn-label', text: started ? 'Continue' : 'Tee off' }),
    h('span', { class: 'btn-sub', text: `${next.number} · ${next.title}` }),
  );
  const nav = (label: string, icon: string, go: () => void, locked = false): HTMLElement =>
    h('button', { class: `nav-btn${locked ? ' locked' : ''}`, onClick: () => (app.play('tap'), go()) }, h('span', { class: 'icon', html: locked ? ICON.lock : icon }), h('span', { text: label }));
  const scoreOpen = modeOpen(store, 'score');
  const dailyOpen = modeOpen(store, 'daily');
  const el = h(
    'main',
    { class: 'screen title golf-title' },
    canvas,
    h('div', { class: 'title-shade' }),
    h(
      'header',
      { class: 'title-head' },
      h('h1', { class: 'wordmark' }, h('span', { text: 'DEMO' }), h('span', { class: 'day', text: 'DAY' })),
      h('span', { class: 'title-stamp', text: 'Golf-powered demolition' }),
      h('p', { class: 'tagline', text: 'One tee, one house, a bag of golf balls. Take it down a brick at a time.' }),
    ),
    h(
      'section',
      { class: 'title-panel' },
      h('div', { class: 'title-stats' }, h('span', { class: 'chip' }, h('span', { class: 'icon', html: ICON.star }), h('b', { text: `${store.totalStars} / ${CAMPAIGN.length * 3}` })), h('span', { class: 'chip', text: `${CAMPAIGN.filter((l) => store.completed(l.id)).length} of ${CAMPAIGN.length} levels` })),
      start,
      h(
        'nav',
        { class: 'title-nav' },
        nav('Levels', GICON.flag, () => app.go('levels')),
        nav('Score Attack', GICON.bolt, () => (scoreOpen ? app.go('golf', { id: 'score' }) : app.toast(MODE_UNLOCK.score?.label ?? '')), !scoreOpen),
        nav('Daily', GICON.calendar, () => (dailyOpen ? app.go('golf', { id: `daily-${todayKey()}` }) : app.toast(MODE_UNLOCK.daily?.label ?? '')), !dailyOpen),
        nav('Settings', ICON.settings, () => app.go('golf-settings')),
      ),
    ),
  );

  let raf = 0;
  let last = performance.now();
  let acc = 0;
  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    const w = canvas.clientWidth || window.innerWidth;
    const hh = canvas.clientHeight || window.innerHeight;
    if (renderer.width !== w || renderer.height !== hh) {
      renderer.resize(w, hh);
      renderer.snapCamera();
    }
    acc += dt;
    let steps = 0;
    while (acc >= DT && steps < 4) {
      session.step();
      acc -= DT;
      steps++;
    }
    if (steps >= 4) acc = 0;
    renderer.ingest(session.takeEvents());
    if (session.phase === 'aim') {
      wait -= dt;
      if (wait <= 0) {
        if (shots >= 7 || session.world.destruction() > 0.3) {
          session = new Session(demoLevel);
          renderer.load(session.world);
          shots = 0;
          wait = 1.5;
        } else {
          // Pick something worth hitting: a window, a seam low on the wall, the porch, the chimney.
          const P = session.world.parts.filter((p) => p.state === PartState.Intact && (p.kind === 'glass' || p.kind === 'brick' || p.kind === 'column') && (p.wall === 'front' || p.kind === 'column' || p.tags.includes('chimney')) && p.y < 6);
          const p = P[Math.floor(rng.next() * P.length)];
          const balls: BallId[] = ['standard', 'standard', 'power', 'heavy', 'super', 'blast'];
          const ball = balls[Math.floor(rng.next() * balls.length)] as BallId;
          if (p) {
            const shot = solveAim(session.world, ball, { x: p.x, y: p.y, z: p.z + p.hz }, 0.75 + rng.next() * 0.25);
            if (shot) {
              aim = { yaw: shot.yaw, power: shot.power, ball };
              session.fire(shot);
              shots++;
            }
          }
          wait = 1.2;
        }
      }
    }
    const view: ViewState = { phase: session.phase === 'done' ? 'aim' : session.phase, ball: aim.ball, yaw: aim.yaw, pitch: 10, power: aim.power, prediction: null, guideFull: false, guideShare: 0, golfers: 1, peek: false, zoom: false, pins: [] };
    renderer.update(dt, view);
    renderer.render();
  };
  raf = requestAnimationFrame(frame);
  return { el, destroy: () => (cancelAnimationFrame(raf), renderer.dispose()) };
}

// ------------------------------------------------------------------ levels

export function golfLevelsScreen(app: App): ScreenInstance {
  const store = app.golf;
  const card = (l: LevelDef, i: number): HTMLElement => {
    const open = store.isOpen(l);
    const prev = CAMPAIGN[i - 1];
    const rec = store.peek(l);
    const intro = l.introduces && l.introduces in BALLS ? (l.introduces as BallId) : null;
    return h(
      'li',
      {},
      h(
        'button',
        { class: `level-card${open ? '' : ' locked'}`, disabled: !open, 'aria-label': `${l.number} ${l.title}${open ? '' : ', locked'}`, onClick: () => (app.play('select'), app.go('golf', { id: l.id })) },
        h('span', { class: 'job-no', text: l.number }),
        h(
          'span',
          { class: 'level-main' },
          h('b', { text: l.title }),
          h('small', { text: l.objectives.map(objectiveText).join(' · ') || l.blurb }),
          h('small', { class: 'muted', text: rec?.completions ? `Best: ${rec.bestShots} shot${rec.bestShots === 1 ? '' : 's'} · ${rec.bestScore.toLocaleString('en-US')} pts` : open ? `Par ${l.par}` : `Finish level ${prev?.number ?? ''} to open` }),
        ),
        h('span', { class: 'level-side' }, intro ? h('span', { class: 'g-swatch', title: `New: ${BALLS[intro].name}`, html: ballSwatch(intro, 20) }) : null, open ? starRow(rec?.bestStars ?? 0) : h('span', { class: 'icon', html: ICON.lock })),
      ),
    );
  };
  const mode = (title: string, icon: string, sub: string, key: string, go: () => void, best = ''): HTMLElement => {
    const open = modeOpen(store, key);
    return h(
      'li',
      {},
      h(
        'button',
        { class: `level-card mode${open ? '' : ' locked'}`, onClick: () => (open ? (app.play('select'), go()) : app.toast(MODE_UNLOCK[key]?.label ?? '')) },
        h('span', { class: 'icon mode-icon', html: open ? icon : ICON.lock }),
        h('span', { class: 'level-main' }, h('b', { text: title }), h('small', { text: open ? sub : (MODE_UNLOCK[key]?.label ?? '') }), best ? h('small', { class: 'muted', text: best }) : null),
      ),
    );
  };
  const daily = dailyLevel(todayKey());
  const dRec = store.peek(daily);
  const saRec = store.peek(SCORE_ATTACK);
  const el = h(
    'main',
    { class: 'screen page golf-levels' },
    pageHead(app, 'Levels'),
    h('p', { class: 'page-lede', text: 'Each level teaches one trick. Three stars for finishing at or under par.' }),
    h('ol', { class: 'level-list' }, ...CAMPAIGN.map(card)),
    h('h3', { class: 'section-title', text: 'More ways to play' }),
    h(
      'ul',
      { class: 'level-list' },
      mode('Score Attack', GICON.bolt, SCORE_ATTACK.blurb, 'score', () => app.go('golf', { id: 'score' }), saRec?.bestScore ? `Best ${saRec.bestScore.toLocaleString('en-US')}` : ''),
      mode('Daily Challenge', GICON.calendar, `${todayKey()}: ${objectiveText(daily.objectives[0] as never)}. Same layout all day.`, 'daily', () => app.go('golf', { id: daily.id }), dRec?.completions ? `Done today in ${dRec.bestShots} shots` : ''),
      ...PRECISION.map((p) => mode(p.title, GICON.target, p.blurb, 'precision', () => app.go('golf', { id: p.id }), store.peek(p)?.completions ? `Best ${store.peek(p)?.bestShots} shots (par ${p.par})` : `Par ${p.par}`)),
      mode('Sandbox', GICON.sandbox, SANDBOX.blurb, 'sandbox', () => app.go('golf', { id: 'sandbox' })),
    ),
    h('h3', { class: 'section-title', text: 'The original Demo Day' }),
    h('ul', { class: 'level-list' }, h('li', {}, h('button', { class: 'level-card mode', onClick: () => app.go('classic') }, h('span', { class: 'icon mode-icon', html: GICON.crane }), h('span', { class: 'level-main' }, h('b', { text: 'Crew Contracts' }), h('small', { text: 'The machine-and-moves demolition game: crane, charges, excavator, dozer, loader. Your saved contracts are kept.' }))))),
  );
  return { el };
}

// ---------------------------------------------------------------- settings

export function golfSettingsScreen(app: App): ScreenInstance {
  const save = app.save;
  const toggle = (label: string, note: string, key: 'sound' | 'haptics' | 'reducedMotion'): HTMLElement => {
    const btn = h('button', {
      class: `toggle${save.settings[key] ? ' on' : ''}`,
      role: 'switch',
      'aria-checked': String(save.settings[key]),
      'aria-label': label,
      onClick: () => {
        save.settings[key] = !save.settings[key];
        app.persist();
        app.applySettings();
        btn.classList.toggle('on', save.settings[key]);
        btn.setAttribute('aria-checked', String(save.settings[key]));
        app.play('tap');
      },
    });
    return h('div', { class: 'setting-row' }, h('div', {}, h('b', { text: label }), h('small', { text: note })), btn);
  };
  const el = h(
    'main',
    { class: 'screen page settings' },
    pageHead(app, 'Settings'),
    h(
      'section',
      { class: 'card' },
      toggle('Sound', 'Swings, bricks, glass and collapses. Every hit is also shown on screen.', 'sound'),
      toggle('Vibration', 'Short buzzes on seam shots and collapses, where the device supports it.', 'haptics'),
      toggle('Reduce motion', 'No camera shake and no slow motion on big collapses.', 'reducedMotion'),
    ),
    h(
      'section',
      { class: 'card' },
      h('h3', { text: 'Controls' }),
      h('p', { class: 'muted small', text: 'Drag on the lawn to aim: sideways turns, up and down sets the loft. The bar on the right sets power. Zoom halves the aim speed for fine shots.' }),
      h('p', { class: 'muted small', text: 'Keyboard: arrows aim (Shift for fine), W and S for power, Space to fire, 1 to 6 picks a ball, Z zooms, X looks inside, R restarts.' }),
    ),
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'setting-row' }, h('div', {}, h('b', { text: 'Reset golf progress' }), h('small', { text: 'Clears golf levels, stars and records on this device. Crew Contracts progress is separate and is not touched.' })), h('button', { class: 'btn danger sm', text: 'Reset', onClick: () => {
        const s = sheet(h('div', { class: 'sheet-body' }, h('h2', { text: 'Reset golf progress?' }), h('p', { text: 'Every golf level, star and record on this device goes. This cannot be undone.' }), h('div', { class: 'sheet-actions' }, h('button', { class: 'btn ghost', text: 'Keep my progress', onClick: () => s.close() }), h('button', { class: 'btn danger', text: 'Reset golf progress', onClick: () => {
          s.close();
          app.golf.reset();
          app.toast('Golf progress reset.');
          app.go('title');
        } }))));
      } })),
    ),
    h('p', { class: 'muted small center', text: 'Progress is saved on this device. Add DEMO DAY to your Home Screen for full screen play.' }),
  );
  return { el };
}
