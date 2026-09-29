import { Rng } from '../core/rng';
import type { ChargeType, Material } from '../core/types';
import { MATERIALS } from '../data/materials';
import type { SimEvent } from '../sim/simulation';

export interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  growth: number;
  life: number;
  maxLife: number;
  color: string;
  alpha: number;
  /** Fireball puffs glow hot then cool to smoke. */
  fire?: boolean;
  /** Maximum radius, metres. */
  maxR?: number;
}

export interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  width?: number;
}

export interface Flash {
  x: number;
  y: number;
  r: number;
  life: number;
  maxLife: number;
  /** Mid colour of the fireball, as "r, g, b". */
  tint: string;
}

export interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  life: number;
  maxLife: number;
  color: string;
  width: number;
  /** Horizontal stretch: directional blasts throw an oval shock front. */
  stretch: number;
  /** Offset of the ring centre along x as it grows (directional push). */
  drift: number;
  /** Rings hugging the ground are drawn as a flat dust wave. */
  ground?: boolean;
}

export interface Debris {
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  va: number;
  w: number;
  h: number;
  color: string;
  life: number;
  maxLife: number;
  bounced: boolean;
}

export interface Jet {
  x: number;
  y: number;
  /** Radians, screen-agnostic world angle (0 = +x, PI/2 = up). */
  angle: number;
  length: number;
  width: number;
  life: number;
  maxLife: number;
  core: string;
  edge: string;
}

export type StressKind = 'blast' | 'fail' | 'load' | 'strain';

export interface Stress {
  kind: StressKind;
  at: number;
}

interface Signature {
  flash: number;
  flashLife: number;
  tint: string;
  ring: number;
  ringLife: number;
  ringColor: string;
  rings: number;
  smoke: number;
  fire: number;
  sparks: number;
  debris: number;
  debrisSpeed: number;
  shake: number;
  punch: number;
}

/** Each charge has its own explosion signature, not just a size. */
const SIGNATURES: Record<ChargeType, Signature> = {
  small: { flash: 1.1, flashLife: 0.28, tint: '255, 160, 60', ring: 2.2, ringLife: 0.32, ringColor: '255, 220, 160', rings: 1, smoke: 8, fire: 5, sparks: 18, debris: 9, debrisSpeed: 7, shake: 0.55, punch: 0.025 },
  heavy: { flash: 2.6, flashLife: 0.5, tint: '255, 120, 40', ring: 5.5, ringLife: 0.55, ringColor: '255, 210, 150', rings: 2, smoke: 20, fire: 14, sparks: 30, debris: 22, debrisSpeed: 10, shake: 1.25, punch: 0.06 },
  directional: { flash: 1.4, flashLife: 0.32, tint: '120, 200, 255', ring: 3.4, ringLife: 0.42, ringColor: '170, 230, 255', rings: 1, smoke: 10, fire: 6, sparks: 26, debris: 14, debrisSpeed: 9, shake: 0.8, punch: 0.035 },
  shaped: { flash: 0.7, flashLife: 0.18, tint: '200, 140, 255', ring: 1.3, ringLife: 0.2, ringColor: '235, 210, 255', rings: 1, smoke: 5, fire: 2, sparks: 34, debris: 8, debrisSpeed: 12, shake: 0.7, punch: 0.04 },
};

const DUST: Record<Material, string> = {
  brick: '#c48a6e',
  concrete: '#bfc2c5',
  wood: '#c9a678',
  steel: '#9aa6b5',
};

export const RUBBLE_MATERIALS: Material[] = ['wood', 'brick', 'concrete', 'steel'];

/** Cosmetic rubble: landed debris crumbles into this mound, cell-aligned with the simulation's ground grid. */
export interface RubbleField {
  minX: number;
  cell: number;
  h: Float32Array;
  /** Material index (RUBBLE_MATERIALS) of the latest debris in each cell, 255 = none. */
  mat: Uint8Array;
}

