import { BALLS, type BallDef, type BallId } from './balls';
import { buildLevel, type HouseInfo, type HouseSpec, type YardSpec } from './house';
import { MATERIALS } from './materials';
import { DEG, Rng, clamp } from './math';
import { PartState, partBox, type Box, type Part } from './parts';

/**
 * The golf demolition simulation. Deterministic and fixed-step: the same
 * level and the same shots always give the same result, so levels can be
 * proven solvable in tests and the renderer only ever reads from it.
 *
 * - Balls are spheres, sub-stepped so they never tunnel through a brick.
 * - Parts are static until they break (removed) or lose support (become
 *   falling debris). Support is a graph: every part rests on others, bonds
 *   sideways to its neighbours, and passes its load down.
 * - Falling debris is a box with gravity and spin that lands on the ground,
 *   on rubble or on standing parts, and can break what it lands on.
 */

export const DT = 1 / 120;
export const GRAVITY = 9.81;
/** How close to a mortar joint (m) the contact point must be for a seam shot. */
export const SEAM_TOL = 0.04;
/** Maximum angle between the ball's path and the wall normal for a seam shot. */
export const SEAM_MAX_ANGLE = 38;
/** Share of the hit each brick takes on a seam shot. */
export const SEAM_SHARE = 0.78;
/** Damage per unit of ½mv² (ball units, m/s). */
export const DAMAGE_K = 1 / 100;
const MAX_DEBRIS = 520;
/** Falling pieces hit what they land on this hard (share of the ball damage formula). */
const DEBRIS_DAMAGE = 1.2;

export type RetireReason = 'rest' | 'out' | 'time' | 'blast';

export type SimEvent =
  | { t: 'launch'; ball: number; x: number; y: number; z: number; golfer: number }
  | { t: 'hit'; ball: number; part: number; x: number; y: number; z: number; speed: number; broke: boolean; seam: number }
  | { t: 'ground'; ball: number; x: number; y: number; z: number; speed: number; paved: boolean }
  | { t: 'break'; part: number; cause: 'ball' | 'blast' | 'debris' | 'overload' | 'land'; ball: number; x: number; y: number; z: number }
  | { t: 'knock'; part: number; ball: number; x: number; y: number; z: number }
  | { t: 'release'; part: number }
  | { t: 'creak'; part: number }
  | { t: 'land'; part: number; speed: number; x: number; y: number; z: number }
  | { t: 'collapse'; count: number; x: number; y: number; z: number; roof: number; floor: number }
  | { t: 'blast'; ball: number; x: number; y: number; z: number; r: number }
  | { t: 'enter'; ball: number; room: string }
  | { t: 'exit'; ball: number }
  | { t: 'leaves'; part: number; ball: number; x: number; y: number; z: number }
  | { t: 'retire'; ball: number; reason: RetireReason; x: number; y: number; z: number }
  | { t: 'seam'; ball: number; a: number; b: number; x: number; y: number; z: number };

export interface Shot {
  ball: BallId;
  /** Degrees, 0 = straight at the house, positive = right. */
  yaw: number;
  /** Degrees above horizontal. */
  pitch: number;
  /** 0..1 */
  power: number;
}

export interface ShotMods {
  /** Damage multiplier (Power Drive). */
  damage: number;
  /** Launch speed multiplier (Power Drive). */
  speed: number;
  /** Extra bounce for the first N contacts (Ricochet Boost). */
  bounceBonus: number;
  bounceHits: number;
  /** Golfers in the volley (Multi-Golfer); 1 = just you. */
  golfers: number;
}

export const NO_MODS: ShotMods = { damage: 1, speed: 1, bounceBonus: 0, bounceHits: 0, golfers: 1 };

export interface Ball {
  id: number;
  def: BallDef;
  golfer: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  alive: boolean;
  /** Seconds before it is launched (volleys are staggered). */
  delay: number;
  age: number;
  bounces: number;
  restT: number;
  /** Sideways curve (m/s²), only until the first contact. */
  hookX: number;
  hookZ: number;
  damage: number;
  bounceBonus: number;
  bounceHits: number;
  /** Distinct parts this ball has hit. */
  touched: Set<number>;
  room: string;
  wasInside: boolean;
  /** Which face of the house the ball came in through. */
  entrySide: string;
  exited: boolean;
  inFoliage: number;
  launchX: number;
  launchY: number;
  launchZ: number;
  power: number;
}

export interface Debris {
  part: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  wx: number;
  wy: number;
  wz: number;
  mass: number;
  age: number;
  still: number;
  /** World half extents of the rotated box. */
  ex: number;
  ey: number;
  ez: number;
  restOn: number;
  asleep: boolean;
}

export interface Contact {
  part: Part;
  nx: number;
  ny: number;
  nz: number;
  depth: number;
  /** Contact point. */
  px: number;
  py: number;
  pz: number;
}

export interface SeamInfo {
  other: Part | null;
  /** Distance from the joint, m. */
  dist: number;
}

/**
 * A settled world, compact enough for localStorage: only what differs from a
 * freshly built house of the same spec. Numbers are flattened into arrays.
 */
export interface WorldSnapshot {
  v: 1;
  /** Part count of the house it came from (a different house refuses it). */
  n: number;
  time: number;
  rng: number;
  ball: number;
  /** [id, state, hp] for every part that is not a fresh, intact part. */
  parts: number[];
  /** [id, x, y, z, qx, qy, qz, qw, restOn] for every piece of rubble. */
  rubble: number[];
  /** [cell, height] for every raised cell of the rubble heightfield. */
  heights: number[];
}

const SNAP_PART = 3;
const SNAP_RUBBLE = 9;
const round = (v: number, k: number): number => Math.round(v * k) / k;

const CELL = 1;
const key = (ix: number, iy: number, iz: number): number => ((ix + 64) * 128 + (iy + 8)) * 128 + (iz + 64);

/** Launch velocity for a shot. */
export function launchVelocity(def: BallDef, shot: Shot, mods: ShotMods = NO_MODS, yawOffset = 0): { vx: number; vy: number; vz: number; speed: number } {
  const speed = (def.minSpeed + clamp(shot.power, 0, 1) * (def.maxSpeed - def.minSpeed)) * mods.speed;
  const yaw = (shot.yaw + yawOffset) * DEG;
  const pitch = shot.pitch * DEG;
  return { vx: Math.sin(yaw) * Math.cos(pitch) * speed, vy: Math.sin(pitch) * speed, vz: -Math.cos(yaw) * Math.cos(pitch) * speed, speed };
}

/** Golfer tee positions for a volley of n golfers. */
export function golferSpots(info: HouseInfo, n: number): Array<{ x: number; z: number }> {
  if (n <= 1) return [{ x: info.tee.x, z: info.tee.z }];
  const gap = 2.8;
  return Array.from({ length: n }, (_, i) => ({ x: info.tee.x + (i - (n - 1) / 2) * gap, z: info.tee.z + Math.abs(i - (n - 1) / 2) * 0.6 }));
}

export class World {
  readonly parts: Part[];
  readonly info: HouseInfo;
  readonly rng: Rng;
  balls: Ball[] = [];
  debris: Debris[] = [];
  events: SimEvent[] = [];
  time = 0;
  wind = { x: 0, z: 0 };
  /** When each overloaded part will give way. */
  pending = new Map<number, number>();
  load: Float64Array;
  private grid = new Map<number, number[]>();
  private stamp: Uint32Array;
  private stampN = 1;
  private dirty = false;
  private nextBall = 1;
  private resting = new Map<number, number[]>();
  private heights: Float32Array;
  private lastBlast = { x: 0, y: 0, z: 0, t: -10, r: 0 };
  private debrisIndex = new Map<number, Debris>();
  /** Total weight of house parts, for the destruction percentage. */
  readonly houseWeight: number;
  /** Parts sorted so everything comes after what it rests on. */
  private readonly supportOrder: number[];

