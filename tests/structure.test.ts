import { describe, expect, it } from 'vitest';
import type { BuildingDef } from '../src/core/types';
import { BUILDINGS } from '../src/data/buildings';
import { memberStats } from '../src/data/materials';
import { buildBuilding, dependents } from '../src/structure/building';
import { computeLoads, evaluateSupport, findCrushed } from '../src/structure/support';

const PORTAL: BuildingDef = {
  id: 'portal',
  name: 'Portal frame',
  floors: 1,
  materials: 'Timber',
  footprint: { x: -1, w: 6 },
  members: [
    { id: 'a', kind: 'column', material: 'wood', x: 0, y: 0, w: 0.3, h: 3 },
    { id: 'b', kind: 'column', material: 'wood', x: 2, y: 0, w: 0.3, h: 3 },
    { id: 'c', kind: 'column', material: 'wood', x: 4, y: 0, w: 0.3, h: 3 },
    { id: 'beam', kind: 'beam', material: 'wood', x: -0.2, y: 3, w: 4.7, h: 0.3 },
    { id: 'upper', kind: 'column', material: 'wood', x: 2, y: 3.3, w: 0.3, h: 2 },
    { id: 'siding', kind: 'wall', material: 'wood', x: 0.3, y: 0, w: 1.7, h: 3, anchors: ['a', 'b'] },
  ],
};

describe('building graph', () => {
  it('derives support links from geometry', () => {
    const b = buildBuilding(PORTAL);
    const beam = b.members.get('beam')!;
    expect(beam.restsOn.map((l) => l.id).sort()).toEqual(['a', 'b', 'c']);
    expect(b.members.get('a')!.carries).toEqual(['beam']);
    expect(b.members.get('upper')!.restsOn.map((l) => l.id)).toEqual(['beam']);
    expect(b.members.get('a')!.grounded).toBe(true);
    expect(beam.grounded).toBe(false);
  });

  it('does not let cladding carry anything', () => {
    const b = buildBuilding(PORTAL);
    expect(b.members.get('siding')!.carries).toEqual([]);
    expect(b.members.get('beam')!.restsOn.some((l) => l.id === 'siding')).toBe(false);
  });

  it('finds transitive dependents including anchored cladding', () => {
    const b = buildBuilding(PORTAL);
    expect(dependents(b, 'a').sort()).toEqual(['beam', 'siding', 'upper']);
    expect(dependents(b, 'c').sort()).toEqual(['beam', 'upper']);
  });

  it('rejects duplicate ids and unknown anchors', () => {
    expect(() => buildBuilding({ ...PORTAL, members: [...PORTAL.members, { ...PORTAL.members[0]! }] })).toThrow(/Duplicate/);
    expect(() => buildBuilding({ ...PORTAL, members: [{ id: 'x', kind: 'wall', material: 'wood', x: 0, y: 0, w: 1, h: 1, anchors: ['nope'] }] })).toThrow(/unknown member/);
  });

  it('every shipped building builds and has a positive target mass', () => {
    for (const def of Object.values(BUILDINGS)) {
      const b = buildBuilding(def);
      expect(b.totalMass).toBeGreaterThan(0);
      // Nothing should be crushed before a single charge goes off.
      const loads = computeLoads(b, () => true);
      const crushed = findCrushed(loads, (id) => b.members.get(id)!.stats.capacity);
      expect(crushed, `${def.id} has members over capacity at rest`).toEqual([]);
    }
  });
});

describe('member stats', () => {
  it('scales integrity with thickness and pre-existing damage', () => {
    const post = memberStats({ id: 'p', kind: 'column', material: 'wood', x: 0, y: 0, w: 0.3, h: 2.4 });
    const rotten = memberStats({ id: 'r', kind: 'column', material: 'wood', x: 0, y: 0, w: 0.3, h: 2.4, damage: 0.9 });
    const column = memberStats({ id: 'c', kind: 'column', material: 'concrete', x: 0, y: 0, w: 0.5, h: 3.5 });
    expect(post.hp).toBeCloseTo(35);
    expect(rotten.hp).toBeCloseTo(3.5);
    expect(rotten.capacity).toBeLessThan(post.capacity);
    expect(column.hp).toBeGreaterThan(post.hp * 4);
  });

  it('honours explicit overrides', () => {
    const s = memberStats({ id: 'x', kind: 'core', material: 'concrete', x: 0, y: 0, w: 2, h: 4, hp: 999, mass: 8, capacity: 80 });
    expect(s.hp).toBe(999);
    expect(s.mass).toBe(8);
    expect(s.capacity).toBe(80);
  });
});

describe('support evaluation', () => {
  const b = buildBuilding(PORTAL);
  const standing = (gone: string[]) => (id: string) => !gone.includes(id);

  it('keeps a beam stable while both ends are held', () => {
    expect(evaluateSupport(b.members.get('beam')!, standing(['b'])).kind).toBe('stable');
  });

  it('tips a beam toward the end that lost its support', () => {
    const left = evaluateSupport(b.members.get('beam')!, standing(['a']));
    expect(left).toMatchObject({ kind: 'tilt', direction: 'left' });
    const right = evaluateSupport(b.members.get('beam')!, standing(['c']));
    expect(right).toMatchObject({ kind: 'tilt', direction: 'right' });
  });

  it('drops a beam with no supports and a column on a fallen beam', () => {
    expect(evaluateSupport(b.members.get('beam')!, standing(['a', 'b', 'c'])).kind).toBe('free');
    expect(evaluateSupport(b.members.get('upper')!, standing(['beam'])).kind).toBe('free');
    expect(evaluateSupport(b.members.get('upper')!, standing([])).kind).toBe('stable');
  });

  it('drops cladding once every anchor is gone, even on the ground', () => {
    expect(evaluateSupport(b.members.get('siding')!, standing(['a'])).kind).toBe('stable');
    expect(evaluateSupport(b.members.get('siding')!, standing(['a', 'b'])).kind).toBe('free');
  });

  it('flows load down through supporters and flags overloads', () => {
    const loads = computeLoads(b, () => true);
    const beamMass = b.members.get('beam')!.stats.mass;
    const upperMass = b.members.get('upper')!.stats.mass;
    const total = (loads.get('a') ?? 0) + (loads.get('b') ?? 0) + (loads.get('c') ?? 0);
    expect(total).toBeCloseTo(beamMass + upperMass, 6);
    expect(loads.get('a')).toBeGreaterThan(0);
    // With column c gone the same load lands on a and b.
    const loads2 = computeLoads(b, standing(['c']));
    expect((loads2.get('a') ?? 0) + (loads2.get('b') ?? 0)).toBeCloseTo(beamMass + upperMass, 6);
    const crushed = findCrushed(loads2, (id) => (id === 'a' ? 0.01 : 100));
    expect(crushed).toEqual(['a']);
  });
});