const MAX_PUFFS = 520;
const MAX_DEBRIS = 360;
const MAX_SPARKS = 260;

/**
 * Purely cosmetic particles driven by simulation events: flashes, shock
 * rings, fire, dust, sparks and material debris, plus member stress flashes
 * that make the chain of failures readable. Nothing here affects the outcome.
 */
export class Effects {
  puffs: Puff[] = [];
  sparks: Spark[] = [];
  flashes: Flash[] = [];
  rings: Ring[] = [];
  debris: Debris[] = [];
  jets: Jet[] = [];
  /** Recent structural drama per member id, keyed by the effects clock. */
  stress = new Map<string, Stress>();
  shake = 0;
  /** Camera zoom punch, decays to 0. */
  punch = 0;
  /** Seconds since effects began; used to age stress flashes. */
  now = 0;
  reducedMotion = false;
  rubble?: RubbleField;
  private rng = new Rng(7);

  initRubble(minX: number, cell: number, cells: number): void {
    this.rubble = { minX, cell, h: new Float32Array(cells), mat: new Uint8Array(cells).fill(255) };
  }

  /**
   * A landed block breaks up: its volume becomes a low mound of rubble under
   * where it lay, with chips and a puff of dust. Purely visual.
   */
  crumble(minX: number, maxX: number, area: number, material: Material, cx: number, cy: number): void {
    const f = this.rubble;
    const amt = this.amount;
    if (f) {
      // Spread a bit wider than the piece and compact it: rubble packs lower than the block stood.
      const spread = Math.max(0.6, (maxX - minX) * 0.6);
      const a = minX - spread;
      const b = maxX + spread;
      const i0 = Math.max(0, Math.floor((a - f.minX) / f.cell));
      const i1 = Math.min(f.h.length - 1, Math.ceil((b - f.minX) / f.cell));
      const volume = area * 0.32;
      let weight = 0;
      for (let i = i0; i <= i1; i++) weight += Math.sin(((i - i0 + 0.5) / (i1 - i0 + 1)) * Math.PI);
      const m = RUBBLE_MATERIALS.indexOf(material);
      for (let i = i0; i <= i1; i++) {
        const w = Math.sin(((i - i0 + 0.5) / (i1 - i0 + 1)) * Math.PI) / (weight || 1);
        f.h[i] = (f.h[i] as number) + (volume * w) / f.cell;
        if (w > 0.3 / (i1 - i0 + 1)) f.mat[i] = m;
      }
    }
    const n = Math.min(26, Math.round((4 + area * 6) * amt));
    this.chips(cx, Math.max(0.2, cy), material, n, 2.5 + Math.min(3, area), 1.2);
    const puffs = Math.min(12, Math.round((3 + area * 3) * amt));
    for (let i = 0; i < puffs; i++) {
      this.puffs.push({
        x: minX + (maxX - minX) * this.rng.next(),
        y: Math.max(0.15, cy + this.rng.range(-0.4, 0.4)),
        vx: this.rng.range(-1.6, 1.6),
        vy: this.rng.range(0.2, 1.1),
        r: this.rng.range(0.3, 0.6),
        growth: this.rng.range(0.4, 0.9),
        life: 0,
        maxLife: this.rng.range(1.6, 2.8),
        color: this.dustColor(material),
        alpha: 0.38,
        maxR: 2,
      });
    }
  }

  clear(): void {
    this.puffs.length = 0;
    this.sparks.length = 0;
    this.flashes.length = 0;
    this.rings.length = 0;
    this.debris.length = 0;
    this.jets.length = 0;
    this.stress.clear();
    this.shake = 0;
    this.punch = 0;
  }

  ingest(events: SimEvent[]): void {
    for (const e of events) this.handle(e);
  }

  private get amount(): number {
    return this.reducedMotion ? 0.35 : 1;
  }

  private dustColor(material?: Material): string {
    return material ? DUST[material] : '#b9aa92';
  }

