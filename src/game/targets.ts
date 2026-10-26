import type { MachineId } from '../data/fleet';
import { HEIGHTMAP, PIECE_STANDING, type WreckSim } from '../wreck/sim';
import type { PieceDef } from '../wreck/structure';
import { BLADE, BLADE_H, CHARGE_KINDS, DOZER_HALF, LOADER_REACH, travelLimits } from '../wreck/tools';

/**
 * What a selected machine can be pointed at right now, so the site can show
 * it before the player taps, and an imprecise tap can snap to the nearest one.
 * Cheap reads only: the full preview is still worked out by the move planner.
 */

export interface Target {
  /** World point to plan at (on the building face, or on the ground). */
  x: number;
  y: number;
  /** The building part, for outlined targets. */
  piece?: number;
  /** Ground targets get a marker on the ground instead of an outline. */
  ground: boolean;
  /** Worth money: drawn gold. */
  valuable?: boolean;
}

export function targetsFor(sim: WreckSim, machine: MachineId): Target[] {
  const s = sim.state;
  const kit = s.kit;
  const pieces = sim.def.pieces.filter((p) => s.status[p.id] === PIECE_STANDING);
  const centre = (p: PieceDef, fy = 0.5): Target => ({ x: p.x + p.w / 2, y: p.y + Math.min(p.h * fy, 2), piece: p.id, ground: false });
  switch (machine) {
    case 'ball':
      // Load-bearing parts the boom can reach.
      return pieces.filter((p) => p.carriesOthers && !p.horizontal && p.y + 0.5 <= kit.ballReach).map((p) => centre(p));
    case 'charges':
      return pieces.filter((p) => CHARGE_KINDS.has(p.kind) && !p.horizontal).map((p) => centre(p, 0.35));
    case 'excavator': {
      const reach = 3.4 + s.exc.l1 + s.exc.l2 - 2.5;
      const out: Target[] = pieces.filter((p) => p.carriesOthers && !p.horizontal && p.y < reach - 2).map((p) => centre(p));
      for (const b of s.blocks) if (b.kind === 'slab' && b.mass > kit.heavyPush) out.push({ x: b.x, y: b.y + b.h / 2, ground: false });
      return out;
    }
    case 'dozer': {
      // Only heaps the dozer can get behind from one side or the other.
      const lim = travelLimits(sim, s.dozer.x, DOZER_HALF, BLADE_H);
      const back = DOZER_HALF + BLADE + 0.4;
      const reachable = (x: number): boolean => [x - back, x + back].some((st) => st >= lim.min - 0.3 && st <= lim.max + 0.3);
      const out: Target[] = heaps(sim)
        .filter((h) => reachable(h.x))
        .map((h) => ({ x: h.x, y: 0, ground: true }));
      for (const b of s.blocks) {
        if (b.mass > kit.heavyPush || b.x < sim.h.site.lotMin - 2 || b.x > sim.h.site.lotMax + 2 || !reachable(b.x)) continue;
        if (!out.some((t) => Math.abs(t.x - b.x) < 3)) out.push({ x: b.x, y: 0, ground: true, valuable: b.kind !== 'slab' });
      }
      return out;
    }
    case 'loader': {
      const out: Target[] = [];
      // Only what the loader can actually drive up to.
      const lim = travelLimits(sim, s.loader.x, 2.4, 2);
      const reachable = (x: number): boolean => {
        const stand = x - (x >= s.loader.x ? 1 : -1) * LOADER_REACH;
        return stand >= lim.min - 0.3 && stand <= lim.max + 0.3;
      };
      for (const b of s.blocks) {
        if (b.mass > kit.lift || !reachable(b.x)) continue;
        out.push({ x: b.x, y: 0, ground: true, valuable: b.kind === 'relic' || b.kind === 'vault' || b.kind === 'steel' });
      }
      for (const h of heaps(sim)) if (reachable(h.x) && !out.some((t) => Math.abs(t.x - h.x) < 3)) out.push({ x: h.x, y: 0, ground: true });
      return out;
    }
  }
}

/** Rubble heaps on site: the middle of each run of ground with real rubble on it. */
export function heaps(sim: WreckSim): Array<{ x: number; area: number }> {
  const hm = sim.state.heightmap;
  const L = sim.h.site;
  const out: Array<{ x: number; area: number }> = [];
  let start = -1;
  let area = 0;
  let peakX = 0;
  let peak = 0;
  for (let i = 0; i <= hm.length; i++) {
    const x = HEIGHTMAP.minX + i * HEIGHTMAP.cell;
    const h = i < hm.length && x > L.lotMin - 2 && x < L.lotMax + 2 ? (hm[i] as number) : 0;
    if (h > 0.12) {
      if (start < 0) {
        start = i;
        area = 0;
        peak = 0;
      }
      area += h * HEIGHTMAP.cell;
      if (h > peak) {
        peak = h;
        peakX = x;
      }
    } else if (start >= 0) {
      if (area > 0.5) out.push({ x: peakX, area });
      start = -1;
    }
  }
  return out;
}
