import { pickStorage, type StorageLike } from '../game/save';
import { HOUSES, unlockedAt, type HouseDef } from './game/houses';
import { REWARD, SPECIALS, emptyEconomy, type Economy, type SpecialId } from './game/rewards';
import { TAG_ORDER, type ShotTag } from './game/quality';
import type { BallId } from './sim/balls';
import { CAMPAIGN, type LevelDef } from './sim/levels';
import type { WorldSnapshot } from './sim/world';

/**
 * Golf progress, stored under its own key so the crew-contracts save is
 * never read, changed or reset by the golf game. Validated field by field
 * on load; a bad save falls back to a fresh one without losing the old text
 * (it is only overwritten once there is real progress to keep).
 *
 * Version 2 adds the PLAY campaign: which houses are open and finished, the
 * special ball economy, and each house's damage, stored as a world snapshot
 * under its own key so a large house never risks the main save.
 */

export const GOLF_SAVE_KEY = 'demo-day:golf';
export const GOLF_SAVE_VERSION = 2;
export const houseKey = (id: string): string => `${GOLF_SAVE_KEY}:house:${id}`;

export interface HouseRecord {
  /** Shots taken on this house, across sessions. */
  shots: number;
  /** The objective has been met. */
  done: boolean;
  /** Shots it took to meet the objective (0 = not yet). */
  doneIn: number;
  /** The arrival gift for this house has been paid. */
  gifted: boolean;
}

export interface CampaignSave {
  /** House the player is on. */
  current: string;
  /** Index of the furthest open house. */
  reached: number;
  houses: Record<string, HouseRecord>;
}

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
  campaign: CampaignSave;
  economy: Economy;
}

export function defaultGolfSave(): GolfSave {
  return { version: GOLF_SAVE_VERSION, levels: {}, daily: {}, coached: false, campaign: { current: (HOUSES[0] as HouseDef).id, reached: 0, houses: {} }, economy: emptyEconomy() };
}

export function emptyHouseRecord(): HouseRecord {
  return { shots: 0, done: false, doneIn: 0, gifted: false };
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
  const version = num(o.version, 1);
  const camp = o.campaign && typeof o.campaign === 'object' ? (o.campaign as Record<string, unknown>) : null;
  if (camp) {
    out.campaign.reached = Math.min(HOUSES.length - 1, Math.floor(num(camp.reached)));
    const houses = camp.houses && typeof camp.houses === 'object' ? (camp.houses as Record<string, unknown>) : {};
    for (const h of HOUSES) {
      const r = houses[h.id];
      if (!r || typeof r !== 'object') continue;
      const q = r as Record<string, unknown>;
      out.campaign.houses[h.id] = { shots: Math.floor(num(q.shots)), done: q.done === true, doneIn: Math.floor(num(q.doneIn)), gifted: q.gifted === true };
    }
    if (typeof camp.current === 'string' && HOUSES.some((h, i) => h.id === camp.current && i <= out.campaign.reached)) out.campaign.current = camp.current;
    else out.campaign.current = (HOUSES[out.campaign.reached] as HouseDef).id;
  } else if (version < 2) {
    // From v1: every old campaign level finished opens one more house, so nobody starts over.
    const finished = CAMPAIGN.filter((l) => (out.levels[l.id]?.completions ?? 0) > 0).length;
    out.campaign.reached = Math.min(HOUSES.length - 1, finished);
    out.campaign.current = (HOUSES[out.campaign.reached] as HouseDef).id;
  }
  const eco = o.economy && typeof o.economy === 'object' ? (o.economy as Record<string, unknown>) : null;
  if (eco) {
    out.economy.meter = Math.min(REWARD.meterSize, num(eco.meter));
    const inv = eco.inventory && typeof eco.inventory === 'object' ? (eco.inventory as Record<string, unknown>) : {};
    for (const b of SPECIALS) {
      const n = Math.min(REWARD.cap, Math.floor(num(inv[b])));
      if (n > 0) out.economy.inventory[b] = n;
    }
    const fat = eco.fatigue && typeof eco.fatigue === 'object' ? (eco.fatigue as Record<string, unknown>) : {};
    for (const t of TAG_ORDER) {
      const n = Math.min(20, num(fat[t]));
      if (n > 0) out.economy.fatigue[t as ShotTag] = n;
    }
  }
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
    for (const h of HOUSES) this.clearHouse(h.id);
    this.data = defaultGolfSave();
    this.save();
  }

  // ------------------------------------------------------------ campaign

  houseRec(id: string): HouseRecord {
    let r = this.data.campaign.houses[id];
    if (!r) this.data.campaign.houses[id] = r = emptyHouseRecord();
    return r;
  }

  houseIndex(id: string): number {
    return HOUSES.findIndex((h) => h.id === id);
  }

  houseOpen(id: string): boolean {
    const i = this.houseIndex(id);
    return i >= 0 && i <= this.data.campaign.reached;
  }

  get currentHouse(): HouseDef {
    return HOUSES.find((h) => h.id === this.data.campaign.current) ?? (HOUSES[0] as HouseDef);
  }

  /** Specials the reward meter can pay out so far. */
  unlockedSpecials(): SpecialId[] {
    return unlockedAt(this.data.campaign.reached);
  }

  /** Adds specials to the inventory, up to the carry limit. */
  grant(balls: Partial<Record<SpecialId, number>>): void {
    const inv = this.data.economy.inventory;
    for (const [b, n] of Object.entries(balls) as Array<[SpecialId, number]>) inv[b] = Math.min(REWARD.cap, (inv[b] ?? 0) + n);
  }

  /** Arriving at a house: makes it current and pays its introduction gift once. Returns the gift. */
  enterHouse(h: HouseDef): Partial<Record<SpecialId, number>> {
    this.data.campaign.current = h.id;
    const rec = this.houseRec(h.id);
    let gift: Partial<Record<SpecialId, number>> = {};
    if (!rec.gifted) {
      rec.gifted = true;
      if (h.unlocks) gift = { [h.unlocks]: 2 };
      this.grant(gift);
    }
    this.save();
    return gift;
  }

  /** Finishing a house: pays the prize, opens the next one. Returns the next house, if any. */
  completeHouse(h: HouseDef): HouseDef | undefined {
    const rec = this.houseRec(h.id);
    if (!rec.done) {
      rec.done = true;
      rec.doneIn = rec.shots;
      this.grant(h.prize);
    }
    const i = this.houseIndex(h.id);
    this.data.campaign.reached = Math.max(this.data.campaign.reached, Math.min(HOUSES.length - 1, i + 1));
    this.save();
    return HOUSES[i + 1];
  }

  saveHouse(id: string, snap: WorldSnapshot): boolean {
    try {
      this.storage.setItem(houseKey(id), JSON.stringify(snap));
      return true;
    } catch {
      return false;
    }
  }

  loadHouse(id: string): WorldSnapshot | null {
    try {
      const text = this.storage.getItem(houseKey(id));
      return text ? (JSON.parse(text) as WorldSnapshot) : null;
    } catch {
      return null;
    }
  }

  clearHouse(id: string): void {
    try {
      this.storage.removeItem(houseKey(id));
    } catch {
      // Nothing to clear.
    }
  }

  /** Puts a finished house back up to play it again from scratch. */
  rebuildHouse(id: string): void {
    this.clearHouse(id);
    const rec = this.houseRec(id);
    rec.shots = 0;
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
