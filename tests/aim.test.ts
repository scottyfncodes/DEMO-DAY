import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../src/data/buildings';
import { Plan } from '../src/game/placement';
import { previewCharge } from '../src/game/preview';
import { Simulation } from '../src/sim/simulation';
import { CHARGE_SNAP, buildBuilding, chargeAtFromPoint, chargePoint, clampChargeAt } from '../src/structure/building';

const house = () => buildBuilding(BUILDINGS.house!);
const shed = () => buildBuilding(BUILDINGS.shed!);

describe('precise charge placement', () => {
  it('keeps the default strap point when no position is given', () => {
    const b = shed();
    const post = b.members.get('post_l')!;
    expect(chargePoint(post)).toEqual({ x: post.x + post.w / 2, y: post.y + post.h * 0.3 });
    const roof = b.members.get('roof')!;
    expect(chargePoint(roof)).toEqual({ x: roof.x + roof.w / 2, y: roof.y + roof.h / 2 });
  });

  it('slides along the long axis: up a column, across a beam', () => {
    const b = shed();
    const post = b.members.get('post_l')!;
    expect(chargePoint(post, 0.75).y).toBeCloseTo(post.y + post.h * 0.75);
    expect(chargePoint(post, 0.75).x).toBeCloseTo(post.x + post.w / 2);
    const roof = b.members.get('roof')!;
    expect(chargePoint(roof, 0.25).x).toBeCloseTo(roof.x + roof.w * 0.25);
    expect(chargePoint(roof, 0.25).y).toBeCloseTo(roof.y + roof.h / 2);
  });

  it('snaps a tap to a 10 cm grid and keeps clear of the ends', () => {
    const post = shed().members.get('post_l')!;
    const at = chargeAtFromPoint(post, post.x, 1.234);
    expect(at * post.h).toBeCloseTo(1.2, 5);
    expect(Math.abs((at * post.h) / CHARGE_SNAP - Math.round((at * post.h) / CHARGE_SNAP))).toBeLessThan(1e-6);
    expect(chargeAtFromPoint(post, post.x, -5) * post.h).toBeGreaterThanOrEqual(0.12 - 1e-9);
    expect(chargeAtFromPoint(post, post.x, 50) * post.h).toBeLessThanOrEqual(post.h - 0.12 + 1e-9);
    expect(clampChargeAt(post, Number.NaN)).toBeCloseTo(0.3);
  });

  it('stores the position on the plan and lets it move until the job is armed', () => {
    const plan = new Plan(shed(), { small: 2 });
    const r = plan.place('small', 'post_l', undefined, 0.8);
    expect(r.ok && r.charge.at).toBeCloseTo(0.8);
    const id = r.ok ? r.charge.id : '';
    expect(plan.setAt(id, 2)).toBe(true);
    expect(plan.charges[0]!.at).toBeLessThan(1);
    plan.lock();
    expect(plan.setAt(id, 0.5)).toBe(false);
    // Without a position the charge keeps the default point (old plans replay unchanged).
    const legacy = new Plan(shed(), { small: 1 }).place('small', 'post_r');
    expect(legacy.ok && legacy.charge.at).toBeUndefined();
  });

  it('moves the blast: a heavy charge high on the chimney reaches the upper floor, low reaches the ground floor', () => {
    const b = house();
    const low = previewCharge(b, [], 'heavy', 'chimney', 1, undefined, 0.1);
    const high = previewCharge(b, [], 'heavy', 'chimney', 1, undefined, 0.9);
    const ids = (p: typeof low): string[] => p.splash.map((s) => s.memberId);
    expect(ids(low)).toContain('p4');
    expect(ids(low)).not.toContain('r3');
    expect(ids(high)).toContain('r3');
    expect(ids(high)).not.toContain('p4');
  });

  it('runs the simulation from the placed point', () => {
    const b = house();
    const low = new Simulation(b, [{ id: 'a', type: 'heavy', memberId: 'chimney', at: 0.1 }]);
    const high = new Simulation(b, [{ id: 'a', type: 'heavy', memberId: 'chimney', at: 0.9 }]);
    low.step(1 / 60);
    high.step(1 / 60);
    const blast = (s: Simulation) => s.events.find((e) => e.type === 'detonate')!;
    expect(blast(high).y - blast(low).y).toBeCloseTo(b.members.get('chimney')!.h * 0.8, 5);
  });
});
