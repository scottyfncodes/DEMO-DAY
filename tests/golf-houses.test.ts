import { describe, expect, it } from 'vitest';
import { HOUSES, hiddenBalls, houseLevel, type HouseDef } from '../src/golf/game/houses';
import { emptyEconomy, stash, type Economy } from '../src/golf/game/rewards';
import { shotAt } from '../src/golf/game/solve';
import type { BallId } from '../src/golf/sim/balls';
import { PartState, type Part } from '../src/golf/sim/parts';
import { Session } from '../src/golf/sim/session';
import { World } from '../src/golf/sim/world';

/**
 * Every campaign house is played to its destruction goal by a simple bot
 * that aims with the real controls (a target point and a pull), sets off the
 * gas bottles first, and spends only special balls it found in the bricks. A goal in the game is
 * never a guess.
 */

const intact = (p: Part): boolean => p.state === PartState.Intact;
const front = (p: Part): { x: number; y: number; z: number } => ({ x: p.x, y: p.y, z: p.z + p.hz + 0.02 });

function pickTarget(s: Session, k: number): Part | undefined {
  const P = s.world.parts;
  const frontBricks = P.filter((p) => intact(p) && p.wall === 'front' && (p.kind === 'brick' || p.kind === 'lintel'));
  const byLow = (a: Part, b: Part): number => a.y - b.y || Math.abs(a.x + 0.6) - Math.abs(b.x + 0.6);
  // Chains first: a gas bottle still standing, nearest the ground and the front.
  const bottle = P.filter((p) => intact(p) && p.tags.includes('tank')).sort((a, b) => a.y - b.y || b.z - a.z)[0];
  if (bottle && k % 2 === 0) return bottle;
  const weak = s.world.weakPoints(1)[0];
  if (weak && k % 3 === 0) return P[weak.part];
  if (k % 3 === 1) {
    // The wall top: roof sections come down with it.
    const top = Math.max(...frontBricks.map((p) => p.y));
    const row = frontBricks.filter((p) => p.y >= top - 0.35 && Math.abs(p.x) > 1.9);
    if (row.length) return row.sort((a, b) => Math.abs(b.x) - Math.abs(a.x))[k % row.length];
  }
  return frontBricks.sort(byLow)[k % 3];
}

function pickBall(econ: Economy): BallId {
  for (const b of ['blast', 'heavy', 'power'] as const) if ((econ.inventory[b] ?? 0) > 0) return b;
  return 'standard';
}

function playHouse(h: HouseDef, econ: Economy, maxShots: number): { shots: number; done: boolean; found: number; pct: number } {
  const s = new Session(houseLevel(h), 7, { ammo: econ.inventory });
  const hidden = hiddenBalls(h, s.world.parts);
  const found = new Set<number>();
  for (let k = 0; k < maxShots && !s.completed; k++) {
    const t = pickTarget(s, k);
    if (!t) break;
    const ball = pickBall(econ);
    const before = econ.inventory[ball as 'power'] ?? 0;
    expect(s.fire(shotAt(s.world, ball, front(t), 0.9, s.mods()).shot)).toBe(true);
    if (ball !== 'standard') expect(econ.inventory[ball as 'power']).toBe(before - 1);
    let guard = 0;
    while (s.phase === 'flight' && guard++ < 120 * 30) {
      s.step();
      for (const e of s.takeEvents()) {
        if ((e.t === 'break' || e.t === 'release') && hidden.has(e.part) && !found.has(e.part)) {
          found.add(e.part);
          stash(econ, hidden.get(e.part) as 'power');
        }
      }
    }
  }
  return { shots: s.shotsUsed, done: s.completed, found: found.size, pct: Math.floor(s.world.destruction() * 100) };
}

describe('the campaign', () => {
  it('houses grow, every one stands untouched, and goals are not met by a fresh house', () => {
    let last = 0;
    for (const h of HOUSES) {
      const w = new World(h.spec, h.yard);
      w.solve(true);
      expect(w.drainEvents().filter((e) => e.t === 'release' || e.t === 'creak'), h.id).toHaveLength(0);
      expect(w.pending.size, `${h.id} has overloaded parts`).toBe(0);
      // Left alone for a while, nothing gives way.
      for (let i = 0; i < 240; i++) w.step();
      expect(w.drainEvents().filter((e) => e.t === 'break' || e.t === 'release'), `${h.id} falls down on its own`).toHaveLength(0);
      expect(new Session(houseLevel(h)).completed, h.id).toBe(false);
      expect(w.parts.length, `${h.id} is not bigger than the one before`).toBeGreaterThanOrEqual(last);
      last = w.parts.length;
    }
  });

  it('hides each house’s balls in the same bricks every time, never in the footing', () => {
    for (const h of HOUSES) {
      const w = new World(h.spec, h.yard);
      const a = hiddenBalls(h, w.parts);
      const b = hiddenBalls(h, new World(h.spec, h.yard).parts);
      expect([...a]).toEqual([...b]);
      expect(a.size).toBe(h.hidden);
      for (const [id, ball] of a) {
        expect(w.parts[id]?.kind).toBe('brick');
        expect(w.parts[id]?.mat).not.toBe('foundation');
        expect(h.pool).toContain(ball);
      }
    }
  });

  it('every house reaches its goal with the real controls and only the balls found in it', () => {
    const econ = emptyEconomy();
    const log: string[] = [];
    for (const h of HOUSES) {
      const r = playHouse(h, econ, 100);
      log.push(`${h.id}:${r.shots}${r.done ? '' : '!'}(${r.found} found, ${r.pct}%)`);
      expect(r.done, `${h.id} ${h.name} not at its goal in ${r.shots} shots (${r.pct}% of ${h.goal}%; ${log.join(' ')})`).toBe(true);
    }
    console.log(log.join(' '), JSON.stringify(econ.inventory));
  }, 300_000);
});
