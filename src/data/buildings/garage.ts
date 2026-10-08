import type { BuildingDef } from '../../core/types';

/**
 * JOB 02 — Detached Garage. Brick walls, a steel lintel over the door and a
 * concrete roof slab. The neighbour's house is a metre from the right wall:
 * whatever you break on the right lands on it.
 */
export const GARAGE: BuildingDef = {
  id: 'garage',
  name: 'Detached Garage',
  floors: 1,
  materials: 'Brick / Steel / Concrete',
  footprint: { x: -2.4, w: 8.7 },
  ground: { x: -14, w: 30 },
  neighbors: [{ id: 'house', label: "Neighbour's House", x: 6.6, w: 5.5, h: 6.2, style: 'house' }],
  members: [
    { id: 'wall_l', kind: 'wall', material: 'brick', x: 0, y: 0, w: 0.3, h: 3.0, label: 'Left Wall', note: 'Solid brick, load-bearing. Carries the left end of the roof slab.' },
    { id: 'pier', kind: 'column', material: 'brick', x: 3.0, y: 0, w: 0.4, h: 2.7, label: 'Door Pier', note: 'Brick pier beside the door. Carries the lintel.' },
    { id: 'wall_r', kind: 'wall', material: 'brick', x: 5.7, y: 0, w: 0.3, h: 2.7, label: 'Right Wall', decor: ['vent'], note: 'Load-bearing brick. Only a metre from the neighbour.' },
    { id: 'infill', kind: 'wall', material: 'brick', x: 0.3, y: 0, w: 2.7, h: 2.85, label: 'Back Wall', anchors: ['wall_l', 'pier'], decor: ['window'], note: 'Half-brick infill panel tied to the wall and the pier. Not load-bearing.' },
    { id: 'lintel', kind: 'beam', material: 'steel', x: 3.0, y: 2.7, w: 3.0, h: 0.3, label: 'Steel Lintel', decor: ['garageDoor'], note: 'Spans the door opening from the pier to the right wall.' },
    { id: 'roof', kind: 'slab', material: 'concrete', x: -0.2, y: 3.0, w: 6.4, h: 0.25, label: 'Roof Slab', note: 'Reinforced concrete. Rests on the left wall and the lintel.' },
  ],
};