  markStress(memberId: string, kind: StressKind): void {
    const prev = this.stress.get(memberId);
    // A failure outranks a load warning that is still showing.
    if (prev && prev.kind === 'fail' && kind === 'load' && this.now - prev.at < 0.5) return;
    this.stress.set(memberId, { kind, at: this.now });
  }

  private handle(e: SimEvent): void {
    switch (e.type) {
      case 'detonate':
        this.explode(e);
        if (e.memberId) this.markStress(e.memberId, 'blast');
        break;
      case 'break':
      case 'shatter':
      case 'crush': {
        if (!e.fragment && e.memberId && e.type !== 'shatter') this.markStress(e.memberId, 'fail');
        const n = Math.round((3 + e.strength * 5) * this.amount);
        for (let i = 0; i < n; i++) {
          this.puffs.push({
            x: e.x + this.rng.range(-0.6, 0.6),
            y: e.y + this.rng.range(-0.6, 0.6),
            vx: this.rng.range(-1.5, 1.5),
            vy: this.rng.range(-0.5, 1.2),
            r: this.rng.range(0.15, 0.4),
            growth: this.rng.range(0.3, 0.8),
            life: 0,
            maxLife: this.rng.range(1.2, 2.2),
            color: this.dustColor(e.material),
            alpha: 0.4,
          });
        }
        if (!e.fragment) this.chips(e.x, e.y, e.material, Math.round((4 + e.strength * 6) * this.amount), 4, 1.5);
        if (e.type === 'crush') {
          this.shake = Math.max(this.shake, 0.45);
          this.ring(e.x, e.y, 0.3, 2.2, 0.35, '255, 220, 190', 2, 1, 0);
        }
        break;
      }
      case 'topple':
      case 'drop':
        if (e.memberId) this.markStress(e.memberId, 'fail');
        this.chips(e.x, e.y, e.material, Math.round(3 * this.amount), 2, 0.5);
        break;
      case 'impact':
        this.impact(e);
        break;
      case 'settled':
        this.settleDust();
        break;
    }
  }

