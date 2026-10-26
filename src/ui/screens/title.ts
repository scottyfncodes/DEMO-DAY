import type { App, ScreenInstance } from '../../app';
import { formatMoney } from '../../core/format';
import { kitFor } from '../../data/fleet';
import { crewMove } from '../../game/crew';
import { Job } from '../../game/moves';
import { completedCount, nextContract } from '../../game/progression';
import { Camera } from '../../render/camera';
import { SceneRenderer } from '../../render/scene';
import { WreckFx } from '../../wreck/fx';
import { DT, prepare } from '../../wreck/sim';
import { getContract } from '../../data/contracts';
import { h } from '../dom';
import { ICON } from '../icons';
import { buildingBounds } from '../view';

/**
 * Title: the next job's building on its lot, being taken down for real by
 * the crew in the background, with the way in front and centre.
 */
export function titleScreen(app: App): ScreenInstance {
  const save = app.save;
  const next = nextContract(save);
  const canvas = h('canvas', { class: 'title-canvas', 'aria-hidden': 'true' });
  const renderer = new SceneRenderer(canvas);
  const camera = new Camera();
  camera.minScale = 0.5;
  const fx = new WreckFx();
  fx.reducedMotion = app.reducedMotion;
  // The demo always plays the Corner Store with the starting fleet: quick, readable, and it never spoils a later job.
  const demoContract = getContract(save.tutorialDone ? next.id : 'corner');
  const newJob = (): Job => new Job({ ...demoContract, budgets: { ball: 4, dozer: 4, charges: 3, excavator: 4, loader: 3 } }, demoContract.recommended, prepare(demoContract.building), kitFor([]));
  let job = newJob();
  let downAt = -1;
  let wait = 2.2;

  const first = !save.tutorialDone;
  const start = h(
    'button',
    { class: 'btn primary xl', onClick: () => go() },
    h('span', { class: 'btn-label', text: first ? 'Take the first call' : 'Next call-out' }),
    h('span', { class: 'btn-sub', text: `${next.number} · ${next.title}` }),
  );
  const go = (): void => {
    app.play('select');
    app.go('brief', { id: next.id });
  };
  const nav = (label: string, icon: string, to: Parameters<App['go']>[0], badge = ''): HTMLElement =>
    h('button', { class: 'nav-btn', onClick: () => (app.play('tap'), app.go(to)) }, h('span', { class: 'icon', html: icon }), h('span', { text: label }), badge ? h('span', { class: 'badge', text: badge }) : null);

  const done = completedCount(save);
  const el = h(
    'main',
    { class: 'screen title' },
    canvas,
    h('div', { class: 'title-shade' }),
    h(
      'header',
      { class: 'title-head' },
      h('h1', { class: 'wordmark' }, h('span', { text: 'DEMO' }), h('span', { class: 'day', text: 'DAY' })),
      h('span', { class: 'title-stamp', text: 'Super-incident cleanup' }),
      h('p', { class: 'tagline', text: 'The heroes saved the city. Somebody has to clean it up.' }),
    ),
    h(
      'section',
      { class: 'title-panel' },
      h(
        'div',
        { class: 'title-stats' },
        h('span', { class: 'chip money' }, h('span', { class: 'icon', html: ICON.coin }), h('b', { text: formatMoney(save.money) })),
        h('span', { class: 'chip', text: `${done} of 8 jobs done` }),
      ),
      start,
      h('nav', { class: 'title-nav' }, nav('Jobs', ICON.board, 'jobs'), nav('Garage', ICON.garage, 'garage'), nav('Records', ICON.records, 'records'), nav('Settings', ICON.settings, 'settings')),
    ),
  );

  let raf = 0;
  let last = performance.now();
  let acc = 0;
  const frame = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const w = canvas.clientWidth || window.innerWidth;
    const hh = canvas.clientHeight || window.innerHeight;
    if (renderer.width !== w || renderer.height !== hh) {
      renderer.resize(w, hh);
      camera.setViewport(w, hh);
      camera.insetTop = hh * 0.2;
      camera.insetBottom = hh * 0.36;
      camera.fit(buildingBounds(job.sim.h, 7), 0);
    }
    acc += dt;
    let steps = 0;
    while (acc >= DT && steps < 3) {
      const ev = job.step();
      fx.ingest(ev, job.sim);
      acc -= DT;
      steps++;
    }
    if (job.ready) {
      wait -= dt;
      if (wait <= 0) {
        const plan = crewMove(job);
        if (plan && job.sim.standingFraction > 0.1) job.commit(plan);
        else if (downAt < 0) downAt = now;
        wait = 1.4;
      }
    }
    if (downAt > 0 && now - downAt > 4000) {
      job = newJob();
      fx.clear();
      downAt = -1;
      wait = 2.2;
    }
    fx.update(dt, job.sim);
    if (fx.shake > 0 && !app.reducedMotion) {
      camera.shakeX = (Math.random() - 0.5) * fx.shake * 5;
      camera.shakeY = (Math.random() - 0.5) * fx.shake * 5;
    } else {
      camera.shakeX = 0;
      camera.shakeY = 0;
    }
    renderer.draw(job.sim, camera, fx, { time: now / 1000, now, site: true, machines: job.loadout });
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return { el, destroy: () => cancelAnimationFrame(raf) };
}
