import { MATERIALS, type MaterialId } from './materials';
import { PartState, type Box, type Part, type PartKind } from './parts';

/**
 * Builds a level: a suburban house of individual bricks on a lot, with its
 * windows, doors, floors, roof, furniture and garden. Everything is laid out
 * on a 0.3 m grid so bricks, openings and floors line up exactly, and the
 * support graph between parts is worked out from where they touch.
 */

export type Wall = 'front' | 'back' | 'left' | 'right';

export const BRICK_L = 0.6;
export const BRICK_H = 0.3;
export const WALL_T = 0.3;
export const FOUNDATION_TOP = 0.6;
export const STOREY_H = 2.7;

export interface Opening {
  wall: Wall;
  /** Along the wall: world x for front/back, world z for left/right. */
  a0: number;
  a1: number;
  y0: number;
  y1: number;
  kind: 'window' | 'door';
}

export interface Zone {
  wall: Wall;
  a0: number;
  a1: number;
  y0: number;
  y1: number;
  mat: MaterialId;
}

export interface Palette {
  brick: number;
  roof: number;
  trim: number;
  door: number;
  plaster: number;
}

export interface HouseSpec {
  storeys: Storeys;
  /** Frontage and depth in metres (default 9 by 6). Multiples of 1.8 keep the brick courses whole. */
  width?: number;
  depth?: number;
  porch: boolean;
  chimney: boolean;
  /** Overrides the standard openings for this storey count. */
  openings?: Opening[];
  /** Patches of weaker or reinforced brick. */
  zones?: Zone[];
  palette: Palette;
  furnish: boolean;
  /** Tee position across the lot (default 0, in line with the front door). */
  teeX?: number;
}

export type DecorModel = 'gnome' | 'flamingo' | 'mailbox' | 'birdbath' | 'pot' | 'light' | 'bench' | 'lawnchair';

export interface YardSpec {
  trees: Array<{ x: number; z: number; s: number }>;
  decor: Array<{ model: DecorModel; x: number; z: number }>;
}

export interface Room {
  id: string;
  name: string;
  box: Box;
}

export interface HouseInfo {
  W: number;
  D: number;
  storeys: Storeys;
  wallTop: number;
  ridgeY: number;
  pitch: number;
  /** Inside of the outer walls, floor to ridge. */
  interior: Box;
  rooms: Room[];
  doorX: number;
  tee: { x: number; y: number; z: number };
  /** Where birds sit before the first shot. */
  perches: Array<{ x: number; y: number; z: number }>;
  /** Paved areas: firmer bounce, shown as paths. */
  paving: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
  bounds: Box;
  palette: Palette;
  trees: Array<{ x: number; z: number; s: number }>;
}

export const PALETTES: Record<string, Palette> = {
  classic: { brick: 0xb9573b, roof: 0x5f7290, trim: 0xf6f1e6, door: 0x2f7a6f, plaster: 0xf3ead8 },
  honey: { brick: 0xc98a4b, roof: 0xa9503a, trim: 0xfbf6ea, door: 0x2b4f8a, plaster: 0xf5eedc },
  rose: { brick: 0xc46a5a, roof: 0x5f7d5c, trim: 0xfffaf0, door: 0xe0a83a, plaster: 0xf7ecdf },
  slate: { brick: 0x9d5e4c, roof: 0x52606f, trim: 0xf0ede6, door: 0xc9472f, plaster: 0xeee6d6 },
  sand: { brick: 0xd2a476, roof: 0x748a9a, trim: 0xffffff, door: 0x8c3f5d, plaster: 0xf6efe0 },
};

export type Storeys = 1 | 2 | 3;
const PITCH = 38 * (Math.PI / 180);
const EPS = 0.004;

/**
 * Openings for any frontage, depth and height: the front door, ground floor windows either side
 * of it (wide where they fit, narrow at the ends), a row of windows on each upper storey, and a
 * window per storey in the back and in each side, lined up so a ball can go in one side and out another.
 */
export function openingsFor(W: number, D: number, storeys: Storeys): Opening[] {
  const g0 = 1.2;
  const g1 = 2.7;
  const half = W / 2;
  const list: Opening[] = [{ wall: 'front', a0: -0.3, a1: 0.9, y0: FOUNDATION_TOP, y1: g1, kind: 'door' }];
  // Ground floor, outward from the door on each side.
  for (const side of [-1, 1]) {
    let edge = side < 0 ? -1.8 : 2.1;
    for (let k = 0; k < 4; k++) {
      const w = k === 0 ? 1.8 : 1.2;
      const a0 = side < 0 ? edge - w : edge;
      const a1 = side < 0 ? edge : edge + w;
      if (a0 < -half + 0.6 - 1e-6 || a1 > half - 0.6 + 1e-6) break;
      list.push({ wall: 'front', a0, a1, y0: g0, y1: g1, kind: 'window' });
      edge = side < 0 ? a0 - 0.9 : a1 + 0.9;
    }
  }
  const upperX: Array<[number, number]> = [[-3.6, -2.4], [-0.3, 0.9], [2.4, 3.6]];
  for (let x = 4.5; x + 1.2 <= half - 0.6 + 1e-6; x += 2.1) upperX.push([-x - 1.2, -x], [x, x + 1.2]);
  const sideMid = -D / 2;
  for (let k = 1; k < storeys; k++) {
    const u0 = FOUNDATION_TOP + k * STOREY_H + 0.6;
    for (const [a0, a1] of upperX) list.push({ wall: 'front', a0, a1, y0: u0, y1: u0 + 1.5, kind: 'window' });
    list.push({ wall: 'back', a0: -3.3, a1: -2.1, y0: u0, y1: u0 + 1.5, kind: 'window' }, { wall: 'back', a0: 2.4, a1: 3.6, y0: u0, y1: u0 + 1.5, kind: 'window' });
    for (const wall of ['left', 'right'] as const) list.push({ wall, a0: sideMid - 0.6, a1: sideMid + 0.6, y0: u0, y1: u0 + 1.2, kind: 'window' });
  }
  list.push({ wall: 'back', a0: -3.3, a1: -1.8, y0: g0, y1: g1, kind: 'window' }, { wall: 'back', a0: 2.1, a1: 3.3, y0: g0, y1: g1, kind: 'window' });
  for (const wall of ['left', 'right'] as const) list.push({ wall, a0: sideMid - 0.6, a1: sideMid + 0.6, y0: g0, y1: g1, kind: 'window' });
  return list;
}