  private explode(e: SimEvent): void {
    const type = e.chargeType ?? 'small';
    const sig = SIGNATURES[type];
    const amt = this.amount;
    const power = Math.max(0.5, Math.min(2.5, e.strength / (type === 'shaped' ? 4.2 : type === 'heavy' ? 2 : type === 'directional' ? 1.3 : 0.6)));
    const dir = e.direction === 'left' ? -1 : e.direction === 'right' ? 1 : 0;
    this.flashes.push({ x: e.x, y: e.y, r: sig.flash * power, life: 0, maxLife: sig.flashLife, tint: sig.tint });
    for (let i = 0; i < sig.rings; i++) {
      this.ring(e.x, e.y, 0.2, sig.ring * power * (i === 0 ? 1 : 1.6), sig.ringLife * (i === 0 ? 1 : 1.5), sig.ringColor, i === 0 ? 4 : 2.5, dir !== 0 ? 1.7 : 1, dir * sig.ring * 0.35);
    }
    this.shake = Math.max(this.shake, sig.shake * power);
    this.punch = Math.max(this.punch, sig.punch * (this.reducedMotion ? 0 : 1));

    // Fireball puffs that cool into smoke and rise.
    for (let i = 0; i < Math.round(sig.fire * amt); i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const s = this.rng.range(0.5, 2.5) * power;
      this.puffs.push({
        x: e.x + Math.cos(a) * 0.2,
        y: e.y + Math.sin(a) * 0.2,
        vx: Math.cos(a) * s + dir * 3,
        vy: Math.sin(a) * s * 0.6 + 1.5,
        r: this.rng.range(0.25, 0.5) * power,
        growth: this.rng.range(0.6, 1.2),
        life: 0,
        maxLife: this.rng.range(0.6, 1.1),
        color: '#ff9a3c',
        alpha: 0.85,
        fire: true,
        maxR: 1.4 * power,
      });
    }
    // Smoke and dust burst.
    for (let i = 0; i < Math.round(sig.smoke * amt); i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const s = this.rng.range(2, 6) * (0.6 + power * 0.4);
      this.puffs.push({
        x: e.x,
        y: e.y,
        vx: Math.cos(a) * s + dir * 4,
        vy: Math.sin(a) * s * 0.6 + 1.5,
        r: this.rng.range(0.2, 0.45),
        growth: this.rng.range(0.5, 1.0),
        life: 0,
        maxLife: this.rng.range(1.4, 2.6) * (type === 'heavy' ? 1.4 : 1),
        color: i % 3 === 0 ? '#2a2623' : i % 3 === 1 ? '#4a423c' : this.dustColor(e.material),
        alpha: 0.5,
      });
    }
    // Sparks: radial for small/heavy, a cone for directional, a tight line for shaped.
    for (let i = 0; i < Math.round(sig.sparks * amt); i++) {
      let a: number;
      let s: number;
      if (type === 'shaped') {
        // The cut goes through the member: a thin horizontal sheet.
        a = (this.rng.next() < 0.5 ? 0 : Math.PI) + this.rng.range(-0.12, 0.12);
        s = this.rng.range(10, 22);
      } else if (dir !== 0) {
        a = (dir > 0 ? 0 : Math.PI) + this.rng.range(-0.45, 0.45);
        s = this.rng.range(8, 18);
      } else {
        a = this.rng.range(0, Math.PI * 2);
        s = this.rng.range(4, 12) * (type === 'heavy' ? 1.3 : 1);
      }
      this.sparks.push({
        x: e.x,
        y: e.y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s + 2,
        life: 0,
        maxLife: this.rng.range(0.25, 0.7),
        color: type === 'shaped' ? (i % 2 ? '#f3e6ff' : '#c58bff') : type === 'directional' ? (i % 2 ? '#dff6ff' : '#ffd27a') : i % 2 ? '#ffd27a' : '#ff8a3d',
        width: type === 'heavy' ? 3 : 2,
      });
    }
    if (type === 'directional' && dir !== 0) {
      this.jets.push({ x: e.x, y: e.y, angle: dir > 0 ? 0 : Math.PI, length: 4.2 * power, width: 1.6, life: 0, maxLife: 0.38, core: '255, 250, 230', edge: '56, 198, 255' });
    }
    if (type === 'shaped') {
      this.jets.push({ x: e.x, y: e.y, angle: 0, length: 2.2, width: 0.28, life: 0, maxLife: 0.16, core: '255, 255, 255', edge: '180, 107, 255' });
      this.jets.push({ x: e.x, y: e.y, angle: Math.PI, length: 2.2, width: 0.28, life: 0, maxLife: 0.16, core: '255, 255, 255', edge: '180, 107, 255' });
    }
    this.chips(e.x, e.y, e.material, Math.round(sig.debris * amt), sig.debrisSpeed, 3, dir);
  }

  /** Material-specific debris: splinters, brick bats, concrete lumps, steel offcuts. */
  private chips(x: number, y: number, material: Material | undefined, n: number, speed: number, lift: number, bias = 0): void {
    const mat = material ?? 'concrete';
    const base = MATERIALS[mat];
    for (let i = 0; i < n; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const s = this.rng.range(0.3, 1) * speed;
      let w = 0.14;
      let h = 0.14;
      switch (mat) {
        case 'wood':
          w = this.rng.range(0.25, 0.6);
          h = this.rng.range(0.05, 0.09);
          break;
        case 'brick':
          w = this.rng.range(0.14, 0.26);
          h = w * 0.55;
          break;
        case 'concrete':
          w = this.rng.range(0.1, 0.32);
          h = w * this.rng.range(0.6, 1);
          break;
        case 'steel':
          w = this.rng.range(0.25, 0.5);
          h = 0.05;
          break;
      }
      this.debris.push({
        x: x + this.rng.range(-0.2, 0.2),
        y: y + this.rng.range(-0.2, 0.2),
        vx: Math.cos(a) * s + bias * speed * 0.6,
        vy: Math.abs(Math.sin(a)) * s * 0.8 + lift,
        a: this.rng.range(0, Math.PI),
        va: this.rng.range(-14, 14),
        w,
        h,
        color: i % 3 === 0 ? base.edge : i % 3 === 1 ? base.rubble : base.color,
        life: 0,
        maxLife: this.rng.range(1.6, 2.8),
        bounced: false,
      });
      if (mat === 'steel' && i % 2 === 0) {
        this.sparks.push({ x, y, vx: Math.cos(a) * s * 1.5, vy: Math.sin(a) * s + 2, life: 0, maxLife: this.rng.range(0.2, 0.5), color: '#fff2c4' });
      }
    }
  }

