import { describe, expect, it } from 'vitest';
import type { PlacedCharge } from '../src/core/types';
import { BUILDINGS } from '../src/data/buildings';
import { CONTRACTS, getContract } from '../src/data/contracts';
import { collateralFraction, destructionFraction, efficiencyFraction, footprintFraction, scoreRun } from '../src/game/scoring';
import { Simulation } from '../src/sim/simulation';
import { buildBuilding } from '../src/structure/building';

function run(buildingId: string, charges: Array<Omit<PlacedCharge, 'id'>>) {
  const building = buildBuilding(BUILDINGS[buildingId]!);
  const placed = charges.map((c, i) => ({ ...c, id: `c${i}` }));
  const sim = new Simulation(building, placed);
  const result = sim.runToEnd();
  return { sim, result, building, placed };
}

describe('collapse simulation', () => {
  it('is deterministic for the same placement', () => {
    const a = run('shed', [{ type: 'small', memberId: 'post_l' }, { type: 'small', memberId: 'post_r' }]);
    const b = run('shed', [{ type: 'small', memberId: 'post_l' }, { type: 'small', memberId: 'post_r' }]);
    expect(a.result).toEqual(b.result);
    expect(a.sim.chunks.map((c) => [c.id, c.state, +c.cx.toFixed(4), +c.cy.toFixed(4)])).toEqual(
      b.sim.chunks.map((c) => [c.id, c.state, +c.cx.toFixed(4), +c.cy.toFixed(4)]),
    );
  });

  it('does nothing without charges', () => {
    const { result } = run('shed', []);
    expect(destructionFraction(result)).toBe(0);
    expect(Object.values(result.memberOutcome).every((o) => o === 'standing')).toBe(true);
  });

  it('breaks a timber post with a small charge and drops the roof it carried', () => {
    const { result } = run('shed', [{ type: 'small', memberId: 'post_l' }]);
    expect(result.memberOutcome.post_l).toBe('destroyed');
    expect(result.memberOutcome.post_r).toBe('standing');
    expect(['fallen', 'destroyed', 'resting']).toContain(result.memberOutcome.roof);
  });

  it('crushes the rotten centre post under the roof once the outer posts go', () => {
    const { result } = run('shed', [{ type: 'small', memberId: 'post_l' }, { type: 'small', memberId: 'post_r' }]);
    expect(result.memberOutcome.post_c).toBe('destroyed');
    expect(destructionFraction(result)).toBeCloseTo(1, 5);
    // Gravity did most of the work: only two posts were blasted.
    expect(efficiencyFraction(result)).toBeGreaterThan(0.6);
  });

  it('does not let a small charge break a concrete column', () => {
    const { result } = run('warehouse', [{ type: 'small', memberId: 'c1_2' }]);
    expect(result.memberOutcome.c1_2).toBe('standing');
  });

  it('leaves the stair core standing after one shaped charge but not two', () => {
    const one = run('warehouse', [{ type: 'shaped', memberId: 'core' }]);
    expect(one.result.memberOutcome.core).toBe('standing');
    const two = run('warehouse', [{ type: 'shaped', memberId: 'core' }, { type: 'shaped', memberId: 'core' }]);
    expect(two.result.memberOutcome.core).toBe('destroyed');
    expect(destructionFraction(two.result)).toBeGreaterThan(0.9);
  });

  it('cascades: removing ground columns drops every floor above them', () => {
    const { result } = run('warehouse', [{ type: 'heavy', memberId: 'c1_2' }, { type: 'heavy', memberId: 'c1_3' }]);
    expect(result.memberOutcome.c1_2).toBe('destroyed');
    for (const id of ['c2_2', 'c3_2', 's1_A', 's2_B', 's3_C']) {
      expect(result.memberOutcome[id], id).not.toBe('standing');
    }
    expect(result.memberOutcome.core).toBe('standing');
    expect(destructionFraction(result)).toBeGreaterThan(0.6);
    expect(destructionFraction(result)).toBeLessThan(0.9);
  });

  it('respects the lean: dropping the silo straight sends it onto the highway', () => {
    const { result } = run('silo', [
      { type: 'directional', memberId: 'leg_l', direction: 'right' },
      { type: 'small', memberId: 'leg_r' },
      { type: 'small', memberId: 'leg_r' },
    ]);
    expect(result.neighborHits.highway ?? 0).toBeGreaterThan(0);
    expect(footprintFraction(result)).toBeLessThan(0.5);
  });

  it('directional charge lays the silo down inside the zone', () => {
    const { result } = run('silo', [{ type: 'directional', memberId: 'leg_l', direction: 'left' }]);
    expect(result.neighborHits.highway ?? 0).toBe(0);
    expect(footprintFraction(result)).toBeGreaterThan(0.85);
    expect(destructionFraction(result)).toBeGreaterThan(0.9);
  });

  it('protected structures fail the job when the stack falls on them', () => {
    const bad = run('mill', [{ type: 'small', memberId: 's1' }, { type: 'small', memberId: 's1' }]);
    expect(bad.result.protectedFailed.length).toBeGreaterThan(0);
    const good = run('mill', [{ type: 'directional', memberId: 's1', direction: 'left' }]);
    expect(good.result.protectedFailed).toEqual([]);
    expect(destructionFraction(good.result)).toBeGreaterThan(0.85);
  });

  it('records where debris lands and what it hits', () => {
    const { result } = run('shed', [{ type: 'small', memberId: 'post_l' }, { type: 'small', memberId: 'post_c' }, { type: 'small', memberId: 'post_r' }]);
    expect(result.landedInside + result.landedOutside).toBeGreaterThan(0);
    expect(footprintFraction(result)).toBeGreaterThan(0.9);
    expect(collateralFraction(result)).toBeLessThan(0.05);
  });

  it('finishes within the time cap and reports a duration', () => {
    const { result } = run('house', [{ type: 'heavy', memberId: 'p2' }]);
    expect(result.duration).toBeGreaterThan(1);
    expect(result.duration).toBeLessThanOrEqual(28.1);
  });

  it('applies the power multiplier from equipment', () => {
    const building = buildBuilding(BUILDINGS.garage!);
    const charges: PlacedCharge[] = [{ id: 'a', type: 'small', memberId: 'wall_l' }];
    const weak = new Simulation(building, charges, { powerMultiplier: 0.5 }).runToEnd();
    expect(weak.memberOutcome.wall_l).toBe('standing');
    const base = new Simulation(building, charges).runToEnd();
    expect(base.memberOutcome.wall_l).toBe('destroyed');
  });

  it('a blast-weakened column gives way under the load it carries', () => {
    const { result } = run('silo', [{ type: 'small', memberId: 'leg_r' }, { type: 'small', memberId: 'leg_r' }]);
    expect(result.memberOutcome.leg_r).toBe('destroyed');
    expect(result.blastMass).toBe(0);
  });
});

