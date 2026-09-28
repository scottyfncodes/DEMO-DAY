import type { Direction, Material, MemberKind, PlacedCharge } from '../core/types';
import { Rng, hashString } from '../core/rng';
import { CHARGES } from '../data/charges';
import { chargePoint, dependents, distanceToMember, type Building, type Member } from '../structure/building';
import { computeLoads, evaluateSupport, findCrushed } from '../structure/support';

/** Gravity, slightly stronger than Earth so collapses feel punchy. */
export const GRAVITY = 12;
/** Converts (mass × impact speed) into structural damage. */
export const IMPACT_K = 15;
export const FIXED_DT = 1 / 60;
const MAX_TIME = 28;
const SETTLE_TIME = 1.4;
const CELL = 0.25;

export type ChunkState = 'standing' | 'falling' | 'resting' | 'gone';
export type DestroyCause = 'blast' | 'impact' | 'crush' | 'shatter';

export interface Chunk {
  id: string;
  memberId: string;
  kind: MemberKind;
  material: Material;
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
  vx: number;
  vy: number;
  va: number;
  mass: number;
  hp: number;
  maxHp: number;
  state: ChunkState;
  isFragment: boolean;
  restingOn: string[];
  prevMinY: number;
  bounces: number;
  groupId?: number;
  destroyedBy?: DestroyCause;
  landedX?: number;
  protect: boolean;
}

interface ToppleGroup {
  id: number;
  pivotX: number;
  pivotY: number;
  theta: number;
  omega: number;
  horizontalRoot: boolean;
  chunkIds: string[];
  offsets: Map<string, { ox: number; oy: number }>;
  /** Chunks the group pivots on; ignored for contact tests. */
  excludeIds: Set<string>;
}

export type SimEventType = 'detonate' | 'break' | 'impact' | 'shatter' | 'crush' | 'topple' | 'settled';

export interface SimEvent {
  type: SimEventType;
  t: number;
  x: number;
  y: number;
  strength: number;
  material?: Material;
}

export interface SimResult {
  totalMass: number;
  targetMass: number;
  removedMass: number;
  standingMass: number;
  blastMass: number;
  cascadeMass: number;
  landedInside: number;
  landedOutside: number;
  neighborHits: Record<string, number>;
  protectedFailed: string[];
  memberOutcome: Record<string, 'standing' | 'fallen' | 'destroyed' | 'resting'>;
  duration: number;
}

export interface SimOptions {
  powerMultiplier?: number;
  seed?: number;
}

interface PushInfo {
  direction: Direction;
  impulse: number;
}

export function corners(c: Chunk): Array<[number, number]> {
  const cos = Math.cos(c.angle);
  const sin = Math.sin(c.angle);
  const hw = c.w / 2;
  const hh = c.h / 2;
  const pts: Array<[number, number]> = [];
  for (const [sx, sy] of [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ] as Array<[number, number]>) {
    pts.push([c.cx + sx * cos - sy * sin, c.cy + sx * sin + sy * cos]);
  }
  return pts;
}

function extents(c: Chunk): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners(c)) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Deterministic, tick-based collapse simulation.
 *
 * Members start as standing chunks. Blasts remove or weaken them; every tick
 * the support graph is re-evaluated, unsupported members tip or drop, and
 * falling pieces hit whatever is below, damaging it. Debris that reaches the
 * ground becomes rubble and is scored by where it landed.
 */
export class Simulation {
  readonly building: Building;
  readonly charges: PlacedCharge[];
  readonly chunks: Chunk[] = [];
  readonly chunkById = new Map<string, Chunk>();
  readonly heightmap: Float32Array;
  readonly groundMinX: number;
  readonly groundMaxX: number;
  readonly events: SimEvent[] = [];
  time = 0;
  done = false;
  detonated = false;

  private readonly rng: Rng;
  private readonly powerMul: number;
  private readonly push = new Map<string, PushInfo>();
  private readonly groups: ToppleGroup[] = [];
  private nextGroupId = 1;
  private lastActivity = 0;
  private fragmentCount = 0;
  private blastMass = 0;
  private landedInside = 0;
  private landedOutside = 0;
  private readonly neighborHits: Record<string, number> = {};
  private readonly memberById = new Map<string, Member>();

