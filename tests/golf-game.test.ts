import { describe, expect, it } from 'vitest';
import type { StorageLike } from '../src/game/save';
import { GOLF_SAVE_KEY, GolfStore, modeOpen, normalizeGolfSave } from '../src/golf/save';
import { solveAim } from '../src/golf/sim/aim';
import { ALL_LEVELS, CAMPAIGN, SCORE_ATTACK, dailyLevel, getLevel, objectiveText, type LevelDef } from '../src/golf/sim/levels';
import { PartState } from '../src/golf/sim/parts';
import { SCORING, Session, playScript, starsFor, streakMultiplier } from '../src/golf/sim/session';
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

const level = (id: string): LevelDef => getLevel(id);
const settle = (s: Session): void => {
  let guard = 0;
  while (s.phase === 'flight' && guard++ < 120 * 30) s.step();
};
const shotAt = (s: Session, ball: Shot['ball'], x: number, y: number, z: number, power = 0.9): Shot => {
  const shot = solveAim(s.world, ball, { x, y, z }, power, s.mods());
  if (!shot) throw new Error('no aim');
  return shot;
};

describe('levels', () => {
  it('every level builds a house that stands, with a sane budget and par', () => {
    for (const l of [...ALL_LEVELS, dailyLevel('2026-10-28')]) {
      const w = new World(l.house, l.yard);
      w.solve(true);
      expect(w.drainEvents().filter((e) => e.t === 'release'), l.id).toHaveLength(0);
      if (Number.isFinite(l.shots)) expect(l.par, l.id).toBeLessThanOrEqual(l.shots);
      for (const o of l.objectives) expect(objectiveText(o).length, l.id).toBeGreaterThan(3);
      for (const o of l.objectives) if (o.kind === 'target') expect(w.parts.some((p) => p.tags.includes(o.tag)), `${l.id} ${o.tag}`).toBe(true);
    }
  });

  it('introduces one new thing per level in the campaign, and the new ball is stocked', () => {
    const seen = new Set<string>();
    for (const l of CAMPAIGN) {
      if (!l.introduces) continue;
      expect(seen.has(l.introduces)).toBe(false);
      seen.add(l.introduces);
      const stocked = (l.balls as Record<string, number>)[l.introduces] ?? (l.powerups as Record<string, number>)[l.introduces] ?? 0;
      expect(stocked, l.id).toBeGreaterThan(0);
    }
    expect(CAMPAIGN.length).toBeGreaterThanOrEqual(8);
  });

  it('the daily challenge is the same all day and changes between days', () => {
    const a = dailyLevel('2026-10-28');
    const b = dailyLevel('2026-10-28');
    const c = dailyLevel('2026-10-29');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });
});