  private ring(x: number, y: number, r0: number, r1: number, maxLife: number, color: string, width: number, stretch: number, drift: number, ground = false): void {
    this.rings.push({ x, y, r0, r1, life: 0, maxLife, color, width, stretch, drift, ground });
  }

  private impact(e: SimEvent): void {
    const amt = this.amount;
    const big = !e.fragment && e.strength > 0.55;
    this.shake = Math.max(this.shake, e.strength * (big ? 0.8 : 0.45));
    if (big) this.punch = Math.max(this.punch, this.reducedMotion ? 0 : 0.02);
    const n = Math.round((4 + e.strength * (big ? 14 : 7)) * amt);
    for (let i = 0; i < n; i++) {
      const dir = this.rng.range(-1, 1);
      this.puffs.push({
        x: e.x + dir * this.rng.range(0, 1.4),
        y: e.y + 0.1,
        vx: dir * this.rng.range(1, 4.5) * (0.5 + e.strength),
        vy: this.rng.range(0.3, 1.6) * (0.5 + e.strength),
        r: this.rng.range(0.25, 0.55),
        growth: this.rng.range(0.5, 1.1) * (0.6 + e.strength),
        life: 0,
        maxLife: this.rng.range(1.6, 3.2) * (big ? 1.5 : 1),
        color: this.dustColor(e.material),
        alpha: 0.36,
      });
    }
    if (!e.fragment) this.chips(e.x, e.y + 0.1, e.material, Math.round((2 + e.strength * 6) * amt), 3 + e.strength * 3, 1.5);
    if (big && e.y < 0.6) {
      // A heavy piece meeting the ground throws a low dust wave both ways.
      this.ring(e.x, e.y + 0.05, 0.4, 3 + e.strength * 4, 0.7, '210, 195, 170', 5, 2.4, 0, true);
    }
  }

  /** A heavy, unexpected landing (the upper structure dropping). */
  heavyLanding(x: number, y: number, material?: Material): void {
    const amt = this.amount;
    this.shake = Math.max(this.shake, 1.4);
    this.punch = Math.max(this.punch, this.reducedMotion ? 0 : 0.07);
    this.ring(x, Math.max(0.05, y), 0.6, 9, 1.1, '220, 205, 180', 7, 2.8, 0, true);
    for (let i = 0; i < Math.round(26 * amt); i++) {
      const dir = i % 2 ? 1 : -1;
      this.puffs.push({
        x: x + dir * this.rng.range(0, 2.5),
        y: Math.max(0.1, y) + this.rng.range(0, 0.5),
        vx: dir * this.rng.range(3, 9),
        vy: this.rng.range(0.4, 2.2),
        r: this.rng.range(0.4, 0.8),
        growth: this.rng.range(0.8, 1.4),
        life: 0,
        maxLife: this.rng.range(2.6, 4.2),
        color: this.dustColor(material),
        alpha: 0.4,
        maxR: 2.6,
      });
    }
  }

