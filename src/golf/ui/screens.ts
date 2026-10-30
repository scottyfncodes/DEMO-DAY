import type { App, ScreenInstance } from '../../app';
import { h } from '../../ui/dom';
import { ICON } from '../../ui/icons';
import { sheet } from '../../ui/screens/common';
import { HOUSES, houseLevel, type HouseDef } from '../game/houses';
import { REWARD, SPECIALS } from '../game/rewards';
import { GolfRenderer, type ViewState } from '../render/scene';
import { BALLS, type BallId } from '../sim/balls';
import { CAMPAIGN, PRECISION, SCORE_ATTACK, objectiveText, type LevelDef } from '../sim/levels';
import { Session } from '../sim/session';
import { World } from '../sim/world';
import { MODE_UNLOCK, modeOpen, todayKey, type GolfStore } from '../save';
import { GICON, ballSwatch } from './icons';

/** Header with a back button for golf pages. */
function pageHead(app: App, title: string, back: () => void = () => app.go('title')): HTMLElement {
  return h('header', { class: 'dd-page-head' }, h('button', { class: 'dd-icon', 'aria-label': 'Back', html: ICON.back, onClick: () => (app.play('tap'), back()) }), h('h2', { text: title }), h('span'));
}

function starRow(n: number): HTMLElement {
  const el = h('span', { class: 'dd-stars small', 'aria-label': `${n} of 3 stars` });
  for (let i = 0; i < 3; i++) el.append(h('span', { class: `star${i < n ? ' on' : ''}`, html: ICON.star }));
  return el;
}

/** The house's objective progress as 0..1 and a short label, read from its saved damage. */
function houseProgress(store: GolfStore, hd: HouseDef): { share: number; label: string; down: number; world: World } {
  const level = houseLevel(hd);
  const world = new World(level.house, level.yard, 7);
  const snap = store.loadHouse(hd.id);
  if (snap) world.restore(snap);
  const s = new Session(level, 7, { world });
  const [a, b] = s.progress(hd.objective);
  const share = Math.min(1, b > 0 ? a / b : 0);
  const label = hd.objective.kind === 'destruction' || hd.objective.kind === 'wall' ? `${Math.min(a, b)}% of ${b}%` : hd.objective.kind === 'collapse' && hd.objective.what !== 'roof' && hd.objective.what !== 'floor' ? (a >= b ? 'Done' : 'Standing') : `${Math.min(a, b)} of ${b}`;
  return { share, label, down: Math.floor(world.destruction() * 100), world };
}

// ------------------------------------------------------------------- title

/**
 * Title: the player's house, as they left it, fills the screen. One big
 * button goes straight back to it; the other modes sit quietly under it.
 */
export function golfTitleScreen(app: App): ScreenInstance {
  const store = app.golf;
  const hd = store.currentHouse;
  const rec = store.houseRec(hd.id);
  const prog = houseProgress(store, hd);
  const canvas = h('canvas', { class: 'title-canvas', 'aria-hidden': 'true' });
  const lowPower = (navigator.hardwareConcurrency ?? 8) <= 4;
  const renderer = new GolfRenderer(canvas, prog.world, { lowPower, reducedMotion: app.reducedMotion });
  const started = rec.shots > 0 || store.data.campaign.reached > 0;

  const inv = SPECIALS.filter((b) => (store.data.economy.inventory[b] ?? 0) > 0);
  const play = h(
    'button',
    { class: 'dd-play', onClick: () => (app.play('select'), app.go('golf', { id: hd.id })) },
    h('span', { class: 'dd-play-label', text: started ? 'Play' : 'Start' }),
    h('span', { class: 'dd-play-sub', text: rec.done ? 'Finished. Keep smashing' : prog.share > 0 ? `${Math.round(prog.share * 100)}% of the way` : 'Fresh house' }),
  );
  const link = (label: string, go: () => void): HTMLElement => h('button', { class: 'dd-link', onClick: () => (app.play('tap'), go()) }, h('span', { text: label }));
  const el = h(
    'main',
    { class: 'screen dd dd-title' },
    canvas,
    h('header', { class: 'dd-title-head' }, h('h1', { class: 'dd-wordmark', 'aria-label': 'Demo Day' }, h('span', { text: 'DEMO' }), h('span', { class: 'day', text: 'DAY' })), h('button', { class: 'dd-icon', 'aria-label': 'Settings', html: ICON.settings, onClick: () => (app.play('tap'), app.go('golf-settings')) })),
    h(
      'section',
      { class: 'dd-title-panel' },
      h(
        'button',
        { class: 'dd-house-line', 'aria-label': 'All houses', onClick: () => (app.play('tap'), app.go('houses')) },
        h('span', { class: 'dd-kicker', text: `House ${hd.number} of ${HOUSES.length}` }),
        h('b', { text: hd.name }),
        h('span', { class: 'dd-house-obj' }, h('span', { text: objectiveText(hd.objective) }), h('span', { class: 'dd-house-count', text: rec.done ? 'Done' : prog.label })),
        h('span', { class: 'dd-obj-bar' }, h('i', { class: 'dd-obj-fill', style: `transform:scaleX(${rec.done ? 1 : prog.share})` })),
      ),
      inv.length ? h('div', { class: 'dd-inv', 'aria-label': 'Special balls' }, ...inv.map((b) => h('span', { class: 'dd-inv-ball', title: BALLS[b].name }, h('span', { class: 'dd-swatch', html: ballSwatch(b, 22) }), h('b', { text: String(store.data.economy.inventory[b]) }))), h('span', { class: 'dd-inv-meter', 'aria-label': `Reward meter ${Math.round(store.data.economy.meter)} of ${REWARD.meterSize}` }, h('i', { style: `transform:scaleX(${store.data.economy.meter / REWARD.meterSize})` }))) : null,
      play,
      h('nav', { class: 'dd-modes' }, link('Daily Demo', () => app.go('golf', { id: `daily-${todayKey()}` })), link('Sandbox', () => app.go('golf', { id: 'sandbox' })), link('Challenges', () => app.go('challenges'))),
    ),
  );

  let raf = 0;
  let last = performance.now();
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
    const view: ViewState = { phase: 'intro', ball: 'standard', yaw: Math.sin(now / 2400) * 4, pitch: 10, power: 0.1, prediction: null, guideFull: false, guideShare: 0, golfers: 1, peek: false, zoom: false, pins: [] };
    renderer.update(dt, view);
    renderer.render();
  };
  raf = requestAnimationFrame(frame);
  return { el, destroy: () => (cancelAnimationFrame(raf), renderer.dispose()) };
}

