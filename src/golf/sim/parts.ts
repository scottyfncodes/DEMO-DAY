import type { MaterialId } from './materials';

/**
 * A part is one piece of the level the simulation knows about: a brick, a
 * pane of glass, a roof tile, a sofa, a garden gnome. Parts are boxes (with an
 * optional tilt about the x axis for roof pieces). Structure is a graph over
 * parts: `groups` lists what a part rests on, `lateral` what it is bonded to
 * beside it.
 */

export const enum PartState {
  Intact = 0,
  /** Loose and moving under physics. */
  Falling = 1,
  /** Broken to fragments and removed. */
  Gone = 2,
  /** Came loose, fell, and now lies still. */
  Rubble = 3,
}

export type PartKind =
  | 'brick'
  | 'foundation'
  | 'glass'
  | 'frame'
  | 'lintel'
  | 'door'
  | 'tile'
  | 'deck'
  | 'ridge'
  | 'floor'
  | 'beam'
  | 'column'
  | 'partition'
  | 'slab'
  | 'stair'
  | 'furniture'
  | 'decor'
  | 'trunk'
  | 'branch'
  | 'foliage'
  | 'hedge'
  | 'fence';

export interface Part {
  id: number;
  kind: PartKind;
  mat: MaterialId;
  /** Centre and half extents (local, before tilt). */
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  /** Tilt about the x axis, radians. */
  rot: number;
  hp: number;
  hp0: number;
  state: PartState;
  /** The ball collides with it. */
  solid: boolean;
  /** Foliage: slows and nudges the ball instead of bouncing it. */
  soft: boolean;
  /** Rests on: every group needs at least one standing member. Empty = rests on the ground. */
  groups: number[][];
  /** Minimum standing members per group (default 1). */
  need?: number[];
  lateral: number[];
  /** How many bonds sideways it can hang from without anything under it. */
  span: number;
  weight: number;
  /** Load it can carry before it starts to fail. */
  capacity: number;
  /** Lateral bond family: parts only bond sideways within the same family. */
  bond: string;
  /** Which outside wall it belongs to (for seam shots and toppling). */
  wall?: 'front' | 'back' | 'left' | 'right';
  tags: string[];
  label?: string;
  /** Renderer model for furniture and decorations. */
  model?: string;
  color: number;
  /** Comes loose and tumbles when hit instead of soaking up damage. */
  knock: boolean;
  /** Breaks when it lands hard. */
  fragile: boolean;
  /** Counts toward the destruction percentage. */
  house: boolean;
  /** Room the part is in, for interior objectives and the camera. */
  room?: string;
  /** Points when broken or knocked loose (from the material unless set). */
  points: number;
  /** Supports pick these up during building (filled by the builder). */
  supporting: number[];
}

export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** World-space bounding box of a part, tilt included. */
export function partBox(p: Part): Box {
  if (p.rot === 0) return { minX: p.x - p.hx, maxX: p.x + p.hx, minY: p.y - p.hy, maxY: p.y + p.hy, minZ: p.z - p.hz, maxZ: p.z + p.hz };
  const c = Math.abs(Math.cos(p.rot));
  const s = Math.abs(Math.sin(p.rot));
  const ey = p.hy * c + p.hz * s;
  const ez = p.hy * s + p.hz * c;
  return { minX: p.x - p.hx, maxX: p.x + p.hx, minY: p.y - ey, maxY: p.y + ey, minZ: p.z - ez, maxZ: p.z + ez };
}
