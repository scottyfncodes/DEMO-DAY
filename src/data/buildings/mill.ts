import type { BuildingDef } from '../../core/types';

/**
 * JOB 05 — Ironworks Smokestack. Drop the brick stack without touching the
 * boiler house beside it. The stack leans toward the boiler house, a heavy
 * charge would crack the boiler house wall, and a directional charge sends
 * it the other way.
 */
export const MILL: BuildingDef = {
  id: 'mill',
  name: 'Ironworks Smokestack',
  floors: 3,
  materials: 'Brick / Steel',
  footprint: { x: -22, w: 25 },
  ground: { x: -32, w: 50 },
  neighbors: [{ id: 'siding', label: 'Rail Siding', x: -30, w: 6.5, h: 0.3, style: 'road' }],
  members: [
    {
      id: 's1',
      kind: 'core',
      material: 'brick',
      x: 0.2,
      y: 0,
      w: 2.0,
      h: 6,
      label: 'Stack Base',
      hp: 120,
      mass: 7,
      lean: 1,
      note: 'Double-skin brick. The stack has settled toward the boiler house.',
    },
    { id: 's2', kind: 'core', material: 'brick', x: 0.3, y: 6, w: 1.8, h: 6, label: 'Stack Middle', hp: 100, mass: 6, lean: 1, note: 'Single-skin brick above the base.' },
    { id: 's3', kind: 'core', material: 'brick', x: 0.4, y: 12, w: 1.6, h: 5.5, label: 'Stack Top', hp: 90, mass: 5, lean: 1, note: 'Tapered crown with a cast-iron cap.' },
    { id: 'bh_wall_l', kind: 'wall', material: 'brick', x: 3.4, y: 0, w: 0.4, h: 4.5, label: 'Boiler House West Wall', protect: true, note: 'KEEP STANDING. The client still uses the boiler house.' },
    { id: 'bh_wall_r', kind: 'wall', material: 'brick', x: 10.6, y: 0, w: 0.4, h: 4.5, label: 'Boiler House East Wall', protect: true, note: 'KEEP STANDING.' },
    { id: 'bh_roof', kind: 'beam', material: 'steel', x: 3.2, y: 4.5, w: 7.8, h: 0.4, label: 'Boiler House Truss', protect: true, mass: 4, note: 'KEEP STANDING. Steel truss roof.' },
  ],
};
