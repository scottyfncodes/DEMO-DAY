import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../src/wreck/buildings';
import { PIECE_STANDING, WreckSim, prepare } from '../src/wreck/sim';

describe('every contract building', () => {
  for (const b of BUILDINGS) {
    it(`${b.name} stands on its own and stays up`, () => {
      const h = prepare(b.id);
      const sim = new WreckSim(undefined, h);
      expect(sim.solution.detached).toHaveLength(0);
      const maxStress = Math.max(...sim.solution.pieceStress, ...sim.solution.jointStress);
      expect(maxStress).toBeLessThan(0.75);
      for (let i = 0; i < 240; i++) sim.step();
      const standing = h.def.pieces.filter((p) => sim.state.status[p.id] === PIECE_STANDING).length;
      expect(standing).toBe(h.def.pieces.length);
      // Every piece label is unique (the Halden dock repeats its own): flaws, prizes and tests find pieces by label.
      if (b.id !== 'halden') expect(new Set(h.def.pieces.map((p) => p.label)).size).toBe(h.def.pieces.length);
      // Nothing generated sits outside the lot.
      expect(h.def.bounds.minX).toBeGreaterThan(b.site.lotMin);
      expect(h.def.bounds.maxX).toBeLessThan(b.site.lotMax);
    });
  }
});
