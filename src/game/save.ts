import { isMachineId, getUpgrade, type MachineId } from '../data/fleet';
import { CONTRACTS } from '../data/contracts';

/**
 * Progress on this device: money, the fleet, upgrades, contract records and
 * settings. Stored in localStorage, validated field by field on load, and
 * migrated from the first save format, so a bad or old save never stops the
 * game from starting.
 */

export const SAVE_KEY = 'demo-day:save';
export const SAVE_VERSION = 2;

export interface Settings {
  sound: boolean;
  haptics: boolean;
  reducedMotion: boolean;
}

export interface ContractRecord {
  attempts: number;
  completions: number;
  bestPayout: number;
  bestStars: number;
  /** Fewest moves on a completed run (0 = none yet). */
  bestMoves: number;
  /** Bonus objectives already paid. */
  bonuses: string[];
}

export interface SaveData {
  version: number;
  money: number;
  totalEarned: number;
  fleet: MachineId[];
  upgrades: string[];
  records: Record<string, ContractRecord>;
  /** Last loadout picked per contract, so a replay starts where you left it. */
  loadouts: Record<string, MachineId[]>;
  tutorialDone: boolean;
  /** The garage hint after the first job has been shown. */
  garageHint: boolean;
  lastContractId?: string;
  settings: Settings;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STARTING_FLEET: MachineId[] = ['ball', 'dozer'];

export function defaultSettings(): Settings {
  return { sound: true, haptics: true, reducedMotion: false };
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    money: 0,
    totalEarned: 0,
    fleet: [...STARTING_FLEET],
    upgrades: [],
    records: {},
    loadouts: {},
    tutorialDone: false,
    garageHint: false,
    settings: defaultSettings(),
  };
}

export function emptyRecord(): ContractRecord {
  return { attempts: 0, completions: 0, bestPayout: 0, bestStars: 0, bestMoves: 0, bonuses: [] };
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Equipment from the first version of the game, carried over as the closest upgrades. */
const LEGACY_EQUIPMENT: Record<string, string[]> = {
  scanner: ['charges-scan'],
  high_yield: ['charges-power-1'],
  shaped_kit: ['charges-cap'],
  directional_kit: ['charges-eff-1'],
  heavy_kit: ['charges-eff-1'],
};

/**
 * Validates and normalises parsed JSON into SaveData. Anything missing or
 * malformed falls back to its default; returns null only when the value is
 * not an object at all.
 */
export function normalizeSave(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const base = defaultSave();
  const money = Math.max(0, num(o.money, 0));
  const totalEarned = Math.max(money, num(o.totalEarned, money));
  const s = (o.settings && typeof o.settings === 'object' ? o.settings : {}) as Record<string, unknown>;
  const settings: Settings = {
    sound: typeof s.sound === 'boolean' ? s.sound : true,
    haptics: typeof s.haptics === 'boolean' ? s.haptics : true,
    reducedMotion: typeof s.reducedMotion === 'boolean' ? s.reducedMotion : false,
  };
  const version = num(o.version, 1);
  if (version < 2) {
    // First-generation save: keep the money and settings, map old equipment onto the new trees.
    const upgrades = new Set<string>();
    const fleet = new Set<MachineId>(STARTING_FLEET);
    for (const e of strs(o.equipment)) {
      for (const u of LEGACY_EQUIPMENT[e] ?? []) {
        upgrades.add(u);
        fleet.add('charges');
      }
    }
    const playedBefore = strs(o.completed).length > 0;
    return { ...base, money, totalEarned, settings, fleet: [...fleet], upgrades: [...upgrades], tutorialDone: playedBefore };
  }
  const fleet = new Set<MachineId>(STARTING_FLEET);
  for (const m of strs(o.fleet)) if (isMachineId(m)) fleet.add(m);
  const upgrades = [...new Set(strs(o.upgrades).filter((u) => getUpgrade(u)))];
  const records: Record<string, ContractRecord> = {};
  if (o.records && typeof o.records === 'object') {
    for (const [id, value] of Object.entries(o.records as Record<string, unknown>)) {
      if (!CONTRACTS.some((c) => c.id === id) || !value || typeof value !== 'object') continue;
      const r = value as Record<string, unknown>;
      records[id] = {
        attempts: Math.max(0, num(r.attempts, 0)),
        completions: Math.max(0, num(r.completions, 0)),
        bestPayout: Math.max(0, num(r.bestPayout, 0)),
        bestStars: Math.max(0, Math.min(3, num(r.bestStars, 0))),
        bestMoves: Math.max(0, num(r.bestMoves, 0)),
        bonuses: [...new Set(strs(r.bonuses))],
      };
    }
  }
  const loadouts: Record<string, MachineId[]> = {};
  if (o.loadouts && typeof o.loadouts === 'object') {
    for (const [id, value] of Object.entries(o.loadouts as Record<string, unknown>)) {
      const list = strs(value).filter(isMachineId);
      if (list.length) loadouts[id] = list;
    }
  }
  return {
    version: SAVE_VERSION,
    money,
    totalEarned,
    fleet: [...fleet],
    upgrades,
    records,
    loadouts,
    tutorialDone: o.tutorialDone === true,
    garageHint: o.garageHint === true,
    lastContractId: typeof o.lastContractId === 'string' ? o.lastContractId : undefined,
    settings,
  };
}

export function serializeSave(data: SaveData): string {
  return JSON.stringify(data);
}

export function parseSave(text: string | null): SaveData | null {
  if (!text) return null;
  try {
    return normalizeSave(JSON.parse(text));
  } catch {
    return null;
  }
}

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** Picks localStorage when it works (Safari private mode can throw). */
export function pickStorage(): StorageLike {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return new MemoryStorage();
    const probe = `${SAVE_KEY}:probe`;
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return new MemoryStorage();
  }
}

export class SaveStore {
  data: SaveData;
  private storage: StorageLike;

  constructor(storage: StorageLike = pickStorage()) {
    this.storage = storage;
    let raw: string | null = null;
    try {
      raw = storage.getItem(SAVE_KEY);
    } catch {
      raw = null;
    }
    this.data = parseSave(raw) ?? defaultSave();
  }

  save(): void {
    try {
      this.storage.setItem(SAVE_KEY, serializeSave(this.data));
    } catch {
      // Storage full or unavailable: progress stays in memory for this session.
    }
  }

  reset(): void {
    const settings = this.data.settings;
    this.data = { ...defaultSave(), settings };
    try {
      this.storage.removeItem(SAVE_KEY);
    } catch {
      // ignore
    }
    this.save();
  }
}