/** The standard openings: windows in every wall, a front door, aligned so a ball can go in one side and out another. */
export function standardOpenings(storeys: 1 | 2): Opening[] {
  const g0 = 1.2;
  const g1 = 2.7;
  const list: Opening[] = [
    { wall: 'front', a0: -3.6, a1: -1.8, y0: g0, y1: g1, kind: 'window' },
    { wall: 'front', a0: -0.3, a1: 0.9, y0: FOUNDATION_TOP, y1: g1, kind: 'door' },
    { wall: 'front', a0: 2.1, a1: 3.9, y0: g0, y1: g1, kind: 'window' },
    { wall: 'back', a0: -3.3, a1: -1.8, y0: g0, y1: g1, kind: 'window' },
    { wall: 'back', a0: 2.1, a1: 3.3, y0: g0, y1: g1, kind: 'window' },
    { wall: 'left', a0: -3.6, a1: -2.4, y0: g0, y1: g1, kind: 'window' },
    { wall: 'right', a0: -3.6, a1: -2.4, y0: g0, y1: g1, kind: 'window' },
  ];
  if (storeys === 2) {
    const u0 = 3.9;
    const u1 = 5.4;
    list.push(
      { wall: 'front', a0: -3.6, a1: -2.4, y0: u0, y1: u1, kind: 'window' },
      { wall: 'front', a0: -0.3, a1: 0.9, y0: u0, y1: u1, kind: 'window' },
      { wall: 'front', a0: 2.4, a1: 3.6, y0: u0, y1: u1, kind: 'window' },
      { wall: 'back', a0: -3.3, a1: -2.1, y0: u0, y1: u1, kind: 'window' },
      { wall: 'back', a0: 2.4, a1: 3.6, y0: u0, y1: u1, kind: 'window' },
      { wall: 'left', a0: -3.6, a1: -2.4, y0: u0, y1: 5.1, kind: 'window' },
      { wall: 'right', a0: -3.6, a1: -2.4, y0: u0, y1: 5.1, kind: 'window' },
    );
  }
  return list;
}

interface FurnitureDef {
  w: number;
  h: number;
  d: number;
  mat: MaterialId;
  points: number;
  knock: boolean;
  fragile: boolean;
  label: string;
  hp?: number;
}

/** Furniture and garden pieces: size, what they are made of and what they are worth. */
export const FURNITURE: Record<string, FurnitureDef> = {
  sofa: { w: 2.0, h: 0.85, d: 0.9, mat: 'soft', points: 80, knock: false, fragile: false, label: 'Sofa' },
  coffeeTable: { w: 1.0, h: 0.42, d: 0.6, mat: 'wood', points: 40, knock: true, fragile: false, label: 'Coffee table' },
  floorLamp: { w: 0.35, h: 1.6, d: 0.35, mat: 'ceramic', points: 60, knock: true, fragile: true, label: 'Floor lamp' },
  tvStand: { w: 1.4, h: 0.55, d: 0.45, mat: 'wood', points: 40, knock: false, fragile: false, label: 'TV stand', hp: 2.4 },
  tv: { w: 1.2, h: 0.72, d: 0.12, mat: 'electronics', points: 150, knock: true, fragile: true, label: 'TV' },
  bookshelf: { w: 1.0, h: 2.0, d: 0.35, mat: 'wood', points: 70, knock: true, fragile: false, label: 'Bookshelf', hp: 3 },
  plant: { w: 0.4, h: 0.9, d: 0.4, mat: 'ceramic', points: 40, knock: true, fragile: true, label: 'Pot plant' },
  clock: { w: 0.5, h: 2.0, d: 0.35, mat: 'wood', points: 120, knock: true, fragile: true, label: 'Grandfather clock' },
  coatRack: { w: 0.4, h: 1.8, d: 0.4, mat: 'wood', points: 30, knock: true, fragile: false, label: 'Coat rack' },
  counter: { w: 1.8, h: 0.95, d: 0.62, mat: 'wood', points: 60, knock: false, fragile: false, label: 'Kitchen counter', hp: 4 },
  fridge: { w: 0.8, h: 1.9, d: 0.7, mat: 'metal', points: 90, knock: false, fragile: false, label: 'Fridge' },
  diningTable: { w: 1.4, h: 0.75, d: 0.9, mat: 'wood', points: 50, knock: true, fragile: false, label: 'Dining table' },
  chair: { w: 0.45, h: 0.95, d: 0.45, mat: 'wood', points: 25, knock: true, fragile: false, label: 'Chair' },
  bed: { w: 1.6, h: 0.6, d: 2.1, mat: 'soft', points: 80, knock: false, fragile: false, label: 'Bed' },
  wardrobe: { w: 1.2, h: 2.1, d: 0.6, mat: 'wood', points: 90, knock: true, fragile: false, label: 'Wardrobe', hp: 3.5 },
  nightstand: { w: 0.5, h: 0.55, d: 0.45, mat: 'wood', points: 30, knock: true, fragile: false, label: 'Nightstand' },
  vase: { w: 0.25, h: 0.42, d: 0.25, mat: 'ceramic', points: 40, knock: true, fragile: true, label: 'Vase' },
  desk: { w: 1.3, h: 0.75, d: 0.65, mat: 'wood', points: 40, knock: false, fragile: false, label: 'Desk', hp: 2.4 },
  monitor: { w: 0.6, h: 0.45, d: 0.1, mat: 'electronics', points: 100, knock: true, fragile: true, label: 'Computer' },
  pedestal: { w: 0.5, h: 1.0, d: 0.5, mat: 'wood', points: 20, knock: true, fragile: false, label: 'Pedestal' },
  trophy: { w: 0.28, h: 0.45, d: 0.28, mat: 'metal', points: 150, knock: true, fragile: false, label: 'Bowling trophy', hp: Infinity },
  gnome: { w: 0.32, h: 0.55, d: 0.32, mat: 'ceramic', points: 75, knock: true, fragile: true, label: 'Garden gnome' },
  flamingo: { w: 0.3, h: 0.95, d: 0.35, mat: 'plastic', points: 50, knock: true, fragile: false, label: 'Lawn flamingo' },
  mailbox: { w: 0.35, h: 1.25, d: 0.5, mat: 'metal', points: 60, knock: true, fragile: false, label: 'Mailbox' },
  birdbath: { w: 0.6, h: 0.9, d: 0.6, mat: 'ceramic', points: 60, knock: true, fragile: true, label: 'Bird bath' },
  pot: { w: 0.4, h: 0.45, d: 0.4, mat: 'ceramic', points: 30, knock: true, fragile: true, label: 'Plant pot' },
  light: { w: 0.14, h: 0.55, d: 0.14, mat: 'metal', points: 20, knock: true, fragile: false, label: 'Garden light' },
  bench: { w: 1.5, h: 0.85, d: 0.55, mat: 'wood', points: 40, knock: true, fragile: false, label: 'Garden bench' },
  lawnchair: { w: 0.6, h: 0.9, d: 0.7, mat: 'plastic', points: 35, knock: true, fragile: false, label: 'Lawn chair' },
};

