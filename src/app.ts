import { audio, type Cue } from './audio/audio';
import type { ContractDef, SaveData } from './core/types';
import type { Payout } from './game/payout';
import type { RunOutcome } from './game/progression';
import { SaveStore } from './game/save';
import type { Report } from './game/scoring';
import type { SimResult } from './sim/simulation';
import type { Building } from './structure/building';
import { clear, h, haptic } from './ui/dom';

export type ScreenName = 'menu' | 'contracts' | 'contract' | 'job' | 'report' | 'equipment' | 'records' | 'settings';

export interface ScreenInstance {
  el: HTMLElement;
  destroy?: () => void;
}

export type ScreenFactory = (app: App, params: Record<string, string>) => ScreenInstance;

export interface JobResult {
  contract: ContractDef;
  building: Building;
  simResult: SimResult;
  report: Report;
  payout: Payout;
  outcome: RunOutcome;
}

/**
 * Application controller: owns the save store, audio and the current screen.
 * Screens are plain factories registered by name.
 */
export class App {
  readonly root: HTMLElement;
  readonly store: SaveStore;
  readonly audio = audio;
  private screens = new Map<ScreenName, ScreenFactory>();
  private current?: ScreenInstance;
  currentName?: ScreenName;
  lastResult?: JobResult;
  private toastTimer?: number;

  constructor(root: HTMLElement, store = new SaveStore()) {
    this.root = root;
    this.store = store;
    this.applySettings();
    const unlock = (): void => {
      this.audio.unlock();
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }

  get save(): SaveData {
    return this.store.data;
  }

  register(name: ScreenName, factory: ScreenFactory): void {
    this.screens.set(name, factory);
  }

  go(name: ScreenName, params: Record<string, string> = {}): void {
    const factory = this.screens.get(name);
    if (!factory) throw new Error(`No screen registered for ${name}`);
    this.current?.destroy?.();
    clear(this.root);
    this.current = factory(this, params);
    this.currentName = name;
    this.root.append(this.current.el);
    this.root.scrollTop = 0;
  }

  play(cue: Cue, strength = 1): void {
    this.audio.play(cue, strength);
  }

  buzz(pattern: number | number[] = 12): void {
    if (this.save.settings.haptics) haptic(pattern);
  }

  persist(): void {
    this.store.save();
  }

  applySettings(): void {
    const s = this.save.settings;
    this.audio.enabled = s.sound;
    const prefers = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    document.documentElement.classList.toggle('reduced-motion', s.reducedMotion || prefers);
  }

  get reducedMotion(): boolean {
    const prefers = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    return this.save.settings.reducedMotion || prefers;
  }

  toast(message: string, danger = false, host: HTMLElement = this.root): void {
    host.querySelectorAll('.toast').forEach((t) => t.remove());
    const el = h('div', { class: `toast${danger ? ' danger' : ''}`, role: 'status', text: message });
    el.style.top = 'calc(env(safe-area-inset-top, 0px) + 72px)';
    host.append(el);
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.remove(), 2300);
  }
}