describe('contract requirements', () => {
  it('every contract has at least one winning plan', () => {
    const plans: Record<string, Array<Omit<PlacedCharge, 'id'>>> = {
      job01: [{ type: 'small', memberId: 'post_l' }, { type: 'small', memberId: 'post_r' }],
      job02: [{ type: 'heavy', memberId: 'wall_l' }, { type: 'small', memberId: 'pier' }],
      job03: [{ type: 'directional', memberId: 'leg_l', direction: 'left' }],
      job04: [{ type: 'heavy', memberId: 'chimney' }, { type: 'small', memberId: 'p1' }, { type: 'small', memberId: 'p2' }, { type: 'small', memberId: 'p3' }],
      job05: [{ type: 'directional', memberId: 's1', direction: 'left' }],
      job06: [{ type: 'shaped', memberId: 'core' }, { type: 'shaped', memberId: 'core' }],
    };
    for (const contract of CONTRACTS) {
      const plan = plans[contract.id];
      expect(plan, `no plan for ${contract.id}`).toBeDefined();
      const { result } = run(contract.buildingId, plan!);
      const available = Object.values(contract.loadout).reduce((a, b) => a + (b ?? 0), 0);
      const report = scoreRun(result, contract, plan!.length, available);
      expect(report.success, `${contract.id} should succeed: ${JSON.stringify(report.requirements)}`).toBe(true);
      expect(plan!.length).toBeLessThanOrEqual(available);
    }
  });

  it('fails a contract when destruction is under the requirement', () => {
    const contract = getContract('job01');
    const { result } = run('shed', [{ type: 'small', memberId: 'post_c' }]);
    const report = scoreRun(result, contract, 1, 3);
    expect(report.success).toBe(false);
    expect(report.requirements.find((r) => r.id === 'destruction')?.met).toBe(false);
  });

  it('fails a controlled collapse that misses the landing zone', () => {
    const contract = getContract('job03');
    const { result } = run('silo', [
      { type: 'directional', memberId: 'leg_l', direction: 'right' },
      { type: 'small', memberId: 'leg_r' },
      { type: 'small', memberId: 'leg_r' },
    ]);
    const report = scoreRun(result, contract, 3, 3);
    expect(report.success).toBe(false);
    expect(report.requirements.find((r) => r.id === 'footprint')?.met).toBe(false);
    expect(report.requirements.find((r) => r.id === 'collateral')?.met).toBe(false);
  });

  it('fails a selective demolition when the protected structure is hit', () => {
    const contract = getContract('job05');
    const { result } = run('mill', [{ type: 'heavy', memberId: 's1' }]);
    const report = scoreRun(result, contract, 1, 5);
    expect(report.success).toBe(false);
    expect(report.requirements.find((r) => r.id === 'protected')?.met).toBe(false);
  });
});
