import { HEIGHTMAP, PIECE_FALLING, PIECE_STANDING, heightAt, type Halden, type RootRecord, type WreckSim } from './sim';
import { vaultBlock, vaultProtected } from './tools';

/**
 * Where the job stands: pure reads of the simulation, so the screen, the
 * scoring and the tests always agree.
 */

/** Rubble-equivalent of one square metre of standing elevation. */
const BULK = 0.24;

export type VaultState = 'none' | 'inside' | 'buried' | 'exposed' | 'saved' | 'scrapped';

export interface SiteStatus {
  /** Share of the building's mass still standing (0..1). */
  standing: number;
  /** 0..1 of the lot's demolition work done (structure and rubble gone from the lot). */
  clear: number;
  vault: VaultState;
  vaultCondition: number;
  /** Rubble on the neighbour's side of the line (m²). */
  collateral: number;
  steelSalvaged: number;
  relicsSaved: number;
}

/** Rubble-equivalent of everything still on the lot: standing parts, sections, heaps and blocks. */
export function lotWork(sim: WreckSim): number {
  const s = sim.state;
  const L = sim.h.site;
  let w = 0;
  for (const p of sim.def.pieces) {
    if (s.status[p.id] === PIECE_STANDING) w += p.w * p.h * BULK;
  }
  for (const b of s.bodies) {
    if (b.state === 'rubble' || b.x < L.lotMin || b.x > L.lotMax) continue;
    for (const id of b.pieces) {
      if (id < 0 || s.status[id] !== PIECE_FALLING) continue;
      const p = sim.def.pieces[id];
      if (p) w += p.w * p.h * BULK;
    }
  }
  const hm = s.heightmap;
  const cell = HEIGHTMAP.cell;
  const i0 = Math.ceil((L.lotMin - HEIGHTMAP.minX) / cell);
  const i1 = Math.floor((L.lotMax - HEIGHTMAP.minX) / cell);
  for (let i = i0; i <= i1; i++) w += (hm[i] as number) * cell;
  for (const b of s.blocks) if (b.kind !== 'vault' && b.x > L.lotMin && b.x < L.lotMax) w += b.area;
  return w;
}

const startWork = new WeakMap<Halden, number>();

/** The lot's work before anything was touched. */
export function initialWork(sim: WreckSim): number {
  let w = startWork.get(sim.h);
  if (w === undefined) {
    w = 0;
    for (const p of sim.def.pieces) w += p.w * p.h * BULK;
    startWork.set(sim.h, w);
  }
  return w;
}

export function collateral(sim: WreckSim): number {
  const hm = sim.state.heightmap;
  const cell = HEIGHTMAP.cell;
  const nx = sim.h.site.neighbourX;
  let a = 0;
  for (let i = Math.ceil((nx - HEIGHTMAP.minX) / cell); i < hm.length; i++) a += (hm[i] as number) * cell;
  for (const b of sim.state.blocks) if (b.x > nx) a += b.area;
  return a;
}

export function vaultState(sim: WreckSim): VaultState {
  if (sim.h.vaultHome < 0) return 'none';
  const t = sim.state.tally;
  if (t.vaultSaved === -2) return 'scrapped';
  if (t.vaultSaved >= 0) return 'saved';
  if (sim.state.loader.carry?.kind === 'vault') return 'exposed';
  if (vaultProtected(sim)) return 'inside';
  const v = vaultBlock(sim);
  if (!v) return 'scrapped';
  return heightAt(sim.state.heightmap, v.x) > v.h * 0.75 ? 'buried' : 'exposed';
}

export function siteStatus(sim: WreckSim): SiteStatus {
  return {
    standing: sim.standingFraction,
    clear: Math.max(0, Math.min(1, 1 - lotWork(sim) / initialWork(sim))),
    vault: vaultState(sim),
    vaultCondition: sim.state.tally.vaultCondition,
    collateral: collateral(sim),
    steelSalvaged: sim.state.tally.steelSalvaged,
    relicsSaved: sim.state.tally.relicsSaved,
  };
}

export function roots(sim: WreckSim): RootRecord[] {
  return sim.state.roots.filter(Boolean) as RootRecord[];
}
