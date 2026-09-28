import { describe, expect, it } from 'vitest';
import { SAVE_KEY, SaveStore, defaultSave, normalizeSave, parseSave, serializeSave, type StorageLike } from '../src/game/save';

class FakeStorage implements StorageLike {
  map = new Map<string, string>();
  failWrites = false;
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe('save data', () => {
  it('round-trips through JSON including Infinity records', () => {
    const data = defaultSave();
    data.money = 1234;
    data.completed = ['job01'];
    data.records.job01 = { attempts: 2, completions: 1, bestPayout: 9000, bestRemoved: 0.95, bestCollateral: 0.02, fewestCharges: 2, bestEfficiency: 0.7 };
    data.records.job02 = { attempts: 1, completions: 0, bestPayout: 0, bestRemoved: 0.4, bestCollateral: Infinity, fewestCharges: Infinity, bestEfficiency: 0 };
    const parsed = parseSave(serializeSave(data));
    expect(parsed).not.toBeNull();
    expect(parsed?.money).toBe(1234);
    expect(parsed?.records.job01).toEqual(data.records.job01);
    expect(parsed?.records.job02?.bestCollateral).toBe(Infinity);
    expect(parsed?.records.job02?.fewestCharges).toBe(Infinity);
  });

  it('falls back to defaults for missing or corrupt data', () => {
    expect(parseSave(null)).toBeNull();
    expect(parseSave('not json{')).toBeNull();
    expect(parseSave('42')).toBeNull();
    const partial = normalizeSave({ money: 'lots', completed: 'job01', settings: { sound: 'no' } });
    expect(partial).toEqual(defaultSave());
    const negative = normalizeSave({ money: -500, completed: ['job01', 'job01'], equipment: ['scanner', 7] });
    expect(negative?.money).toBe(0);
    expect(negative?.completed).toEqual(['job01']);
    expect(negative?.equipment).toEqual([]);
  });

  it('loads, saves and resets through a storage backend', () => {
    const storage = new FakeStorage();
    const store = new SaveStore(storage);
    expect(store.data).toEqual(defaultSave());
    store.data.money = 500;
    store.data.completed.push('job01');
    store.save();
    expect(storage.map.has(SAVE_KEY)).toBe(true);
    const again = new SaveStore(storage);
    expect(again.data.money).toBe(500);
    expect(again.data.completed).toEqual(['job01']);
    again.reset();
    expect(again.data).toEqual(defaultSave());
    expect(storage.map.has(SAVE_KEY)).toBe(false);
  });

  it('survives corrupt stored data and failing writes', () => {
    const storage = new FakeStorage();
    storage.map.set(SAVE_KEY, '{"money": ');
    const store = new SaveStore(storage);
    expect(store.data).toEqual(defaultSave());
    storage.failWrites = true;
    store.data.money = 10;
    expect(() => store.save()).not.toThrow();
    expect(store.data.money).toBe(10);
  });
});