  constructor(building: Building, charges: PlacedCharge[], options: SimOptions = {}) {
    this.building = building;
    this.charges = charges;
    this.powerMul = options.powerMultiplier ?? 1;
    const seed = options.seed ?? hashString(building.def.id + JSON.stringify(charges));
    this.rng = new Rng(seed);
    const pad = 30;
    this.groundMinX = Math.floor(building.bounds.minX - pad);
    this.groundMaxX = Math.ceil(building.bounds.maxX + pad);
    this.heightmap = new Float32Array(Math.ceil((this.groundMaxX - this.groundMinX) / CELL) + 1);
    for (const id of building.order) {
      const m = building.members.get(id) as Member;
      this.memberById.set(id, m);
      const chunk: Chunk = {
        id,
        memberId: id,
        kind: m.kind,
        material: m.material,
        cx: m.x + m.w / 2,
        cy: m.y + m.h / 2,
        w: m.w,
        h: m.h,
        angle: 0,
        vx: 0,
        vy: 0,
        va: 0,
        mass: m.stats.mass,
        hp: m.stats.hp,
        maxHp: m.stats.hp,
        state: 'standing',
        isFragment: false,
        restingOn: [],
        prevMinY: m.y,
        bounces: 0,
        protect: !!m.protect,
      };
      this.chunks.push(chunk);
      this.chunkById.set(id, chunk);
    }
  }

  /** Runs the whole simulation headlessly and returns the result. */
  runToEnd(): SimResult {
    while (!this.done) this.step(FIXED_DT);
    return this.result();
  }

  /** Advances the simulation by dt seconds, in fixed sub-steps. */
  step(dt: number): SimEvent[] {
    const startIndex = this.events.length;
    if (this.done) return [];
    if (!this.detonated) this.detonate();
    let remaining = dt;
    while (remaining > 1e-6 && !this.done) {
      const h = Math.min(FIXED_DT, remaining);
      this.tick(h);
      remaining -= h;
    }
    return this.events.slice(startIndex);
  }

  // ----------------------------------------------------------------- blasts

  private detonate(): void {
    this.detonated = true;
    const damage = new Map<string, number>();
    for (const charge of this.charges) {
      const def = CHARGES[charge.type];
      const target = this.memberById.get(charge.memberId);
      if (!target) continue;
      const point = chargePoint(target);
      const px = point.x;
      const py = point.y;
      const power = def.power * this.powerMul;
      this.events.push({ type: 'detonate', t: this.time, x: px, y: py, strength: power / 100 });
      for (const chunk of this.chunks) {
        if (chunk.state !== 'standing') continue;
        const member = this.memberById.get(chunk.memberId) as Member;
        const mul = def.multipliers[member.kind] ?? 1;
        let dmg = 0;
        if (chunk.id === target.id) {
          dmg = power * mul;
        } else {
          const d = distanceToMember(member, px, py);
          if (d < def.radius) {
            const falloff = 1 - (d / def.radius) * (d / def.radius);
            dmg = power * falloff * mul;
          }
        }
        if (dmg > 0) damage.set(chunk.id, (damage.get(chunk.id) ?? 0) + dmg);
      }
      if (def.directional && charge.direction) {
        const impulse = def.impulse;
        this.push.set(target.id, { direction: charge.direction, impulse });
        for (const id of dependents(this.building, target.id)) {
          this.push.set(id, { direction: charge.direction, impulse });
        }
      }
    }
    for (const [id, dmg] of damage) {
      const chunk = this.chunkById.get(id) as Chunk;
      chunk.hp -= dmg;
      if (chunk.hp <= 0) {
        this.destroy(chunk, 'blast', 2.4);
      }
    }
    this.lastActivity = this.time;
  }

  // ------------------------------------------------------------------ ticks

  private tick(dt: number): void {
    this.time += dt;
    this.evaluateStructure();
    this.updateGroups(dt);
    this.integrateFalling(dt);
    this.relaxRubble();
    const active = this.groups.length > 0 || this.chunks.some((c) => c.state === 'falling');
    if (active) this.lastActivity = this.time;
    if ((this.time - this.lastActivity > SETTLE_TIME && this.time > 2.2) || this.time >= MAX_TIME) {
      this.finish();
    }
  }

