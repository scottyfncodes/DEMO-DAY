import type { BuildingDef, MemberDef } from '../../core/types';

/**
 * JOB 04 — Two-Storey House. Timber frame on four post lines with a brick
 * chimney on the right. Timber posts fail together when a heavy charge goes
 * off nearby; the chimney does not care about the timber at all.
 */
const POST_X = [0, 2.5, 5.0, 7.5];

function posts(prefix: string, y: number, h: number, labelPrefix: string): MemberDef[] {
  return POST_X.map((x, i) => ({
    id: `${prefix}${i + 1}`,
    kind: 'column' as const,
    material: 'wood' as const,
    x,
    y,
    w: 0.3,
    h,
    label: `${labelPrefix} Post ${i + 1}`,
    note: i === 0 || i === 3 ? 'Corner post. Carries one end of the floor.' : 'Interior post. Carries two floor bays.',
  }));
}

function siding(prefix: string, y: number, h: number, anchorPrefix: string, labelPrefix: string): MemberDef[] {
  return [0, 1, 2].map((i) => ({
    id: `${prefix}${i + 1}`,
    kind: 'wall' as const,
    material: 'wood' as const,
    x: (POST_X[i] as number) + 0.3,
    y,
    w: 2.2,
    h,
    label: `${labelPrefix} Siding ${i + 1}`,
    anchors: [`${anchorPrefix}${i + 1}`, `${anchorPrefix}${i + 2}`],
    note: 'Clapboard siding nailed to the posts either side.',
  }));
}

export const HOUSE: BuildingDef = {
  id: 'house',
  name: 'Two-Storey House',
  floors: 2,
  materials: 'Timber / Brick',
  footprint: { x: -1.8, w: 11.2 },
  ground: { x: -16, w: 34 },
  neighbors: [
    { id: 'fence', label: "Neighbour's Fence", x: -4.2, w: 2.0, h: 1.6, style: 'fence' },
    { id: 'propane', label: 'Propane Tank', x: 10.4, w: 1.4, h: 1.3, style: 'tank' },
  ],
  members: [
    ...posts('p', 0, 2.8, 'Ground'),
    ...siding('sg', 0, 2.8, 'p', 'Ground'),
    { id: 'f1', kind: 'slab', material: 'wood', x: 0, y: 2.8, w: 2.8, h: 0.3, label: 'Floor Bay 1', note: 'Timber joists spanning posts 1 and 2.' },
    { id: 'f2', kind: 'slab', material: 'wood', x: 2.5, y: 2.8, w: 2.8, h: 0.3, label: 'Floor Bay 2', note: 'Timber joists spanning posts 2 and 3.' },
    { id: 'f3', kind: 'slab', material: 'wood', x: 5.0, y: 2.8, w: 2.8, h: 0.3, label: 'Floor Bay 3', note: 'Timber joists spanning posts 3 and 4.' },
    ...posts('u', 3.1, 2.6, 'Upper'),
    ...siding('su', 3.1, 2.6, 'u', 'Upper'),
    { id: 'r1', kind: 'roof', material: 'wood', x: -0.3, y: 5.7, w: 3.1, h: 0.3, label: 'Roof Bay 1', note: 'Roof deck over posts 1 and 2.' },
    { id: 'r2', kind: 'roof', material: 'wood', x: 2.5, y: 5.7, w: 2.8, h: 0.3, label: 'Roof Bay 2', note: 'Roof deck over posts 2 and 3.' },
    { id: 'r3', kind: 'roof', material: 'wood', x: 5.0, y: 5.7, w: 3.1, h: 0.3, label: 'Roof Bay 3', note: 'Roof deck over posts 3 and 4.' },
    {
      id: 'chimney',
      kind: 'column',
      material: 'brick',
      x: 7.9,
      y: 0,
      w: 0.6,
      h: 7.2,
      label: 'Chimney',
      note: 'Free-standing brick stack. Not tied to the timber frame, so the house can fall without it.',
    },
  ],
};
