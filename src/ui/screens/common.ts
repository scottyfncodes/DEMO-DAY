import type { App } from '../../app';
import { formatMoney } from '../../core/format';
import { h } from '../dom';
import { ICON } from '../icons';

/** Page header: back to the title, the page name and the bank balance. */
export function screenHeader(app: App, title: string, money = false, back: () => void = () => app.go('classic')): HTMLElement {
  return h(
    'header',
    { class: 'page-head' },
    h('button', { class: 'icon-btn', 'aria-label': 'Back', html: ICON.back, onClick: () => (app.play('tap'), back()) }),
    h('h2', { text: title }),
    money ? h('span', { class: 'chip money' }, h('span', { class: 'icon', html: ICON.coin }), h('b', { class: 'money-value', text: formatMoney(app.save.money) })) : h('span'),
  );
}

export function stars(n: number, max = 3): HTMLElement {
  const el = h('span', { class: 'stars', 'aria-label': `${n} of ${max} stars` });
  for (let i = 0; i < max; i++) el.append(h('span', { class: `star${i < n ? ' on' : ''}`, html: ICON.star }));
  return el;
}

/** A bottom sheet over the current screen. Returns a close function. */
export function sheet(content: HTMLElement, onClose?: () => void, dismissable = true): { el: HTMLElement; close: () => void } {
  const scrim = h('div', { class: 'scrim' });
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, content);
  const el = h('div', { class: 'sheet-wrap' }, scrim, panel);
  const close = (): void => {
    el.classList.add('closing');
    window.setTimeout(() => el.remove(), 180);
    onClose?.();
  };
  if (dismissable) scrim.addEventListener('click', close);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('open'));
  return { el, close };
}
