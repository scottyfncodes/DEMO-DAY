import { describe, expect, it } from 'vitest';
import { CAMPAIGN, PRECISION, SCORE_ATTACK, getLevel, type PowerUpId } from '../src/golf/sim/levels';
import { playScript } from '../src/golf/sim/session';
import type { Shot } from '../src/golf/sim/world';
import solutions from './golf-solutions.json';

/**
 * Every campaign level and precision challenge is replayed from a recorded
 * run (found by scripts/tune/golf-solve.tune.test.ts) and must finish within
 * its par: a par in the game is never a guess. Score Attack's gold medal is
 * proven the same way.
 */

type Recorded = Shot & { powerups?: PowerUpId[] };
const runs = solutions as unknown as { levels: Record<string, Recorded[]>; scoreAttack: Recorded[] };

describe('every level can be finished at par', () => {
  for (const level of [...CAMPAIGN, ...PRECISION]) {
    it(`${level.number} ${level.title}`, () => {
      const run = runs.levels[level.id];
      expect(run, `no recorded run for ${level.id}`).toBeTruthy();
      const s = playScript(level, run ?? []);
      expect(s.result?.complete).toBe(true);
      expect(s.shotsUsed).toBeLessThanOrEqual(level.par);
      expect(s.result?.stars).toBe(3);
    });
  }

  it('Score Attack gold is reachable in its eight shots', () => {
    const s = playScript(SCORE_ATTACK, runs.scoreAttack);
    const r = s.finish();
    expect(s.shotsUsed).toBeLessThanOrEqual(SCORE_ATTACK.shots);
    expect(r.medal).toBe(3);
    expect(r.score).toBeGreaterThanOrEqual((SCORE_ATTACK.medals ?? [0, 0, 0])[2]);
  });

  it('a level is not finished by accident: a wild miss completes nothing', () => {
    for (const level of CAMPAIGN) {
      const s = playScript(getLevel(level.id), [{ ball: 'standard', yaw: -35, pitch: 40, power: 1 }]);
      expect(s.result?.complete ?? false, level.id).toBe(false);
    }
  });
});