  private isStanding = (id: string): boolean => this.chunkById.get(id)?.state === 'standing';

  private evaluateStructure(): void {
    // Resting chunks whose support vanished fall again.
    for (const c of this.chunks) {
      if (c.state !== 'resting') continue;
      const lost = c.restingOn.some((id) => {
        if (id === 'ground') return false;
        const base = this.chunkById.get(id);
        return !base || (base.state !== 'standing' && base.state !== 'resting');
      });
      if (lost) {
        c.state = 'falling';
        c.restingOn = [];
        c.vx = 0;
        c.vy = 0;
        c.va = 0;
        c.landedX = undefined;
      }
    }

    // Crush check: mass sitting on standing members.
    const extra = this.restingLoads();
    const loads = computeLoads(this.building, this.isStanding, extra);
    const crushed = findCrushed(loads, (id) => {
      const c = this.chunkById.get(id) as Chunk;
      const m = this.memberById.get(id) as Member;
      const integrity = c.maxHp > 0 ? Math.max(0, c.hp) / c.maxHp : 0;
      return m.stats.capacity * integrity;
    });
    for (const id of crushed) {
      const c = this.chunkById.get(id) as Chunk;
      if (c.state === 'standing') {
        this.destroy(c, 'crush', 1.2);
        this.events.push({ type: 'crush', t: this.time, x: c.cx, y: c.cy, strength: 1 });
      }
    }

    // Support check, lowest members first so stacks fail from the bottom.
    const standing = this.chunks.filter((c) => c.state === 'standing' && c.groupId === undefined);
    standing.sort((a, b) => a.cy - b.cy);
    for (const c of standing) {
      if (c.state !== 'standing' || c.groupId !== undefined) continue;
      const member = this.memberById.get(c.memberId) as Member;
      const status = evaluateSupport(member, this.isStanding);
      if (status.kind === 'stable') continue;
      if (status.kind === 'tilt') {
        const omega0 = status.direction === 'left' ? 0.05 : -0.05;
        this.createGroup(c, status.pivotX, member.y, omega0, true);
        continue;
      }
      const push = this.push.get(c.memberId);
      const lean = member.lean ?? 0;
      const cladding = !!member.anchors && member.anchors.length > 0;
      if (push) {
        const closure = this.closure(c);
        let top = member.y + member.h;
        for (const id of closure) {
          const cm = this.memberById.get(id) as Member;
          top = Math.max(top, cm.y + cm.h);
        }
        const height = Math.max(1, top - member.y);
        const omega0 = (push.direction === 'left' ? 1 : -1) * (push.impulse / height);
        this.createGroup(c, member.x + member.w / 2, member.y, omega0, false);
      } else if (lean !== 0) {
        const omega0 = -Math.sign(lean) * Math.min(0.25, Math.abs(lean) * 0.12);
        this.createGroup(c, member.x + member.w / 2, member.y, omega0, false);
      } else if (cladding) {
        // Cladding that lost its frame peels away from the building.
        const centre = (this.building.bounds.minX + this.building.bounds.maxX) / 2;
        const omega0 = c.cx < centre ? 0.8 : -0.8;
        this.createGroup(c, member.x + member.w / 2, member.y, omega0, false);
      } else {
        c.state = 'falling';
        c.vx = 0;
        c.vy = 0;
        c.va = 0;
        c.prevMinY = extents(c).minY;
      }
    }
  }

  /** Mass sitting on standing members via resting chunks, keyed by member id. */
  private restingLoads(): Map<string, number> {
    const extra = new Map<string, number>();
    const memo = new Map<string, number>();
    const carriedBy = new Map<string, Chunk[]>();
    for (const c of this.chunks) {
      if (c.state !== 'resting') continue;
      for (const id of c.restingOn) {
        if (id === 'ground') continue;
        const list = carriedBy.get(id) ?? [];
        list.push(c);
        carriedBy.set(id, list);
      }
    }
    const loadOf = (c: Chunk): number => {
      const cached = memo.get(c.id);
      if (cached !== undefined) return cached;
      let total = c.mass;
      for (const above of carriedBy.get(c.id) ?? []) {
        total += loadOf(above) / Math.max(1, above.restingOn.length);
      }
      memo.set(c.id, total);
      return total;
    };
    for (const c of this.chunks) {
      if (c.state !== 'resting') continue;
      const bases = c.restingOn.filter((id) => this.chunkById.get(id)?.state === 'standing');
      if (bases.length === 0) continue;
      const share = loadOf(c) / c.restingOn.length;
      for (const id of bases) extra.set(id, (extra.get(id) ?? 0) + share);
    }
    return extra;
  }

