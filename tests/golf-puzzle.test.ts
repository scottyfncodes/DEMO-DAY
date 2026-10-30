import { describe, expect, it } from 'vitest';
import type { StorageLike } from '../src/game/save';
import { AIM, isCancel, pullFrom, shotFor, yawStep } from '../src/golf/game/controls';
import { HOUSES, houseLevel, unlockedAt } from '../src/golf/game/houses';
import { evaluateShot, type ShotQuality } from '../src/golf/game/quality';
import { REWARD, applyShot, emptyEconomy, meterLines, payoutFor } from '../src/golf/game/rewards';
import { solvePull } from '../src/golf/game/solve';
import { GOLF_SAVE_KEY, GolfStore, houseKey, normalizeGolfSave } from '../src/golf/save';
import { predict, solveAim } from '../src/golf/sim/aim';
import { getLevel } from '../src/golf/sim/levels';
import { PartState } from '../src/golf/sim/parts';
import { Session } from '../src/golf/sim/session';
import { World, type Shot } from '../src/golf/sim/world';

class Mem implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

const settle = (s: Session): void => {
  let guard = 0;
  while (s.phase === 'flight' && guard++ < 120 * 30) s.step();
};
const q = (tags: ShotQuality['tags'], pieces = 0): ShotQuality => ({ tags, headline: tags[0] ?? null, tier: 2, pieces, released: 0 });
const h1 = HOUSES[0] as (typeof HOUSES)[number];

describe('pull-back controls', () => {
  it('a longer pull is a harder, higher shot; a short one cancels', () => {
    expect(isCancel(AIM.deadPx - 1)).toBe(true);
    expect(isCancel(AIM.deadPx + 1)).toBe(false);
    expect(pullFrom(0, 844)).toBe(0);
    expect(pullFrom(2000, 844)).toBe(1);
    const a = shotFor('standard', 0, 0.2);
    const b = shotFor('standard', 0, 0.8);
    expect(b.power).toBeGreaterThan(a.power);
    expect(b.pitch).toBeGreaterThan(a.pitch);
  });

  it('turns like a slingshot, finer when the thumb moves slowly', () => {
    expect(yawStep(-10, 10)).toBeGreaterThan(0);
    expect(Math.abs(yawStep(10, 200))).toBeLessThan(Math.abs(yawStep(10, 10)));
    expect(shotFor('standard', 99, 0.5).yaw).toBe(AIM.yawMax);
  });

  it('covers the house from the footing to the roof, and the guide predicts the real hit', () => {
    const w = new World(h1.spec, h1.yard);
    const low = predict(w, shotFor('standard', -3, 0.35)).contact;
    const high = predict(w, shotFor('standard', -3, 0.75)).contact;
    expect(low && high).toBeTruthy();
    expect((high?.py ?? 0) - (low?.py ?? 0)).toBeGreaterThan(1.5);
    const aim = solvePull(w, 'standard', { x: -1.5, y: 1.6, z: 0.02 });
    expect(aim).toBeTruthy();
    const c = predict(w, aim!.shot).contact;
    expect(Math.hypot((c?.px ?? 9) + 1.5, (c?.py ?? 9) - 1.6)).toBeLessThan(0.3);
  });
});

describe('shot quality', () => {
  it('names a clean hit, and nothing for a miss', () => {
    const miss = new Session(getLevel('c1'));
    miss.fire({ ball: 'standard', yaw: -35, pitch: 40, power: 1 });
    settle(miss);
    expect(miss.reports[0]?.quality.headline).toBeNull();
    const hit = new Session(getLevel('c1'));
    hit.fire(solvePull(hit.world, 'standard', { x: -4.05, y: 1.5, z: 0.02 })!.shot);
    settle(hit);
    expect(hit.reports[0]?.quality.tags).toContain('clean');
  });

  it('taking out a porch column is a support down', () => {
    const s = new Session(getLevel('c5'));
    const col = s.world.parts.find((p) => p.kind === 'column')!;
    s.fire({ ...solveAim(s.world, 'power', { x: col.x, y: col.y, z: col.z + col.hz }, 0.9)!, ball: 'power' });
    settle(s);
    expect(s.world.parts.some((p) => p.tags.includes('porch-roof') && p.state !== PartState.Intact)).toBe(true);
    expect(s.reports[0]?.quality.tags).toContain('support');
  });

  it('is a pure read of the events', () => {
    const w = new World(h1.spec, h1.yard);
    const ctx = { parts: w.parts, balls: [], focus: new Set<number>(), destructionBefore: 0, destructionAfter: 0 };
    expect(evaluateShot([], ctx)).toMatchObject({ tags: [], headline: null, tier: 0 });
    expect(evaluateShot([{ t: 'seam', ball: 1, a: 1, b: 2, x: 0, y: 0, z: 0 }], ctx).headline).toBe('seam');
  });
});

