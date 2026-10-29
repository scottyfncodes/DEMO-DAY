import { pickStorage, type StorageLike } from '../game/save';
import type { BallId } from './sim/balls';
import { CAMPAIGN, type LevelDef } from './sim/levels';

/**
 * Golf progress, stored under its own key so the crew-contracts save is
 * never read, changed or reset by the golf game. Validated field by field
 * on load; a bad save falls back to a fresh one without losing the old text
 * (it is only overwritten once there is real progress to keep).
 */

export const GOLF_SAVE_KEY = 'demo-day:golf';
export const GOLF_SAVE_VERSION = 1;

export interface LevelRecord {
  attempts: number;
  completions: number;
  bestStars: number;
  bestScore: number;
  /** Fewest shots on a completed run (0 = none yet). */
  bestShots: number;
}

export interface GolfSave {
  version: number;
  levels: Record<string, LevelRecord>;
  /** Daily challenge results by date (YYYY-MM-DD). */
  daily: Record<string, LevelRecord>;
  /** Coach marks on the first level have been completed. */
  coached: boolean;
}

export function defaultGolfSave(): GolfSave {
  return { version: GOLF_SAVE_VERSION, levels: {}, daily: {}, coached: false };
}

export function emptyLevelRecord(): LevelRecord {
  return { attempts: 0, completions: 0, bestStars: 0, bestScore: 0, bestShots: 0 };
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : d);

function record(v: unknown): LevelRecord | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  return { attempts: num(r.attempts), completions: num(r.completions), bestStars: Math.min(3, num(r.bestStars)), bestScore: num(r.bestScore), bestShots: num(r.bestShots) };
}

export function normalizeGolfSave(raw: unknown): GolfSave | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out = defaultGolfSave();
  for (const field of ['levels', 'daily'] as const) {
    const src = o[field];
    if (src && typeof src === 'object') {
      for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
        const r = record(v);
        if (r) out[field][k] = r;
      }
    }
  }
  out.coached = o.coached === true;
  return out;
}

export class GolfStore {
  data: GolfSave;
  private storage: StorageLike;

  constructor(storage: StorageLike = pickStorage()) {
    this.storage = storage;
    let parsed: GolfSave | null = null;
    try {
      const text = storage.getItem(GOLF_SAVE_KEY);
      parsed = text ? normalizeGolfSave(JSON.parse(text)) : null;
    } catch {
      parsed = null;
    }
    this.data = parsed ?? defaultGolfSave();
  }

  save(): void {
    try {
      this.storage.setItem(GOLF_SAVE_KEY, JSON.stringify(this.data));
    } catch {
      // Storage full or unavailable: progress stays in memory for this session.
    }
  }

  reset(): void {
    this.data = defaultGolfSave();
    this.save();
  }

  rec(level: LevelDef): LevelRecord {
    const bucket = level.mode === 'daily' ? this.data.daily : this.data.levels;
    const key = level.mode === 'daily' ? level.id.slice(6) : level.id;
    let r = bucket[key];
    if (!r) bucket[key] = r = emptyLevelRecord();
    return r;
  }

  peek(level: LevelDef): LevelRecord | undefined {
    return level.mode === 'daily' ? this.data.daily[level.id.slice(6)] : this.data.levels[level.id];
  }

  /** Records a finished attempt. Returns which personal bests it set. */
  finish(level: LevelDef, r: { complete: boolean; stars: number; score: number; shots: number }): { newScore: boolean; newStars: boolean; newShots: boolean; first: boolean } {
    const rec = this.rec(level);
    const first = r.complete && rec.completions === 0;
    const out = { newScore: false, newStars: false, newShots: false, first };
    if (r.complete) {
      rec.completions++;
      if (r.stars > rec.bestStars) {
        rec.bestStars = r.stars;
        out.newStars = true;
      }
      if (rec.bestShots === 0 || r.shots < rec.bestShots) {
        out.newShots = rec.bestShots !== 0;
        rec.bestShots = r.shots;
      }
    }
    if (r.score > rec.bestScore && (r.complete || level.mode === 'score')) {
      out.newScore = rec.bestScore > 0;
      rec.bestScore = r.score;
    }
    this.save();
    return out;
  }

  started(level: LevelDef): void {
    this.rec(level).attempts++;
    this.save();
  }

  completed(id: string): boolean {
    return (this.data.levels[id]?.completions ?? 0) > 0;
  }

  /** A campaign level opens when the one before it has been completed. */
  isOpen(level: LevelDef): boolean {
    if (level.mode === 'campaign') {
      const i = CAMPAIGN.findIndex((l) => l.id === level.id);
      return i <= 0 || this.completed((CAMPAIGN[i - 1] as LevelDef).id);
    }
    return modeOpen(this, level.mode);
  }

  get totalStars(): number {
    return CAMPAIGN.reduce((s, l) => s + (this.data.levels[l.id]?.bestStars ?? 0), 0);
  }

  get nextLevel(): LevelDef {
    return CAMPAIGN.find((l) => !this.completed(l.id)) ?? (CAMPAIGN[CAMPAIGN.length - 1] as LevelDef);
  }

  /** Balls the player has met in the campaign (for the sandbox). */
  unlockedBalls(): BallId[] {
    const out: BallId[] = ['standard'];
    for (const l of CAMPAIGN) {
      if (!this.isOpen(l)) break;
      for (const b of Object.keys(l.balls) as BallId[]) if (!out.includes(b)) out.push(b);
    }
    return out;
  }
}

/** Which modes are open, and what opens them. */
export const MODE_UNLOCK: Record<string, { after: string; label: string }> = {
  sandbox: { after: 'c2', label: 'Finish level 02 to open the sandbox.' },
  score: { after: 'c3', label: 'Finish level 03 to open Score Attack.' },
  daily: { after: 'c4', label: 'Finish level 04 to open the Daily Challenge.' },
  precision: { after: 'c6', label: 'Finish level 06 to open the Precision Challenges.' },
};

export function modeOpen(store: GolfStore, mode: string): boolean {
  const u = MODE_UNLOCK[mode];
  return !u || store.completed(u.after);
}

export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
