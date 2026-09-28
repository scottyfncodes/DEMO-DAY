import type { App, ScreenInstance } from '../../app';
import { formatMoney, formatPercent } from '../../core/format';
import { CONTRACTS } from '../../data/contracts';
import { h } from '../dom';

export function recordsScreen(app: App): ScreenInstance {
  const save = app.save;
  const list = h('div', { class: 'stack' });
  let attempts = 0;
  for (const c of CONTRACTS) {
    const r = save.records[c.id];
    if (!r) continue;
    attempts += r.attempts;
    list.append(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'row' }, h('h3', { text: c.title }), h('span', { class: `pill ${r.completions > 0 ? 'ok' : 'danger'}`, text: r.completions > 0 ? `${r.completions}× complete` : 'Not completed' })),
        h(
          'div',
          { class: 'stat-grid' },
          h('div', { class: 'stat' }, h('span', { class: 'k', text: 'Best Payout' }), h('span', { class: 'v accent', text: r.bestPayout > 0 ? formatMoney(r.bestPayout) : '—' })),
          h('div', { class: 'stat' }, h('span', { class: 'k', text: 'Best Destruction' }), h('span', { class: 'v', text: r.bestRemoved > 0 ? formatPercent(r.bestRemoved) : '—' })),
          h('div', { class: 'stat' }, h('span', { class: 'k', text: 'Best Collateral' }), h('span', { class: 'v', text: Number.isFinite(r.bestCollateral) ? formatPercent(r.bestCollateral) : '—' })),
          h('div', { class: 'stat' }, h('span', { class: 'k', text: 'Fewest Charges' }), h('span', { class: 'v', text: Number.isFinite(r.fewestCharges) ? String(r.fewestCharges) : '—' })),
          h('div', { class: 'stat' }, h('span', { class: 'k', text: 'Best Efficiency' }), h('span', { class: 'v', text: r.bestEfficiency > 0 ? formatPercent(r.bestEfficiency, 0) : '—' })),
          h('div', { class: 'stat' }, h('span', { class: 'k', text: 'Attempts' }), h('span', { class: 'v', text: String(r.attempts) })),
        ),
      ),
    );
  }
  if (!list.childElementCount) list.append(h('div', { class: 'empty', text: 'No demolitions on record yet. Take a contract.' }));

  const el = h(
    'section',
    { class: 'screen scroll' },
    h(
      'div',
      { class: 'topbar' },
      h('button', { class: 'btn btn-icon', 'aria-label': 'Back', onClick: () => { app.play('tap'); app.go('menu'); } }, '‹'),
      h('div', { style: 'flex:1;min-width:0' }, h('h2', { text: 'Records' }), h('div', { class: 'sub', text: 'Can you get more money out of the same building?' })),
    ),
    h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'stat-grid' },
        h('div', { class: 'stat' }, h('span', { class: 'k', text: 'Total Earned' }), h('span', { class: 'v accent', text: formatMoney(save.totalEarned) })),
        h('div', { class: 'stat' }, h('span', { class: 'k', text: 'Balance' }), h('span', { class: 'v', text: formatMoney(save.money) })),
        h('div', { class: 'stat' }, h('span', { class: 'k', text: 'Contracts Complete' }), h('span', { class: 'v', text: `${save.completed.length} / ${CONTRACTS.length}` })),
        h('div', { class: 'stat' }, h('span', { class: 'k', text: 'Demo Days' }), h('span', { class: 'v', text: String(attempts) })),
      ),
    ),
    list,
  );
  return { el };
}