// ------------------------------------------------------------------ houses

export function golfHousesScreen(app: App): ScreenInstance {
  const store = app.golf;
  const row = (hd: HouseDef, i: number): HTMLElement => {
    const open = store.houseOpen(hd.id);
    const rec = store.data.campaign.houses[hd.id];
    const current = store.data.campaign.current === hd.id;
    const prog = open && rec?.shots ? houseProgress(store, hd) : null;
    const status = !open ? 'Locked' : rec?.done ? `Done in ${rec.doneIn} shot${rec.doneIn === 1 ? '' : 's'}` : prog ? `${prog.down}% down · ${rec?.shots ?? 0} shots` : 'Not started';
    return h(
      'li',
      {},
      h(
        'button',
        { class: `dd-row${open ? '' : ' locked'}${current ? ' current' : ''}${rec?.done ? ' done' : ''}`, disabled: !open, 'aria-label': `House ${hd.number}, ${hd.name}, ${status}`, onClick: () => (app.play('select'), app.go('golf', { id: hd.id })) },
        h('span', { class: 'dd-row-no', text: hd.number }),
        h('span', { class: 'dd-row-main' }, h('b', { text: hd.name }), h('small', { text: open ? objectiveText(hd.objective) : i > 0 ? `Finish ${(HOUSES[i - 1] as HouseDef).name} to open` : '' }), h('small', { class: 'dd-row-status', text: status })),
        h('span', { class: 'dd-row-side' }, hd.unlocks && open ? h('span', { class: 'dd-swatch', title: `Brings the ${BALLS[hd.unlocks].name}`, html: ballSwatch(hd.unlocks, 22) }) : null, rec?.done ? h('span', { class: 'dd-tick', html: ICON.check }) : !open ? h('span', { class: 'icon', html: ICON.lock }) : null),
      ),
    );
  };
  const el = h('main', { class: 'screen dd dd-page' }, pageHead(app, 'The Street'), h('p', { class: 'dd-page-lede', text: 'Each house has a weak spot. Damage stays until you come back.' }), h('ol', { class: 'dd-rows' }, ...HOUSES.map(row)));
  return { el };
}

// -------------------------------------------------------------- challenges