  constructor(spec: HouseSpec, yard: YardSpec, seed = 1) {
    const { parts, info } = buildLevel(spec, yard);
    this.parts = parts;
    this.info = info;
    this.rng = new Rng(seed);
    this.stamp = new Uint32Array(parts.length);
    this.load = new Float64Array(parts.length);
    this.heights = new Float32Array(HF_NX * HF_NZ);
    for (const p of parts) this.insert(p);
    this.houseWeight = parts.reduce((s, p) => s + (p.house ? scoreWeight(p) : 0), 0);
    this.supportOrder = supportOrder(parts);
    this.solve(false);
  }

  // ------------------------------------------------------------------ grid

  private insert(p: Part): void {
    const b = partBox(p);
    for (let ix = Math.floor(b.minX / CELL); ix <= Math.floor(b.maxX / CELL); ix++)
      for (let iy = Math.floor(b.minY / CELL); iy <= Math.floor(b.maxY / CELL); iy++)
        for (let iz = Math.floor(b.minZ / CELL); iz <= Math.floor(b.maxZ / CELL); iz++) {
          const k = key(ix, iy, iz);
          let list = this.grid.get(k);
          if (!list) this.grid.set(k, (list = []));
          list.push(p.id);
        }
  }

  /** Intact parts whose cells overlap the box. */
  query(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, out: Part[]): Part[] {
    out.length = 0;
    const s = ++this.stampN;
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++)
      for (let iy = Math.floor(minY / CELL); iy <= Math.floor(maxY / CELL); iy++)
        for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
          const list = this.grid.get(key(ix, iy, iz));
          if (!list) continue;
          for (const id of list) {
            if (this.stamp[id] === s) continue;
            this.stamp[id] = s;
            const p = this.parts[id] as Part;
            if (p.state === PartState.Intact) out.push(p);
          }
        }
    return out;
  }

  // ------------------------------------------------------------- shooting

  /** Fires a shot: one ball, a fan of balls, or a volley from several golfers. Returns the new balls. */
  launch(shot: Shot, mods: ShotMods = NO_MODS): Ball[] {
    const def = BALLS[shot.ball];
    const spots = golferSpots(this.info, mods.golfers);
    const out: Ball[] = [];
    spots.forEach((spot, g) => {
      for (let i = 0; i < def.count; i++) {
        const off = def.count > 1 ? (i - (def.count - 1) / 2) * def.spread : 0;
        const pitchOff = def.count > 1 ? (i % 2 === 0 ? 0 : 1.6) : 0;
        const v = launchVelocity(def, { ...shot, pitch: shot.pitch + pitchOff }, mods, off);
        const hook = def.hook * Math.max(0, shot.power - 0.8) / 0.2;
        const yaw = (shot.yaw + off) * DEG;
        const b: Ball = {
          id: this.nextBall++,
          def,
          golfer: g,
          x: spot.x,
          y: def.radius + 0.04,
          z: spot.z,
          vx: v.vx,
          vy: v.vy,
          vz: v.vz,
          alive: true,
          delay: g * 0.22,
          age: 0,
          bounces: 0,
          restT: 0,
          hookX: Math.cos(yaw) * hook,
          hookZ: Math.sin(yaw) * hook,
          damage: def.damage * mods.damage,
          bounceBonus: mods.bounceBonus,
          bounceHits: mods.bounceHits,
          touched: new Set(),
          room: '',
          wasInside: false,
          entrySide: '',
          exited: false,
          inFoliage: -1,
          launchX: spot.x,
          launchY: def.radius + 0.04,
          launchZ: spot.z,
          power: shot.power,
        };
        this.balls.push(b);
        out.push(b);
      }
    });
    return out;
  }

  get activeBalls(): number {
    let n = 0;
    for (const b of this.balls) if (b.alive) n++;
    return n;
  }

  get activeDebris(): number {
    let n = 0;
    for (const d of this.debris) if (!d.asleep) n++;
    return n;
  }

  /** Nothing is moving and nothing is about to give way. */
  get settled(): boolean {
    return this.activeBalls === 0 && this.activeDebris === 0 && this.pending.size === 0 && !this.dirty;
  }

  // -------------------------------------------------------------- stepping

  step(dt = DT): void {
    this.time += dt;
    for (const b of this.balls) if (b.alive) this.stepBall(b, dt);
    this.stepDebris(dt);
    for (const [id, at] of this.pending) {
      if (this.time >= at) {
        this.pending.delete(id);
        const p = this.parts[id] as Part;
        if (p.state === PartState.Intact) this.breakPart(p, 'overload', 0);
      }
    }
    if (this.dirty) this.solve(true);
  }

  /** Runs until everything is still (or the time cap). Used by tests and the level checker. */
  runUntilSettled(maxSeconds = 20): void {
    const end = this.time + maxSeconds;
    while (this.time < end) {
      this.step();
      if (this.settled) break;
    }
    if (!this.settled) this.forceSettle();
  }

  /** Puts every moving thing to rest where it is. */
  forceSettle(): void {
    for (const b of this.balls) if (b.alive) this.retire(b, 'time');
    for (const d of this.debris) if (!d.asleep) this.sleep(d);
    for (const [id] of this.pending) {
      const p = this.parts[id] as Part;
      if (p.state === PartState.Intact) this.breakPart(p, 'overload', 0);
    }
    this.pending.clear();
    if (this.dirty) this.solve(true);
    for (const d of this.debris) if (!d.asleep) this.sleep(d);
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ----------------------------------------------------------------- balls

  private retire(b: Ball, reason: RetireReason): void {
    b.alive = false;
    this.events.push({ t: 'retire', ball: b.id, reason, x: b.x, y: b.y, z: b.z });
  }

  private tmp: Part[] = [];

  /** Deepest contact between a sphere and the intact solid parts. */
  contactAt(x: number, y: number, z: number, r: number, skipSoft = true): Contact | null {
    const list = this.query(x - r, y - r, z - r, x + r, y + r, z + r, this.tmp);
    let best: Contact | null = null;
    for (const p of list) {
      if (!p.solid || (skipSoft && p.soft)) continue;
      const c = sphereBox(p, x, y, z, r);
      if (c && (!best || c.depth > best.depth)) best = c;
    }
    return best;
  }

  /** Seam check for a contact on a brick face: is the contact point on a mortar joint with a standing neighbour? */
  seamAt(c: Contact): SeamInfo {
    const p = c.part;
    if (p.kind !== 'brick' && p.kind !== 'foundation') return { other: null, dist: Infinity };
    // Local contact point (bricks have no tilt).
    const qx = c.px - p.x;
    const qy = c.py - p.y;
    const qz = c.pz - p.z;
    const ax = Math.abs(c.nx);
    const ay = Math.abs(c.ny);
    const az = Math.abs(c.nz);
    // Face axes: the two that are not the normal.
    const axes: Array<['x' | 'y' | 'z', number, number]> = [];
    if (!(ax >= ay && ax >= az)) axes.push(['x', qx, p.hx]);
    if (!(ay > ax && ay >= az)) axes.push(['y', qy, p.hy]);
    if (!(az > ax && az > ay)) axes.push(['z', qz, p.hz]);
    let bestAxis: 'x' | 'y' | 'z' = 'x';
    let bestDist = Infinity;
    let sign = 1;
    for (const [axis, q, h] of axes) {
      const d = h - Math.abs(q);
      if (d < bestDist) {
        bestDist = d;
        bestAxis = axis;
        sign = q >= 0 ? 1 : -1;
      }
    }
    if (bestDist > SEAM_TOL) return { other: null, dist: bestDist };
    const step = bestDist + 0.05;
    const tx = c.px + (bestAxis === 'x' ? sign * step : 0) - c.nx * 0.05;
    const ty = c.py + (bestAxis === 'y' ? sign * step : 0) - c.ny * 0.05;
    const tz = c.pz + (bestAxis === 'z' ? sign * step : 0) - c.nz * 0.05;
    const list = this.query(tx, ty, tz, tx, ty, tz, this.tmp);
    for (const q of list) {
      if (q === p || (q.kind !== 'brick' && q.kind !== 'foundation') || q.bond !== p.bond) continue;
      if (Math.abs(tx - q.x) <= q.hx + 1e-3 && Math.abs(ty - q.y) <= q.hy + 1e-3 && Math.abs(tz - q.z) <= q.hz + 1e-3) return { other: q, dist: bestDist };
    }
    return { other: null, dist: bestDist };
  }

  private stepBall(b: Ball, dt: number): void {
    if (b.delay > 0) {
      b.delay -= dt;
      return;
    }
    if (b.age === 0) this.events.push({ t: 'launch', ball: b.id, x: b.x, y: b.y, z: b.z, golfer: b.golfer });
    b.age += dt;
    const def = b.def;
    const r = def.radius;
    const speed0 = Math.hypot(b.vx, b.vy, b.vz);
    const n = Math.max(1, Math.ceil((speed0 * dt) / (r * 0.45)));
    const h = dt / n;
    let grounded = false;
    for (let i = 0; i < n && b.alive; i++) {
      // Forces: gravity, drag, wind, hook (until the first contact).
      const sp = Math.hypot(b.vx, b.vy, b.vz);
      const drag = def.drag * sp;
      b.vx += (-drag * b.vx + this.wind.x + (b.bounces === 0 ? b.hookX : 0)) * h;
      b.vy += (-drag * b.vy - GRAVITY) * h;
      b.vz += (-drag * b.vz + this.wind.z + (b.bounces === 0 ? b.hookZ : 0)) * h;
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.z += b.vz * h;

      // Foliage: slows the ball and nudges it.
      const soft = this.query(b.x - r, b.y - r, b.z - r, b.x + r, b.y + r, b.z + r, this.tmp).find((p) => p.soft && insideEllipsoid(p, b.x, b.y, b.z));
      if (soft) {
        const k = Math.max(0, 1 - 2.6 * h);
        b.vx *= k;
        b.vy *= k;
        b.vz *= k;
        if (b.inFoliage !== soft.id) {
          b.inFoliage = soft.id;
          const a = (this.rng.next() - 0.5) * 0.5;
          const c = Math.cos(a);
          const s = Math.sin(a);
          const vx = b.vx * c - b.vz * s;
          b.vz = b.vx * s + b.vz * c;
          b.vx = vx;
          this.events.push({ t: 'leaves', part: soft.id, ball: b.id, x: b.x, y: b.y, z: b.z });
        }
      } else b.inFoliage = -1;

      // Ground.
      if (b.y - r < 0) {
        const paved = this.info.paving.some((p) => b.x >= p.minX && b.x <= p.maxX && b.z >= p.minZ && b.z <= p.maxZ);
        b.y = r;
        const vn = -b.vy;
        if (def.blastRadius > 0 && vn > 3) {
          this.detonate(b, b.x, 0, b.z);
          return;
        }
        const e = clamp((paved ? 0.55 : 0.36) * def.bounce, 0, 0.92);
        if (vn > 1.1) {
          b.vy = vn * e;
          const grip = (paved ? 0.12 : 0.28) * def.grip;
          b.vx *= 1 - grip;
          b.vz *= 1 - grip;
          if (vn > 2) this.events.push({ t: 'ground', ball: b.id, x: b.x, y: 0, z: b.z, speed: vn, paved });
          b.bounces++;
        } else {
          b.vy = Math.max(0, b.vy);
          grounded = true;
        }
      }

      const c = this.contactAt(b.x, b.y, b.z, r);
      if (c) {
        this.resolveHit(b, c);
        if (!b.alive) return;
        if (c.ny > 0.6) grounded = true;
      }
    }

    // Rolling friction on the ground or a floor.
    if (grounded) {
      const hs = Math.hypot(b.vx, b.vz);
      if (hs > 0) {
        const dec = Math.min(hs, (2.2 * Math.max(0.4, def.grip) + 0.5) * dt);
        b.vx -= (b.vx / hs) * dec;
        b.vz -= (b.vz / hs) * dec;
      }
    }

    // Where is it: inside the house, which room.
    const inn = this.info.interior;
    const inside = b.x > inn.minX && b.x < inn.maxX && b.z > inn.minZ && b.z < inn.maxZ && b.y > inn.minY && b.y < inn.maxY;
    if (inside) {
      const room = this.info.rooms.find((rm) => b.x >= rm.box.minX && b.x <= rm.box.maxX && b.y >= rm.box.minY && b.y <= rm.box.maxY)?.id ?? 'inside';
      if (!b.wasInside) b.entrySide = sideOf(inn, b.x, b.y, b.z);
      if (room !== b.room) {
        b.room = room;
        this.events.push({ t: 'enter', ball: b.id, room });
      }
      b.wasInside = true;
    } else if (b.wasInside && !b.exited && b.room) {
      b.room = '';
      // Only a different side counts as going through; bouncing back out the way it came does not.
      if (sideOf(inn, b.x, b.y, b.z) !== b.entrySide) {
        b.exited = true;
        this.events.push({ t: 'exit', ball: b.id });
      }
    } else b.room = '';

    // Retire: out of the lot, at rest, or too old.
    const bd = this.info.bounds;
    if (b.x < bd.minX || b.x > bd.maxX || b.z < bd.minZ || b.z > bd.maxZ || b.y < bd.minY || b.y > bd.maxY) return this.retire(b, 'out');
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    b.restT = sp < 0.45 ? b.restT + dt : 0;
    if (b.restT > 0.45) return this.retire(b, 'rest');
    if (b.age > def.lifetime) return this.retire(b, 'time');
  }

  private resolveHit(b: Ball, c: Contact): void {
    const def = b.def;
    const p = c.part;
    const m = MATERIALS[p.mat];
    // Push out of the surface.
    b.x += c.nx * c.depth;
    b.y += c.ny * c.depth;
    b.z += c.nz * c.depth;
    const vn = -(b.vx * c.nx + b.vy * c.ny + b.vz * c.nz);
    if (vn <= 0) return;
    const speed = Math.hypot(b.vx, b.vy, b.vz);

    if (def.blastRadius > 0 && vn > 3) {
      this.detonate(b, c.px, c.py, c.pz);
      return;
    }

    // Damage from the normal component of the impact.
    const raw = 0.5 * def.mass * vn * vn * DAMAGE_K * b.damage;
    const significant = vn > 1.5;
    let broke = false;
    let absorbed = 0;
    let seamWith = -1;
    if (significant) {
      b.touched.add(p.id);
      const cos = vn / Math.max(1e-6, speed);
      let targets: Part[] = [p];
      if (def.radius < 0.15 && cos >= Math.cos(SEAM_MAX_ANGLE * DEG)) {
        const seam = this.seamAt(c);
        if (seam.other) {
          targets = [p, seam.other];
          seamWith = seam.other.id;
          b.touched.add(seam.other.id);
          this.events.push({ t: 'seam', ball: b.id, a: p.id, b: seam.other.id, x: c.px, y: c.py, z: c.pz });
        }
      }
      const share = targets.length > 1 ? SEAM_SHARE : 1;
      let allBroke = true;
      for (const t of targets) {
        const before = t.hp;
        const res = this.damagePart(t, raw * share, 'ball', b.id, c.px, c.py, c.pz, b);
        if (res === 'broke') absorbed += Math.min(before, raw * share);
        else {
          allBroke = false;
          absorbed += raw * share;
        }
      }
      broke = allBroke;
      // Heavy balls shove the parts around the one they hit.
      if (def.knock > 0) {
        for (const nb of [...p.lateral, ...p.supporting, ...p.groups.flat()]) {
          const q = this.parts[nb] as Part;
          if (q.state === PartState.Intact && q.solid) this.damagePart(q, raw * def.knock * 0.5, 'ball', b.id, q.x, q.y, q.z, b);
        }
      }
      this.events.push({ t: 'hit', ball: b.id, part: p.id, x: c.px, y: c.py, z: c.pz, speed: vn, broke, seam: seamWith });
    }

    const leftover = raw > 0 ? Math.max(0, 1 - absorbed / raw) : 0;
    if (broke && m.passable && leftover > 0.2) {
      // Clean through: keep going with what is left.
      const k = Math.sqrt(leftover) * m.passKeep;
      b.vx *= k;
      b.vy *= k;
      b.vz *= k;
      b.x -= c.nx * c.depth * 2;
      b.y -= c.ny * c.depth * 2;
      b.z -= c.nz * c.depth * 2;
      return;
    }
    // Bounce: reflect the normal component, scrub some tangential speed.
    let e = m.bounce * def.bounce;
    if (b.bounceHits > 0 && significant) {
      e += b.bounceBonus;
      b.bounceHits--;
    }
    if (b.bounces >= def.maxBounces) e *= 0.35;
    if (broke) e *= 0.5;
    e = clamp(e, 0, 0.95);
    if (vn < 1.1) e = 0;
    const tx = b.vx + vn * c.nx;
    const ty = b.vy + vn * c.ny;
    const tz = b.vz + vn * c.nz;
    const keep = 1 - clamp(m.grip * def.grip * (significant ? 1 : 0.15), 0, 0.9);
    b.vx = tx * keep + c.nx * vn * e;
    b.vy = ty * keep + c.ny * vn * e;
    b.vz = tz * keep + c.nz * vn * e;
    if (significant) b.bounces++;
  }

  private detonate(b: Ball, x: number, y: number, z: number): void {
    const R = b.def.blastRadius;
    this.events.push({ t: 'blast', ball: b.id, x, y, z, r: R });
    this.lastBlast = { x, y, z, t: this.time, r: R };
    const list = this.query(x - R, y - R, z - R, x + R, y + R, z + R, []);
    for (const p of list) {
      const bx = partBox(p);
      const dx = Math.max(bx.minX - x, 0, x - bx.maxX);
      const dy = Math.max(bx.minY - y, 0, y - bx.maxY);
      const dz = Math.max(bx.minZ - z, 0, z - bx.maxZ);
      const d = Math.hypot(dx, dy, dz);
      if (d > R || p.soft) continue;
      const f = 1 - d / R;
      b.touched.add(p.id);
      this.damagePart(p, 5.5 * f * f * b.damage + 0.4 * f, 'blast', b.id, p.x, p.y, p.z, b);
    }
    b.alive = false;
    this.events.push({ t: 'retire', ball: b.id, reason: 'blast', x, y, z });
  }

  /** Applies damage. Knockable pieces come loose instead of soaking it up. */
  damagePart(p: Part, dmg: number, cause: 'ball' | 'blast' | 'debris', ball: number, x: number, y: number, z: number, src?: Ball): 'none' | 'broke' | 'knocked' {
    if (p.state !== PartState.Intact || !Number.isFinite(p.hp0) && !p.knock) return 'none';
    if (p.knock && dmg < p.hp) {
      if (dmg < 0.05) return 'none';
      this.knockLoose(p, ball, x, y, z, src, cause === 'blast');
      return 'knocked';
    }
    p.hp -= dmg;
    if (p.hp > 0) return 'none';
    this.breakPart(p, cause, ball, x, y, z);
    return 'broke';
  }

  private breakPart(p: Part, cause: 'ball' | 'blast' | 'debris' | 'overload' | 'land', ball: number, x = p.x, y = p.y, z = p.z): void {
    p.state = PartState.Gone;
    p.hp = 0;
    this.pending.delete(p.id);
    this.dirty = true;
    this.events.push({ t: 'break', part: p.id, cause, ball, x, y, z });
    this.wake(p.id);
  }

  private knockLoose(p: Part, ball: number, x: number, y: number, z: number, src: Ball | undefined, blast: boolean): void {
    this.events.push({ t: 'knock', part: p.id, ball, x, y, z });
    const d = this.release(p);
    if (src) {
      const massK = clamp((src.def.mass * 1.6) / Math.max(0.3, p.weight * 0.25), 0.15, 1.2);
      d.vx += src.vx * 0.55 * massK;
      d.vy += Math.abs(src.vy) * 0.2 * massK + 1.2;
      d.vz += src.vz * 0.55 * massK;
      d.wx += (this.rng.next() - 0.5) * 8;
      d.wz += (this.rng.next() - 0.5) * 8;
    }
    if (blast) this.blastPush(d);
  }

  // ------------------------------------------------------------- structure

  /**
   * Which parts are still held up, and by what load. A part stands if every
   * support group has a standing member, or if it hangs sideways from a
   * standing neighbour within its span. Masonry inherits its supporter's
   * sideways count, which is what makes a hole in a wall arch: bricks over a
   * narrow hole hang from their neighbours; over a wide one they drop.
   */
  solve(releaseFalls: boolean): void {
    this.dirty = false;
    const P = this.parts;
    const N = P.length;
    const INF = STAND_INF;
    const cost = this.standCost();
    const isUp = (i: number): boolean => (P[i] as Part).state === PartState.Intact && (cost[i] as number) <= (P[i] as Part).span;

    // Loads: each standing part passes its weight (plus what it carries) to whatever holds it up.
    const parents: number[][] = new Array(N);
    const indeg = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      if (!isUp(i)) continue;
      const p = P[i] as Part;
      if (p.groups.length === 0) {
        parents[i] = [];
        continue;
      }
      let vertical = true;
      const ps: number[] = [];
      p.groups.forEach((g, gi) => {
        if (g.filter(isUp).length < Math.max(1, p.need?.[gi] ?? 1)) vertical = false;
      });
      if (vertical) for (const g of p.groups) for (const m of g) if (isUp(m)) ps.push(m);
      else {
        let best = -1;
        for (const m of p.lateral) if (isUp(m) && (best < 0 || (cost[m] as number) < (cost[best] as number))) best = m;
        if (best >= 0) ps.push(best);
      }
      parents[i] = ps;
    }
    for (let i = 0; i < N; i++) for (const m of parents[i] ?? []) indeg[m] = (indeg[m] as number) + 1;
    const load = this.load;
    load.fill(0);
    const order: number[] = [];
    for (let i = 0; i < N; i++) if (parents[i] && indeg[i] === 0) order.push(i);
    for (let oi = 0; oi < order.length; oi++) {
      const i = order[oi] as number;
      const p = P[i] as Part;
      load[i] = (load[i] as number) + p.weight;
      const ps = parents[i] as number[];
      if (!ps.length) continue;
      const vertical = p.groups.length && p.groups.every((g, gi) => g.filter(isUp).length >= Math.max(1, p.need?.[gi] ?? 1));
      if (vertical) {
        const share = (load[i] as number) / p.groups.length;
        for (const g of p.groups) {
          const up = g.filter(isUp);
          for (const m of up) load[m] = (load[m] as number) + share / up.length;
        }
      } else load[ps[0] as number] = (load[ps[0] as number] as number) + (load[i] as number);
      for (const m of ps) {
        indeg[m] = (indeg[m] as number) - 1;
        if (indeg[m] === 0) order.push(m);
      }
    }

    // Overloaded parts creak, then give way, worst first.
    const over: Array<[number, number]> = [];
    for (let i = 0; i < N; i++) {
      if (!isUp(i)) continue;
      const p = P[i] as Part;
      const ratio = (load[i] as number) / p.capacity;
      if (ratio > 1) over.push([i, ratio]);
      else this.pending.delete(i);
    }
    over.sort((a, b) => b[1] - a[1]);
    over.forEach(([i, ratio], k) => {
      if (this.pending.has(i)) return;
      if (k > 2) return;
      this.pending.set(i, this.time + clamp(1.3 - 0.5 * (ratio - 1), 0.3, 1.3) + k * 0.15);
      this.events.push({ t: 'creak', part: i });
    });

    if (!releaseFalls) return;
    const fallen: Part[] = [];
    for (let i = 0; i < N; i++) {
      const p = P[i] as Part;
      if (p.state === PartState.Intact && (cost[i] as number) >= INF) fallen.push(p);
    }
    if (!fallen.length) return;
    let minY = Infinity;
    for (const p of fallen) minY = Math.min(minY, p.y - p.hy);
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let roof = 0;
    let floor = 0;
    for (const p of fallen) {
      this.events.push({ t: 'release', part: p.id });
      const d = this.release(p);
      // Outside walls topple outward, more so higher up.
      if (p.wall && (p.kind === 'brick' || p.kind === 'lintel')) {
        const out = 0.35 + 0.14 * (p.y - minY);
        const nx = p.wall === 'left' ? -1 : p.wall === 'right' ? 1 : 0;
        const nz = p.wall === 'front' ? 1 : p.wall === 'back' ? -1 : 0;
        d.vx += nx * out + (this.rng.next() - 0.5) * 0.3;
        d.vz += nz * out + (this.rng.next() - 0.5) * 0.3;
        d.wx += -nz * (1.2 + this.rng.next());
        d.wz += nx * (1.2 + this.rng.next());
      } else if (p.tags.includes('chimney')) {
        // A cut chimney leans over onto the roof beside it.
        const lean = 0.25 + 0.22 * (p.y - minY);
        d.vx -= lean;
        d.wz += 0.9 + this.rng.next() * 0.6;
      } else {
        d.wx += (this.rng.next() - 0.5) * 1.2;
        d.wz += (this.rng.next() - 0.5) * 1.2;
      }
      if (this.time - this.lastBlast.t < 0.4) this.blastPush(d);
      sx += p.x;
      sy += p.y;
      sz += p.z;
      if (p.kind === 'deck' && p.tags.includes('roof')) roof++;
      if (p.kind === 'floor') floor++;
    }
    if (fallen.length >= 8 || roof || floor) {
      const n = fallen.length;
      this.events.push({ t: 'collapse', count: n, x: sx / n, y: sy / n, z: sz / n, roof, floor });
    }
  }

  /**
   * Sideways-hang cost of every part: 0 on the ground, up to its span when it
   * hangs from neighbours, STAND_INF when nothing holds it.
   */
  private standCost(): Int32Array {
    const P = this.parts;
    const N = P.length;
    const INF = STAND_INF;
    const cost = new Int32Array(N).fill(INF);
    const isUp = (i: number): boolean => (P[i] as Part).state === PartState.Intact && (cost[i] as number) <= (P[i] as Part).span;
    for (let i = 0; i < N; i++) {
      const p = P[i] as Part;
      if (p.state === PartState.Intact && p.groups.length === 0) cost[i] = 0;
    }
    const evalCost = (p: Part): number => {
      let cv = INF;
      if (p.groups.length) {
        cv = 0;
        for (let gi = 0; gi < p.groups.length; gi++) {
          const g = p.groups[gi] as number[];
          const need = p.need?.[gi] ?? 1;
          // Masonry inherits the weakest standing support under it, so an undercut column stays
          // undercut all the way up; everything else only needs its supports to be standing.
          let best = INF;
          let worst = 0;
          let up = 0;
          for (const m of g) {
            if (!isUp(m)) continue;
            up++;
            const c = cost[m] as number;
            if (c < best) best = c;
            if (c > worst) worst = c;
          }
          if (best >= INF || up < need) {
            cv = INF;
            break;
          }
          if (p.bond && worst > cv) cv = worst;
        }
      }
      let cl = INF;
      for (const m of p.lateral) if (isUp(m) && (cost[m] as number) + 1 < cl) cl = (cost[m] as number) + 1;
      const c = Math.min(cv, cl);
      return c <= p.span ? c : INF;
    };
    // Every rule above is monotone, so sweeping in support order from "nothing stands" settles on
    // the right answer; sideways hangs need a few sweeps to spread along a course.
    for (let sweep = 0; sweep < 40; sweep++) {
      let changed = false;
      for (const i of this.supportOrder) {
        const p = P[i] as Part;
        if (p.state !== PartState.Intact || p.groups.length === 0) continue;
        const c = evalCost(p);
        if (c !== cost[i]) {
          cost[i] = c;
          changed = true;
        }
      }
      if (!changed) break;
    }
    return cost;
  }

  // ---------------------------------------------------------------- debris

  private release(p: Part): Debris {
    p.state = PartState.Falling;
    this.pending.delete(p.id);
    this.dirty = true;
    this.wake(p.id);
    const half = p.rot / 2;
    const d: Debris = {
      part: p.id,
      x: p.x,
      y: p.y,
      z: p.z,
      vx: 0,
      vy: 0,
      vz: 0,
      qx: Math.sin(half),
      qy: 0,
      qz: 0,
      qw: Math.cos(half),
      wx: 0,
      wy: 0,
      wz: 0,
      mass: Math.max(0.2, p.weight),
      age: 0,
      still: 0,
      ex: p.hx,
      ey: p.hy,
      ez: p.hz,
      restOn: -1,
      asleep: false,
    };
    this.updateExtents(d);
    this.debris.push(d);
    this.debrisIndex.set(p.id, d);
    if (this.activeDebris > MAX_DEBRIS) this.trimDebris();
    return d;
  }

  debrisOf(partId: number): Debris | undefined {
    return this.debrisIndex.get(partId);
  }

  private blastPush(d: Debris): void {
    const B = this.lastBlast;
    const dx = d.x - B.x;
    const dy = d.y - B.y;
    const dz = d.z - B.z;
    const dist = Math.max(0.3, Math.hypot(dx, dy, dz));
    if (dist > B.r * 2.2) return;
    const k = (6 * (1 - dist / (B.r * 2.2))) / dist;
    d.vx += dx * k;
    d.vy += Math.abs(dy) * k + 2;
    d.vz += dz * k;
  }

  /** Too much loose debris: the smallest, oldest pieces crumble to dust. */
  private trimDebris(): void {
    const live = this.debris.filter((d) => !d.asleep).sort((a, b) => a.mass - b.mass || b.age - a.age);
    for (let i = 0; i < live.length - MAX_DEBRIS + 40; i++) {
      const d = live[i] as Debris;
      const p = this.parts[d.part] as Part;
      d.asleep = true;
      p.state = PartState.Gone;
      this.events.push({ t: 'break', part: p.id, cause: 'land', ball: 0, x: d.x, y: d.y, z: d.z });
    }
  }

  private wake(partId: number): void {
    const list = this.resting.get(partId);
    if (!list) return;
    this.resting.delete(partId);
    for (const id of list) {
      const d = this.debrisIndex.get(id);
      const p = this.parts[id] as Part;
      if (d && d.asleep && p.state === PartState.Rubble) {
        d.asleep = false;
        d.still = 0;
        d.restOn = -1;
        p.state = PartState.Falling;
      }
    }
  }

  private updateExtents(d: Debris): void {
    const p = this.parts[d.part] as Part;
    const { qx, qy, qz, qw } = d;
    const m00 = 1 - 2 * (qy * qy + qz * qz);
    const m01 = 2 * (qx * qy - qz * qw);
    const m02 = 2 * (qx * qz + qy * qw);
    const m10 = 2 * (qx * qy + qz * qw);
    const m11 = 1 - 2 * (qx * qx + qz * qz);
    const m12 = 2 * (qy * qz - qx * qw);
    const m20 = 2 * (qx * qz - qy * qw);
    const m21 = 2 * (qy * qz + qx * qw);
    const m22 = 1 - 2 * (qx * qx + qy * qy);
    d.ex = Math.abs(m00) * p.hx + Math.abs(m01) * p.hy + Math.abs(m02) * p.hz;
    d.ey = Math.abs(m10) * p.hx + Math.abs(m11) * p.hy + Math.abs(m12) * p.hz;
    d.ez = Math.abs(m20) * p.hx + Math.abs(m21) * p.hy + Math.abs(m22) * p.hz;
  }

  groundAt(x: number, z: number): number {
    const ix = Math.floor((x - HF_X0) / HF_CELL);
    const iz = Math.floor((z - HF_Z0) / HF_CELL);
    if (ix < 0 || iz < 0 || ix >= HF_NX || iz >= HF_NZ) return 0;
    return this.heights[iz * HF_NX + ix] as number;
  }

  private sleep(d: Debris): void {
    d.asleep = true;
    d.vx = d.vy = d.vz = 0;
    d.wx = d.wy = d.wz = 0;
    const p = this.parts[d.part] as Part;
    if (p.state === PartState.Falling) p.state = PartState.Rubble;
    if (d.restOn >= 0) {
      let list = this.resting.get(d.restOn);
      if (!list) this.resting.set(d.restOn, (list = []));
      list.push(d.part);
    } else {
      // Add to the rubble heap under it.
      const top = d.y + d.ey * 0.6;
      for (let x = d.x - d.ex * 0.8; x <= d.x + d.ex * 0.8; x += HF_CELL) {
        for (let z = d.z - d.ez * 0.8; z <= d.z + d.ez * 0.8; z += HF_CELL) {
          const ix = Math.floor((x - HF_X0) / HF_CELL);
          const iz = Math.floor((z - HF_Z0) / HF_CELL);
          if (ix < 0 || iz < 0 || ix >= HF_NX || iz >= HF_NZ) continue;
          const k = iz * HF_NX + ix;
          this.heights[k] = Math.max(this.heights[k] as number, Math.min(top, 3));
        }
      }
    }
  }

  private dtmp: Part[] = [];

  private stepDebris(dt: number): void {
    for (const d of this.debris) {
      if (d.asleep) continue;
      const p = this.parts[d.part] as Part;
      if (p.state === PartState.Gone) {
        d.asleep = true;
        continue;
      }
      d.age += dt;
      d.vy -= GRAVITY * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      // Integrate spin.
      const { wx, wy, wz } = d;
      let { qx, qy, qz, qw } = d;
      const hx = 0.5 * dt;
      const nqx = qx + hx * (wx * qw + wy * qz - wz * qy);
      const nqy = qy + hx * (wy * qw + wz * qx - wx * qz);
      const nqz = qz + hx * (wz * qw + wx * qy - wy * qx);
      const nqw = qw + hx * (-wx * qx - wy * qy - wz * qz);
      const ql = Math.hypot(nqx, nqy, nqz, nqw) || 1;
      qx = nqx / ql;
      qy = nqy / ql;
      qz = nqz / ql;
      qw = nqw / ql;
      d.qx = qx;
      d.qy = qy;
      d.qz = qz;
      d.qw = qw;
      this.updateExtents(d);
      let resting = false;
      // Ground and rubble.
      const g = this.groundAt(d.x, d.z);
      if (d.y - d.ey < g) {
        d.y = g + d.ey;
        if (d.vy < 0) {
          const imp = -d.vy;
          d.vy = imp > 2 ? imp * 0.18 : 0;
          d.vx *= 0.55;
          d.vz *= 0.55;
          d.wx *= 0.55;
          d.wy *= 0.55;
          d.wz *= 0.55;
          if (imp > 1.6) this.landed(d, p, imp);
          if (gone(p)) continue;
        }
        resting = true;
        d.restOn = -1;
      }
      // Standing parts.
      const list = this.query(d.x - d.ex, d.y - d.ey, d.z - d.ez, d.x + d.ex, d.y + d.ey, d.z + d.ez, this.dtmp);
      for (const q of list) {
        if (q.id === d.part || q.soft) continue;
        const b = partBox(q);
        const ox = Math.min(d.x + d.ex, b.maxX) - Math.max(d.x - d.ex, b.minX);
        const oy = Math.min(d.y + d.ey, b.maxY) - Math.max(d.y - d.ey, b.minY);
        const oz = Math.min(d.z + d.ez, b.maxZ) - Math.max(d.z - d.ez, b.minZ);
        if (ox <= 0 || oy <= 0 || oz <= 0) continue;
        if (q.rot !== 0 && !q.solid) continue;
        let rel = 0;
        if (oy <= ox && oy <= oz) {
          if (d.y > (b.minY + b.maxY) / 2) {
            d.y += oy;
            rel = Math.max(0, -d.vy);
            d.vy = rel > 2 ? rel * 0.15 : 0;
            d.vx *= 0.6;
            d.vz *= 0.6;
            d.wx *= 0.6;
            d.wz *= 0.6;
            resting = true;
            d.restOn = q.id;
          } else {
            d.y -= oy;
            rel = Math.max(0, d.vy);
            d.vy = -rel * 0.2;
          }
        } else if (ox <= oz) {
          const s = d.x > (b.minX + b.maxX) / 2 ? 1 : -1;
          d.x += s * ox;
          rel = Math.max(0, -s * d.vx);
          d.vx = s * rel * 0.2;
        } else {
          const s = d.z > (b.minZ + b.maxZ) / 2 ? 1 : -1;
          d.z += s * oz;
          rel = Math.max(0, -s * d.vz);
          d.vz = s * rel * 0.2;
        }
        if (rel > 2.4) {
          const dmg = 0.5 * d.mass * rel * rel * DAMAGE_K * DEBRIS_DAMAGE;
          if (dmg > 0.06) this.damagePart(q, dmg, 'debris', 0, d.x, d.y - d.ey, d.z);
          if (rel > 1.6 && q.state !== PartState.Intact) continue;
          if (rel > 3) this.landed(d, p, rel);
          if (gone(p)) break;
        }
      }
      if (gone(p)) continue;
      const sp = Math.hypot(d.vx, d.vy, d.vz);
      const spin = Math.hypot(d.wx, d.wy, d.wz);
      if (resting) {
        d.wx *= 0.9;
        d.wy *= 0.9;
        d.wz *= 0.9;
      }
      d.still = resting && sp < 0.4 && spin < 1.2 ? d.still + dt : 0;
      const bd = this.info.bounds;
      if (d.still > 0.25 || d.age > 7 || d.y < -2 || d.x < bd.minX - 4 || d.x > bd.maxX + 4) this.sleep(d);
    }
  }

  /** A falling piece hits something hard: fragile things and bricks dropped from height break. */
  private landed(d: Debris, p: Part, speed: number): void {
    this.events.push({ t: 'land', part: p.id, speed, x: d.x, y: d.y - d.ey, z: d.z });
    const brittle = p.fragile ? 3.2 : p.kind === 'tile' || p.kind === 'glass' ? 2.5 : p.kind === 'brick' || p.kind === 'partition' ? 7.5 : Infinity;
    if (speed > brittle && (p.fragile || p.kind === 'glass' || p.kind === 'tile' || this.rng.next() < 0.5)) {
      p.state = PartState.Gone;
      d.asleep = true;
      this.events.push({ t: 'break', part: p.id, cause: 'land', ball: 0, x: d.x, y: d.y, z: d.z });
      this.wake(p.id);
    }
  }

  // ----------------------------------------------------------- save/load

  /** Captures a settled world. Anything still moving is put to rest first. */
  snapshot(): WorldSnapshot {
    if (!this.settled) this.runUntilSettled(8);
    const parts: number[] = [];
    const rubble: number[] = [];
    for (const p of this.parts) {
      const fresh = p.state === PartState.Intact && (p.hp === p.hp0 || !Number.isFinite(p.hp0));
      if (fresh) continue;
      const state = p.state === PartState.Falling ? PartState.Rubble : p.state;
      parts.push(p.id, state, Number.isFinite(p.hp) ? round(p.hp, 1000) : -1);
      if (state !== PartState.Rubble) continue;
      const d = this.debrisIndex.get(p.id);
      if (!d) continue;
      rubble.push(p.id, round(d.x, 1000), round(d.y, 1000), round(d.z, 1000), round(d.qx, 10000), round(d.qy, 10000), round(d.qz, 10000), round(d.qw, 10000), d.restOn);
    }
    const heights: number[] = [];
    for (let i = 0; i < this.heights.length; i++) {
      const v = this.heights[i] as number;
      if (v > 0) heights.push(i, round(v, 1000));
    }
    return { v: 1, n: this.parts.length, time: round(this.time, 1000), rng: this.rng.state >>> 0, ball: this.nextBall, parts, rubble, heights };
  }

  /**
   * Puts a snapshot back on a freshly built world of the same house. Returns
   * false (and leaves the world fresh) if the snapshot does not fit it.
   */
  restore(snap: WorldSnapshot): boolean {
    if (!validSnapshot(snap, this.parts.length)) return false;
    for (let i = 0; i < snap.parts.length; i += SNAP_PART) {
      const p = this.parts[snap.parts[i] as number] as Part;
      const state = snap.parts[i + 1] as number;
      const hp = snap.parts[i + 2] as number;
      p.state = state as PartState;
      if (Number.isFinite(p.hp0)) p.hp = state === PartState.Intact ? Math.min(p.hp0, Math.max(0.001, hp)) : 0;
    }
    for (let i = 0; i < snap.rubble.length; i += SNAP_RUBBLE) {
      const id = snap.rubble[i] as number;
      const p = this.parts[id] as Part;
      if (p.state !== PartState.Rubble) continue;
      const r = (k: number): number => snap.rubble[i + k] as number;
      const ql = Math.hypot(r(4), r(5), r(6), r(7)) || 1;
      const d: Debris = { part: id, x: r(1), y: r(2), z: r(3), vx: 0, vy: 0, vz: 0, qx: r(4) / ql, qy: r(5) / ql, qz: r(6) / ql, qw: r(7) / ql, wx: 0, wy: 0, wz: 0, mass: Math.max(0.2, p.weight), age: 0, still: 0, ex: p.hx, ey: p.hy, ez: p.hz, restOn: r(8), asleep: true };
      this.updateExtents(d);
      this.debris.push(d);
      this.debrisIndex.set(id, d);
      if (d.restOn >= 0) {
        let list = this.resting.get(d.restOn);
        if (!list) this.resting.set(d.restOn, (list = []));
        list.push(id);
      }
    }
    // Rubble without a pose (should not happen) is treated as cleared away.
    for (const p of this.parts) if (p.state === PartState.Rubble && !this.debrisIndex.has(p.id)) p.state = PartState.Gone;
    for (let i = 0; i < snap.heights.length; i += 2) this.heights[snap.heights[i] as number] = snap.heights[i + 1] as number;
    this.time = snap.time;
    this.rng.state = snap.rng;
    this.nextBall = Math.max(1, snap.ball);
    this.solve(true);
    this.pending.clear();
    for (const d of this.debris) if (!d.asleep) this.sleep(d);
    this.events = [];
    return true;
  }

  // ------------------------------------------------------------ weak points

  /**
   * How many standing house parts would lose their support if these parts
   * went, without changing anything. Used to point out weak points.
   */
  fallIfRemoved(ids: number[]): { count: number; weight: number } {
    const P = this.parts;
    const saved = ids.map((id) => (P[id] as Part).state);
    for (const id of ids) (P[id] as Part).state = PartState.Gone;
    const cost = this.standCost();
    for (let k = 0; k < ids.length; k++) (P[ids[k] as number] as Part).state = saved[k] as PartState;
    let count = 0;
    let weight = 0;
    for (let i = 0; i < P.length; i++) {
      const p = P[i] as Part;
      if (p.state !== PartState.Intact || !p.house || ids.includes(i)) continue;
      if ((cost[i] as number) >= STAND_INF) {
        count++;
        weight += scoreWeight(p);
      }
    }
    return { count, weight };
  }

  /**
   * Standing parts whose loss would bring the most down: supports, chimney
   * footings, and the bricks at the edge of holes. Strongest first.
   */
  weakPoints(max = 3, minFall = 6, minWeight = 4): Array<{ part: number; count: number }> {
    const P = this.parts;
    const cands: Part[] = [];
    const seen = new Set<number>();
    const add = (p: Part): void => {
      if (seen.has(p.id) || p.state !== PartState.Intact || !p.solid || !Number.isFinite(p.hp0)) return;
      seen.add(p.id);
      cands.push(p);
    };
    for (const p of P) if (p.house && (p.kind === 'column' || p.kind === 'lintel' || (p.kind === 'beam' && p.tags.includes('support')))) add(p);
    const chimney = P.filter((p) => p.tags.includes('chimney') && p.kind === 'brick' && p.state === PartState.Intact).sort((a, b) => a.y - b.y);
    for (const p of chimney.slice(0, 2)) add(p);
    // Bricks beside a hole: the next ones to knock out to widen it.
    let edge = 0;
    for (const p of P) {
      if (edge >= 36) break;
      if (p.state !== PartState.Intact || p.kind !== 'brick' || !p.wall) continue;
      if (p.lateral.some((q) => (P[q] as Part).state !== PartState.Intact) || p.groups.some((g) => g.some((q) => (P[q] as Part).state !== PartState.Intact))) {
        add(p);
        edge++;
      }
    }
    const out: Array<{ part: number; count: number; weight: number }> = [];
    for (const p of cands) {
      const f = this.fallIfRemoved([p.id]);
      // Many pieces, or a few heavy ones (a porch roof, a floor).
      if (f.count >= minFall || f.weight >= minWeight) out.push({ part: p.id, count: f.count, weight: f.weight });
    }
    out.sort((a, b) => b.weight - a.weight || a.part - b.part);
    return out.slice(0, max).map(({ part, count }) => ({ part, count }));
  }

  // ---------------------------------------------------------- measurement

  /** Share of the house (by weight) that has broken or fallen, 0..1. */
  destruction(): number {
    let lost = 0;
    for (const p of this.parts) if (p.house && p.state !== PartState.Intact) lost += scoreWeight(p);
    return this.houseWeight > 0 ? lost / this.houseWeight : 0;
  }

  /** A box that holds every part still standing and every piece of rubble. */
  extent(): Box {
    const b: Box = { minX: Infinity, minY: 0, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
    for (const p of this.parts) {
      if (!p.house || p.state === PartState.Gone) continue;
      const d = this.debrisIndex.get(p.id);
      const x = d ? d.x : p.x;
      const y = d ? d.y : p.y;
      const z = d ? d.z : p.z;
      b.minX = Math.min(b.minX, x);
      b.maxX = Math.max(b.maxX, x);
      b.maxY = Math.max(b.maxY, y);
      b.minZ = Math.min(b.minZ, z);
      b.maxZ = Math.max(b.maxZ, z);
    }
    return b;
  }
}