  /**
   * Standing chunks that would be carried entirely by `root`: members whose
   * every remaining support (or anchor) sits inside the growing set.
   */
  private closure(root: Chunk): string[] {
    const set = new Set<string>([root.memberId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of this.chunks) {
        if (c.state !== 'standing' || c.isFragment || set.has(c.memberId) || c.groupId !== undefined) continue;
        const m = this.memberById.get(c.memberId) as Member;
        if (m.anchors && m.anchors.length > 0) {
          const standingAnchors = m.anchors.filter((a) => this.isStanding(a));
          if (standingAnchors.length > 0 && standingAnchors.every((a) => set.has(a))) {
            set.add(c.memberId);
            changed = true;
            continue;
          }
        }
        if (m.grounded) continue;
        const supporters = m.restsOn.filter((l) => this.isStanding(l.id));
        if (supporters.length > 0 && supporters.every((l) => set.has(l.id))) {
          set.add(c.memberId);
          changed = true;
        }
      }
    }
    set.delete(root.memberId);
    return [...set];
  }

  private createGroup(root: Chunk, pivotX: number, pivotY: number, omega0: number, horizontalRoot: boolean): void {
    const ids = [root.memberId, ...this.closure(root)];
    const rootMember = this.memberById.get(root.memberId) as Member;
    const group: ToppleGroup = {
      id: this.nextGroupId++,
      pivotX,
      pivotY,
      theta: 0,
      omega: omega0,
      horizontalRoot,
      chunkIds: ids,
      offsets: new Map(),
      excludeIds: new Set(horizontalRoot ? rootMember.restsOn.map((l) => l.id) : []),
    };
    for (const id of ids) {
      const c = this.chunkById.get(id) as Chunk;
      c.groupId = group.id;
      c.state = 'falling';
      c.prevMinY = extents(c).minY;
      group.offsets.set(id, { ox: c.cx - pivotX, oy: c.cy - pivotY });
    }
    this.groups.push(group);
    this.events.push({
      type: 'topple',
      t: this.time,
      x: root.cx,
      y: root.cy,
      strength: Math.min(1, ids.length / 4),
      material: root.material,
    });
  }

  private updateGroups(dt: number): void {
    for (let gi = this.groups.length - 1; gi >= 0; gi--) {
      const g = this.groups[gi] as ToppleGroup;
      // Gravity torque about the pivot.
      let num = 0;
      let inertia = 0;
      for (const id of g.chunkIds) {
        const c = this.chunkById.get(id) as Chunk;
        const rx = c.cx - g.pivotX;
        const ry = c.cy - g.pivotY;
        num += c.mass * rx;
        inertia += c.mass * (rx * rx + ry * ry) + (c.mass * (c.w * c.w + c.h * c.h)) / 12;
      }
      const alpha = inertia > 0 ? (-GRAVITY * num) / inertia : 0;
      g.omega += alpha * dt;
      g.theta += g.omega * dt;
      const cos = Math.cos(g.theta);
      const sin = Math.sin(g.theta);
      let contact = false;
      for (const id of g.chunkIds) {
        const c = this.chunkById.get(id) as Chunk;
        const off = g.offsets.get(id) as { ox: number; oy: number };
        c.cx = g.pivotX + off.ox * cos - off.oy * sin;
        c.cy = g.pivotY + off.ox * sin + off.oy * cos;
        c.angle = g.theta;
        c.vx = -g.omega * (c.cy - g.pivotY);
        c.vy = g.omega * (c.cx - g.pivotX);
        c.va = g.omega;
        const ext = extents(c);
        const surface = this.surfaceUnder(c, ext, g);
        if (ext.minY <= surface.y + 0.02) contact = true;
      }
      const limit = g.horizontalRoot ? 0.5 : 1.35;
      if (contact || Math.abs(g.theta) > limit) {
        for (const id of g.chunkIds) {
          const c = this.chunkById.get(id) as Chunk;
          c.groupId = undefined;
        }
        this.groups.splice(gi, 1);
      }
    }
  }

