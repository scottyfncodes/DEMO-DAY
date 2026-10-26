import type { App, ScreenInstance } from '../../app';
import { h } from '../dom';
import { screenHeader, sheet } from './common';

export function settingsScreen(app: App): ScreenInstance {
  const save = app.save;
  const toggle = (label: string, note: string, key: 'sound' | 'haptics' | 'reducedMotion'): HTMLElement => {
    const btn = h('button', {
      class: `toggle${save.settings[key] ? ' on' : ''}`,
      role: 'switch',
      'aria-checked': String(save.settings[key]),
      'aria-label': label,
      onClick: () => {
        save.settings[key] = !save.settings[key];
        app.persist();
        app.applySettings();
        btn.classList.toggle('on', save.settings[key]);
        btn.setAttribute('aria-checked', String(save.settings[key]));
        app.play('tap');
      },
    });
    return h('div', { class: 'setting-row' }, h('div', {}, h('b', { text: label }), h('small', { text: note })), btn);
  };
  const el = h(
    'main',
    { class: 'screen page settings' },
    screenHeader(app, 'Settings'),
    h(
      'section',
      { class: 'card' },
      toggle('Sound', 'Machines, impacts and collapses. Everything is also shown on screen.', 'sound'),
      toggle('Vibration', 'Short buzzes on hits and spends, where the device supports it.', 'haptics'),
      toggle('Reduce motion', 'No camera shake or zoom kicks; counters jump straight to their totals.', 'reducedMotion'),
    ),
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'setting-row' }, h('div', {}, h('b', { text: 'Training job' }), h('small', { text: 'Play the Corner Store with the step-by-step guide again.' })), h('button', { class: 'btn ghost sm', text: 'Replay', onClick: () => {
        save.tutorialDone = false;
        app.persist();
        app.go('brief', { id: 'corner' });
      } })),
      h('div', { class: 'setting-row' }, h('div', {}, h('b', { text: 'Start over' }), h('small', { text: 'Clears money, fleet, upgrades and records on this device.' })), h('button', { class: 'btn danger sm', text: 'Reset', onClick: () => {
        const s = sheet(h('div', { class: 'sheet-body' }, h('h2', { text: 'Start over?' }), h('p', { text: 'Money, machines, upgrades and every record go. This cannot be undone.' }), h('div', { class: 'sheet-actions' }, h('button', { class: 'btn ghost', text: 'Keep my progress', onClick: () => s.close() }), h('button', { class: 'btn danger', text: 'Reset everything', onClick: () => {
          s.close();
          app.store.reset();
          app.applySettings();
          app.toast('Progress reset.');
          app.go('title');
        } }))));
      } })),
    ),
    h('p', { class: 'muted small center', text: 'Progress is saved on this device. Add DEMO DAY to your Home Screen for full screen play.' }),
  );
  return { el };
}