const CAPACITY: Partial<Record<PartKind, number>> = {
  brick: 86,
  foundation: 600,
  lintel: 110,
  column: 26,
  beam: 60,
  floor: 1e9,
  deck: 1e9,
  ridge: 1e9,
  partition: 40,
};

export class HouseBuilder {
  parts: Part[] = [];
  private auto = new Map<number, 'one' | 'ends-x' | 'ends-z'>();
  private carriers = new Set<PartKind>(['brick', 'foundation', 'lintel', 'slab', 'floor', 'partition', 'beam', 'stair', 'furniture', 'column', 'frame']);

  add(o: Partial<Part> & { kind: PartKind; mat: MaterialId; x: number; y: number; z: number; hx: number; hy: number; hz: number }): Part {
    const m = MATERIALS[o.mat];
    const hp = o.hp ?? m.hp;
    const vol = 8 * o.hx * o.hy * o.hz;
    const p: Part = {
      id: this.parts.length,
      rot: 0,
      state: PartState.Intact,
      solid: true,
      soft: false,
      groups: [],
      lateral: [],
      span: 0,
      weight: vol * m.density,
      capacity: CAPACITY[o.kind] ?? 1e9,
      bond: '',
      tags: [],
      color: m.color,
      knock: false,
      fragile: false,
      house: true,
      points: m.points,
      supporting: [],
      ...o,
      hp,
      hp0: hp,
    };
    this.parts.push(p);
    return p;
  }

  autoSupport(p: Part, mode: 'one' | 'ends-x' | 'ends-z' = 'one'): Part {
    this.auto.set(p.id, mode);
    return p;
  }

  /** Works out what each auto part rests on, and lateral bonds within each bond family. */
  link(): void {
    for (const p of this.parts) if (p.bond) p.lateral = [];
    const tops = new Map<number, Part[]>();
    for (const p of this.parts) {
      if (p.rot !== 0 || !this.carriers.has(p.kind)) continue;
      const k = Math.round((p.y + p.hy) * 100);
      for (const kk of [k - 1, k, k + 1]) {
        let list = tops.get(kk);
        if (!list) tops.set(kk, (list = []));
        list.push(p);
      }
    }
    for (const [id, mode] of this.auto) {
      const p = this.parts[id] as Part;
      const bottom = p.y - p.hy;
      if (bottom <= EPS) {
        p.groups = [];
        continue;
      }
      const cands = tops.get(Math.round(bottom * 100)) ?? [];
      const sup: Part[] = [];
      for (const q of cands) {
        if (q === p || Math.abs(q.y + q.hy - bottom) > 0.012) continue;
        const ox = Math.min(p.x + p.hx, q.x + q.hx) - Math.max(p.x - p.hx, q.x - q.hx);
        const oz = Math.min(p.z + p.hz, q.z + q.hz) - Math.max(p.z - p.hz, q.z - q.hz);
        if (ox > 0.02 && oz > 0.02 && !sup.includes(q)) sup.push(q);
      }
      if (!sup.length) {
        p.groups = [[]];
        continue;
      }
      if (mode === 'one') p.groups = [sup.map((q) => q.id)];
      else {
        const axis = mode === 'ends-x' ? 'x' : 'z';
        const a = sup.filter((q) => q[axis] < p[axis]).map((q) => q.id);
        const b = sup.filter((q) => q[axis] >= p[axis]).map((q) => q.id);
        p.groups = [a, b].filter((g) => g.length);
        if (p.groups.length < 2) p.groups = [a.concat(b)];
      }
    }
    // Lateral bonds: same family, same course, touching faces.
    const fam = new Map<string, Part[]>();
    for (const p of this.parts) {
      if (!p.bond) continue;
      const key = `${p.bond}|${Math.round(p.y * 100)}|${Math.round(p.hy * 100)}`;
      let list = fam.get(key);
      if (!list) fam.set(key, (list = []));
      list.push(p);
    }
    for (const list of fam.values()) {
      for (let i = 0; i < list.length; i++) {
        const a = list[i] as Part;
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j] as Part;
          const gx = Math.max(a.x - a.hx, b.x - b.hx) - Math.min(a.x + a.hx, b.x + b.hx);
          const gz = Math.max(a.z - a.hz, b.z - b.hz) - Math.min(a.z + a.hz, b.z + b.hz);
          // Touching on one axis (gap ~0), overlapping on the other.
          const touch = (Math.abs(gx) < 0.02 && gz < -0.02) || (Math.abs(gz) < 0.02 && gx < -0.02);
          if (touch) {
            a.lateral.push(b.id);
            b.lateral.push(a.id);
          }
        }
      }
    }
    for (const p of this.parts) p.supporting = [];
    for (const p of this.parts) for (const g of p.groups) for (const s of g) (this.parts[s] as Part).supporting.push(p.id);
  }
}

/** Splits [a0,a1] minus the blocked intervals into running-bond bricks. Returns [start,end] pairs. */
export function courseBricks(a0: number, a1: number, blocked: Array<[number, number]>, offset: number, len = BRICK_L): Array<[number, number]> {
  const free: Array<[number, number]> = [];
  let cur = a0;
  for (const [b0, b1] of [...blocked].sort((p, q) => p[0] - q[0])) {
    if (b1 <= cur + EPS) continue;
    if (b0 > cur + EPS) free.push([cur, Math.min(b0, a1)]);
    cur = Math.max(cur, b1);
    if (cur >= a1 - EPS) break;
  }
  if (cur < a1 - EPS) free.push([cur, a1]);
  const out: Array<[number, number]> = [];
  for (const [f0, f1] of free) {
    if (f1 - f0 < 0.05) continue;
    let s = f0;
    const k0 = Math.floor((f0 - (a0 - offset)) / len + EPS);
    let cut = a0 - offset + (k0 + 1) * len;
    while (cut < f1 - EPS) {
      if (cut > s + EPS) {
        out.push([s, cut]);
        s = cut;
      }
      cut += len;
    }
    if (f1 - s > 0.05) out.push([s, f1]);
  }
  return out;
}

