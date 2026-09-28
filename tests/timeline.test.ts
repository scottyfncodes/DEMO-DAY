import { describe, expect, it } from 'vitest';
import type { PlacedCharge } from '../src/core/types';
import { BUILDINGS } from '../src/data/buildings';
import { CONTRACTS } from '../src/data/contracts';
import { analyzeEvents, isNearPerfect, precomputeCollapse } from '../src/game/timeline';
import { Simulation, type SimEvent } from '../src/sim/simulation';
import { buildBuilding } from '../src/structure/building';

const shedPlan: PlacedCharge[] = [
  { id: 'a', type: 'small', memberId: 'post_l' },
  { id: 'b', type: 'small', memberId: 'post_r' },
];

describe('collapse timeline', () => {
  it('orders failures: blasted posts first, then the crushed centre post', () => {
    const building = buildBuilding(BUILDINGS.shed!);
    const { timeline } = precomputeCollapse(building, shedPlan);
    const first = timeline.failures.slice(0, 2).map((f) => f.memberId).sort();
    expect(first).toEqual(['post_l', 'post_r']);
    expect(timeline.failures[0]!.cause).toBe('blast');
    const centre = timeline.byMember.get('post_c');
    expect(centre).toBeDefined();
    expect(centre!.cause).not.toBe('blast');
    expect(centre!.t).toBeGreaterThan(0);
    expect(timeline.cascadeCount).toBeGreaterThan(0);
    for (let i = 1; i < timeline.failures.length; i++) {
      expect(timeline.failures[i]!.t).toBeGreaterThanOrEqual(timeline.failures[i - 1]!.t);
    }
  });

  it('matches the live simulation stepped frame by frame', () => {
    const building = buildBuilding(BUILDINGS.warehouse!);
    const plan: PlacedCharge[] = [
      { id: 'a', type: 'shaped', memberId: 'core' },
      { id: 'b', type: 'shaped', memberId: 'core' },
    ];
    const { timeline, result } = precomputeCollapse(building, plan);
    const live = new Simulation(building, plan);
    const events: SimEvent[] = [];
    while (!live.done) events.push(...live.step(1 / 60));
    expect(live.result()).toEqual(result);
    const replay = analyzeEvents(building, events);
    expect(replay.failures.map((f) => [f.memberId, f.cause, f.t])).toEqual(timeline.failures.map((f) => [f.memberId, f.cause, f.t]));
    expect(replay.peakChain).toBe(timeline.peakChain);
    expect(timeline.peakChain).toBeGreaterThanOrEqual(3);
  });

  it('does not change the plan it is given', () => {
    const building = buildBuilding(BUILDINGS.silo!);
    const plan: PlacedCharge[] = [{ id: 'a', type: 'directional', memberId: 'leg_l', direction: 'left' }];
    const copy = JSON.parse(JSON.stringify(plan));
    const a = precomputeCollapse(building, plan);
    const b = precomputeCollapse(building, plan);
    expect(plan).toEqual(copy);
    expect(a.result).toEqual(b.result);
    expect(a.timeline.settledBounds.minX).toBeLessThan(building.bounds.minX);
  });

  it('tags detonations with the charge that caused them', () => {
    const building = buildBuilding(BUILDINGS.silo!);
    const sim = new Simulation(building, [{ id: 'a', type: 'directional', memberId: 'leg_l', direction: 'left' }]);
    const events = sim.step(1 / 60);
    const det = events.find((e) => e.type === 'detonate');
    expect(det).toMatchObject({ chargeType: 'directional', direction: 'left', memberId: 'leg_l' });
  });

  it('builds a timeline for every contract building', () => {
    for (const c of CONTRACTS) {
      const building = buildBuilding(BUILDINGS[c.buildingId]!);
      const { timeline } = precomputeCollapse(building, []);
      expect(timeline.failures).toEqual([]);
      expect(timeline.peakChain).toBe(0);
    }
  });

  it('only calls a clean, gravity-driven sweep near-perfect', () => {
    expect(isNearPerfect(1, 0.8)).toBe(true);
    expect(isNearPerfect(0.97, 0.9)).toBe(false);
    expect(isNearPerfect(1, 0.3)).toBe(false);
  });
});
