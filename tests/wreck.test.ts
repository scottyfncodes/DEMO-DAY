import { describe, expect, it } from 'vitest';
import { getContract } from '../src/data/contracts';
import { kitFor } from '../src/data/fleet';
import { crewMove } from '../src/game/crew';
import { Job } from '../src/game/moves';
import { solve } from '../src/wreck/solver';
import { PIECE_GONE, PIECE_STANDING, WreckSim, craneHook, halden } from '../src/wreck/sim';
import type { PieceDef } from '../src/wreck/structure';

const H = halden();
const byLabel = (label: string): PieceDef => {
  const p = H.def.pieces.find((q) => q.label === label);
  if (!p) throw new Error(`no piece ${label}`);
  return p;
};

function solveWithout(labels: string[]) {
  const n = H.def.pieces.length;
  const alive = new Uint8Array(n).fill(1);
  for (const l of labels) alive[byLabel(l).id] = 0;
  return solve(H.def, H.adj, {
    alive,
    jointOk: new Uint8Array(H.def.joints.length).fill(1),
    pieceCap: new Float32Array(H.def.pieces.map((p) => p.cap)),
    jointCap: new Float32Array(H.def.joints.map((j) => j.cap)),
  });
}

const maxOf = (a: Float32Array): number => a.reduce((m, v) => Math.max(m, v), 0);

/** Swings once from the current crane position, then lets the structure play out. */
function swing(sim: WreckSim, hookX: number, hookY: number, pullX: number, pullY: number, seconds = 6): void {
  sim.setHookTarget(hookX, hookY);
  sim.settleCrane();
  const hook = craneHook(sim.state.crane);
  sim.aim(hook.x + pullX, hook.y + pullY);
  sim.release();
  for (let i = 0; i < seconds * 60; i++) sim.step();
}

describe('structure and load solver', () => {
  it('stands comfortably when intact', () => {
    const r = solveWithout([]);
    expect(maxOf(r.pieceStress)).toBeLessThan(0.6);
    expect(maxOf(r.jointStress)).toBeLessThan(0.6);
    expect(r.detached).toHaveLength(0);
    expect(H.def.pieces.length).toBeGreaterThan(300);
  });

  it('bridges a single lost column but not two neighbours', () => {
    const one = solveWithout(['Column F · floor 1']);
    expect(maxOf(one.pieceStress)).toBeLessThan(1);
    const two = solveWithout(['Column F · floor 1', 'Column E · floor 1']);
    const overloaded = [...two.jointStress].filter((s) => s > 1).length + [...two.pieceStress].filter((s) => s > 1).length;
    expect(overloaded).toBeGreaterThan(5);
  });

  it('routes the lost load sideways to the neighbouring columns', () => {
    const intact = solveWithout([]);
    const cut = solveWithout(['Column F · floor 1']);
    const g = byLabel('Column G · floor 1').id;
    const e = byLabel('Column E · floor 1').id;
    expect(cut.load[g] as number).toBeGreaterThan((intact.load[g] as number) * 1.1);
    expect(cut.load[e] as number).toBeGreaterThan((intact.load[e] as number) * 1.1);
  });

  it('cuts loose whatever has no path to the ground', () => {
    const r = solveWithout(['Tank stand']);
    const tank = byLabel('Water tank').id;
    expect(r.detached.some((g) => g.includes(tank))).toBe(true);
  });
});

describe('wrecking ball simulation', () => {
  it('damages only the region it strikes', () => {
    const sim = new WreckSim();
    swing(sim, 12, 46, -14, -6, 3);
    const rec = sim.state.roots[1];
    expect(rec?.hitPiece).toBeGreaterThanOrEqual(0);
    const hit = H.def.pieces[rec?.hitPiece as number] as PieceDef;
    for (const p of H.def.pieces) {
      const lost = (sim.state.hp[p.id] as number) < p.hp;
      if (!lost || sim.state.status[p.id] !== PIECE_STANDING) continue;
      const d = Math.hypot(p.x + p.w / 2 - (hit.x + hit.w / 2), p.y + p.h / 2 - (hit.y + hit.h / 2));
      expect(d).toBeLessThan(8);
    }
  });

  it('is deterministic, so a swing replays identically from its snapshot', () => {
    const a = new WreckSim();
    a.setHookTarget(12, 46);
    a.settleCrane();
    const hook = craneHook(a.state.crane);
    a.aim(hook.x - 14, hook.y - 6);
    const snap = a.snapshot();
    a.release();
    for (let i = 0; i < 600; i++) a.step();
    const b = new WreckSim(snap);
    b.release();
    for (let i = 0; i < 600; i++) b.step();
    expect(b.state.standingMass).toBe(a.state.standingMass);
    expect([...b.state.hp]).toEqual([...a.state.hp]);
  });

  it('lets an overloaded column creep and fail later, blamed on the swing that weakened it', () => {
    const sim = new WreckSim();
    const col = byLabel('Column E · floor 9');
    // Knock most of the strength out of it in one go, as a hard hit would.
    sim.state.hp[col.id] = col.hp * 0.15;
    sim.state.lastRoot = 1;
    sim.state.roots[1] = { swing: 1, tool: 'ball', index: 1, chain: 0, charges: 0, hitPiece: col.id, hitEnergy: 1, hitSpeed: 1, hitX: 0, hitY: 0, hitT: 0, firstFailPiece: -1, firstFailKind: '', firstFailT: 0, mass: 0, peakMoving: 0, lastT: 0 };
    sim.state.dirty = true;
    sim.step();
    expect(sim.state.status[col.id]).toBe(PIECE_STANDING);
    let failedAt = -1;
    for (let i = 0; i < 600 && failedAt < 0; i++) {
      sim.step();
      if (sim.state.status[col.id] !== PIECE_STANDING) failedAt = sim.state.time;
    }
    expect(failedAt).toBeGreaterThan(0.2);
    expect(sim.state.roots[1]?.mass).toBeGreaterThan(0);
  });

  it('topples a block whose centre of mass passes its last footing', () => {
    const sim = new WreckSim();
    // Undercut the whole left of the building at street level.
    for (const p of H.def.pieces) {
      if (p.y === 0 && p.x < 27 && p.zone !== 'dock') sim.state.status[p.id] = PIECE_GONE;
    }
    sim.state.dirty = true;
    sim.step();
    const big = sim.state.bodies.reduce((m, b) => Math.max(m, b.mass), 0);
    expect(big).toBeGreaterThan(1000);
  });

  it('can be brought down by a player who aims for the loaded columns', () => {
    const job = new Job({ ...getContract('halden'), budgets: { ball: 18 } }, ['ball'], H, kitFor([]));
    for (let i = 0; i < 18 && job.sim.standingFraction > 0.12; i++) {
      job.settle();
      const plan = crewMove(job);
      if (!plan) break;
      job.commit(plan);
    }
    job.settle();
    const sim = job.sim;
    expect(sim.standingFraction).toBeLessThan(0.12);
    const decisive = sim.decisiveSwing();
    expect(decisive?.mass).toBeGreaterThan(H.def.totalMass * 0.15);
    expect(decisive?.hitPiece).toBeGreaterThanOrEqual(0);
  }, 60000);
});