  private integrateFalling(dt: number): void {
    for (const c of this.chunks) {
      if (c.state !== 'falling' || c.groupId !== undefined) continue;
      c.vy -= GRAVITY * dt;
      c.vx *= 1 - 0.08 * dt;
      c.cx += c.vx * dt;
      c.cy += c.vy * dt;
      c.angle += c.va * dt;
      const ext = extents(c);
      const surface = this.surfaceUnder(c, ext);
      if (ext.minY <= surface.y) {
        this.land(c, ext, surface);
      }
      c.prevMinY = ext.minY;
    }
  }

  // ------------------------------------------------------------- collisions

  private surfaceUnder(
    c: Chunk,
    ext: { minX: number; maxX: number; minY: number; maxY: number },
    group?: ToppleGroup,
  ): { y: number; chunks: Chunk[]; neighbor?: string } {
    const tolerance = 0.2;
    let y = this.rubbleHeight(ext.minX, ext.maxX);
    let chunks: Chunk[] = [];
    let neighbor: string | undefined;
    for (const other of this.chunks) {
      if (other === c) continue;
      if (other.state !== 'standing' && other.state !== 'resting') continue;
      if (group && (other.groupId === group.id || group.excludeIds.has(other.id))) continue;
      if (other.isFragment && !c.isFragment) continue;
      const oe = extents(other);
      const overlap = Math.min(ext.maxX, oe.maxX) - Math.max(ext.minX, oe.minX);
      if (overlap < 0.12) continue;
      if (oe.maxY > c.prevMinY + tolerance) continue;
      if (oe.maxY > y + 0.05) {
        y = oe.maxY;
        chunks = [other];
        neighbor = undefined;
      } else if (Math.abs(oe.maxY - y) <= 0.05 && chunks.length > 0) {
        chunks.push(other);
      }
    }
    for (const n of this.building.def.neighbors ?? []) {
      const overlap = Math.min(ext.maxX, n.x + n.w) - Math.max(ext.minX, n.x);
      if (overlap < 0.12) continue;
      if (n.h > c.prevMinY + tolerance) continue;
      if (n.h > y + 0.05) {
        y = n.h;
        chunks = [];
        neighbor = n.id;
      }
    }
    return { y, chunks, neighbor };
  }

