import type { App, ScreenInstance } from '../../app';
import { formatMoney } from '../../core/format';
import { CONTRACTS } from '../../data/contracts';
import { getBuilding } from '../../wreck/buildings';
import { isCompleted, isUnlocked, nextContract } from '../../game/progression';
import { h } from '../dom';
import { thumbnail } from '../view';
import { screenHeader, stars } from './common';

/** The contract board: every job, what it pays, and how well it went. */
export function jobsScreen(app: App): ScreenInstance {
  const save = app.save;
  const next = nextContract(save);
  const list = h('ol', { class: 'job-list' });
  for (const c of CONTRACTS) {
    const open = isUnlocked(c, save);
    const done = isCompleted(save, c.id);
    const rec = save.records[c.id];
    const b = getBuilding(c.building);
    const status = !open ? 'locked' : done ? 'done' : c.id === next.id ? 'next' : 'open';
    const card = h(
      'li',
      { class: `job-card ${status}` },
      h(
        'button',
        {
          class: 'job-hit',
          disabled: !open,
          'aria-label': `${c.number} ${c.title}${open ? '' : ', locked'}`,
          onClick: () => {
            app.play('select');
            app.go('brief', { id: c.id });
          },
        },
        thumbnail(c.building, 132, 100, 'job-thumb'),
        h(
          'div',
          { class: 'job-info' },
          h('div', { class: 'job-top' }, h('span', { class: 'job-no', text: c.number }), status === 'next' ? h('span', { class: 'tag go', text: done ? 'Replay' : 'Next' }) : done ? h('span', { class: 'tag', text: 'Done' }) : null),
          h('h3', { text: c.title }),
          h('p', { class: 'job-headline', text: b.incident.headline }),
          h('p', { class: 'job-kind', text: `${b.kind} · ${c.client}` }),
          h(
            'div',
            { class: 'job-meta' },
            open ? h('span', { class: 'fee', text: done ? `Best ${formatMoney(rec?.bestPayout ?? 0)}` : `Pays ${formatMoney(c.fee)}+` }) : h('span', { class: 'fee', text: `Finish ${CONTRACTS.find((x) => x.id === c.requires)?.title ?? ''} first` }),
            open ? stars(rec?.bestStars ?? 0) : null,
          ),
        ),
      ),
    );
    list.append(card);
  }
  const el = h('main', { class: 'screen page jobs' }, screenHeader(app, 'Call-outs', true), h('p', { class: 'page-lede', text: 'Every fight leaves a mess. Each call-out is a different building, a different disaster and a different way to bring it down. Finish one to open the next; replay any of them for salvage and stars.' }), list);
  return { el };
}
