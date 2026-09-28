import type { App, ScreenInstance } from '../../app';
import { formatMoney } from '../../core/format';
import { EQUIPMENT } from '../../data/equipment';
import { canAfford, purchase } from '../../game/progression';
import { h } from '../dom';

export function equipmentScreen(app: App): ScreenInstance {
  const money = h('div', { class: 'money', text: formatMoney(app.save.money) });
  const list = h('div', { class: 'stack' });

  const render = (): void => {
    list.replaceChildren();
    money.textContent = formatMoney(app.save.money);
    for (const e of EQUIPMENT) {
      const owned = app.save.equipment.includes(e.id);
      const affordable = canAfford(app.save, e.id);
      const button = h(
        'button',
        {
          class: `btn ${owned ? 'btn-ghost' : 'btn-primary'} btn-small`,
          disabled: owned || !affordable,
          onClick: () => {
            if (purchase(app.save, e.id)) {
              app.persist();
              app.play('purchase');
              app.buzz([10, 30, 10]);
              app.toast(`${e.name} installed`);
              render();
            }
          },
        },
        owned ? 'Owned' : affordable ? `Buy · ${formatMoney(e.cost)}` : formatMoney(e.cost),
      );
      list.append(
        h(
          'div',
          { class: `card${owned ? ' selected' : ''}` },
          h('div', { class: 'row' }, h('h3', { text: e.name }), owned ? h('span', { class: 'pill ok', text: 'Installed' }) : null),
          h('p', { class: 'brief', text: e.description }),
          h('div', { class: 'hint', style: 'margin-top:6px', text: e.effect }),
          h('div', { style: 'margin-top:12px' }, button),
        ),
      );
    }
  };
  render();

  const el = h(
    'section',
    { class: 'screen scroll' },
    h(
      'div',
      { class: 'topbar' },
      h('button', { class: 'btn btn-icon', 'aria-label': 'Back', onClick: () => { app.play('tap'); app.go('menu'); } }, '‹'),
      h('div', { style: 'flex:1;min-width:0' }, h('h2', { text: 'Equipment' }), h('div', { class: 'sub', text: 'Every upgrade changes how you plan' })),
      money,
    ),
    list,
  );
  return { el };
}
