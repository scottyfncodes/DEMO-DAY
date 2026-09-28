import type { ContractRecord, SaveData, Settings } from '../core/types';

export const SAVE_KEY = 'demo-day:save';
export const SAVE_VERSION = 1;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function defaultSettings(): Settings {
  return { sound: true, reducedMotion: false, haptics: true };
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    money: 0,
    totalEarned: 0,
    completed: [],
    equipment: [],
    records: {},
    settings: defaultSettings(),
  };
}

export function emptyRecord(): ContractRecord {
  return {
    attempts: 0,
    completions: 0,
    bestPayout: 0,
    bestRemoved: 0,
    bestCollateral: Infinity,
    fewestCharges: Infinity,
    bestEfficiency: 0,
  };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * Validates and normalises raw parsed JSON into SaveData, falling back to
 * defaults for anything missing or malformed. Returns null when the shape is
 * beyond repair.
 */
export function normalizeSave(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const base = defaultSave();
  const money = isFiniteNumber(obj.money) ? Math.max(0, obj.money) : base.money;
  const totalEarned = isFiniteNumber(obj.totalEarned) ? Math.max(0, obj.totalEarned) : money;
  const completed = isStringArray(obj.completed) ? [...new Set(obj.completed)] : [];
  const equipment = isStringArray(obj.equipment) ? [...new Set(obj.equipment)] : [];
  const records: Record<string, ContractRecord> = {};
  if (obj.records && typeof obj.records === 'object') {
    for (const [id, value] of Object.entries(obj.records as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const r = value as Record<string, unknown>;
      const rec = emptyRecord();
      rec.attempts = isFiniteNumber(r.attempts) ? r.attempts : 0;
      rec.completions = isFiniteNumber(r.completions) ? r.completions : 0;
      rec.bestPayout = isFiniteNumber(r.bestPayout) ? r.bestPayout : 0;
      rec.bestRemoved = isFiniteNumber(r.bestRemoved) ? r.bestRemoved : 0;
      rec.bestCollateral = isFiniteNumber(r.bestCollateral) ? r.bestCollateral : Infinity;
      rec.fewestCharges = isFiniteNumber(r.fewestCharges) ? r.fewestCharges : Infinity;
      rec.bestEfficiency = isFiniteNumber(r.bestEfficiency) ? r.bestEfficiency : 0;
      records[id] = rec;
    }
  }
  const s = (obj.settings && typeof obj.settings === 'object' ? obj.settings : {}) as Record<string, unknown>;
  const settings: Settings = {
    sound: typeof s.sound === 'boolean' ? s.sound : true,
    reducedMotion: typeof s.reducedMotion === 'boolean' ? s.reducedMotion : false,
    haptics: typeof s.haptics === 'boolean' ? s.haptics : true,
  };
  const lastContractId = typeof obj.lastContractId === 'string' ? obj.lastContractId : undefined;
  return { version: SAVE_VERSION, money, totalEarned, completed, equipment, records, settings, lastContractId };
}

/** Serialises save data. Infinity is not valid JSON so it is encoded as null. */
export function serializeSave(data: SaveData): string {
  return JSON.stringify(data, (_key, value) => (value === Infinity ? null : value));
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
    this.data = parseSave(this.safeGet()) ?? defaultSave();
  }

  private safeGet(): string | null {
    try {
      return this.storage.getItem(SAVE_KEY);
    } catch {
      return null;
    }
  }

  save(): void {
    try {
      this.storage.setItem(SAVE_KEY, serializeSave(this.data));
    } catch {
      // Storage may be full or unavailable; progress stays in memory.
    }
  }

  reset(): void {
    this.data = defaultSave();
    try {
      this.storage.removeItem(SAVE_KEY);
    } catch {
      // ignore
    }
  }
}