  private land(c: Chunk, ext: { minX: number; maxX: number; minY: number; maxY: number }, surface: { y: number; chunks: Chunk[]; neighbor?: string }): void {
    const speed = Math.max(0, -c.vy);
    const standingHits = surface.chunks.filter((o) => o.state === 'standing');
    const restingHits = surface.chunks.filter((o) => o.state === 'resting');

    if (standingHits.length > 0) {
      const totalOverlap = standingHits.reduce((acc, o) => {
        const oe = extents(o);
        return acc + Math.max(0, Math.min(ext.maxX, oe.maxX) - Math.max(ext.minX, oe.minX));
      }, 0) || 1;
      const damage = c.mass * speed * IMPACT_K;
      let destroyedAny = false;
      for (const hit of standingHits) {
        const oe = extents(hit);
        const overlap = Math.max(0, Math.min(ext.maxX, oe.maxX) - Math.max(ext.minX, oe.minX));
        hit.hp -= damage * (overlap / totalOverlap);
        if (hit.hp <= 0) {
          destroyedAny = true;
          this.destroy(hit, 'impact', 1.6);
        }
      }
      this.events.push({
        type: 'impact',
        t: this.time,
        x: c.cx,
        y: ext.minY,
        strength: Math.min(1, (c.mass * speed) / 25),
        material: c.material,
      });
      if (destroyedAny) {
        // Punched through: keep falling, slower.
        c.vy *= 0.55;
        c.vx *= 0.7;
        return;
      }
      if (!c.isFragment && speed > this.shatterSpeed(c.material) * 1.6) {
        this.shatter(c, 'shatter', 1.4, 0);
        return;
      }
      this.rest(c, ext, surface.y, standingHits.map((h) => h.id));
      return;
    }

    if (restingHits.length > 0) {
      if (!c.isFragment && speed > this.shatterSpeed(c.material)) {
        this.shatter(c, 'shatter', 1.2, 0);
        return;
      }
      this.rest(c, ext, surface.y, restingHits.map((h) => h.id));
      // Debris piled on debris: if the pile sits on the ground this counts as landed.
      if (!this.restsOnStructure(c)) {
        const width = Math.max(0.3, ext.maxX - ext.minX);
        this.addRubble(ext.minX, ext.maxX, (c.w * c.h * 0.8) / width);
        this.recordLanding(c, false);
      }
      return;
    }

    if (surface.neighbor) {
      const neighborId = surface.neighbor;
      this.events.push({ type: 'impact', t: this.time, x: c.cx, y: surface.y, strength: Math.min(1, (c.mass * speed) / 20), material: c.material });
      if (!c.isFragment) {
        // Impact bonus for the initial hit; the fragments add their mass as they settle.
        this.neighborHits[neighborId] = (this.neighborHits[neighborId] ?? 0) + c.mass * Math.min(1, speed / 6);
        this.shatter(c, 'shatter', 1.2, 0, true);
        return;
      }
      c.state = 'resting';
      c.restingOn = ['ground'];
      c.vx = 0;
      c.vy = 0;
      c.va = 0;
      c.cy += surface.y - ext.minY;
      this.recordLanding(c, true, neighborId);
      return;
    }

    // Ground or rubble.
    if (c.isFragment) {
      if (speed > 2.2 && c.bounces < 1) {
        c.bounces++;
        c.vy = speed * 0.25;
        c.vx *= 0.55;
        c.va *= 0.5;
        c.cy += surface.y - ext.minY + 0.001;
        return;
      }
      c.state = 'resting';
      c.restingOn = ['ground'];
      c.vx = 0;
      c.vy = 0;
      c.va = 0;
      c.cy += surface.y - ext.minY;
      const width = Math.max(0.3, ext.maxX - ext.minX);
      this.addRubble(ext.minX, ext.maxX, (c.w * c.h * 1.3) / width);
      this.recordLanding(c, false);
      return;
    }
    this.events.push({
      type: 'impact',
      t: this.time,
      x: c.cx,
      y: surface.y,
      strength: Math.min(1, (c.mass * speed) / 25),
      material: c.material,
    });
    if (speed > this.shatterSpeed(c.material)) {
      this.shatter(c, 'shatter', Math.min(2.4, 0.8 + speed * 0.12), 0);
      return;
    }
    c.state = 'resting';
    c.restingOn = ['ground'];
    c.vx = 0;
    c.vy = 0;
    c.va = 0;
    c.cy += surface.y - ext.minY;
    const width = Math.max(0.3, ext.maxX - ext.minX);
    this.addRubble(ext.minX, ext.maxX, (c.w * c.h * 0.6) / width);
    this.recordLanding(c, false);
  }

  /** True when the chunk's resting chain reaches a standing member rather than the ground. */
  private restsOnStructure(c: Chunk): boolean {
    const visited = new Set<string>();
    const stack = [c];
    while (stack.length) {
      const cur = stack.pop() as Chunk;
      if (visited.has(cur.id)) continue;
      visited.add(cur.id);
      for (const id of cur.restingOn) {
        if (id === 'ground') continue;
        const base = this.chunkById.get(id);
        if (!base) continue;
        if (base.state === 'standing') return true;
        if (base.state === 'resting') stack.push(base);
      }
    }
    return false;
  }

  private rest(c: Chunk, ext: { minY: number }, surfaceY: number, on: string[]): void {
    c.state = 'resting';
    c.restingOn = on;
    c.vx = 0;
    c.vy = 0;
    c.va = 0;
    c.cy += surfaceY - ext.minY;
  }

  private shatterSpeed(material: Material): number {
    switch (material) {
      case 'brick':
        return 2.6;
      case 'concrete':
        return 3.4;
      case 'wood':
        return 4.2;
      case 'steel':
        return 6;
    }
  }