/** Weight used for the destruction percentage: real weight, but light glass and tiles still count. */
export function scoreWeight(p: Part): number {
  return Math.max(0.4, Math.min(p.weight, 30));
}

/** Orders parts by how many supports deep they sit (ground first). Sideways-only parts sit with their neighbours. */
function supportOrder(parts: Part[]): number[] {
  const depth = new Int32Array(parts.length).fill(-1);
  const visit = (i: number, guard: number): number => {
    const d = depth[i] as number;
    if (d >= 0) return d;
    const p = parts[i] as Part;
    let best = 0;
    if (guard < 200) for (const g of p.groups) for (const m of g) best = Math.max(best, visit(m, guard + 1) + 1);
    depth[i] = best;
    return best;
  };
  for (let i = 0; i < parts.length; i++) visit(i, 0);
  for (let pass = 0; pass < 3; pass++) {
    for (const p of parts) {
      if (p.groups.length && p.groups.every((g) => g.length === 0)) for (const m of p.lateral) depth[p.id] = Math.max(depth[p.id] as number, depth[m] as number);
    }
  }
  return parts.map((p) => p.id).sort((a, b) => (depth[a] as number) - (depth[b] as number) || a - b);
}

const STAND_INF = 1 << 20;

function validSnapshot(s: WorldSnapshot, n: number): boolean {
  if (!s || typeof s !== 'object' || s.v !== 1 || s.n !== n) return false;
  const nums = (a: unknown, stride: number): a is number[] => Array.isArray(a) && a.length % stride === 0 && a.every((x) => typeof x === 'number' && Number.isFinite(x));
  if (!nums(s.parts, SNAP_PART) || !nums(s.rubble, SNAP_RUBBLE) || !nums(s.heights, 2)) return false;
  if (![s.time, s.rng, s.ball].every((x) => typeof x === 'number' && Number.isFinite(x))) return false;
  for (let i = 0; i < s.parts.length; i += SNAP_PART) {
    const id = s.parts[i] as number;
    const st = s.parts[i + 1] as number;
    if (!Number.isInteger(id) || id < 0 || id >= n || ![0, 2, 3].includes(st)) return false;
  }
  for (let i = 0; i < s.rubble.length; i += SNAP_RUBBLE) {
    const id = s.rubble[i] as number;
    const on = s.rubble[i + 8] as number;
    if (!Number.isInteger(id) || id < 0 || id >= n || !Number.isInteger(on) || on < -1 || on >= n) return false;
  }
  for (let i = 0; i < s.heights.length; i += 2) {
    const k = s.heights[i] as number;
    if (!Number.isInteger(k) || k < 0 || k >= HF_NX * HF_NZ) return false;
  }
  return true;
}

