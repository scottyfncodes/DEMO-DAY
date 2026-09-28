import type { App, ScreenInstance } from '../../app';
import { h } from '../dom';

function toggle(app: App, label: string, description: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
  const button = h('button', { class: `toggle${get() ? ' on' : ''}`, role: 'switch', 'aria-checked': String(get()), 'aria-label': label });
  button.addEventListener('click', () => {
    set(!get());
    app.persist();
    app.applySettings();
    button.classList.toggle('on', get());
    button.setAttribute('aria-checked', String(get()));
    app.play('tap');
  });
  return h('div', { class: 'setting' }, h('div', {}, h('div', { class: 'k', text: label }), h('div', { class: 'd', text: description })), button);
}

export function settingsScreen(app: App): ScreenInstance {
  const s = app.save.settings;
  let armed = false;
  const resetButton = h('button', { class: 'btn btn-danger btn-block' }, 'Reset Progress');
  resetButton.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      resetButton.textContent = 'Tap again to erase everything';
      app.play('error');
      window.setTimeout(() => {
        armed = false;
        resetButton.textContent = 'Reset Progress';
      }, 4000);
      return;
    }
    app.store.reset();
    app.persist();
    app.applySettings();
    app.play('remove');
    app.toast('Progress erased');
    app.go('menu');
  });

  const el = h(
    'section',
    { class: 'screen scroll' },
    h(
      'div',
      { class: 'topbar' },
      h('button', { class: 'btn btn-icon', 'aria-label': 'Back', onClick: () => { app.play('tap'); app.go('menu'); } }, '‹'),
      h('div', { style: 'flex:1;min-width:0' }, h('h2', { text: 'Settings' })),
    ),
    h(
      'div',
      { class: 'card' },
      toggle(app, 'Sound', 'Countdown, detonation, debris and payout cues.', () => s.sound, (v) => { s.sound = v; }),
      toggle(app, 'Reduced Motion', 'Fewer particles, no camera shake, instant reveals.', () => s.reducedMotion, (v) => { s.reducedMotion = v; }),
      toggle(app, 'Haptics', 'Vibration on placement and payout (where supported).', () => s.haptics, (v) => { s.haptics = v; }),
    ),
    h(
      'div',
      { class: 'card' },
      h('h3', { text: 'Danger Zone' }),
      h('p', { class: 'hint', text: 'Erases money, unlocks, equipment and records on this device.' }),
      h('div', { style: 'margin-top:12px' }, resetButton),
    ),
    h('p', { class: 'hint', style: 'text-align:center;margin-top:auto', text: 'DEMO DAY · Add to Home Screen for the full-screen experience.' }),
  );
  return { el };
}
