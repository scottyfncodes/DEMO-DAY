import type { App, ScreenInstance } from '../../app';
import { formatMoney, formatPercent } from '../../core/format';
import type { ContractDef, ChargeType } from '../../core/types';
import { getBuilding } from '../../data/buildings';
import { CHARGES, CHARGE_ORDER } from '../../data/charges';
import { CONTRACT_TYPE_BRIEF, CONTRACT_TYPE_LABEL, CONTRACTS, getContract } from '../../data/contracts';
import { effectiveLoadout } from '../../data/equipment';
import { isUnlocked } from '../../game/progression';
import { h, stars } from '../dom';

function topbar(app: App, title: string, sub?: string, back: () => void = () => app.go('menu')): HTMLElement {
  return h(
    'div',
    { class: 'topbar' },
    h('button', { class: 'btn btn-icon', 'aria-label': 'Back', onClick: () => { app.play('tap'); back(); } }, '‹'),
    h('div', { style: 'flex:1;min-width:0' }, h('h2', { text: title }), sub ? h('div', { class: 'sub', text: sub }) : null),
    h('div', { class: 'money', text: formatMoney(app.save.money) }),
  );
}

export function loadoutChips(contract: ContractDef, owned: readonly string[]): HTMLElement {
  const loadout = effectiveLoadout(contract.loadout, owned);
  const wrap = h('div', { class: 'loadout-list' });
  for (const type of CHARGE_ORDER) {
    const n = loadout[type as ChargeType] ?? 0;
    if (n <= 0) continue;
    const def = CHARGES[type];
    wrap.append(h('span', { class: 'chip' }, h('i', { class: 'dot', style: `background:${def.color}` }), `${def.name} × ${n}`));
  }
  return wrap;
}

export function contractsScreen(app: App): ScreenInstance {
  const list = h('div', { class: 'stack' });
  for (const c of CONTRACTS) {
    const unlocked = isUnlocked(c, app.save);
    const record = app.save.records[c.id];
    const done = app.save.completed.includes(c.id);
    const building = getBuilding(c.buildingId);
    const card = h(
      'div',
      {
        class: `card tappable${unlocked ? '' : ' locked'}`,
        role: 'button',
        tabindex: '0',
        onClick: () => {
          if (!unlocked) {
            app.play('error');
            app.toast(`Complete Job ${String(CONTRACTS.find((x) => x.id === c.requires)?.jobNumber ?? '').padStart(2, '0')} first`, true);
            return;
          }
          app.play('select');
          app.go('contract', { id: c.id });
        },
      },
      h(
        'div',
        { class: 'row' },
        h('div', {}, h('div', { class: 'sub', style: 'font-size:12px;letter-spacing:.14em;color:var(--muted);font-family:var(--font-display)', text: `JOB ${String(c.jobNumber).padStart(2, '0')} · ${CONTRACT_TYPE_LABEL[c.type].toUpperCase()}` }), h('h3', { text: c.title })),
        h('span', { class: `pill ${done ? 'ok' : unlocked ? '' : 'info'}`, text: done ? 'Complete' : unlocked ? 'Open' : 'Locked' }),
      ),
      h('div', { class: 'meta', text: `${building.floors} floor${building.floors === 1 ? '' : 's'} · ${building.materials} · ` }, h('span', { class: 'stars', text: stars(c.difficulty) })),
      h(
        'div',
        { class: 'row', style: 'margin-top:10px' },
        h('div', { class: 'money', text: formatMoney(c.value) }),
        record && record.bestPayout > 0 ? h('div', { class: 'hint', text: `Best ${formatMoney(record.bestPayout)}` }) : h('div', { class: 'hint', text: unlocked ? 'Not yet completed' : `Requires Job ${String(CONTRACTS.find((x) => x.id === c.requires)?.jobNumber ?? '').padStart(2, '0')}` }),
      ),
    );
    list.append(card);
  }
  const el = h('section', { class: 'screen scroll' }, topbar(app, 'Contracts', 'Take the next Demo Day'), list);
  return { el };
}

