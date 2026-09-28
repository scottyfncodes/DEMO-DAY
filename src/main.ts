import './styles.css';
import { App } from './app';
import { contractScreen, contractsScreen } from './ui/screens/contracts';
import { equipmentScreen } from './ui/screens/equipment';
import { jobScreen } from './ui/screens/job';
import { menuScreen } from './ui/screens/menu';
import { recordsScreen } from './ui/screens/records';
import { reportScreen } from './ui/screens/report';
import { settingsScreen } from './ui/screens/settings';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root');

const app = new App(root);
app.register('menu', menuScreen);
app.register('contracts', contractsScreen);
app.register('contract', contractScreen);
app.register('job', jobScreen);
app.register('report', reportScreen);
app.register('equipment', equipmentScreen);
app.register('records', recordsScreen);
app.register('settings', settingsScreen);
app.go('menu');

// Debug/automation hook (used by the smoke test).
(window as unknown as { __demoDay?: App }).__demoDay = app;

// Offline support and Home Screen install.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  });
}