describe('a session', () => {
  it('counts shots once, spends ammo, and refuses what it cannot do', () => {
    const s = new Session(level('c5'));
    expect(s.shotsLeft).toBe(4);
    expect(s.canUse('heavy')).toBe(false);
    expect(s.fire({ ball: 'heavy', yaw: 0, pitch: 10, power: 1 })).toBe(false);
    expect(s.shotsLeft).toBe(4);
    expect(s.fire(shotAt(s, 'power', -1, 2, 0))).toBe(true);
    // A second fire during the flight is ignored.
    expect(s.fire(shotAt(s, 'power', -1, 2, 0))).toBe(false);
    expect(s.shotsUsed).toBe(1);
    expect(s.ammo.power).toBe(1);
    settle(s);
    expect(s.phase === 'aim' || s.phase === 'done').toBe(true);
  });

  it('power-ups arm for the next shot only, and Precision Mode lasts three shots', () => {
    const s = new Session({ ...level('c10'), shots: 9 });
    expect(s.toggle('drive')).toBe(true);
    expect(s.mods().damage).toBeGreaterThan(1);
    expect(s.toggle('drive')).toBe(true);
    expect(s.mods().damage).toBe(1);
    s.toggle('precision');
    expect(s.guideFull).toBe(true);
    for (let i = 0; i < 3; i++) {
      expect(s.guideFull).toBe(true);
      s.fire({ ball: 'standard', yaw: 30, pitch: 40, power: 0.2 });
      settle(s);
    }
    expect(s.guideFull).toBe(false);
    expect(s.powerups.precision).toBe(0);
    expect(s.toggle('precision')).toBe(false);
  });

  it('multi-golfer launches a three-ball volley for one shot', () => {
    const s = new Session(level('c9'));
    s.toggle('golfers');
    s.fire(shotAt(s, 'standard', 0, 3, 0));
    expect(s.world.balls).toHaveLength(3);
    expect(s.shotsUsed).toBe(1);
    expect(s.powerups.golfers).toBe(0);
  });

  it('scores only what actually happened, and the same shots always score the same', () => {
    const script = (s: Session): Shot[] => [shotAt(s, 'standard', -3.15, 1.95, 0, 0.9), shotAt(s, 'standard', -0.75, 2.1, 0, 0.9)];
    const a = playScript(level('score'), script(new Session(level('score'))));
    const b = playScript(level('score'), script(new Session(level('score'))));
    expect(a.score).toBe(b.score);
    expect(a.score).toBeGreaterThan(0);
    // Every point traces to a broken or loosened part, a seam, a chain, a collapse or a through shot.
    const report = a.reports[1];
    expect(report?.seams).toBe(1);
    const missed = playScript(level('score'), [{ ball: 'standard', yaw: 35, pitch: 35, power: 1 }]);
    expect(missed.score).toBe(0);
    expect(missed.reports[0]?.lines).toEqual(['No damage']);
  });

  it('a streak multiplies consecutive scoring shots and a miss resets it', () => {
    expect(streakMultiplier(1)).toBe(1);
    expect(streakMultiplier(3)).toBe(1 + 2 * SCORING.streakStep);
    expect(streakMultiplier(50)).toBe(SCORING.streakMax);
    const lvl = level('score');
    const s0 = new Session(lvl);
    const shots = [shotAt(s0, 'standard', -3.15, 1.95, 0), shotAt(s0, 'standard', 3.0, 1.95, 0), { ball: 'standard' as const, yaw: 35, pitch: 35, power: 1 }];
    const s = playScript(lvl, shots);
    expect(s.reports[0]?.streak).toBe(1);
    expect(s.reports[1]?.streak).toBe(2);
    expect(s.reports[1]?.multiplier).toBe(streakMultiplier(2));
    expect(s.reports[2]?.streak).toBe(0);
  });

  it('finishes when the objective is met, with stars by shots against par', () => {
    const l = level('c5');
    const s0 = new Session(l);
    const col = s0.world.parts.find((p) => p.kind === 'column');
    if (!col) throw new Error('no column');
    const s = playScript(l, [shotAt(s0, 'standard', col.x, col.y, col.z + col.hz)]);
    expect(s.result?.complete).toBe(true);
    expect(s.result?.stars).toBe(3);
    expect(s.score).toBeGreaterThanOrEqual((l.shots - 1) * SCORING.shotLeft);
    expect(starsFor(l, l.par)).toBe(3);
    expect(starsFor(l, l.par + 1)).toBe(2);
    expect(starsFor(l, l.par + 5)).toBe(1);
  });

  it('runs out of shots without completing, and a fresh session restarts cleanly', () => {
    const l = level('c4');
    const misses = Array.from({ length: l.shots }, () => ({ ball: 'standard' as const, yaw: -35, pitch: 30, power: 1 }));
    const s = playScript(l, misses);
    expect(s.result?.complete).toBe(false);
    expect(s.phase).toBe('done');
    const again = new Session(l);
    expect(again.shotsUsed).toBe(0);
    expect(again.score).toBe(0);
    expect(again.world.parts.every((p) => p.state === PartState.Intact)).toBe(true);
  });

  it('score attack awards medals from the thresholds', () => {
    const s = playScript(SCORE_ATTACK, [{ ball: 'standard', yaw: 35, pitch: 35, power: 1 }]);
    const r = s.finish();
    expect(r.complete).toBe(true);
    expect(r.medal).toBe(0);
  });
});

describe('golf save', () => {
  it('keeps golf progress under its own key and never touches the crew save', () => {
    const mem = new Mem();
    mem.setItem('demo-day:save', '{"money":4200}');
    const store = new GolfStore(mem);
    const c1 = level('c1');
    store.started(c1);
    const best = store.finish(c1, { complete: true, stars: 2, score: 900, shots: 3 });
    expect(best.first).toBe(true);
    expect(mem.getItem('demo-day:save')).toBe('{"money":4200}');
    const again = new GolfStore(mem);
    expect(again.data.levels.c1).toMatchObject({ attempts: 1, completions: 1, bestStars: 2, bestScore: 900, bestShots: 3 });
    // A worse run does not lower the records.
    again.finish(c1, { complete: true, stars: 1, score: 100, shots: 5 });
    expect(again.data.levels.c1).toMatchObject({ bestStars: 2, bestScore: 900, bestShots: 3, completions: 2 });
    expect(JSON.parse(mem.getItem(GOLF_SAVE_KEY) ?? '{}').levels.c1.completions).toBe(2);
  });

  it('opens levels and modes in order', () => {
    const store = new GolfStore(new Mem());
    expect(store.isOpen(level('c1'))).toBe(true);
    expect(store.isOpen(level('c2'))).toBe(false);
    expect(modeOpen(store, 'score')).toBe(false);
    for (const id of ['c1', 'c2', 'c3']) store.finish(level(id), { complete: true, stars: 1, score: 1, shots: 1 });
    expect(store.isOpen(level('c4'))).toBe(true);
    expect(modeOpen(store, 'score')).toBe(true);
    expect(modeOpen(store, 'precision')).toBe(false);
    expect(store.unlockedBalls()).toContain('standard');
    expect(store.nextLevel.id).toBe('c4');
  });

  it('survives junk: bad JSON, wrong types and negative numbers', () => {
    expect(normalizeGolfSave('nope')).toBeNull();
    const n = normalizeGolfSave({ levels: { c1: { attempts: -3, bestStars: 9, bestScore: 'x' } }, coached: 'yes' });
    expect(n?.levels.c1).toMatchObject({ attempts: 0, bestStars: 3, bestScore: 0 });
    expect(n?.coached).toBe(false);
    const mem = new Mem();
    mem.setItem(GOLF_SAVE_KEY, '{broken');
    expect(new GolfStore(mem).data.levels).toEqual({});
  });
});