const r2 = (v: number): number => Math.round(v * 1000) / 1000;

/** Builds the house and its lot. Returns the parts (linked) and the layout facts the renderer and camera need. */
export function buildLevel(spec: HouseSpec, yard: YardSpec): { parts: Part[]; info: HouseInfo } {
  const b = new HouseBuilder();
  const { palette } = spec;
  const W = spec.width ?? 9;
  const D = spec.depth ?? 6;
  const storeys = spec.storeys;
  const wallTop = FOUNDATION_TOP + storeys * STOREY_H;
  const rise = (D / 2) * Math.tan(PITCH);
  const ridgeY = wallTop + rise;
  const openings = spec.openings ?? (W === 9 && D === 6 && storeys <= 2 ? standardOpenings(storeys as 1 | 2) : openingsFor(W, D, storeys));
  const zones = spec.zones ?? [];
  const doorX = 0.3;

  const brickColor = (base: number, i: number): number => {
    // Per-brick tint variation so the wall reads as bricks, deterministic.
    const t = ((i * 2654435761) >>> 0) / 4294967296;
    const f = 0.9 + t * 0.18;
    const r = Math.min(255, ((base >> 16) & 255) * f);
    const g = Math.min(255, ((base >> 8) & 255) * f);
    const bl = Math.min(255, (base & 255) * f);
    return (r << 16) | (g << 8) | bl;
  };

  const wallMeta: Record<Wall, { axis: 'x' | 'z'; a0: number; a1: number; c: number; phase: number; normal: [number, number] }> = {
    front: { axis: 'x', a0: -W / 2, a1: W / 2, c: -WALL_T / 2, phase: 0, normal: [0, 1] },
    back: { axis: 'x', a0: -W / 2, a1: W / 2, c: -D + WALL_T / 2, phase: 0, normal: [0, -1] },
    left: { axis: 'z', a0: -D + WALL_T, a1: -WALL_T, c: -W / 2 + WALL_T / 2, phase: BRICK_L / 2, normal: [-1, 0] },
    right: { axis: 'z', a0: -D + WALL_T, a1: -WALL_T, c: W / 2 - WALL_T / 2, phase: BRICK_L / 2, normal: [1, 0] },
  };

  const wallParts: Record<Wall, Part[]> = { front: [], back: [], left: [], right: [] };
  const lintels: Part[] = [];

  const mkWallPiece = (wall: Wall, kind: PartKind, mat: MaterialId, s0: number, s1: number, y0: number, y1: number, extra: Partial<Part> = {}): Part => {
    const m = wallMeta[wall];
    const mid = (s0 + s1) / 2;
    const half = (s1 - s0) / 2;
    const p = b.add({
      kind,
      mat,
      x: m.axis === 'x' ? r2(mid) : m.c,
      z: m.axis === 'x' ? m.c : r2(mid),
      y: r2((y0 + y1) / 2),
      hx: m.axis === 'x' ? r2(half) : WALL_T / 2,
      hz: m.axis === 'x' ? WALL_T / 2 : r2(half),
      hy: r2((y1 - y0) / 2),
      bond: 'shell',
      span: kind === 'lintel' ? 1 : 2,
      wall,
      ...extra,
    });
    wallParts[wall].push(p);
    return p;
  };

  // Outer walls, course by course.
  for (const wall of ['front', 'back', 'left', 'right'] as Wall[]) {
    const m = wallMeta[wall];
    const ops = openings.filter((o) => o.wall === wall);
    for (let r = 0; ; r++) {
      const y0 = r * BRICK_H;
      const y1 = y0 + BRICK_H;
      let a0 = m.a0;
      let a1 = m.a1;
      if (y0 >= wallTop - EPS) {
        // Gable: only the side walls carry on, stepped under the roof line.
        if (m.axis !== 'z') break;
        const d = (y1 - wallTop) / Math.tan(PITCH);
        a0 = Math.ceil((-D + d) / (BRICK_L / 2) - EPS) * (BRICK_L / 2);
        a1 = Math.floor(-d / (BRICK_L / 2) + EPS) * (BRICK_L / 2);
        if (a1 - a0 < BRICK_L / 2 - EPS) break;
      }
      const blocked: Array<[number, number]> = [];
      for (const o of ops) {
        if (y0 >= o.y0 - EPS && y1 <= o.y1 + EPS) blocked.push([o.a0, o.a1]);
        if (Math.abs(y0 - o.y1) < EPS) {
          const l0 = Math.max(m.a0, o.a0 - BRICK_L / 2);
          const l1 = Math.min(m.a1, o.a1 + BRICK_L / 2);
          blocked.push([l0, l1]);
          const lin = mkWallPiece(wall, 'lintel', 'lintel', l0, l1, y0, y1, { color: palette.trim, tags: ['lintel', 'support'], label: 'Lintel' });
          b.autoSupport(lin, m.axis === 'x' ? 'ends-x' : 'ends-z');
          lintels.push(lin);
        }
      }
      const offset = (r % 2) * (BRICK_L / 2) + m.phase;
      const foundation = y1 <= FOUNDATION_TOP + EPS;
      const bricks = courseBricks(a0, a1, blocked, offset);
      bricks.forEach(([s0, s1], i) => {
        const mid = (s0 + s1) / 2;
        let mat: MaterialId = foundation ? 'foundation' : 'brick';
        for (const z of zones) if (z.wall === wall && mid >= z.a0 && mid <= z.a1 && y0 + 0.15 >= z.y0 && y0 + 0.15 <= z.y1) mat = z.mat;
        const color = foundation ? 0xa9a59c : mat === 'oldBrick' ? brickColor(0x8f7a6a, i + r * 31) : mat === 'foundation' ? brickColor(0x8d949a, i + r * 31) : brickColor(palette.brick, i * 7 + r * 131 + wall.length);
        const p = mkWallPiece(wall, foundation ? 'foundation' : 'brick', mat, s0, s1, y0, y1, { color, tags: y0 >= wallTop - EPS ? ['gable'] : [] });
        if (mat === 'foundation' && !foundation) p.tags.push('reinforced');
        b.autoSupport(p);
      });
    }
  }

  // Window and door fittings.
  const glassParts: Part[] = [];
  for (const o of openings) {
    const m = wallMeta[o.wall];
    const fw = 0.07;
    const piece = (s0: number, s1: number, y0: number, y1: number, depth: number, kind: PartKind, mat: MaterialId, extra: Partial<Part> = {}): Part => {
      const mid = (s0 + s1) / 2;
      const half = (s1 - s0) / 2;
      return b.add({
        kind,
        mat,
        x: m.axis === 'x' ? mid : m.c + m.normal[0] * (depth > WALL_T ? (depth - WALL_T) / 2 : 0),
        z: m.axis === 'x' ? m.c + m.normal[1] * (depth > WALL_T ? (depth - WALL_T) / 2 : 0) : mid,
        y: (y0 + y1) / 2,
        hx: m.axis === 'x' ? half : depth / 2,
        hz: m.axis === 'x' ? depth / 2 : half,
        hy: (y1 - y0) / 2,
        wall: o.wall,
        color: palette.trim,
        ...extra,
      });
    };
    const tags = [o.kind === 'door' ? 'door' : 'window', `${o.wall}-${o.kind}`];
    if (o.kind === 'window') {
      const sill = b.autoSupport(piece(o.a0, o.a1, o.y0, o.y0 + fw, WALL_T + 0.1, 'frame', 'frame', { tags: ['frame'] }));
      const jl = piece(o.a0, o.a0 + fw, o.y0 + fw, o.y1 - fw, WALL_T, 'frame', 'frame', { tags: ['frame'], groups: [[sill.id]] });
      const jr = piece(o.a1 - fw, o.a1, o.y0 + fw, o.y1 - fw, WALL_T, 'frame', 'frame', { tags: ['frame'], groups: [[sill.id]] });
      piece(o.a0 + fw, o.a1 - fw, o.y1 - fw, o.y1, WALL_T, 'frame', 'frame', { tags: ['frame'], groups: [[jl.id, jr.id]] });
      const wide = o.a1 - o.a0 > 1.45;
      const mids = wide ? [(o.a0 + o.a1) / 2] : [];
      for (const mx of mids) piece(mx - 0.035, mx + 0.035, o.y0 + fw, o.y1 - fw, WALL_T * 0.6, 'frame', 'frame', { tags: ['frame'], groups: [[sill.id]] });
      const edges = [o.a0 + fw, ...mids.flatMap((mx) => [mx - 0.035, mx + 0.035]), o.a1 - fw];
      for (let i = 0; i < edges.length; i += 2) {
        const g = piece(edges[i] as number, edges[i + 1] as number, o.y0 + fw, o.y1 - fw, 0.035, 'glass', 'glass', { tags, color: 0xbfe3f2, groups: [[sill.id]], label: 'Window' });
        glassParts.push(g);
      }
    } else {
      const jl = b.autoSupport(piece(o.a0, o.a0 + fw, o.y0, o.y1 - fw, WALL_T + 0.04, 'frame', 'frame', { tags: ['frame'] }));
      const jr = b.autoSupport(piece(o.a1 - fw, o.a1, o.y0, o.y1 - fw, WALL_T + 0.04, 'frame', 'frame', { tags: ['frame'] }));
      piece(o.a0, o.a1, o.y1 - fw, o.y1, WALL_T + 0.04, 'frame', 'frame', { tags: ['frame'], groups: [[jl.id, jr.id]] });
      b.autoSupport(piece(o.a0 + fw, o.a1 - fw, o.y0, o.y1 - fw, 0.07, 'door', 'door', { tags, color: palette.door, label: 'Front door' }));
    }
  }

  // Ground floor slab (not counted: it never moves).
  const inX0 = -W / 2 + WALL_T;
  const inX1 = W / 2 - WALL_T;
  const inZ0 = -D + WALL_T;
  const inZ1 = -WALL_T;
  b.add({ kind: 'slab', mat: 'slab', x: 0, y: FOUNDATION_TOP / 2, z: -D / 2, hx: (inX1 - inX0) / 2, hy: FOUNDATION_TOP / 2, hz: (inZ1 - inZ0) / 2, house: false, color: 0xc7a983 });

  const bearing = (wall: Wall, yIn: number, x0: number, x1: number): number[] =>
    wallParts[wall].filter((p) => Math.abs(p.y - yIn) < BRICK_H / 2 - EPS && p.x + p.hx > x0 + 0.05 && p.x - p.hx < x1 - 0.05 && p.kind !== 'foundation').map((p) => p.id);

  // Interior partitions: plaster blocks, a doorway near the back.
  const partX = [-0.9, 1.2];
  const partition = (x: number, y0: number, y1: number, rows: number, key: string, onFloor: boolean): Part[] => {
    const out: Part[] = [];
    const rh = (y1 - y0) / rows;
    const doorRows = Math.round(2.05 / rh);
    for (let r = 0; r < rows; r++) {
      const ry0 = y0 + r * rh;
      const blocked: Array<[number, number]> = r < doorRows ? [[-D + 0.9, -D + 1.8]] : [];
      for (const [s0, s1] of courseBricks(inZ0, inZ1, blocked, (r % 2) * 0.45, 0.9)) {
        const p = b.add({ kind: 'partition', mat: 'plaster', x, z: r2((s0 + s1) / 2), y: r2(ry0 + rh / 2), hx: 0.075, hz: r2((s1 - s0) / 2), hy: r2(rh / 2), bond: key, span: 2, color: palette.plaster, tags: ['interior', 'partition'], room: 'inside' });
        b.autoSupport(p);
        void onFloor;
        out.push(p);
      }
    }
    return out;
  };

  const floorTop = FOUNDATION_TOP + STOREY_H;
  const groundCeil = storeys >= 2 ? floorTop - 0.2 : wallTop;
  const rooms: Room[] = [];
  const roomBox = (x0: number, x1: number, y0: number, y1: number): Box => ({ minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: inZ0, maxZ: inZ1 });
  rooms.push({ id: 'living', name: 'Living room', box: roomBox(inX0, partX[0] as number, FOUNDATION_TOP, groundCeil) });
  rooms.push({ id: 'hall', name: 'Hallway', box: roomBox(partX[0] as number, partX[1] as number, FOUNDATION_TOP, groundCeil) });
  rooms.push({ id: 'kitchen', name: 'Kitchen', box: roomBox(partX[1] as number, inX1, FOUNDATION_TOP, groundCeil) });
  const groundParts = partX.map((x, i) => partition(x, FOUNDATION_TOP, groundCeil, storeys >= 2 ? 5 : 6, `part-g${i}`, false));

  const furniture = (model: string, x: number, z0: number, y: number, room: string, extra: Partial<Part> = {}): Part => {
    const f = FURNITURE[model] as FurnitureDef;
    // In a deeper house, what stands against the back wall moves back with it.
    const z = z0 < -3 ? z0 - (D - 6) : z0;
    const p = b.add({
      kind: 'furniture',
      mat: f.mat,
      x,
      y: y + f.h / 2,
      z,
      hx: f.w / 2,
      hy: f.h / 2,
      hz: f.d / 2,
      hp: f.hp,
      points: f.points,
      knock: f.knock,
      fragile: f.fragile,
      label: f.label,
      model,
      room,
      tags: ['interior', model],
      ...extra,
    });
    return b.autoSupport(p);
  };

  const floor2Top = FOUNDATION_TOP + 2 * STOREY_H;
  if (storeys >= 2) {
    // Upper floor: one section per room, bearing on the front and back walls.
    const yIn = floorTop - 0.15;
    const secs: Array<[number, number, string]> = [
      [inX0, partX[0] as number, 'Bedroom floor'],
      [partX[0] as number, partX[1] as number, 'Landing floor'],
      [partX[1] as number, inX1, 'Study floor'],
    ];
    const trimmerZ = -2.4;
    // Stairwell: the landing floor stops at a trimmer beam carried by the two partitions.
    const topBlocks = (list: Part[], z0: number, z1: number): number[] => list.filter((p) => Math.abs(p.y + p.hy - groundCeil) < 0.02 && p.z + p.hz > z0 && p.z - p.hz < z1).map((p) => p.id);
    const trimmer = b.add({
      kind: 'beam',
      mat: 'timber',
      x: ((partX[0] as number) + (partX[1] as number)) / 2,
      y: groundCeil - 0.1,
      z: trimmerZ + 0.15,
      hx: ((partX[1] as number) - (partX[0] as number)) / 2 - 0.075,
      hy: 0.1,
      hz: 0.15,
      tags: ['support', 'beam'],
      label: 'Stair beam',
      color: 0xd9c7a6,
      groups: [topBlocks(groundParts[0] as Part[], trimmerZ, trimmerZ + 0.3), topBlocks(groundParts[1] as Part[], trimmerZ, trimmerZ + 0.3)],
    });
    for (const [x0, x1, label] of secs) {
      const hall = label === 'Landing floor';
      const z0 = hall ? trimmerZ : inZ0;
      const groups = [bearing('front', yIn, x0, x1), hall ? [trimmer.id] : bearing('back', yIn, x0, x1)];
      // A floor drops once two thirds of the wall under either edge has gone.
      const need = groups.map((g) => Math.max(1, Math.ceil(g.length / 3)));
      b.add({ kind: 'floor', mat: 'floor', x: (x0 + x1) / 2, y: floorTop - 0.1, z: (z0 + inZ1) / 2, hx: (x1 - x0) / 2, hy: 0.1, hz: (inZ1 - z0) / 2, groups, need, tags: ['floor', 'support'], label, color: 0xc89b6a, span: 0 });
    }
    const upTop = storeys === 3 ? floor2Top - 0.2 : wallTop + rise;
    rooms.push({ id: 'bedroom', name: 'Bedroom', box: roomBox(inX0, partX[0] as number, floorTop, upTop) });
    rooms.push({ id: 'landing', name: 'Landing', box: roomBox(partX[0] as number, partX[1] as number, floorTop, upTop) });
    rooms.push({ id: 'study', name: 'Study', box: roomBox(partX[1] as number, inX1, floorTop, upTop) });
    if (storeys === 3) partX.forEach((x, i) => partition(x, floorTop, floor2Top - 0.2, 5, `part-u${i}`, true));
    else partX.forEach((x, i) => partition(x, floorTop, wallTop, 6, `part-u${i}`, true));
    // Stairs up the left of the hall, rising to the landing.
    for (let k = 0; k < 9; k++) {
      const z1 = -5.6 + (k + 1) * 0.34;
      const top = FOUNDATION_TOP + (k + 1) * 0.3;
      b.autoSupport(b.add({ kind: 'stair', mat: 'wood', x: (partX[0] as number) + 0.075 + 0.5, y: (FOUNDATION_TOP + top) / 2, z: z1 - 0.17, hx: 0.5, hy: (top - FOUNDATION_TOP) / 2, hz: 0.17, hp: 3, points: 20, color: 0xa87a4f, tags: ['interior', 'stair'], room: 'hall', label: 'Stair' }));
    }
  }

  if (storeys === 3) {
    // Top floor: three full sections, bearing on the front and back walls, with an attic room over each.
    const yIn = floor2Top - 0.15;
    const secs: Array<[number, number, string, string]> = [
      [inX0, partX[0] as number, 'Attic floor', 'attic'],
      [partX[0] as number, partX[1] as number, 'Top landing floor', 'top-landing'],
      [partX[1] as number, inX1, 'Den floor', 'den'],
    ];
    for (const [x0, x1, label, room] of secs) {
      const groups = [bearing('front', yIn, x0, x1), bearing('back', yIn, x0, x1)];
      const need = groups.map((g) => Math.max(1, Math.ceil(g.length / 3)));
      b.add({ kind: 'floor', mat: 'floor', x: (x0 + x1) / 2, y: floor2Top - 0.1, z: (inZ0 + inZ1) / 2, hx: (x1 - x0) / 2, hy: 0.1, hz: (inZ1 - inZ0) / 2, groups, need, tags: ['floor', 'support'], label, color: 0xc89b6a, span: 0 });
      rooms.push({ id: room, name: label.replace(' floor', ''), box: roomBox(x0, x1, floor2Top, wallTop + rise) });
    }
    partX.forEach((x, i) => partition(x, floor2Top, wallTop, 6, `part-t${i}`, true));
  }

  // Roof: decks per section on each slope, tiles on the decks, a ridge beam on the gables.
  const ovZ = 0.35;
  const ovX = 0.25;
  const secN = W > 10 ? 4 : 3;
  const rx0 = -W / 2 - ovX;
  const secW = (W + 2 * ovX) / secN;
  const cosP = Math.cos(PITCH);
  const sinP = Math.sin(PITCH);
  const L = (ovZ + D / 2) / cosP;
  const deckT = 0.08;
  const tileT = 0.07;
  const topRow = (wall: Wall, x0: number, x1: number): number[] => wallParts[wall].filter((p) => Math.abs(p.y + p.hy - wallTop) < EPS && p.x + p.hx > x0 && p.x - p.hx < x1).map((p) => p.id);
  const gableTop = (wall: Wall): number[] => {
    const list = wallParts[wall].filter((p) => p.tags.includes('gable'));
    const maxY = Math.max(...list.map((p) => p.y));
    return list.filter((p) => p.y >= maxY - BRICK_H - EPS).map((p) => p.id);
  };
  const ridges: Part[] = [];
  for (let i = 0; i < secN; i++) {
    // Middle sections have nothing under them: they hang from their neighbours (span 1).
    const groups = i === 0 ? [gableTop('left')] : i === secN - 1 ? [gableTop('right')] : [[]];
    ridges.push(b.add({ kind: 'ridge', mat: 'timber', x: rx0 + secW * (i + 0.5), y: ridgeY + 0.08, z: -D / 2, hx: secW / 2, hy: 0.12, hz: 0.16, groups, span: 1, bond: 'ridge', tags: ['roof', 'support', 'ridge'], label: 'Ridge beam', color: palette.roof, solid: true }));
  }
  for (const slope of [1, -1]) {
    const wall: Wall = slope === 1 ? 'front' : 'back';
    // Tilt about x: positive tips local +z downward, so the front slope falls toward the front.
    const rot = slope * PITCH;
    const nY = cosP;
    const nZ = slope * sinP;
    const pt = (s: number, off: number): [number, number] => [ridgeY - s * sinP + nY * off, -D / 2 + slope * s * cosP + nZ * off];
    for (let i = 0; i < secN; i++) {
      const x0 = rx0 + secW * i;
      const [dy, dz] = pt(L / 2, deckT / 2);
      const deck = b.add({
        kind: 'deck',
        mat: 'deck',
        x: x0 + secW / 2,
        y: dy,
        z: dz,
        hx: secW / 2 - 0.01,
        hy: deckT / 2,
        hz: L / 2,
        rot,
        solid: false,
        // Needs at least half the wall top under it, and its ridge segment.
        groups: [topRow(wall, x0, x0 + secW), [(ridges[i] as Part).id]],
        need: [Math.ceil(topRow(wall, x0, x0 + secW).length * 0.5), 1],
        tags: ['roof', `roof-${wall}`],
        label: 'Roof section',
        color: 0x8a6a4a,
      });
      const cols = 5;
      const rows = 8;
      const tl = L / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const [ty, tz] = pt((r + 0.5) * tl, deckT + tileT / 2 + (r % 2) * 0.012);
          const tint = brickColor(palette.roof, r * 17 + c * 5 + i * 41 + (slope > 0 ? 0 : 999));
          b.add({ kind: 'tile', mat: 'tile', x: x0 + (c + 0.5) * (secW / cols), y: ty, z: tz, hx: secW / cols / 2 - 0.012, hy: tileT / 2, hz: tl / 2 + 0.01, rot, groups: [[deck.id]], tags: ['roof', 'tile', `roof-${wall}`], color: tint });
        }
      }
    }
  }

  // Chimney: a two-brick stack against the right gable, with its own footing.
  if (spec.chimney) {
    const cx0 = W / 2 + 0.3;
    const top = ridgeY + 1.2;
    const rows = Math.round(top / BRICK_H);
    for (let r = 0; r < rows; r++) {
      const y0 = r * BRICK_H;
      for (let c = 0; c < 2; c++) {
        const foundation = y0 < FOUNDATION_TOP - EPS;
        const p = b.add({ kind: foundation ? 'foundation' : 'brick', mat: foundation ? 'foundation' : 'brick', x: cx0 + 0.3 + c * BRICK_L, y: y0 + BRICK_H / 2, z: -D / 2, hx: BRICK_L / 2, hy: BRICK_H / 2, hz: 0.3, bond: 'chimney', span: 0, capacity: 1e9, color: foundation ? 0xa9a59c : brickColor(palette.brick, r * 3 + c + 77), tags: ['chimney'], label: 'Chimney' });
        b.autoSupport(p);
      }
    }
    b.autoSupport(b.add({ kind: 'beam', mat: 'lintel', x: cx0 + 0.6, y: rows * BRICK_H + 0.08, z: -D / 2, hx: 0.68, hy: 0.08, hz: 0.38, tags: ['chimney'], label: 'Chimney cap', color: 0xd8d0c0, points: 40 }));
  }

  // Porch: two columns carry a beam; the beam and the front wall carry the porch roof.
  if (spec.porch) {
    const ph = storeys >= 2 ? 3.0 : 2.7;
    const pz = 1.95;
    b.add({ kind: 'slab', mat: 'slab', x: doorX, y: FOUNDATION_TOP / 2, z: 1.05, hx: 1.7, hy: FOUNDATION_TOP / 2, hz: 1.05, house: false, color: 0xd6d0c4, tags: ['porch'] });
    const cols = [-1.45, 1.45].map((dx) =>
      b.autoSupport(b.add({ kind: 'column', mat: 'timber', x: doorX + dx, y: (FOUNDATION_TOP + ph) / 2, z: pz, hx: 0.12, hy: (ph - FOUNDATION_TOP) / 2, hz: 0.12, tags: ['porch', 'support', 'column'], label: 'Porch column', color: palette.trim })),
    );
    const beam = b.add({ kind: 'beam', mat: 'timber', x: doorX, y: ph + 0.1, z: pz, hx: 1.7, hy: 0.1, hz: 0.14, groups: [[(cols[0] as Part).id], [(cols[1] as Part).id]], tags: ['porch', 'support', 'beam'], label: 'Porch beam', color: palette.trim });
    const tilt = 12 * (Math.PI / 180);
    const len = 2.35;
    const yWall = ph + 0.2 + Math.tan(tilt) * pz + 0.06;
    b.add({
      kind: 'deck',
      mat: 'deck',
      x: doorX,
      y: yWall - Math.sin(tilt) * (len / 2),
      z: Math.cos(tilt) * (len / 2),
      hx: 1.85,
      hy: 0.06,
      hz: len / 2,
      rot: tilt,
      solid: true,
      hp: 3,
      groups: [[beam.id], bearing('front', yWall - 0.1, doorX - 1.7, doorX + 1.7)],
      tags: ['porch', 'porch-roof'],
      label: 'Porch roof',
      color: palette.roof,
    });
  }

  // Furniture.
  const F = FOUNDATION_TOP;
  if (spec.furnish) {
    furniture('tvStand', -2.6, -5.38, F, 'living');
    furniture('tv', -2.6, -5.4, F + 0.55, 'living', { tags: ['interior', 'tv', 'target'] });
    furniture('sofa', -2.6, -2.3, F, 'living');
    furniture('coffeeTable', -2.6, -3.55, F, 'living');
    furniture('floorLamp', -3.85, -0.75, F, 'living');
    furniture('bookshelf', -3.95, -1.6, F, 'living', { hx: 0.175, hz: 0.5 });
    furniture('plant', -1.35, -5.3, F, 'living');
    furniture('coatRack', 0.8, -0.75, F, 'hall');
    furniture('clock', 0.82, -3.7, F, 'hall', { tags: ['interior', 'clock', 'target'] });
    furniture('counter', 2.3, -5.37, F, 'kitchen');
    furniture('vase', 2.1, -5.37, F + 0.95, 'kitchen');
    furniture('fridge', 3.75, -5.3, F, 'kitchen');
    furniture('diningTable', 2.75, -2.6, F, 'kitchen');
    furniture('chair', 1.8, -2.6, F, 'kitchen');
    furniture('chair', 3.7, -2.6, F, 'kitchen');
    if (storeys >= 2) {
      const U = floorTop;
      furniture('bed', -2.4, -4.6, U, 'bedroom');
      furniture('nightstand', -1.3, -5.35, U, 'bedroom');
      furniture('vase', -1.3, -5.35, U + 0.55, 'bedroom', { label: 'Bedside lamp' });
      furniture('wardrobe', -3.85, -1.2, U, 'bedroom', { hx: 0.3, hz: 0.6 });
      furniture('pedestal', 0.3, -1.6, U, 'landing');
      furniture('trophy', 0.3, -1.6, U + 1.0, 'landing', { tags: ['interior', 'trophy', 'target'] });
      furniture('desk', 2.8, -5.3, U, 'study');
      furniture('monitor', 2.8, -5.35, U + 0.75, 'study', { tags: ['interior', 'monitor', 'target'] });
      furniture('bookshelf', 3.97, -1.4, U, 'study', { hx: 0.175, hz: 0.5 });
      furniture('chair', 2.8, -4.5, U, 'study');
    }
    if (storeys === 3) {
      const T = floor2Top;
      furniture('bed', -2.4, -4.6, T, 'attic');
      furniture('wardrobe', -3.85, -1.2, T, 'attic', { hx: 0.3, hz: 0.6 });
      furniture('bookshelf', 0.3, -5.3, T, 'top-landing');
      furniture('sofa', 2.8, -4.9, T, 'den');
      furniture('tvStand', 2.8, -1.4, T, 'den');
      furniture('tv', 2.8, -1.42, T + 0.55, 'den');
    }
  }

  // The lot: trees, hedges and garden pieces.
  for (const t of yard.trees) {
    const s = t.s;
    b.add({ kind: 'trunk', mat: 'trunk', x: t.x, y: 1.8 * s, z: t.z, hx: 0.2 * s, hy: 1.8 * s, hz: 0.2 * s, house: false, tags: ['tree'], color: 0x6b4a32 });
    b.add({ kind: 'branch', mat: 'branch', x: t.x + 0.9 * s, y: 3.0 * s, z: t.z, hx: 0.75 * s, hy: 0.08 * s, hz: 0.08 * s, house: false, tags: ['tree'], color: 0x6b4a32 });
    b.add({ kind: 'branch', mat: 'branch', x: t.x - 0.8 * s, y: 3.5 * s, z: t.z + 0.2 * s, hx: 0.65 * s, hy: 0.08 * s, hz: 0.08 * s, house: false, tags: ['tree'], color: 0x6b4a32 });
    b.add({ kind: 'foliage', mat: 'foliage', x: t.x, y: 4.6 * s, z: t.z, hx: 2.0 * s, hy: 1.6 * s, hz: 2.0 * s, solid: false, soft: true, house: false, tags: ['tree'], color: 0x5f9a4a });
  }
  const hedge = (x: number, z: number, hx: number, hz: number): void => {
    b.add({ kind: 'hedge', mat: 'hedge', x, y: 0.75, z, hx, hy: 0.75, hz, house: false, tags: ['hedge'], color: 0x4d8a3e });
  };
  hedge(0, -13, 15, 0.6);
  hedge(-15, 0, 0.6, 13);
  hedge(15, 0, 0.6, 13);
  for (const d of yard.decor) {
    const f = FURNITURE[d.model] as FurnitureDef;
    b.autoSupport(b.add({ kind: 'decor', mat: f.mat, x: d.x, y: f.h / 2, z: d.z, hx: f.w / 2, hy: f.h / 2, hz: f.d / 2, points: f.points, knock: true, fragile: f.fragile, label: f.label, model: d.model, house: false, tags: ['decor', d.model] }));
  }
  if (spec.porch) {
    for (const dx of [-1.45, 1.45]) b.autoSupport(b.add({ kind: 'decor', mat: 'ceramic', x: doorX + dx, y: FOUNDATION_TOP + 0.225, z: 1.35, hx: 0.2, hy: 0.225, hz: 0.2, points: 30, knock: true, fragile: true, label: 'Plant pot', model: 'pot', house: false, tags: ['decor', 'pot'] }));
  }

  b.link();
  void glassParts;
  void lintels;

  // Bigger houses put the tee further back, so the whole house still fits the view.
  const tee = { x: spec.teeX ?? 0, y: 0, z: 20 + Math.max(0, W - 9) * 1.2 + (storeys === 3 ? 3 : 0) };
  const info: HouseInfo = {
    W,
    D,
    storeys,
    wallTop,
    ridgeY,
    pitch: PITCH,
    interior: { minX: inX0, maxX: inX1, minY: FOUNDATION_TOP - 0.05, maxY: ridgeY, minZ: inZ0, maxZ: inZ1 },
    rooms,
    doorX,
    tee,
    perches: [-2.6, -0.4, 1.9, 3.1].map((x) => ({ x, y: ridgeY + 0.22, z: -D / 2 })),
    paving: [{ minX: doorX - 0.7, maxX: doorX + 0.7, minZ: 2.1, maxZ: tee.z - 3 }],
    bounds: { minX: -16, maxX: 16, minY: -1, maxY: 40, minZ: -15, maxZ: tee.z + 8 },
    palette,
    trees: yard.trees,
  };
  return { parts: b.parts, info };
}