  private recordLanding(c: Chunk, onNeighbor: boolean, neighborId?: string): void {
    const zone = this.building.def.footprint;
    // Debris that reaches the ground inside a neighbour's footprint went through it.
    if (!neighborId) {
      const n = (this.building.def.neighbors ?? []).find((nb) => c.cx >= nb.x && c.cx <= nb.x + nb.w);
      if (n) {
        neighborId = n.id;
        onNeighbor = true;
      }
    }
    const inside = !onNeighbor && c.cx >= zone.x && c.cx <= zone.x + zone.w;
    c.landedX = c.cx;
    if (inside) this.landedInside += c.mass;
    else this.landedOutside += c.mass;
    if (neighborId) this.neighborHits[neighborId] = (this.neighborHits[neighborId] ?? 0) + c.mass;
  }

  // ------------------------------------------------------------ destruction

  private destroy(c: Chunk, cause: DestroyCause, scatter: number): void {
    if (c.state === 'gone') return;
    if (cause === 'blast' && !c.isFragment) this.blastMass += c.mass;
    this.events.push({
      type: cause === 'blast' ? 'break' : cause === 'crush' ? 'crush' : 'break',
      t: this.time,
      x: c.cx,
      y: c.cy,
      strength: Math.min(1, c.mass / 8 + 0.3),
      material: c.material,
    });
    this.shatter(c, cause, scatter, cause === 'blast' ? 2.2 : 0.6);
  }

