import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../src/wreck/buildings';
import { PIECE_STANDING, WreckSim, prepare } from '../src/wreck/sim';

describe('every contract building', () => {
  for (const b of BUILDINGS) {
    it(`${b.name} stands on its own and stays up`, () => {
      const h = prepare(b.id);
      const sim = new WreckSim(undefined, h);
      expect(sim.solution.detached).toHaveLength(0);
      // Battle-damaged, but nothing more falls until the crew touches it.
      const before = h.def.pieces.filter((p) => sim.state.status[p.id] === PIECE_STANDING).length;
      expect(before).toBe(h.def.pieces.length - b.incident.gone.length);
      for (let i = 0; i < 360; i++) sim.step();
      const standing = h.def.pieces.filter((p) => sim.state.status[p.id] === PIECE_STANDING).length;
      expect(standing).toBe(before);
      expect(sim.state.bodies).toHaveLength(0);
      // Every incident label names a real piece, and the relics are on the lot.
      for (const l of [...b.incident.gone, ...b.incident.fires, ...b.incident.damaged.map((d) => d[0])]) expect(h.def.pieces.some((p) => p.label === l), l).toBe(true);
      for (const r of b.incident.relics) {
        expect(r.x).toBeGreaterThan(b.site.lotMin);
        expect(r.x).toBeLessThan(b.site.lotMax);
      }
      expect(sim.state.blocks.filter((x) => x.kind === 'relic')).toHaveLength(b.incident.relics.length);
      // Every piece label is unique (the Halden dock repeats its own): flaws, prizes and tests find pieces by label.
      if (b.id !== 'halden') expect(new Set(h.def.pieces.map((p) => p.label)).size).toBe(h.def.pieces.length);
      // Nothing generated sits outside the lot.
      expect(h.def.bounds.minX).toBeGreaterThan(b.site.lotMin);
      expect(h.def.bounds.maxX).toBeLessThan(b.site.lotMax);
    });
  }
});
