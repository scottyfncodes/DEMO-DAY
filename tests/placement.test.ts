import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../src/data/buildings';
import { effectiveLoadout, powerMultiplier } from '../src/data/equipment';
import { Plan } from '../src/game/placement';
import { previewCharge } from '../src/game/preview';
import { buildBuilding } from '../src/structure/building';

const shed = () => buildBuilding(BUILDINGS.shed!);

describe('charge inventory and placement', () => {
  it('enforces the finite loadout per charge type', () => {
    const plan = new Plan(shed(), { small: 2 });
    expect(plan.place('small', 'post_l').ok).toBe(true);
    expect(plan.place('small', 'post_r').ok).toBe(true);
    const third = plan.place('small', 'post_c');
    expect(third.ok).toBe(false);
    expect(plan.remaining('small')).toBe(0);
    expect(plan.place('heavy', 'post_c').ok).toBe(false);
    expect(plan.totalUsed()).toBe(2);
    expect(plan.totalAvailable()).toBe(2);
  });

  it('allows stacking several charges on one member', () => {
    const plan = new Plan(shed(), { small: 3 });
    expect(plan.place('small', 'post_c').ok).toBe(true);
    expect(plan.place('small', 'post_c').ok).toBe(true);
    expect(plan.chargesOn('post_c')).toHaveLength(2);
  });

  it('removes and repositions charges during planning', () => {
    const plan = new Plan(shed(), { small: 1 });
    const r = plan.place('small', 'post_l');
    expect(r.ok).toBe(true);
    expect(plan.remaining('small')).toBe(0);
    expect(plan.removeLastOn('post_l')).toBe(true);
    expect(plan.remaining('small')).toBe(1);
    expect(plan.place('small', 'post_r').ok).toBe(true);
    expect(plan.chargesOn('post_r')).toHaveLength(1);
  });

  it('rejects unknown members and protected members', () => {
    const plan = new Plan(shed(), { small: 1 });
    expect(plan.place('small', 'nope').ok).toBe(false);
    const mill = new Plan(buildBuilding(BUILDINGS.mill!), { small: 1 });
    const res = mill.place('small', 'bh_wall_l');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/Protected/);
  });

  it('locks placements once armed', () => {
    const plan = new Plan(shed(), { small: 2 });
    plan.place('small', 'post_l');
    plan.lock();
    expect(plan.place('small', 'post_r').ok).toBe(false);
    expect(plan.removeLastOn('post_l')).toBe(false);
    expect(plan.charges).toHaveLength(1);
  });

  it('defaults directional charges to a direction and lets it change', () => {
    const plan = new Plan(buildBuilding(BUILDINGS.silo!), { directional: 1 });
    const r = plan.place('directional', 'leg_l');
    expect(r.ok && r.charge.direction).toBe('left');
    if (r.ok) {
      expect(plan.setDirection(r.charge.id, 'right')).toBe(true);
      expect(plan.charges[0]?.direction).toBe('right');
    }
  });
});

describe('equipment effects on the loadout', () => {
  it('adds charges for owned kits', () => {
    const base = { small: 3 };
    expect(effectiveLoadout(base, [])).toEqual({ small: 3 });
    expect(effectiveLoadout(base, ['directional_kit', 'shaped_kit'])).toEqual({ small: 3, directional: 1, shaped: 1 });
    expect(effectiveLoadout({ small: 3, heavy: 1 }, ['heavy_kit'])).toEqual({ small: 3, heavy: 2 });
  });

  it('boosts power with the high-yield blend', () => {
    expect(powerMultiplier([])).toBe(1);
    expect(powerMultiplier(['high_yield'])).toBeCloseTo(1.2);
  });
});

describe('placement preview', () => {
  it('predicts direct breaks and splash without predicting the collapse', () => {
    const b = shed();
    const p = previewCharge(b, [], 'small', 'post_l');
    expect(p.target.destroyed).toBe(true);
    expect(p.summary).toMatch(/Breaks Left Post/);
    const roofSplash = p.splash.find((s) => s.memberId === 'roof');
    expect(roofSplash).toBeUndefined();
  });

  it('accounts for charges already planned on the same member', () => {
    const silo = buildBuilding(BUILDINGS.silo!);
    const one = previewCharge(silo, [], 'small', 'leg_l');
    expect(one.target.destroyed).toBe(false);
    const two = previewCharge(silo, [{ id: 'x', type: 'small', memberId: 'leg_l' }], 'small', 'leg_l');
    expect(two.target.destroyed).toBe(true);
  });

  it('warns about neighbours, protected members and push direction', () => {
    const garage = buildBuilding(BUILDINGS.garage!);
    const p = previewCharge(garage, [], 'heavy', 'wall_r');
    expect(p.warnings.some((w) => /House/.test(w))).toBe(true);
    const mill = buildBuilding(BUILDINGS.mill!);
    const q = previewCharge(mill, [], 'heavy', 's1');
    expect(q.warnings.some((w) => /protected/i.test(w))).toBe(true);
    const d = previewCharge(mill, [], 'directional', 's1', 1, 'left');
    expect(d.warnings.some((w) => /to the left/.test(w))).toBe(true);
  });
});
