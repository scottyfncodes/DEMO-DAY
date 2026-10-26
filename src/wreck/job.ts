import { HEIGHTMAP, PIECE_FALLING, PIECE_STANDING, heightAt, type RootRecord, type WreckSim } from './sim';
import { SITE_LAYOUT, vaultBlock, vaultProtected } from './tools';

/**
 * The job: what has to be done, how it is going, and what it scored.
 * Pure reads of the simulation, so the screen and the tests agree.
 */

/** Below this share of the building still standing, it counts as down. */
export const DOWN_AT = 0.12;
/** Share of the lot that has to be cleared to sign the job off. */
export const CLEAR_AT = 0.88;
/** Clock seconds: finish inside par for a time bonus; the shift ends the job. */
export const PAR = 300;
export const SHIFT = 540;
const BULK = 0.12;

export type VaultState = 'inside' | 'buried' | 'exposed' | 'saved' | 'scrapped';

export interface JobStatus {
  standing: number;
  down: boolean;
  /** 0..1 of the lot's demolition work done (structure and rubble gone from the lot). */
  clear: number;
  cleared: boolean;
  vault: VaultState;
  vaultCondition: number;
  /** Rubble on Pellow's side of the line (m²). */
  collateral: number;
  complete: boolean;
  clock: number;
  overtime: boolean;
}

let startWork = 0;

