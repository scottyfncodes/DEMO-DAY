import './styles.css';
import { App } from './app';
import { golfPlayScreen } from './golf/ui/play';
import { golfLevelsScreen, golfSettingsScreen, golfTitleScreen } from './golf/ui/screens';
import { briefScreen } from './ui/screens/brief';
import { garageScreen } from './ui/screens/garage';
import { jobsScreen } from './ui/screens/jobs';
import { playScreen } from './ui/screens/play';
import { recordsScreen } from './ui/screens/records';
import { settingsScreen } from './ui/screens/settings';
import { titleScreen } from './ui/screens/title';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root');

const app = new App(root);
// The golf game.
app.register('title', golfTitleScreen);
app.register('levels', golfLevelsScreen);
app.register('golf', golfPlayScreen);
app.register('golf-settings', golfSettingsScreen);
// The original crew-contracts game, kept whole and reachable from Levels.
app.register('classic', titleScreen);
app.register('jobs', jobsScreen);
app.register('brief', briefScreen);
app.register('play', playScreen);
app.register('garage', garageScreen);
app.register('settings', settingsScreen);
app.register('records', recordsScreen);
app.go('title');

// Automation hook (used by the smoke tests).
(window as unknown as { __demoDay?: App }).__demoDay = app;

// Offline support and Home Screen install.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  });
}
