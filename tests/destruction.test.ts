import { describe, expect, it } from 'vitest';
import { getContract } from '../src/data/contracts';
import { kitFor } from '../src/data/fleet';
import { Job } from '../src/game/moves';
import { lotWork, siteStatus } from '../src/wreck/job';
import { HEIGHTMAP, PIECE_STANDING, prepare } from '../src/wreck/sim';
import type { PieceDef } from '../src/wreck/structure';

function job(id: string, loadout: Parameters<typeof Job.prototype.plan>[0][], upgrades: string[] = [], budgets?: Record<string, number>): Job {
  const c = getContract(id);
  return new Job(budgets ? { ...c, budgets } : c, loadout, prepare(c.building), kitFor(upgrades));
}

const piece = (j: Job, label: string): PieceDef => {
  const p = j.sim.def.pieces.find((q) => q.label === label);
  if (!p) throw new Error(label);
  return p;
};

const rubble = (j: Job): number => j.sim.state.heightmap.reduce((m, v) => m + v * HEIGHTMAP.cell, 0);

/** Brings the corner store down with one swing at its end pier. */
function collapsedStore(): Job {
  const j = job('corner', ['ball', 'dozer']);
  const a = piece(j, 'Column A · floor 1');
  expect(j.commit(j.plan('ball', a.x + a.w / 2, 1.6)).ok).toBe(true);
  j.settle();
  return j;
}

describe('destruction', () => {
  it('a swing damages what it hits and changes the structure', () => {
    const j = job('warehouse', ['ball']);
    const p = piece(j, 'Column A · floor 1');
    const before = j.sim.state.hp[p.id] as number;
    j.commit(j.plan('ball', p.x + p.w / 2, 1.5));
    j.settle();
    const after = j.sim.state.status[p.id] === PIECE_STANDING ? (j.sim.state.hp[p.id] as number) : 0;
    expect(after).toBeLessThan(before);
  });

  it('removing a key support brings down what depended on it', () => {
    const j = collapsedStore();
    const roof = piece(j, 'Roof A–B');
    expect(j.sim.state.status[roof.id]).not.toBe(PIECE_STANDING);
    expect(j.sim.standingFraction).toBeLessThan(0.5);
  });

  it('a hit far from the supports does far less than a hit on them', () => {
    const j = job('warehouse', ['ball']);
    const sign = piece(j, 'Brick bay E–F · floor 2');
    j.commit(j.plan('ball', sign.x + sign.w / 2, sign.y + 1.5));
    j.settle();
    expect(j.sim.standingFraction).toBeGreaterThan(0.8);
  });

  it('rubble stays on the lot after the collapse', () => {
    const j = collapsedStore();
    for (let i = 0; i < 900; i++) j.step();
    const heap = rubble(j);
    expect(heap).toBeGreaterThan(5);
    for (let i = 0; i < 600; i++) j.step();
    expect(rubble(j)).toBeCloseTo(heap, 0);
  });

  it('a dozer run moves rubble off the lot', () => {
    const j = collapsedStore();
    const before = lotWork(j.sim);
    const plan = j.plan('dozer', -1, 0, { dir: 1 });
    expect(plan.ok).toBe(true);
    expect(j.commit(plan).ok).toBe(true);
    j.settle();
    expect(lotWork(j.sim)).toBeLessThan(before * 0.75);
    expect(j.sim.state.tally.hauled).toBeGreaterThan(0);
  });

  it('the excavator breaks a slab too heavy for the dozer', () => {
    const j = job('parkade', ['excavator', 'charges'], [], { excavator: 6, charges: 6 });
    const s = j.sim.state;
    s.blocks.push({ id: 99, kind: 'slab', label: 'Core slab', material: 'concrete', x: 20, y: 0, w: 5, h: 1.2, mass: 40, hp: 520, maxHp: 520, area: 3, seed: 1 });
    // Clear the frame out of the way so the machine can drive in.
    for (const p of j.sim.def.pieces) s.status[p.id] = 2;
    s.standingMass = 0;
    s.dirty = true;
    const plan = j.plan('excavator', 20, 0.8);
    expect(plan.ok).toBe(true);
    j.commit(plan);
    j.settle();
    expect(s.blocks.some((b) => b.id === 99)).toBe(false);
    expect(s.blocks.filter((b) => b.kind === 'slab').every((b) => b.mass <= 20)).toBe(true);
  });

  it('the loader recovers salvage to the pad and it counts', () => {
    const j = job('house', ['loader'], ['loader-power-1'], { loader: 3 });
    const s = j.sim.state;
    for (const p of j.sim.def.pieces) s.status[p.id] = 2;
    s.standingMass = 0;
    s.dirty = true;
    const safe = s.blocks.find((b) => b.kind === 'vault');
    expect(safe).toBeDefined();
    s.blocks.push({ id: 98, kind: 'steel', label: 'Truss steel', material: 'steel', x: 4, y: 0, w: 3, h: 0.6, mass: 3, hp: 400, maxHp: 400, area: 0.6, seed: 2 });
    const plan = j.plan('loader', 4, 0);
    expect(plan.ok).toBe(true);
    expect(plan.scoop?.dumpTo).toBe('pad');
    j.commit(plan);
    j.settle();
    expect(s.tally.steelSalvaged).toBeCloseTo(3, 5);
    const safePlan = j.plan('loader', (safe as { x: number }).x, 0);
    expect(safePlan.ok).toBe(true);
    j.commit(safePlan);
    j.settle();
    expect(siteStatus(j.sim).vault).toBe('saved');
  });

  it('the base loader cannot lift what the heavy-lift arms can', () => {
    const base = job('house', ['loader']);
    base.sim.state.heightmap.fill(0);
    for (const p of base.sim.def.pieces) base.sim.state.status[p.id] = 2;
    base.sim.state.blocks.push({ id: 97, kind: 'steel', label: 'Truss steel', material: 'steel', x: 4, y: 0, w: 3, h: 0.6, mass: 12, hp: 400, maxHp: 400, area: 0, seed: 3 });
    expect(base.plan('loader', 4, 0).ok).toBe(false);
    const up = job('house', ['loader'], ['loader-power-1']);
    up.sim.state.heightmap.fill(0);
    for (const p of up.sim.def.pieces) up.sim.state.status[p.id] = 2;
    up.sim.state.blocks.push({ id: 97, kind: 'steel', label: 'Truss steel', material: 'steel', x: 4, y: 0, w: 3, h: 0.6, mass: 12, hp: 400, maxHp: 400, area: 0, seed: 3 });
    expect(up.plan('loader', 4, 0).ok).toBe(true);
  });

  it('a charge fired at the base of a tall stack topples it away from the cut side', () => {
    const j = job('stack', ['charges'], [], { charges: 3 });
    for (const label of ['Column A · floor 1', 'Stack A–B · floor 1']) {
      const p = piece(j, label);
      expect(j.commit(j.plan('charges', p.x + p.w / 2, 1, { piece: p.id })).ok).toBe(true);
    }
    j.commit(j.planDetonate());
    j.settle(40);
    const st = siteStatus(j.sim);
    expect(st.standing).toBeLessThan(0.5);
    expect(st.collateral).toBeLessThan(1);
  });
});