describe('the reward economy', () => {
  it('skill fills the meter and the skill picks the ball', () => {
    const e = emptyEconomy();
    e.meter = 90;
    const r = applyShot(e, q(['seam']), ['standard', 'power', 'heavy']);
    expect(r.awarded).toEqual(['power']);
    expect(r.reason).toBe('seam');
    expect(e.inventory.power).toBe(1);
    expect(e.meter).toBeCloseTo(90 + REWARD.tag.seam - REWARD.meterSize);
  });

  it('a locked ball pays out the scarcest open one instead, and a full bag waits', () => {
    const e = emptyEconomy();
    e.inventory = { power: 3 };
    expect(payoutFor('support', e, ['standard', 'power', 'super'])).toBe('super');
    e.inventory = { power: REWARD.cap };
    expect(payoutFor('seam', e, ['standard', 'power'])).toBeNull();
    e.meter = 99;
    applyShot(e, q(['seam']), ['standard', 'power']);
    expect(e.inventory.power).toBe(REWARD.cap);
    expect(e.meter).toBe(REWARD.meterSize);
  });

  it('repeating the same easy trick is worth less each time, and recovers', () => {
    const e = emptyEconomy();
    const gains = [0, 1, 2].map(() => applyShot(e, q(['clean'], 1), ['standard']).gain);
    expect(gains[1]).toBeLessThan(gains[0] as number);
    expect(gains[2]).toBeLessThan(gains[1] as number);
    for (let i = 0; i < 4; i++) applyShot(e, q([]), ['standard']);
    expect(applyShot(e, q(['clean'], 1), ['standard']).gain).toBeCloseTo(gains[0] as number);
  });

  it('plain firing earns nothing; ordinary damage earns a little; a finished house earns half', () => {
    const e = emptyEconomy();
    expect(applyShot(e, q([]), ['standard']).gain).toBe(0);
    expect(meterLines(q([], 3), e)[0]?.value).toBeCloseTo(3 * REWARD.perPiece);
    expect(meterLines(q(['bank']), e, true)[0]?.value).toBeCloseTo(REWARD.tag.bank * REWARD.finishedHouse);
    // A great shot fills more than half the meter; an ordinary hit is a sliver.
    expect(REWARD.tag.house + REWARD.tag.support + REWARD.tag.chain).toBeGreaterThan(REWARD.meterSize * 0.6);
    expect(REWARD.tag.clean + REWARD.perPiece).toBeLessThan(REWARD.meterSize * 0.1);
  });
});

describe('persistent houses', () => {
  const play = (s: Session, ball: Shot['ball'], x: number, y: number): void => {
    const a = solvePull(s.world, ball, { x, y, z: 0.02 });
    if (!a) throw new Error('no aim');
    s.fire(a.shot);
    settle(s);
  };

  it('a snapshot puts every broken brick, rubble pile and damaged part back', () => {
    const level = houseLevel(HOUSES[3]!);
    const s = new Session(level, 7, { ammo: { power: 5 } });
    play(s, 'power', -1.5, 1.2);
    play(s, 'standard', 2.0, 1.6);
    const snap = JSON.parse(JSON.stringify(s.world.snapshot()));
    const w = new World(level.house, level.yard, 7);
    expect(w.restore(snap)).toBe(true);
    for (let i = 0; i < w.parts.length; i++) {
      expect(w.parts[i]!.state, `part ${i}`).toBe(s.world.parts[i]!.state);
      expect(w.parts[i]!.hp).toBeCloseTo(s.world.parts[i]!.hp, 2);
    }
    expect(w.destruction()).toBeCloseTo(s.world.destruction(), 6);
    // And it carries on exactly the same.
    const next = solvePull(w, 'standard', { x: -3, y: 1.5, z: 0.02 })!.shot;
    s.world.launch(next);
    s.world.runUntilSettled();
    w.launch(next);
    w.runUntilSettled();
    expect(w.destruction()).toBeCloseTo(s.world.destruction(), 6);
  });

  it('refuses a snapshot from a different house, or junk', () => {
    const a = new World(HOUSES[0]!.spec, HOUSES[0]!.yard);
    const b = new World(HOUSES[4]!.spec, HOUSES[4]!.yard);
    expect(b.restore(a.snapshot())).toBe(false);
    expect(b.restore({ v: 1, n: b.parts.length, time: 0, rng: 1, ball: 1, parts: [99999, 2, 0], rubble: [], heights: [] })).toBe(false);
    expect(b.restore('nope' as never)).toBe(false);
    expect(b.destruction()).toBe(0);
  });

  it('a house session never ends: meeting the objective fires once and play carries on', () => {
    const e = emptyEconomy();
    e.inventory.power = 1;
    const s = new Session(houseLevel(h1), 7, { ammo: e.inventory });
    let done = 0;
    s.onComplete = () => done++;
    s.fire(solvePull(s.world, 'power', { x: -1.2, y: 1.5, z: 0.02 })!.shot);
    expect(e.inventory.power).toBe(0);
    expect(s.canUse('power')).toBe(false);
    settle(s);
    for (let k = 0; k < 40 && !s.completed; k++) play(s, 'standard', -3.6 + (k % 12) * 0.6, 0.9 + (k % 3) * 0.3);
    expect(s.completed).toBe(true);
    expect(done).toBe(1);
    play(s, 'standard', 3, 1.5);
    expect(s.phase).toBe('aim');
    expect(done).toBe(1);
    expect(s.result).toBeNull();
  });

  it('fast resolve hands the next shot back before the last debris settles', () => {
    const level = houseLevel(HOUSES[1]!);
    const quick = new Session(level, 7, { fastResolve: true });
    const slow = new Session(level, 7);
    const col = quick.world.parts.find((p) => p.kind === 'column')!;
    const shot = solveAim(quick.world, 'standard', { x: col.x, y: col.y, z: col.z + col.hz }, 1)!;
    let tq = 0;
    let ts = 0;
    quick.fire(shot);
    slow.fire(shot);
    while (quick.phase === 'flight') (quick.step(), tq++);
    while (slow.phase === 'flight') (slow.step(), ts++);
    expect(tq).toBeLessThanOrEqual(ts);
  });
});

