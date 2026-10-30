import { describe, expect, it } from 'vitest';
import { HOUSES, houseLevel, unlockedAt, type HouseDef } from '../src/golf/game/houses';
import { applyShot, emptyEconomy, type Economy } from '../src/golf/game/rewards';
import { solvePull } from '../src/golf/game/solve';
import type { BallId } from '../src/golf/sim/balls';
import { PartState, type Part } from '../src/golf/sim/parts';
import { Session } from '../src/golf/sim/session';
import { World } from '../src/golf/sim/world';

/**
 * Every campaign house is played to its objective by a simple bot that aims
 * with the real pull-back controls (yaw and pull, loft tied to power) and
 * spends only specials it earned from the reward meter or the house gifts.
 * A house in the game is never a guess.
 */

const intact = (p: Part): boolean => p.state === PartState.Intact;
const front = (p: Part): { x: number; y: number; z: number } => ({ x: p.x, y: p.y, z: p.z + p.hz + 0.02 });

function pickTarget(s: Session, h: HouseDef, k: number): Part | undefined {
  const P = s.world.parts;
  const o = h.objective;
  const byLow = (a: Part, b: Part): number => a.y - b.y || Math.abs(a.x + 0.6) - Math.abs(b.x + 0.6);
  const frontBricks = P.filter((p) => intact(p) && p.wall === 'front' && (p.kind === 'brick' || p.kind === 'lintel'));
  switch (o.kind) {
    case 'collapse':
      if (o.what === 'porch') return P.find((p) => intact(p) && p.kind === 'column');
      if (o.what === 'chimney') return P.filter((p) => intact(p) && p.tags.includes('chimney') && p.kind === 'brick').sort((a, b) => a.y - b.y)[k % 2];
      if (o.what === 'floor') {
        const course = frontBricks.filter((p) => Math.abs(p.y - 3.15) < 0.4 && p.x < -0.9).sort((a, b) => Math.abs(a.y - 3.15) - Math.abs(b.y - 3.15) || a.x - b.x);
        return course[0] ?? frontBricks.sort(byLow)[0];
      }
      if (o.what === 'roof') {
        // The wall top under the outer roof sections, left then right.
        const top = Math.max(...frontBricks.map((p) => p.y));
        const row = frontBricks.filter((p) => p.y >= top - 0.35 && Math.abs(p.x) > 1.9);
        const side = row.filter((p) => (k % 2 === 0 ? p.x < 0 : p.x > 0));
        return (side.length ? side : row).sort((a, b) => Math.abs(b.x) - Math.abs(a.x))[0] ?? frontBricks.sort(byLow)[0];
      }
      break;
    case 'windows':
      return P.filter((p) => intact(p) && p.kind === 'glass' && p.wall === 'front').sort((a, b) => a.y - b.y || a.x - b.x)[0];
    default: {
      const weak = s.world.weakPoints(1)[0];
      if (o.kind === 'destruction') {
        if (weak && k % 3 === 0) return P[weak.part];
        if (k % 3 === 1) {
          // The wall top: roof sections come down with it.
          const top = Math.max(...frontBricks.map((p) => p.y));
          const row = frontBricks.filter((p) => p.y >= top - 0.35 && Math.abs(p.x) > 1.9);
          if (row.length) return row.sort((a, b) => Math.abs(b.x) - Math.abs(a.x))[k % row.length];
        }
      }
      return frontBricks.sort(byLow)[k % 3];
    }
  }
  return frontBricks.sort(byLow)[0];
}

function pickBall(econ: Economy, h: HouseDef): BallId {
  const o = h.objective;
  const has = (b: BallId): boolean => (econ.inventory[b as Exclude<BallId, 'standard'>] ?? 0) > 0;
  if (o.kind === 'collapse' && (o.what === 'porch' || o.what === 'chimney') && has('heavy')) return 'heavy';
  if (o.kind === 'windows') return 'standard';
  for (const b of ['blast', 'heavy', 'power'] as BallId[]) if (has(b) && o.kind !== 'bricks') return b;
  return 'standard';
}

function playHouse(h: HouseDef, index: number, econ: Economy, maxShots = 60): { shots: number; done: boolean; specials: number; progress: string } {
  const level = houseLevel(h);
  const s = new Session(level, 7, { ammo: econ.inventory });
  const unlocked: BallId[] = ['standard', ...unlockedAt(index)];
  let specials = 0;
  for (let k = 0; k < maxShots && !s.completed; k++) {
    const t = pickTarget(s, h, k);
    if (!t) break;
    let ball = pickBall(econ, h);
    let aim = solvePull(s.world, ball, front(t));
    if (!aim && ball !== 'standard') {
      ball = 'standard';
      aim = solvePull(s.world, ball, front(t));
    }
    if (!aim) aim = { shot: { ball: 'standard', yaw: 0, pitch: 12, power: 0.8 }, yaw: 0, pull: 0.6 };
    const before = econ.inventory[aim.shot.ball as 'power'] ?? 0;
    expect(s.fire(aim.shot)).toBe(true);
    // The session spends from the shared campaign inventory.
    if (aim.shot.ball !== 'standard') {
      expect(econ.inventory[aim.shot.ball as 'power']).toBe(before - 1);
      specials++;
    }
    let guard = 0;
    while (s.phase === 'flight' && guard++ < 120 * 30) s.step();
    s.takeEvents();
    const report = s.reports[s.reports.length - 1];
    if (report) applyShot(econ, report.quality, unlocked);
  }
  return { shots: s.shotsUsed, done: s.completed, specials, progress: s.progress(h.objective).join('/') };
}

describe('the campaign', () => {
  it('every house stands untouched and has a reachable objective', () => {
    for (const h of HOUSES) {
      const w = new World(h.spec, h.yard);
      w.solve(true);
      expect(w.drainEvents().filter((e) => e.t === 'release'), h.id).toHaveLength(0);
      expect(new Session(houseLevel(h)).completed, h.id).toBe(false);
    }
  });

  it('every house can be finished with the pull-back controls and earned specials', () => {
    const econ = emptyEconomy();
    const log: string[] = [];
    HOUSES.forEach((h, i) => {
      if (h.unlocks) econ.inventory[h.unlocks] = (econ.inventory[h.unlocks] ?? 0) + 2;
      const r = playHouse(h, i, econ, 100);
      log.push(`${h.id}:${r.shots}${r.done ? '' : '!'}(${r.specials})`);
      expect(r.done, `${h.id} ${h.name} not finished in ${r.shots} shots (${r.progress}, ${log.join(' ')})`).toBe(true);
      for (const [b, n] of Object.entries(h.prize)) econ.inventory[b as 'power'] = (econ.inventory[b as 'power'] ?? 0) + (n as number);
    });
    console.log(log.join(' '), JSON.stringify(econ.inventory));
  }, 120_000);
});
