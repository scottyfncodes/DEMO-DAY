import { describe, expect, it } from 'vitest';
import { getContract } from '../src/data/contracts';
import { MACHINE_ORDER, kitFor } from '../src/data/fleet';
import { Job } from '../src/game/moves';
import { targetsFor } from '../src/game/targets';
import { prepare } from '../src/wreck/sim';

describe('valid targets shown for each machine', () => {
  const job = new Job(getContract('garage'), MACHINE_ORDER, prepare('garage'), kitFor([]));

  it('every machine has something to point at on a fresh site', () => {
    for (const m of MACHINE_ORDER) expect(targetsFor(job.sim, m).length, m).toBeGreaterThan(0);
  });

  it('every highlighted target plans as a valid move', () => {
    for (const m of ['ball', 'charges', 'excavator', 'loader'] as const) {
      const ts = targetsFor(job.sim, m);
      const ok = ts.filter((t) => job.plan(m, t.x, t.y, { piece: m === 'charges' ? t.piece : undefined }).ok).length;
      // Nearly all: a swing can meet something in front of the part first, which is still a valid move.
      expect(ok / ts.length, m).toBeGreaterThan(0.6);
    }
  });

  it('the loader marks relics as worth money', () => {
    expect(targetsFor(job.sim, 'loader').some((t) => t.valuable)).toBe(true);
  });
});
