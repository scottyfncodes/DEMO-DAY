import type { App, ScreenInstance } from '../../app';
import { formatMoney } from '../../core/format';
import { getContract } from '../../data/contracts';
import { MACHINES, MACHINE_ORDER, type MachineId } from '../../data/fleet';
import { defaultLoadout, isCompleted, isUnlocked } from '../../game/progression';
import { getBuilding } from '../../wreck/buildings';
import { h } from '../dom';
import { MACHINE_ICON } from '../icons';
import { thumbnail } from '../view';
import { screenHeader } from './common';

/** The job sheet: what the client wants, what it pays, and which machines go to site. */
export function briefScreen(app: App, params: Record<string, string>): ScreenInstance {
  const save = app.save;
  const c = getContract(params.id ?? 'corner');
  if (!isUnlocked(c, save)) {
    queueMicrotask(() => app.go('jobs'));
    return { el: h('main', { class: 'screen' }) };
  }
  const b = getBuilding(c.building);
  const done = isCompleted(save, c.id);
  const rec = save.records[c.id];
  let pick: MachineId[] = defaultLoadout(c, save);

  const startBtn = h('button', { class: 'btn primary lg wide', onClick: () => start() });
  const count = h('span', { class: 'slot-count' });
  const grid = h('div', { class: 'crew-grid' });

  const sync = (): void => {
    count.textContent = `${pick.length} of ${c.slots}`;
    startBtn.disabled = pick.length === 0;
    startBtn.textContent = pick.length ? 'Start the job' : 'Pick at least one machine';
    for (const tile of grid.querySelectorAll<HTMLButtonElement>('.crew-tile')) {
      const id = tile.dataset.id as MachineId;
      const on = pick.includes(id);
      tile.classList.toggle('on', on);
      tile.setAttribute('aria-pressed', String(on));
    }
  };

  for (const id of MACHINE_ORDER) {
    const m = MACHINES[id];
    const owned = save.fleet.includes(id);
    const fixed = !!c.fixed;
    const allowed = fixed ? c.fixed?.includes(id) : owned;
    const moves = c.budgets[id] ?? m.baseMoves;
    const tile = h(
      'button',
      {
        class: `crew-tile${allowed ? '' : ' off'}${c.recommended.includes(id) ? ' rec' : ''}`,
        'data-id': id,
        disabled: !allowed || fixed,
        onClick: () => {
          if (pick.includes(id)) pick = pick.filter((x) => x !== id);
          else if (pick.length < c.slots) pick = [...pick, id];
          else {
            app.play('error');
            app.toast(`This site has room for ${c.slots} machines.`);
            return;
          }
          app.play('tap');
          sync();
        },
      },
      h('span', { class: 'crew-icon', html: MACHINE_ICON[id] }),
      h('span', { class: 'crew-name', text: m.short }),
      h('span', { class: 'crew-moves' }, h('b', { text: String(moves) }), ` ${moves === 1 ? m.move : m.moves}`),
      h('span', { class: 'crew-note', text: owned ? m.strength : `Not in your fleet · ${formatMoney(m.price)} in the garage` }),
    );
    grid.append(tile);
  }

  const start = (): void => {
    if (!pick.length) return;
    save.loadouts[c.id] = pick;
    app.persist();
    app.play('select');
    app.go('play', { id: c.id, crew: pick.join(',') });
  };

  const objectives = h(
    'ul',
    { class: 'obj-list' },
    h('li', { class: 'primary' }, h('span', { text: 'Bring it down' }), h('em', { text: `${Math.round((1 - c.downAt) * 100)}% gone` })),
    h('li', { class: 'primary' }, h('span', { text: 'Clear the lot' }), h('em', { text: `${Math.round(c.clearAt * 100)}% clear` })),
    c.maxCollateral !== undefined ? h('li', { class: 'primary warn' }, h('span', { text: `Keep debris off ${b.neighbour.name}` }), h('em', { text: 'or the job fails' })) : null,
    ...c.bonuses.map((x) => h('li', { class: `bonus${rec?.bonuses.includes(x.id) ? ' got' : ''}` }, h('span', { text: x.label }), h('em', { text: rec?.bonuses.includes(x.id) ? 'paid' : `+${formatMoney(x.reward)}` }))),
  );

  const el = h(
    'main',
    { class: 'screen page brief' },
    screenHeader(app, `Job ${c.number}`, true, () => app.go('jobs')),
    h('div', { class: 'brief-hero' }, thumbnail(c.building, Math.min(560, window.innerWidth - 32), 210, 'hero-thumb')),
    h('section', { class: 'brief-title' }, h('h1', { text: c.title }), h('p', { class: 'muted', text: `${b.kind} for ${c.client}` })),
    h('p', { class: 'brief-text', text: c.brief }),
    h('aside', { class: 'site-note' }, h('b', { text: 'Site note' }), h('span', { text: c.tip })),
    h('section', { class: 'card' }, h('h3', { text: 'To get paid' }), objectives, h('p', { class: 'pay-line' }, done ? `Fee paid on your first completion. Replays pay salvage and moves to spare. Best so far ${formatMoney(rec?.bestPayout ?? 0)}.` : `Contract fee ${formatMoney(c.fee)}, plus bonuses and salvage.`)),
    h(
      'section',
      { class: 'card crew' },
      h('div', { class: 'crew-head' }, h('h3', { text: c.fixed ? 'Your crew' : 'Pick your crew' }), count),
      h('p', { class: 'muted small', text: c.fixed ? 'Training job: the crane and the dozer.' : `Room on site for ${c.slots}. Each machine brings its own moves.` }),
      grid,
    ),
    h('div', { class: 'sticky-cta' }, startBtn),
  );
  sync();
  return { el };
}