  /** Replaces a chunk with fragments that scatter and fall. */
  private shatter(c: Chunk, cause: DestroyCause, scatter: number, lift: number, onNeighbor = false): void {
    c.state = 'gone';
    c.destroyedBy = c.destroyedBy ?? cause;
    c.groupId = undefined;
    const area = c.w * c.h;
    let count = Math.max(2, Math.min(8, Math.round(area / 0.7)));
    if (this.fragmentCount > 420) count = 2;
    const cols = c.w >= c.h ? Math.min(count, Math.max(1, Math.round(Math.sqrt(count * (c.w / c.h))))) : Math.max(1, Math.round(Math.sqrt(count / (c.h / c.w))));
    const rows = Math.max(1, Math.ceil(count / cols));
    const fw = c.w / cols;
    const fh = c.h / rows;
    const total = cols * rows;
    const cos = Math.cos(c.angle);
    const sin = Math.sin(c.angle);
    const push = this.push.get(c.memberId);
    const pushVx = push ? (push.direction === 'left' ? -push.impulse : push.impulse) * 0.6 : 0;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const lx = -c.w / 2 + fw * (i + 0.5);
        const ly = -c.h / 2 + fh * (j + 0.5);
        const fx = c.cx + lx * cos - ly * sin;
        const fy = c.cy + lx * sin + ly * cos;
        // Outward, mostly deterministic scatter: outer pieces fly furthest.
        const outward = cols > 1 ? lx / (c.w / 2) : this.rng.range(-0.5, 0.5);
        const dirX = outward === 0 ? this.rng.range(-0.4, 0.4) : outward;
        const frag: Chunk = {
          id: `${c.id}#${this.fragmentCount++}`,
          memberId: c.memberId,
          kind: c.kind,
          material: c.material,
          cx: fx,
          cy: fy,
          w: Math.max(0.15, fw * this.rng.range(0.7, 0.95)),
          h: Math.max(0.15, fh * this.rng.range(0.7, 0.95)),
          angle: c.angle + this.rng.range(-0.3, 0.3),
          vx: c.vx * 0.5 + pushVx + dirX * scatter * this.rng.range(0.7, 1) + this.rng.range(-0.25, 0.25),
          vy: Math.max(0, c.vy * 0.3) + lift * this.rng.range(0.4, 1.2),
          va: this.rng.range(-3, 3),
          mass: c.mass / total,
          hp: 1,
          maxHp: 1,
          state: 'falling',
          isFragment: true,
          restingOn: [],
          prevMinY: fy,
          bounces: onNeighbor ? 1 : 0,
          protect: false,
        };
        frag.prevMinY = extents(frag).minY;
        this.chunks.push(frag);
        this.chunkById.set(frag.id, frag);
      }
    }
    this.events.push({
      type: 'shatter',
      t: this.time,
      x: c.cx,
      y: c.cy,
      strength: Math.min(1, area / 6 + 0.2),
      material: c.material,
    });
  }

  // ----------------------------------------------------------------- rubble

  private cellIndex(x: number): number {
    return Math.max(0, Math.min(this.heightmap.length - 1, Math.floor((x - this.groundMinX) / CELL)));
  }

  rubbleHeight(minX: number, maxX: number): number {
    const a = this.cellIndex(minX);
    const b = this.cellIndex(maxX);
    let h = 0;
    for (let i = a; i <= b; i++) h = Math.max(h, this.heightmap[i] as number);
    return h;
  }

  rubbleAt(x: number): number {
    return this.heightmap[this.cellIndex(x)] as number;
  }

  private addRubble(minX: number, maxX: number, height: number): void {
    const a = this.cellIndex(minX);
    const b = this.cellIndex(maxX);
    for (let i = a; i <= b; i++) this.heightmap[i] = (this.heightmap[i] as number) + height * 0.5;
  }

  /** Lets steep rubble slump sideways so piles read as mounds. */
  private relaxRubble(): void {
    const hm = this.heightmap;
    const maxSlope = 0.32;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < hm.length; i++) {
        const diff = (hm[i - 1] as number) - (hm[i] as number);
        if (diff > maxSlope) {
          const move = (diff - maxSlope) * 0.5;
          hm[i - 1] = (hm[i - 1] as number) - move;
          hm[i] = (hm[i] as number) + move;
        } else if (-diff > maxSlope) {
          const move = (-diff - maxSlope) * 0.5;
          hm[i] = (hm[i] as number) - move;
          hm[i - 1] = (hm[i - 1] as number) + move;
        }
      }
    }
  }

  // ----------------------------------------------------------------- finish

  private finish(): void {
    if (this.done) return;
    this.done = true;
    for (const c of this.chunks) {
      if (c.state === 'falling') {
        c.state = 'resting';
        c.restingOn = ['ground'];
        this.recordLanding(c, false);
      }
    }
    this.events.push({ type: 'settled', t: this.time, x: 0, y: 0, strength: 1 });
  }

  /** Aggregates the outcome. Safe to call at any time; final once `done`. */
  result(): SimResult {
    let totalMass = 0;
    let targetMass = 0;
    let standingTarget = 0;
    let standingAll = 0;
    const memberOutcome: SimResult['memberOutcome'] = {};
    const protectedFailed: string[] = [];
    for (const id of this.building.order) {
      const m = this.memberById.get(id) as Member;
      const c = this.chunkById.get(id) as Chunk;
      totalMass += m.stats.mass;
      if (!m.protect) targetMass += m.stats.mass;
      let outcome: SimResult['memberOutcome'][string];
      if (c.state === 'standing') {
        outcome = 'standing';
      } else if (c.state === 'resting') {
        const ext = extents(c);
        const onStructure = c.restingOn.some((r) => r !== 'ground' && this.chunkById.get(r)?.state === 'standing');
        outcome = onStructure && ext.minY > 1.0 ? 'resting' : 'fallen';
      } else if (c.state === 'gone') {
        outcome = 'destroyed';
      } else {
        outcome = 'fallen';
      }
      memberOutcome[id] = outcome;
      const counts = outcome === 'standing' || outcome === 'resting';
      if (counts) {
        standingAll += m.stats.mass;
        if (!m.protect) standingTarget += m.stats.mass;
      }
      if (m.protect && outcome !== 'standing') protectedFailed.push(id);
    }
    const removedMass = Math.max(0, targetMass - standingTarget);
    const cascadeMass = Math.max(0, removedMass - this.blastMass);
    return {
      totalMass,
      targetMass,
      removedMass,
      standingMass: standingAll,
      blastMass: Math.min(this.blastMass, removedMass),
      cascadeMass,
      landedInside: this.landedInside,
      landedOutside: this.landedOutside,
      neighborHits: { ...this.neighborHits },
      protectedFailed,
      memberOutcome,
      duration: this.time,
    };
  }
}
