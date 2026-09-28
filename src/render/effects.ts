import { Rng } from '../core/rng';
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
}

export interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
}

export interface Flash {
  x: number;
  y: number;
  r: number;
  life: number;
  maxLife: number;
}

/**
 * Purely cosmetic particles driven by simulation events: dust, sparks and
 * detonation flashes. Nothing here affects the outcome.
 */
export class Effects {
  puffs: Puff[] = [];
  sparks: Spark[] = [];
  flashes: Flash[] = [];
  shake = 0;
  reducedMotion = false;
  private rng = new Rng(7);

  clear(): void {
    this.puffs.length = 0;
    this.sparks.length = 0;
    this.flashes.length = 0;
    this.shake = 0;
  }

  ingest(events: SimEvent[]): void {
    for (const e of events) this.handle(e);
  }

  private dustColor(material?: SimEvent['material']): string {
    if (!material) return '#b9aa92';
    switch (material) {
      case 'brick':
        return '#c48a6e';
      case 'concrete':
        return '#bfc2c5';
      case 'wood':
        return '#c9a678';
      case 'steel':
        return '#9aa6b5';
      default:
        return MATERIALS[material as keyof typeof MATERIALS]?.rubble ?? '#b9aa92';
    }
  }

  private handle(e: SimEvent): void {
    const scale = this.reducedMotion ? 0.35 : 1;
    switch (e.type) {
      case 'detonate': {
        this.flashes.push({ x: e.x, y: e.y, r: 0.6 + e.strength * 1.6, life: 0, maxLife: 0.45 });
        this.shake = Math.max(this.shake, 0.6 + e.strength * 0.4);
        const n = Math.round(10 * scale);
        for (let i = 0; i < n; i++) {
          const a = this.rng.range(0, Math.PI * 2);
          const s = this.rng.range(3, 8) * (0.6 + e.strength);
          this.puffs.push({
            x: e.x,
            y: e.y,
            vx: Math.cos(a) * s,
            vy: Math.sin(a) * s * 0.7 + 2,
            r: this.rng.range(0.15, 0.4),
            growth: this.rng.range(0.4, 0.9),
            life: 0,
            maxLife: this.rng.range(0.9, 1.6),
            color: i % 3 === 0 ? '#2a2623' : '#4a423c',
            alpha: 0.5,
          });
        }
        const sparks = Math.round(18 * scale);
        for (let i = 0; i < sparks; i++) {
          const a = this.rng.range(0, Math.PI * 2);
          const s = this.rng.range(4, 12);
          this.sparks.push({ x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 3, life: 0, maxLife: this.rng.range(0.3, 0.8), color: i % 2 ? '#ffd27a' : '#ff8a3d' });
        }
        break;
      }
      case 'break':
      case 'shatter':
      case 'crush': {
        const n = Math.round((3 + e.strength * 4) * scale);
        for (let i = 0; i < n; i++) {
          this.puffs.push({
            x: e.x + this.rng.range(-0.6, 0.6),
            y: e.y + this.rng.range(-0.6, 0.6),
            vx: this.rng.range(-1.5, 1.5),
            vy: this.rng.range(-0.5, 1.2),
            r: this.rng.range(0.15, 0.4),
            growth: this.rng.range(0.3, 0.8),
            life: 0,
            maxLife: this.rng.range(0.9, 1.6),
            color: this.dustColor(e.material),
            alpha: 0.38,
          });
        }
        break;
      }
      case 'impact': {
        this.shake = Math.max(this.shake, e.strength * 0.5);
        const n = Math.round((4 + e.strength * 8) * scale);
        for (let i = 0; i < n; i++) {
          const dir = this.rng.range(-1, 1);
          this.puffs.push({
            x: e.x + dir * this.rng.range(0, 1.2),
            y: e.y + 0.1,
            vx: dir * this.rng.range(1, 4) * (0.5 + e.strength),
            vy: this.rng.range(0.3, 1.6) * (0.5 + e.strength),
            r: this.rng.range(0.2, 0.5),
            growth: this.rng.range(0.5, 1.1) * (0.6 + e.strength),
            life: 0,
            maxLife: this.rng.range(1.2, 2.4),
            color: this.dustColor(e.material),
            alpha: 0.35,
          });
        }
        break;
      }
      case 'topple':
      case 'settled':
        break;
    }
  }

  update(dt: number): void {
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
      p.vy = p.vy * (1 - 1.5 * dt) + 0.35 * dt;
      p.r = Math.min(1.8, p.r + p.growth * dt);
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
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i] as Flash;
      f.life += dt;
      if (f.life >= f.maxLife) this.flashes.splice(i, 1);
    }
    this.shake = Math.max(0, this.shake - dt * 1.6);
    if (this.puffs.length > 600) this.puffs.splice(0, this.puffs.length - 600);
  }

  get active(): boolean {
    return this.puffs.length > 0 || this.sparks.length > 0 || this.flashes.length > 0 || this.shake > 0;
  }
}