describe('save v2', () => {
  it('migrates a v1 save: records kept, finished levels open houses, crew save untouched', () => {
    const mem = new Mem();
    mem.setItem('demo-day:save', '{"money":4200}');
    const lvl = { attempts: 2, completions: 1, bestStars: 3, bestScore: 900, bestShots: 1 };
    mem.setItem(GOLF_SAVE_KEY, JSON.stringify({ version: 1, levels: { c1: lvl, c2: lvl, c3: lvl }, daily: {}, coached: true }));
    const store = new GolfStore(mem);
    expect(store.data.version).toBe(2);
    expect(store.data.levels.c3).toMatchObject(lvl);
    expect(store.data.campaign.reached).toBe(3);
    expect(store.houseOpen('h4')).toBe(true);
    expect(store.houseOpen('h5')).toBe(false);
    expect(store.data.coached).toBe(true);
    expect(mem.getItem('demo-day:save')).toBe('{"money":4200}');
  });

  it('pays a house gift once, its prize once, and opens the next house', () => {
    const store = new GolfStore(new Mem());
    expect(store.enterHouse(h1)).toEqual({ power: 2 });
    expect(store.enterHouse(h1)).toEqual({});
    const next = store.completeHouse(h1);
    expect(next?.id).toBe('h2');
    expect(store.houseOpen('h2')).toBe(true);
    expect(store.data.economy.inventory.power).toBe(2 + (h1.prize.power ?? 0));
    store.completeHouse(h1);
    expect(store.data.economy.inventory.power).toBe(2 + (h1.prize.power ?? 0));
    expect(store.unlockedSpecials()).toEqual(unlockedAt(1));
  });

  it('keeps the economy and house damage across a reload, and reset clears both', () => {
    const mem = new Mem();
    const store = new GolfStore(mem);
    store.data.economy.meter = 42;
    store.data.economy.inventory.heavy = 3;
    store.houseRec('h1').shots = 7;
    const w = new World(h1.spec, h1.yard);
    w.launch(solvePull(w, 'standard', { x: -1.2, y: 1.5, z: 0.02 })!.shot);
    w.runUntilSettled();
    store.saveHouse('h1', w.snapshot());
    store.save();
    const again = new GolfStore(mem);
    expect(again.data.economy).toMatchObject({ meter: 42, inventory: { heavy: 3 } });
    expect(again.houseRec('h1').shots).toBe(7);
    const w2 = new World(h1.spec, h1.yard);
    expect(w2.restore(again.loadHouse('h1')!)).toBe(true);
    expect(w2.destruction()).toBeCloseTo(w.destruction(), 6);
    again.reset();
    expect(mem.getItem(houseKey('h1'))).toBeNull();
    expect(new GolfStore(mem).data.economy.meter).toBe(0);
  });

  it('survives junk in the new fields', () => {
    const n = normalizeGolfSave({ version: 2, campaign: { current: 'h9', reached: 99, houses: { h1: { shots: -4, done: 'yes' } } }, economy: { meter: 9999, inventory: { power: 400, bogus: 3 }, fatigue: { seam: -1 } } });
    expect(n?.campaign.reached).toBe(HOUSES.length - 1);
    expect(n?.campaign.houses.h1).toMatchObject({ shots: 0, done: false });
    expect(n?.economy.meter).toBe(REWARD.meterSize);
    expect(n?.economy.inventory).toEqual({ power: REWARD.cap });
    expect(n?.economy.fatigue).toEqual({});
  });
});
