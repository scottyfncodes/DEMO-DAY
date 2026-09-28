import type { BuildingDef } from '../../core/types';

/**
 * JOB 01 — Garden Shed. Three timber posts carry a roof. The middle post is
 * rotten: take out the outer posts and the roof's weight crushes it.
 */
export const SHED: BuildingDef = {
  id: 'shed',
  name: 'Garden Shed',
  floors: 1,
  materials: 'Timber',
  footprint: { x: -1.6, w: 7.2 },
  ground: { x: -12, w: 28 },
  neighbors: [{ id: 'greenhouse', label: 'Greenhouse', x: 6.4, w: 3.2, h: 2.2, style: 'shed' }],
  members: [
    { id: 'post_l', kind: 'column', material: 'wood', x: 0, y: 0, w: 0.3, h: 2.4, label: 'Left Post', note: 'Sound timber. Carries the left end of the roof.' },
    {
      id: 'post_c',
      kind: 'column',
      material: 'wood',
      x: 1.85,
      y: 0,
      w: 0.3,
      h: 2.4,
      label: 'Centre Post',
      damage: 0.9,
      note: 'Rotten through at the base. It only stands because the outer posts take the weight.',
    },
    { id: 'post_r', kind: 'column', material: 'wood', x: 3.7, y: 0, w: 0.3, h: 2.4, label: 'Right Post', note: 'Sound timber. Carries the right end of the roof.' },
    { id: 'wall_l', kind: 'wall', material: 'wood', x: 0.3, y: 0, w: 1.55, h: 2.4, label: 'Left Siding', anchors: ['post_l', 'post_c'], note: 'Cladding nailed to the posts. Falls when its posts go.' },
    { id: 'wall_r', kind: 'wall', material: 'wood', x: 2.15, y: 0, w: 1.55, h: 2.4, label: 'Right Siding', anchors: ['post_c', 'post_r'], note: 'Cladding nailed to the posts. Falls when its posts go.' },
    { id: 'roof', kind: 'roof', material: 'wood', x: -0.3, y: 2.4, w: 4.6, h: 0.25, label: 'Roof', note: 'Heavy timber roof deck resting on all three posts.' },
  ],
};
