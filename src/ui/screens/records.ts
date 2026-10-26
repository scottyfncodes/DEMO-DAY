import type { App, ScreenInstance } from '../../app';
import { formatMoney } from '../../core/format';
import { CONTRACTS } from '../../data/contracts';
import { completedCount, isUnlocked } from '../../game/progression';
import { h } from '../dom';
import { screenHeader, stars } from './common';

/** Saved records: best pay, stars and fewest moves per job, and the totals. */
export function recordsScreen(app: App): ScreenInstance {
  const save = app.save;
  const totalStars = CONTRACTS.reduce((m, c) => m + (save.records[c.id]?.bestStars ?? 0), 0);
  const rows = CONTRACTS.map((c) => {
    const r = save.records[c.id];
    const open = isUnlocked(c, save);
    return h(
      'li',
      { class: `record${open ? '' : ' locked'}` },
      h('span', { class: 'job-no', text: c.number }),
      h('div', { class: 'rec-main' }, h('b', { text: c.title }), h('small', { text: r?.completions ? `${r.completions} done of ${r.attempts} tries · best ${r.bestMoves} moves` : r?.attempts ? `${r.attempts} tries, not finished yet` : open ? 'Not tried yet' : 'Locked' })),
      h('div', { class: 'rec-side' }, stars(r?.bestStars ?? 0), h('b', { text: r?.bestPayout ? formatMoney(r.bestPayout) : '·' })),
      open ? h('button', { class: 'btn ghost sm', text: r?.completions ? 'Replay' : 'Play', onClick: () => app.go('brief', { id: c.id }) }) : null,
    );
  });
  const el = h(
    'main',
    { class: 'screen page records' },
    screenHeader(app, 'Records', true),
    h('section', { class: 'totals' }, h('div', {}, h('b', { text: `${completedCount(save)}/8` }), h('small', { text: 'jobs done' })), h('div', {}, h('b', { text: `${totalStars}/24` }), h('small', { text: 'stars' })), h('div', {}, h('b', { text: formatMoney(save.totalEarned) }), h('small', { text: 'earned in total' }))),
    h('ol', { class: 'record-list' }, ...rows),
    h('p', { class: 'muted small center', text: 'Stars: finish the job, meet every bonus, and come in at or under the move par.' }),
  );
  return { el };
}
