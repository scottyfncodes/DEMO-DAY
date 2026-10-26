import type { App, ScreenInstance } from '../../app';
import { formatMoney } from '../../core/format';
import { MACHINES, MACHINE_ORDER, kitFor, upgradesFor, type MachineId, type UpgradeCategory, type UpgradeDef } from '../../data/fleet';
import { buyMachine, buyUpgrade, canBuyMachine, lockReason, upgradeState } from '../../game/progression';
import type { Kit } from '../../wreck/kit';
import { h } from '../dom';
import { ICON, MACHINE_ICON } from '../icons';
import { machinePreview } from '../view';
import { screenHeader } from './common';

const CATS: Array<[UpgradeCategory, string, string]> = [
  ['power', 'Power', 'More force in every move'],
  ['efficiency', 'Efficiency', 'More done per move'],
  ['capability', 'Capability', 'New things it can do'],
];

export function statLine(id: MachineId, k: Kit): string[] {
  switch (id) {
    case 'ball':
      return [`${k.ballMass} t ball`, `reaches ${k.ballReach} m up`, k.drop ? 'drop strikes' : 'swings only'];
    case 'charges':
      return [`damage ×${k.chargePower}`, `shock radius ×${k.chargeRadius}`, k.shaped ? 'shaped charges' : 'cutters and blasts', ...(k.scanner ? ['scanner'] : [])];
    case 'excavator':
      return [`${k.bite} kJ a bite, 3 bites a move`, `reaches about ${Math.round(3.4 + 23 * k.excReach - 2.5)} m`, k.shears ? 'shears fitted' : 'crusher jaws'];
    case 'dozer':
      return [`blade carries ${k.bladeCap} m²`, `pushes blocks up to ${k.heavyPush} t`, k.ram ? 'ram plate' : 'standard blade'];
    case 'loader':
      return [`${k.bucket} m² bucket`, `lifts up to ${k.lift} t`, k.sorter ? 'scrap sorter' : 'no sorting'];
  }
}

/** The fleet garage: inspect machines, buy them, and fit upgrades. */
export function garageScreen(app: App, params: Record<string, string>): ScreenInstance {
  const save = app.save;
  let current: MachineId = (params.machine as MachineId) ?? (params.hint ? 'excavator' : 'ball');
  let armed = '';
  let armTimer = 0;

  const tabs = h('div', { class: 'garage-tabs', role: 'tablist' });
  const body = h('div', { class: 'garage-body' });
  const header = screenHeader(app, 'Garage', true);
  const hint = params.hint && !save.fleet.includes('excavator') ? h('aside', { class: 'site-note' }, h('b', { text: 'Your first upgrade' }), h('span', { text: 'The excavator takes apart what the ball cannot reach cleanly. Buy it, then take on Halsey Auto.' })) : null;

  const refreshMoney = (): void => {
    const m = header.querySelector('.money-value');
    if (m) m.textContent = formatMoney(save.money);
  };

  const arm = (key: string): boolean => {
    // Two taps to buy: the first shows the price as a question, the second pays.
    if (armed === key) {
      armed = '';
      window.clearTimeout(armTimer);
      return true;
    }
    armed = key;
    window.clearTimeout(armTimer);
    armTimer = window.setTimeout(() => {
      armed = '';
      draw();
    }, 3000);
    app.play('tap');
    draw();
    return false;
  };

  const purchased = (text: string): void => {
    app.play('purchase');
    app.buzz([20, 30, 20]);
    app.toast(text, 'good');
    app.persist();
    refreshMoney();
    draw();
    body.querySelector('.machine-card')?.classList.add('fitted');
  };

  function upgradeCard(u: UpgradeDef): HTMLElement {
    const state = upgradeState(save, u);
    const afford = save.money >= u.cost;
    let action: HTMLElement;
    if (state === 'owned') action = h('span', { class: 'tag good' }, h('span', { class: 'icon', html: ICON.check }), 'Fitted');
    else if (state === 'locked') action = h('span', { class: 'lock-note' }, h('span', { class: 'icon', html: ICON.lock }), lockReason(save, u));
    else {
      const key = `u:${u.id}`;
      action = h('button', {
        class: `btn ${armed === key ? 'confirm-buy' : afford ? 'primary' : 'ghost'} sm`,
        disabled: !afford,
        text: !afford ? `${formatMoney(u.cost)} · ${formatMoney(u.cost - save.money)} short` : armed === key ? `Pay ${formatMoney(u.cost)}?` : `Buy ${formatMoney(u.cost)}`,
        onClick: () => {
          if (!arm(key)) return;
          const r = buyUpgrade(save, u.id);
          if (r.ok) purchased(`Fitted: ${u.name}`);
          else {
            app.play('error');
            app.toast(r.reason, 'bad');
          }
        },
      });
    }
    return h('article', { class: `upgrade ${state}` }, h('h4', { text: u.name }), h('p', { class: 'effect', text: u.effect }), h('p', { class: 'detail', text: u.detail }), action);
  }

  function draw(): void {
    tabs.textContent = '';
    for (const id of MACHINE_ORDER) {
      const owned = save.fleet.includes(id);
      tabs.append(
        h(
          'button',
          {
            class: `garage-tab${id === current ? ' on' : ''}${owned ? '' : ' not-owned'}`,
            role: 'tab',
            'aria-selected': String(id === current),
            onClick: () => {
              current = id;
              armed = '';
              app.play('tap');
              draw();
            },
          },
          h('span', { class: 'icon', html: MACHINE_ICON[id] }),
          h('span', { text: MACHINES[id].short }),
        ),
      );
    }
    body.textContent = '';
    const m = MACHINES[current];
    const owned = save.fleet.includes(current);
    const kit = kitFor(save.upgrades);
    const buy = (): HTMLElement => {
      const check = canBuyMachine(save, current);
      const key = `m:${current}`;
      return h('button', {
        class: `btn ${armed === key ? 'confirm-buy' : check.ok ? 'primary' : 'ghost'}`,
        disabled: !check.ok,
        text: check.ok ? (armed === key ? `Pay ${formatMoney(m.price)}?` : `Buy for ${formatMoney(m.price)}`) : `${formatMoney(m.price)} · ${check.reason}`,
        onClick: () => {
          if (!arm(key)) return;
          const r = buyMachine(save, current);
          if (r.ok) purchased(`${m.name} added to the fleet`);
        },
      });
    };
    body.append(
      h(
        'section',
        { class: `machine-card${owned ? '' : ' not-owned'}` },
        machinePreview(current, kit),
        h('div', { class: 'mc-info' }, h('h2', { text: m.name }), h('p', { text: m.role }), h('ul', { class: 'stat-list' }, ...statLine(current, kit).map((s) => h('li', { text: s }))), owned ? h('p', { class: 'muted small', text: `Brings ${m.baseMoves} ${m.moves} to most jobs.` }) : buy()),
      ),
    );
    for (const [cat, name, sub] of CATS) {
      const list = upgradesFor(current).filter((u) => u.category === cat);
      if (!list.length) continue;
      body.append(h('section', { class: `upgrade-col ${cat}` }, h('header', {}, h('h3', { text: name }), h('span', { class: 'muted small', text: sub })), h('div', { class: 'upgrade-track' }, ...list.map(upgradeCard))));
    }
  }

  draw();
  const el = h('main', { class: 'screen page garage' }, header, hint, tabs, body);
  return { el, destroy: () => window.clearTimeout(armTimer) };
}