export function contractScreen(app: App, params: Record<string, string>): ScreenInstance {
  const contract = getContract(params.id ?? CONTRACTS[0]?.id ?? 'job01');
  const building = getBuilding(contract.buildingId);
  const loadout = effectiveLoadout(contract.loadout, app.save.equipment);
  const total = Object.values(loadout).reduce((a, b) => a + (b ?? 0), 0);
  const record = app.save.records[contract.id];
  const requirements: HTMLElement[] = [
    h('div', { class: 'stat' }, h('span', { class: 'k', text: 'Contract Value' }), h('span', { class: 'v accent', text: formatMoney(contract.value) })),
    h('div', { class: 'stat' }, h('span', { class: 'k', text: 'Required Destruction' }), h('span', { class: 'v', text: formatPercent(contract.requiredDestruction, 0) })),
    h('div', { class: 'stat' }, h('span', { class: 'k', text: 'Maximum Collateral' }), h('span', { class: 'v', text: formatPercent(contract.maxCollateral, 0) })),
    h('div', { class: 'stat' }, h('span', { class: 'k', text: 'Available Charges' }), h('span', { class: 'v', text: String(total) })),
  ];
  if (contract.footprintRequired) {
    requirements.push(h('div', { class: 'stat' }, h('span', { class: 'k', text: 'Debris In Zone' }), h('span', { class: 'v', text: `≥ ${formatPercent(contract.targetFootprint, 0)}` })));
  }
  if (contract.type === 'SELECTIVE_DEMOLITION') {
    requirements.push(h('div', { class: 'stat' }, h('span', { class: 'k', text: 'Protected Structure' }), h('span', { class: 'v', text: 'Keep standing' })));
  }
  const el = h(
    'section',
    { class: 'screen scroll' },
    topbar(app, 'Next Demo Day', `Job ${String(contract.jobNumber).padStart(2, '0')}`, () => app.go('contracts')),
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'sub', style: 'font-size:12px;letter-spacing:.14em;color:var(--accent);font-family:var(--font-display)', text: CONTRACT_TYPE_LABEL[contract.type].toUpperCase() }),
      h('h3', { text: contract.title, style: 'font-size:32px' }),
      h('div', { class: 'meta', text: `${building.floors} floor${building.floors === 1 ? '' : 's'} · ${building.materials} · Difficulty ` }, h('span', { class: 'stars', text: stars(contract.difficulty) })),
      h('p', { class: 'brief', text: contract.brief }),
      h('p', { class: 'hint', text: CONTRACT_TYPE_BRIEF[contract.type] }),
      h('div', { class: 'stat-grid' }, ...requirements),
      h('div', { class: 'sub', style: 'margin-top:14px;font-size:12px;letter-spacing:.14em;color:var(--muted);font-family:var(--font-display)', text: 'DEMOLITION LOADOUT' }),
      loadoutChips(contract, app.save.equipment),
    ),
    record && record.attempts > 0
      ? h(
          'div',
          { class: 'card' },
          h('div', { class: 'sub', style: 'font-size:12px;letter-spacing:.14em;color:var(--muted);font-family:var(--font-display)', text: 'YOUR RECORD' }),
          h(
            'div',
            { class: 'stat-grid' },
            h('div', { class: 'stat' }, h('span', { class: 'k', text: 'Best Payout' }), h('span', { class: 'v accent', text: formatMoney(record.bestPayout) })),
            h('div', { class: 'stat' }, h('span', { class: 'k', text: 'Best Destruction' }), h('span', { class: 'v', text: formatPercent(record.bestRemoved) })),
            h('div', { class: 'stat' }, h('span', { class: 'k', text: 'Fewest Charges' }), h('span', { class: 'v', text: Number.isFinite(record.fewestCharges) ? String(record.fewestCharges) : '—' })),
            h('div', { class: 'stat' }, h('span', { class: 'k', text: 'Attempts' }), h('span', { class: 'v', text: `${record.attempts} (${record.completions} done)` })),
          ),
        )
      : null,
    h(
      'div',
      { class: 'footer-actions' },
      h(
        'button',
        {
          class: 'btn btn-primary btn-block',
          onClick: () => {
            app.play('arm');
            app.buzz(20);
            app.go('job', { id: contract.id });
          },
        },
        'Accept Contract',
      ),
    ),
  );
  return { el };
}
