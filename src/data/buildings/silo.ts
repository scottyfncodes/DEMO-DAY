import type { BuildingDef } from '../../core/types';

/**
 * JOB 03 — Grain Silo. A tall hollow concrete silo on two legs beside a
 * highway. Its foundations have settled toward the road, so a plain drop
 * lands on the traffic. Break the left leg (or kick it left) and it falls
 * into the field.
 */
export const SILO: BuildingDef = {
  id: 'silo',
  name: 'Grain Silo',
  floors: 4,
  materials: 'Concrete / Steel',
  footprint: { x: -21, w: 24.4 },
  ground: { x: -30, w: 52 },
  neighbors: [{ id: 'highway', label: 'Highway 9', x: 4.6, w: 16, h: 0.35, style: 'road' }],
  members: [
    {
      id: 'leg_l',
      kind: 'column',
      material: 'concrete',
      x: 0.2,
      y: 0,
      w: 0.45,
      h: 4,
      label: 'Left Leg',
      damage: 0.3,
      capacity: 55,
      note: 'Spalled concrete with exposed rebar. Weaker than it looks.',
    },
    {
      id: 'leg_r',
      kind: 'column',
      material: 'concrete',
      x: 1.85,
      y: 0,
      w: 0.45,
      h: 4,
      label: 'Right Leg',
      capacity: 55,
      note: 'Sound concrete. The highway is right behind it.',
    },
    {
      id: 'ring',
      kind: 'beam',
      material: 'concrete',
      x: -0.2,
      y: 4,
      w: 2.9,
      h: 0.5,
      label: 'Ring Beam',
      hp: 320,
      mass: 3,
      capacity: 80,
      lean: 1,
      note: 'Massive ring beam. Survey shows the whole silo leans 2° toward the highway.',
    },
    { id: 'seg_1', kind: 'core', material: 'concrete', x: 0, y: 4.5, w: 2.5, h: 4.5, label: 'Lower Bin', mass: 8, lean: 1, decor: ['ladder', 'door'], note: 'Hollow concrete bin wall. Leans toward the highway.' },
    { id: 'seg_2', kind: 'core', material: 'concrete', x: 0, y: 9, w: 2.5, h: 4.5, label: 'Middle Bin', mass: 8, lean: 1, decor: ['lettering', 'ladder'], note: 'Hollow concrete bin wall.' },
    { id: 'seg_3', kind: 'core', material: 'concrete', x: 0, y: 13.5, w: 2.5, h: 4, label: 'Upper Bin', mass: 7, lean: 1, decor: ['ladder'], note: 'Hollow concrete bin wall.' },
    { id: 'tank', kind: 'core', material: 'steel', x: -0.5, y: 17.5, w: 3.5, h: 2.5, label: 'Head House', mass: 8, lean: 1, decor: ['louvre'], note: 'Steel head house on top. Heavy and top-heavy.' },
  ],
};
