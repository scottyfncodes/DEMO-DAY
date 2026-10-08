import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../src/data/buildings';
import { CONTRACTS } from '../src/data/contracts';
import { SHOWCASE_PLANS, showcasePlan } from '../src/data/showcase';
import { Simulation } from '../src/sim/simulation';
import { buildBuilding } from '../src/structure/building';

// The title screen loops a real demolition of the next job's building.
// It has to actually come down, or the opening shot is a dud.
describe('title screen showcase plans', () => {
  it('has a plan for every contract building', () => {
    for (const c of CONTRACTS) expect(SHOWCASE_PLANS[c.buildingId], c.buildingId).toBeDefined();
  });

  it('only places charges on members that exist', () => {
    for (const [id, plan] of Object.entries(SHOWCASE_PLANS)) {
      const building = buildBuilding(BUILDINGS[id]!);
      for (const c of plan) expect(building.members.has(c.memberId), `${id}:${c.memberId}`).toBe(true);
    }
  });

  it('brings most of each building down', () => {
    for (const id of Object.keys(SHOWCASE_PLANS)) {
      const building = buildBuilding(BUILDINGS[id]!);
      const result = new Simulation(building, showcasePlan(id)).runToEnd();
      expect(result.removedMass / result.targetMass, id).toBeGreaterThan(0.6);
    }
  });

  it('falls back to the shed for an unknown building', () => {
    expect(showcasePlan('nope').map((c) => c.memberId)).toEqual(['post_l', 'post_r']);
  });
});