export function golfChallengesScreen(app: App): ScreenInstance {
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
        { class: `dd-row${open ? '' : ' locked'}`, disabled: !open, 'aria-label': `${l.number} ${l.title}${open ? '' : ', locked'}`, onClick: () => (app.play('select'), app.go('golf', { id: l.id })) },
        h('span', { class: 'dd-row-no', text: l.number }),
        h('span', { class: 'dd-row-main' }, h('b', { text: l.title }), h('small', { text: l.objectives.map(objectiveText).join(' · ') || l.blurb }), h('small', { class: 'dd-row-status', text: rec?.completions ? `Best ${rec.bestShots} shot${rec.bestShots === 1 ? '' : 's'} · par ${l.par}` : open ? `${l.shots} shots · par ${l.par}` : `Finish ${prev?.title ?? ''} to open` })),
        h('span', { class: 'dd-row-side' }, intro ? h('span', { class: 'dd-swatch', html: ballSwatch(intro, 20) }) : null, open ? starRow(rec?.bestStars ?? 0) : h('span', { class: 'icon', html: ICON.lock })),
      ),
    );
  };
  const mode = (l: LevelDef, key: string, best: string): HTMLElement => {
    const open = modeOpen(store, key);
    return h(
      'li',
      {},
      h(
        'button',
        { class: `dd-row${open ? '' : ' locked'}`, onClick: () => (open ? (app.play('select'), app.go('golf', { id: l.id })) : app.toast(MODE_UNLOCK[key]?.label ?? '')) },
        h('span', { class: 'dd-row-no', text: l.number }),
        h('span', { class: 'dd-row-main' }, h('b', { text: l.title }), h('small', { text: open ? l.blurb : (MODE_UNLOCK[key]?.label ?? '') }), best ? h('small', { class: 'dd-row-status', text: best }) : null),
        h('span', { class: 'dd-row-side' }, open ? null : h('span', { class: 'icon', html: ICON.lock })),
      ),
    );
  };
  const sa = store.peek(SCORE_ATTACK);
  const el = h(
    'main',
    { class: 'screen dd dd-page' },
    pageHead(app, 'Challenges'),
    h('p', { class: 'dd-page-lede', text: 'Set puzzles with a shot limit. Three stars at or under par. Nothing here changes your houses.' }),
    h('h3', { class: 'dd-section', text: 'Trick shots' }),
    h('ol', { class: 'dd-rows' }, ...CAMPAIGN.map(card)),
    h('h3', { class: 'dd-section', text: 'Precision' }),
    h('ul', { class: 'dd-rows' }, ...PRECISION.map((p) => mode(p, 'precision', store.peek(p)?.completions ? `Best ${store.peek(p)?.bestShots} shots, par ${p.par}` : `Par ${p.par}`))),
    h('h3', { class: 'dd-section', text: 'Score Attack' }),
    h('ul', { class: 'dd-rows' }, mode(SCORE_ATTACK, 'score', sa?.bestScore ? `Best ${sa.bestScore.toLocaleString('en-US')}` : 'Bronze, silver and gold')),
  );
  return { el };
}

/** Kept for old links: the levels page is now Challenges. */
export const golfLevelsScreen = golfChallengesScreen;

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
    { class: 'screen dd dd-page' },
    pageHead(app, 'Settings'),
    h(
      'section',
      { class: 'dd-panel' },
      toggle('Sound', 'Bricks, glass, snapping supports and collapses. Every hit is also shown on screen.', 'sound'),
      toggle('Vibration', 'Short buzzes on seam shots, supports and collapses, where the device supports it.', 'haptics'),
      toggle('Reduce motion', 'No camera shake, no slow motion and no pulsing weak points.', 'reducedMotion'),
    ),
    h(
      'section',
      { class: 'dd-panel' },
      h('h3', { text: 'How to shoot' }),
      h('p', { text: 'Press anywhere and pull back. The further you pull, the harder and higher the shot. Pull to the side to turn; move slowly for fine turns. Let go to shoot, or let go before the ring starts to fill to cancel.' }),
      h('p', { text: 'Keyboard: left and right turn (Shift for fine), up and down set power, Space shoots, 1 to 6 pick a ball, X looks inside, Escape pauses.' }),
    ),
    h(
      'section',
      { class: 'dd-panel' },
      h('h3', { text: 'More' }),
      h('button', { class: 'dd-row', onClick: () => (app.play('tap'), app.go('classic')) }, h('span', { class: 'dd-row-no', html: GICON.crane }), h('span', { class: 'dd-row-main' }, h('b', { text: 'Crew Contracts' }), h('small', { text: 'The original machine-and-moves Demo Day. Its save is separate and untouched.' }))),
    ),
    h(
      'section',
      { class: 'dd-panel' },
      h(
        'div',
        { class: 'setting-row' },
        h('div', {}, h('b', { text: 'Reset progress' }), h('small', { text: 'Clears houses, specials, challenges and daily scores on this device. Crew Contracts is not touched.' })),
        h('button', {
          class: 'btn danger sm',
          text: 'Reset',
          onClick: () => {
            const s = sheet(
              h(
                'div',
                { class: 'sheet-body dd dd-sheet' },
                h('h2', { text: 'Reset everything?' }),
                h('p', { class: 'dd-lede', text: 'Every house goes back up, and your specials, stars and scores go. This cannot be undone.' }),
                h(
                  'div',
                  { class: 'sheet-actions stack' },
                  h('button', { class: 'btn ghost', text: 'Keep my progress', onClick: () => s.close() }),
                  h('button', {
                    class: 'btn danger',
                    text: 'Reset progress',
                    onClick: () => {
                      s.close();
                      app.golf.reset();
                      app.toast('Progress reset.');
                      app.go('title');
                    },
                  }),
                ),
              ),
            );
          },
        }),
      ),
    ),
    h('p', { class: 'dd-foot', text: 'Progress is saved on this device. Add DEMO DAY to your Home Screen for full screen play.' }),
  );
  return { el };
}
