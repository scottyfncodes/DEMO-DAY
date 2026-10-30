import { describe, expect, it } from 'vitest';
import type { StorageLike } from '../src/game/save';
import { AIM, isCancel, powerFor, pullFrom } from '../src/golf/game/controls';
import { HOUSES, houseLevel } from '../src/golf/game/houses';
import { evaluateShot } from '../src/golf/game/quality';
import { REWARD, emptyEconomy, stash } from '../src/golf/game/rewards';
import { shotAt } from '../src/golf/game/solve';
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
/** The shot for a target at a strong pull, the way the play screen makes it. */
const solvePull = (w: World, ball: Shot['ball'], t: { x: number; y: number; z: number }, pull = 0.9): { shot: Shot } => shotAt(w, ball, t, pull);
const h1 = HOUSES[0] as (typeof HOUSES)[number];

describe('touch-and-pull controls', () => {
  it('a longer pull is more power; a short one only re-aims', () => {
    expect(isCancel(AIM.deadPx - 1)).toBe(true);
    expect(isCancel(AIM.deadPx + 1)).toBe(false);
    expect(pullFrom(0, 844)).toBe(0);
    expect(pullFrom(2000, 844)).toBe(1);
    expect(powerFor(1)).toBeGreaterThan(powerFor(0.3));
  });

  it('aim and power are separate: full power at a low brick is a flat drive, soft is a lob, both land on it', () => {
    const w = new World(HOUSES[0]!.spec, HOUSES[0]!.yard);
    const target = { x: -1.5, y: 0.9, z: 0.02 };
    const hard = shotAt(w, 'standard', target, 1);
    const soft = shotAt(w, 'standard', target, 0.45);
    expect(hard.reach && soft.reach).toBe(true);
    expect(hard.shot.power).toBeGreaterThan(soft.shot.power);
    expect(hard.shot.pitch).toBeLessThan(soft.shot.pitch);
    for (const a of [hard, soft]) {
      const c = predict(w, a.shot).contact;
      expect(Math.hypot((c?.px ?? 9) - target.x, (c?.py ?? 9) - target.y)).toBeLessThan(0.25);
    }
    // Full power reaches the roof of the biggest house too.
    const big = new World(HOUSES[9]!.spec, HOUSES[9]!.yard);
    expect(shotAt(big, 'standard', { x: 2, y: big.info.wallTop - 0.3, z: 0.02 }, 1).reach).toBe(true);
    // Too soft to get there flies short, and says so.
    expect(shotAt(big, 'standard', { x: 2, y: big.info.wallTop - 0.3, z: 0.02 }, 0).reach).toBe(false);
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

describe('hidden balls', () => {
  it('a found ball goes in the bag, up to the carry limit', () => {
    const e = emptyEconomy();
    expect(stash(e, 'heavy')).toBe(true);
    expect(e.inventory.heavy).toBe(1);
    e.inventory.heavy = REWARD.cap;
    expect(stash(e, 'heavy')).toBe(false);
    expect(e.inventory.heavy).toBe(REWARD.cap);
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
    expect(s.level.objectives).toEqual([{ kind: 'destruction', pct: h1.goal }]);
    let done = 0;
    s.onComplete = () => done++;
    s.fire(solvePull(s.world, 'power', { x: -1.2, y: 1.5, z: 0.02 })!.shot);
    expect(e.inventory.power).toBe(0);
    expect(s.canUse('power')).toBe(false);
    settle(s);
    for (let k = 0; k < 60 && !s.completed; k++) play(s, 'standard', -3.6 + (k % 12) * 0.6, 0.9 + (k % 3) * 0.3);
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

  it('reaching the goal opens the next house and records shots; a rebuild keeps the best and the found balls', () => {
    const store = new GolfStore(new Mem());
    store.enterHouse(h1);
    const rec = store.houseRec('h1');
    rec.shots = 9;
    rec.found.push(42);
    expect(store.completeHouse(h1)?.id).toBe('h2');
    expect(store.houseOpen('h2')).toBe(true);
    expect(rec).toMatchObject({ done: true, doneIn: 9, bestIn: 9 });
    store.rebuildHouse('h1');
    expect(rec).toMatchObject({ shots: 0, doneIn: 0, bestIn: 9, found: [42] });
    rec.shots = 6;
    store.completeHouse(h1);
    expect(rec).toMatchObject({ doneIn: 6, bestIn: 6 });
    rec.shots = 12;
    store.rebuildHouse('h1');
    rec.shots = 12;
    store.completeHouse(h1);
    expect(rec).toMatchObject({ doneIn: 12, bestIn: 6 });
  });

  it('keeps the economy and house damage across a reload, and reset clears both', () => {
    const mem = new Mem();
    const store = new GolfStore(mem);
    store.data.economy.inventory.heavy = 3;
    store.houseRec('h1').shots = 7;
    const w = new World(h1.spec, h1.yard);
    w.launch(solvePull(w, 'standard', { x: -1.2, y: 1.5, z: 0.02 })!.shot);
    w.runUntilSettled();
    store.saveHouse('h1', w.snapshot());
    store.save();
    const again = new GolfStore(mem);
    expect(again.data.economy).toMatchObject({ inventory: { heavy: 3 } });
    expect(again.houseRec('h1').shots).toBe(7);
    const w2 = new World(h1.spec, h1.yard);
    expect(w2.restore(again.loadHouse('h1')!)).toBe(true);
    expect(w2.destruction()).toBeCloseTo(w.destruction(), 6);
    again.reset();
    expect(mem.getItem(houseKey('h1'))).toBeNull();
    expect(new GolfStore(mem).data.economy.inventory).toEqual({});
  });

  it('survives junk in the new fields', () => {
    const n = normalizeGolfSave({ version: 2, campaign: { current: 'h9', reached: 99, houses: { h1: { shots: -4, done: 'yes', found: [3, -1, 'x', 7.5] } } }, economy: { meter: 9999, inventory: { power: 400, bogus: 3 }, fatigue: { seam: -1 } } });
    expect(n?.campaign.reached).toBe(HOUSES.length - 1);
    expect(n?.campaign.houses.h1).toMatchObject({ shots: 0, done: false, found: [3] });
    expect(n?.economy).toEqual({ inventory: { power: REWARD.cap } });
  });
});