/** Fresh read of a part's state (calls in between can change it). */
const gone = (p: Part): boolean => p.state === PartState.Gone;

const HF_CELL = 0.3;
const HF_X0 = -20;
const HF_Z0 = -18;
const HF_NX = Math.ceil(40 / HF_CELL);
const HF_NZ = Math.ceil(50 / HF_CELL);

/** The face of a box a point is nearest to (inside) or furthest beyond (outside). */
function sideOf(b: Box, x: number, y: number, z: number): string {
  const d: Array<[string, number]> = [
    ['left', x - b.minX],
    ['right', b.maxX - x],
    ['bottom', y - b.minY],
    ['top', b.maxY - y],
    ['back', z - b.minZ],
    ['front', b.maxZ - z],
  ];
  d.sort((p, q) => p[1] - q[1]);
  return (d[0] as [string, number])[0];
}

function insideEllipsoid(p: Part, x: number, y: number, z: number): boolean {
  const dx = (x - p.x) / p.hx;
  const dy = (y - p.y) / p.hy;
  const dz = (z - p.z) / p.hz;
  return dx * dx + dy * dy + dz * dz <= 1;
}

/** Sphere against a box tilted about x. Returns the contact with an outward normal, or null. */
export function sphereBox(p: Part, x: number, y: number, z: number, r: number): Contact | null {
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  const dx = x - p.x;
  const wy = y - p.y;
  const wz = z - p.z;
  // World to local (inverse of the tilt).
  const ly = wy * c + wz * s;
  const lz = -wy * s + wz * c;
  const qx = clamp(dx, -p.hx, p.hx);
  const qy = clamp(ly, -p.hy, p.hy);
  const qz = clamp(lz, -p.hz, p.hz);
  let nx = dx - qx;
  let ny = ly - qy;
  let nz = lz - qz;
  const d2 = nx * nx + ny * ny + nz * nz;
  if (d2 > r * r) return null;
  let depth: number;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    nx /= d;
    ny /= d;
    nz /= d;
    depth = r - d;
  } else {
    // Centre inside the box: push out through the nearest face.
    const px = p.hx - Math.abs(dx);
    const py = p.hy - Math.abs(ly);
    const pz = p.hz - Math.abs(lz);
    nx = ny = nz = 0;
    if (px <= py && px <= pz) {
      nx = dx >= 0 ? 1 : -1;
      depth = px + r;
    } else if (py <= pz) {
      ny = ly >= 0 ? 1 : -1;
      depth = py + r;
    } else {
      nz = lz >= 0 ? 1 : -1;
      depth = pz + r;
    }
  }
  // Local to world.
  const wny = ny * c - nz * s;
  const wnz = ny * s + nz * c;
  const cpy = qy * c - qz * s;
  const cpz = qy * s + qz * c;
  return { part: p, nx, ny: wny, nz: wnz, depth, px: p.x + qx, py: p.y + cpy, pz: p.z + cpz };
}