/** Rubble-equivalent of everything still on the lot: standing parts, sections, heaps and blocks. */
export function lotWork(sim: WreckSim): number {
  const s = sim.state;
  const L = SITE_LAYOUT;
  let w = 0;
  for (const p of sim.def.pieces) {
    const st = s.status[p.id];
    if (st === PIECE_STANDING) w += p.w * p.h * BULK;
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

function initialWork(sim: WreckSim): number {
  if (!startWork) {
    for (const p of sim.def.pieces) startWork += p.w * p.h * BULK;
  }
  return startWork;
}

export function collateral(sim: WreckSim): number {
  const hm = sim.state.heightmap;
  const cell = HEIGHTMAP.cell;
  let a = 0;
  for (let i = Math.ceil((SITE_LAYOUT.neighbourX - HEIGHTMAP.minX) / cell); i < hm.length; i++) a += (hm[i] as number) * cell;
  for (const b of sim.state.blocks) if (b.x > SITE_LAYOUT.neighbourX) a += b.area;
  return a;
}

export function vaultState(sim: WreckSim): VaultState {
  const t = sim.state.tally;
  if (t.vaultSaved === -2) return 'scrapped';
  if (t.vaultSaved >= 0) return 'saved';
  if (vaultProtected(sim)) return 'inside';
  const v = vaultBlock(sim);
  if (!v) return 'scrapped';
  return heightAt(sim.state.heightmap, v.x) > v.h * 0.75 ? 'buried' : 'exposed';
}

export function jobStatus(sim: WreckSim): JobStatus {
  const standing = sim.standingFraction;
  const down = standing <= DOWN_AT;
  const clear = Math.max(0, Math.min(1, 1 - lotWork(sim) / initialWork(sim)));
  const cleared = clear >= CLEAR_AT;
  const clock = sim.clock;
  return {
    standing,
    down,
    clear,
    cleared,
    vault: vaultState(sim),
    vaultCondition: sim.state.tally.vaultCondition,
    collateral: collateral(sim),
    complete: down && cleared,
    clock,
    overtime: clock >= SHIFT,
  };
}

export interface ScoreLine {
  key: string;
  label: string;
  detail: string;
  points: number;
}

export interface Feat {
  id: string;
  name: string;
  how: string;
  earned: boolean;
}

export interface JobScore {
  lines: ScoreLine[];
  total: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  feats: Feat[];
  bestChain: number;
  status: JobStatus;
}

export const GRADES: Array<{ grade: JobScore['grade']; min: number }> = [
  { grade: 'S', min: 13000 },
  { grade: 'A', min: 10500 },
  { grade: 'B', min: 8000 },
  { grade: 'C', min: 5000 },
  { grade: 'D', min: -Infinity },
];

export function roots(sim: WreckSim): RootRecord[] {
  return sim.state.roots.filter(Boolean) as RootRecord[];
}

export function scoreJob(sim: WreckSim): JobScore {
  const st = jobStatus(sim);
  const s = sim.state;
  const t = s.tally;
  const rs = roots(sim);
  const lines: ScoreLine[] = [];
  const add = (key: string, label: string, detail: string, points: number): void => {
    if (Math.round(points) !== 0) lines.push({ key, label, detail, points: Math.round(points) });
  };
  const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
  const down = rs.reduce((m, r) => m + r.mass, 0);
  add('down', 'Brought down', `${fmt(down)} t`, down);
  let chainPts = 0;
  let bestChain = 0;
  for (const r of rs) {
    // A long chain is worth up to half again what it brought down.
    chainPts += r.mass * Math.min(0.5, r.chain * 0.02);
    bestChain = Math.max(bestChain, r.chain);
  }
  add('chain', 'Chain reactions', `best ×${bestChain}`, chainPts);
  add('flaws', 'Weak points used', `${t.flawsExploited}`, t.flawsExploited * 250);
  add('ballFired', 'Charges set off by the ball', `${t.ballFired}`, t.ballFired * 400);
  add('sympathy', 'Charges set off by debris', `${t.debrisFired + t.chainFired}`, (t.debrisFired + t.chainFired) * 200);
  if (st.down) add('clear', 'Lot cleared', `${Math.round(st.clear * 100)}%`, st.clear * 3000);
  add('steel', 'Steel salvaged', `${fmt(t.steelSalvaged)} t`, t.steelSalvaged * 30);
  if (t.vaultSaved >= 0) add('vault', 'Vault recovered', `${Math.round(t.vaultSaved * 100)}% intact`, 2500 * t.vaultSaved);
  const unused = s.chargesLeft.cutter + s.chargesLeft.blast + s.charges.filter((c) => c.state === 0).length;
  if (st.down) add('unused', 'Charges left over', `${unused}`, unused * 200);
  if (st.complete) add('time', 'Under par', `${fmtClock(Math.max(0, PAR - st.clock))} spare`, Math.max(0, PAR - st.clock) * 6);
  add('collateral', 'Debris on Pellow’s', `${st.collateral.toFixed(1)} m²`, -st.collateral * 60);
  add('machines', 'Machines hit', `${t.machineHits}`, -t.machineHits * 300);
  const total = lines.reduce((m, l) => m + l.points, 0);
  const grade = (GRADES.find((g) => total >= g.min) as (typeof GRADES)[number]).grade;
  const used = (tool: RootRecord['tool']): boolean => rs.some((r) => r.tool === tool);
  const feats: Feat[] = [
    { id: 'clean', name: 'Clean lot', how: 'Clear 98% of the lot', earned: st.clear >= 0.98 },
    { id: 'vault', name: 'Safe cracker', how: 'Recover the vault 90% intact', earned: t.vaultSaved >= 0.9 },
    { id: 'neighbour', name: 'Good neighbour', how: 'Bring it down with nothing on Pellow’s', earned: st.down && st.collateral < 0.5 },
    { id: 'chain', name: 'Domino', how: 'One swing sets off a chain of 30', earned: rs.some((r) => r.tool === 'ball' && r.chain >= 30) },
    { id: 'ballOnly', name: 'Old school', how: 'Bring it down without charges', earned: st.down && t.chargesFired === 0 },
    { id: 'noBall', name: 'Blaster', how: 'Bring it down without a swing', earned: st.down && !used('ball') },
    { id: 'sympathy', name: 'Detonator', how: 'Set off a charge with the ball', earned: t.ballFired > 0 },
    { id: 'par', name: 'On the clock', how: `Finish the job inside ${fmtClock(PAR)}`, earned: st.complete && st.clock <= PAR },
  ];
  return { lines, total, grade, feats, bestChain, status: st };
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