  /** A low, slow cloud that rolls over the rubble once everything has come down. */
  settleHaze(minX: number, maxX: number): void {
    const n = Math.round(16 * this.amount);
    const span = Math.max(2, maxX - minX);
    for (let i = 0; i < n; i++) {
      this.puffs.push({
        x: minX + span * ((i + this.rng.range(0, 1)) / n),
        y: this.rng.range(0.3, 2.2),
        vx: this.rng.range(-0.5, 0.5),
        vy: this.rng.range(0.05, 0.25),
        r: this.rng.range(0.8, 1.4),
        growth: this.rng.range(0.2, 0.45),
        life: 0,
        maxLife: this.rng.range(4, 6),
        color: i % 2 ? '#8f877c' : '#a79e90',
        alpha: 0.2,
        maxR: 3.2,
      });
    }
  }

  /** Long, slow dust that hangs over the site once everything stops. */
  private settleDust(): void {
    // Leave what is already there to drift; add a thin lingering haze.
    for (const p of this.puffs) {
      p.maxLife = Math.max(p.maxLife, p.life + 1.5);
      p.vx *= 0.4;
    }
  }

  update(dt: number): void {
    this.now += dt;
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i] as Puff;
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.puffs.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 1.8 * dt;
      p.vy = p.vy * (1 - 1.5 * dt) + (p.fire ? 1.2 : 0.35) * dt;
      p.r = Math.min(p.maxR ?? 1.9, p.r + p.growth * dt);
      if (p.y < 0.05) {
        p.y = 0.05;
        p.vy = Math.abs(p.vy) * 0.3;
      }
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i] as Spark;
      s.life += dt;
      if (s.life >= s.maxLife) {
        this.sparks.splice(i, 1);
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy -= 14 * dt;
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i] as Debris;
      d.life += dt;
      if (d.life >= d.maxLife) {
        this.debris.splice(i, 1);
        continue;
      }
      d.vy -= 16 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.a += d.va * dt;
      if (d.y < 0.04) {
        d.y = 0.04;
        if (!d.bounced && d.vy < -2) {
          d.vy = -d.vy * 0.3;
          d.vx *= 0.5;
          d.va *= 0.4;
          d.bounced = true;
        } else {
          d.vy = 0;
          d.vx *= 1 - 6 * dt;
          d.va = 0;
        }
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i] as Flash;
      f.life += dt;
      if (f.life >= f.maxLife) this.flashes.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i] as Ring;
      r.life += dt;
      if (r.life >= r.maxLife) this.rings.splice(i, 1);
    }
    for (let i = this.jets.length - 1; i >= 0; i--) {
      const j = this.jets[i] as Jet;
      j.life += dt;
      if (j.life >= j.maxLife) this.jets.splice(i, 1);
    }
    for (const [id, s] of this.stress) if (this.now - s.at > 1.2) this.stress.delete(id);
    if (this.rubble) this.slumpRubble();
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.punch = Math.max(0, this.punch - dt * 0.22);
    if (this.puffs.length > MAX_PUFFS) this.puffs.splice(0, this.puffs.length - MAX_PUFFS);
    if (this.debris.length > MAX_DEBRIS) this.debris.splice(0, this.debris.length - MAX_DEBRIS);
    if (this.sparks.length > MAX_SPARKS) this.sparks.splice(0, this.sparks.length - MAX_SPARKS);
  }

  /** Steep rubble slides sideways so heaps settle into mounds. */
  private slumpRubble(): void {
    const h = (this.rubble as RubbleField).h;
    const maxStep = 0.11;
    for (let i = 1; i < h.length; i++) {
      const d = (h[i - 1] as number) - (h[i] as number);
      if (Math.abs(d) > maxStep) {
        const move = (Math.abs(d) - maxStep) * 0.25 * Math.sign(d);
        h[i - 1] = (h[i - 1] as number) - move;
        h[i] = (h[i] as number) + move;
      }
    }
  }

  get active(): boolean {
    return this.puffs.length > 0 || this.sparks.length > 0 || this.flashes.length > 0 || this.debris.length > 0 || this.rings.length > 0 || this.shake > 0;
  }
}
