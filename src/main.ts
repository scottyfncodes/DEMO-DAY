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

// From the iOS Home Screen the viewport can come up short of the real screen, leaving a
// dark band under fixed layers. There the app fills the whole screen, so size to it.
const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
if (standalone) {
  const fit = (): void => {
    const { width, height } = window.screen;
    const portrait = window.matchMedia('(orientation: portrait)').matches;
    // iOS reports the screen in portrait whatever the orientation.
    const h = portrait ? Math.max(width, height) : Math.min(width, height);
    document.documentElement.style.setProperty('--screen-h', `${Math.max(h, window.innerHeight)}px`);
  };
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
}

// Automation hook (used by the smoke tests).
(window as unknown as { __demoDay?: App }).__demoDay = app;

// Offline support and Home Screen install.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  });
}
