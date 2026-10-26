import type { PieceMaterial } from './structure';
import { heightAt, type WreckEvent, type WreckSim } from './sim';

/**
 * Secondary debris and dust. Purely cosmetic: driven by simulation events,
 * never read back by the simulation, so it is free to use Math.random and to
 * drop particles when the budget is spent.
 */

const MAX_CHUNKS = 700;
const MAX_DUST = 260;

const CHUNK_COLORS: Record<PieceMaterial, string[]> = {
  concrete: ['#a39d93', '#8f8980', '#b8b2a7', '#77726b'],
  brick: ['#8b4a35', '#a0573e', '#6e3a2a', '#b8a58c'],
  glass: ['#cfe3ee', '#9fc0d4', '#e8f3f8'],
  steel: ['#5b666e', '#78848c', '#3e474e'],
  wood: ['#7a5636', '#94693f', '#5a3f27'],
};

export class WreckFx {
  // Chunks: struct of arrays.
  private cx = new Float32Array(MAX_CHUNKS);
  private cy = new Float32Array(MAX_CHUNKS);
  private cvx = new Float32Array(MAX_CHUNKS);
  private cvy = new Float32Array(MAX_CHUNKS);
  private ca = new Float32Array(MAX_CHUNKS);
  private cva = new Float32Array(MAX_CHUNKS);
  private cs = new Float32Array(MAX_CHUNKS);
  private clife = new Float32Array(MAX_CHUNKS);
  private ccol: string[] = new Array(MAX_CHUNKS).fill('#888');
  private cglass = new Uint8Array(MAX_CHUNKS);
  private chunkCount = 0;
  // Dust puffs.
  private dx = new Float32Array(MAX_DUST);
  private dy = new Float32Array(MAX_DUST);
  private dvx = new Float32Array(MAX_DUST);
  private dvy = new Float32Array(MAX_DUST);
  private dr = new Float32Array(MAX_DUST);
  private dgrow = new Float32Array(MAX_DUST);
  private dlife = new Float32Array(MAX_DUST);
  private dmax = new Float32Array(MAX_DUST);
  private dalpha = new Float32Array(MAX_DUST);
  private dtint = new Uint8Array(MAX_DUST);
  private dustCount = 0;
  private dustSprites: HTMLCanvasElement[] = [];

  /** Shockwave rings and fireballs: the over-the-top layer. */
  private rings: Array<{ x: number; y: number; r: number; max: number; life: number; total: number; hot: boolean }> = [];
  private fire: Array<{ x: number; y: number; vx: number; vy: number; r: number; life: number; total: number }> = [];

  shake = 0;
  punch = 0;
  /** Brief white-out of the impact point for the biggest hits (0..1). */
  flash = 0;
  flashX = 0;
  flashY = 0;
  reducedMotion = false;
  /** Scales particle counts on slow devices. */
  quality = 1;

  constructor() {
    if (typeof document !== 'undefined') {
      this.dustSprites = ['rgba(196,184,166,', 'rgba(150,140,128,', 'rgba(214,206,192,'].map((base) => {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const g = c.getContext('2d') as CanvasRenderingContext2D;
        const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, `${base}0.9)`);
        grad.addColorStop(0.45, `${base}0.55)`);
        grad.addColorStop(1, `${base}0)`);
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
        return c;
      });
    }
  }

  ring(x: number, y: number, max: number, life = 0.6, hot = false): void {
    if (this.rings.length > 12) this.rings.shift();
    this.rings.push({ x, y, r: 0.4, max, life, total: life, hot });
  }

  fireball(x: number, y: number, size: number): void {
    const n = Math.round(10 * this.quality * size);
    for (let i = 0; i < n && this.fire.length < 80; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 5 * size;
      const life = 0.5 + Math.random() * 0.5;
      this.fire.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 2, r: (0.6 + Math.random() * 1.2) * size, life, total: life });
    }
  }

  clear(): void {
    this.rings = [];
    this.fire = [];
    this.chunkCount = 0;
    this.dustCount = 0;
    this.shake = 0;
    this.punch = 0;
    this.flash = 0;
  }

  chunk(x: number, y: number, vx: number, vy: number, size: number, color: string, glass = false, life = 4): void {
    if (this.chunkCount >= MAX_CHUNKS) return;
    const i = this.chunkCount++;
    this.cx[i] = x;
    this.cy[i] = y;
    this.cvx[i] = vx;
    this.cvy[i] = vy;
    this.ca[i] = Math.random() * Math.PI;
    this.cva[i] = (Math.random() - 0.5) * 12;
    this.cs[i] = size;
    this.clife[i] = life + Math.random() * 1.5;
    this.ccol[i] = color;
    this.cglass[i] = glass ? 1 : 0;
  }

  dust(x: number, y: number, r: number, vx = 0, vy = 0, life = 4, alpha = 0.55, grow = 0.9): void {
    if (this.dustCount >= MAX_DUST) {
      // Recycle the faintest old puff rather than drop a new one.
      let oldest = 0;
      let worst = Infinity;
      for (let i = 0; i < this.dustCount; i++) {
        const left = this.dlife[i] as number;
        if (left < worst) {
          worst = left;
          oldest = i;
        }
      }
      this.removeDust(oldest);
    }
    const i = this.dustCount++;
    this.dx[i] = x;
    this.dy[i] = y;
    this.dvx[i] = vx;
    this.dvy[i] = vy;
    this.dr[i] = r;
    this.dgrow[i] = grow;
    this.dlife[i] = life;
    this.dmax[i] = life;
    this.dalpha[i] = alpha;
    this.dtint[i] = Math.floor(Math.random() * 3);
  }

  private removeDust(i: number): void {
    const last = --this.dustCount;
    if (i === last) return;
    this.dx[i] = this.dx[last] as number;
    this.dy[i] = this.dy[last] as number;
    this.dvx[i] = this.dvx[last] as number;
    this.dvy[i] = this.dvy[last] as number;
    this.dr[i] = this.dr[last] as number;
    this.dgrow[i] = this.dgrow[last] as number;
    this.dlife[i] = this.dlife[last] as number;
    this.dmax[i] = this.dmax[last] as number;
    this.dalpha[i] = this.dalpha[last] as number;
    this.dtint[i] = this.dtint[last] as number;
  }

  private removeChunk(i: number): void {
    const last = --this.chunkCount;
    if (i === last) return;
    this.cx[i] = this.cx[last] as number;
    this.cy[i] = this.cy[last] as number;
    this.cvx[i] = this.cvx[last] as number;
    this.cvy[i] = this.cvy[last] as number;
    this.ca[i] = this.ca[last] as number;
    this.cva[i] = this.cva[last] as number;
    this.cs[i] = this.cs[last] as number;
    this.clife[i] = this.clife[last] as number;
    this.ccol[i] = this.ccol[last] as string;
    this.cglass[i] = this.cglass[last] as number;
  }

  ingest(events: WreckEvent[], sim: WreckSim): void {
    const q = this.quality;
    for (const e of events) {
      switch (e.type) {
        case 'hit': {
          const k = Math.min(1, e.energy / 700);
          if (k > 0.35) this.ring(e.x, e.y, 2 + k * 5, 0.35);
          this.shake = Math.max(this.shake, 0.25 + k * 0.9);
          this.punch = Math.max(this.punch, 0.02 + k * 0.05);
          if (k > 0.45) {
            this.flash = Math.max(this.flash, k);
            this.flashX = e.x;
            this.flashY = e.y;
          }
          const dir = Math.sign(sim.state.ball.vx || 1);
          const n = Math.round((6 + k * 18) * q);
          const cols = CHUNK_COLORS[e.material];
          for (let i = 0; i < n; i++) {
            const sp = 3 + Math.random() * 9 * (0.4 + k);
            const ang = (Math.random() - 0.5) * 1.8;
            this.chunk(e.x, e.y, dir * Math.cos(ang) * sp, Math.sin(ang) * sp + 2, 0.08 + Math.random() * 0.22, cols[i % cols.length] as string, e.material === 'glass');
          }
          for (let i = 0; i < 3 + k * 6; i++) this.dust(e.x + (Math.random() - 0.5), e.y + (Math.random() - 0.5), 0.8 + k * 1.4, dir * (1 + Math.random() * 3), Math.random() * 1.5, 2.5 + k * 3, 0.5);
          break;
        }
        case 'shatter': {
          const p = sim.def.pieces[e.piece];
          if (!p) break;
          const cols = CHUNK_COLORS[e.material];
          const glass = e.material === 'glass';
          const area = p.w * p.h;
          const n = Math.min(glass ? 16 : 12, Math.round((3 + area * (glass ? 1.4 : 0.9)) * q));
          const cos = Math.cos(e.a);
          const sin = Math.sin(e.a);
          for (let i = 0; i < n; i++) {
            const u = (Math.random() - 0.5) * p.w;
            const v = (Math.random() - 0.5) * p.h;
            const x = e.x + u * cos - v * sin;
            const y = e.y + u * sin + v * cos;
            const size = glass ? 0.06 + Math.random() * 0.14 : Math.min(0.9, 0.12 + Math.random() * Math.min(p.w, p.h) * 0.45);
            this.chunk(x, y, e.vx + (Math.random() - 0.5) * 4, e.vy + Math.random() * 3, size, cols[i % cols.length] as string, glass);
          }
          if (!glass) {
            const puffs = Math.min(4, 1 + Math.floor(area / 4));
            for (let i = 0; i < puffs; i++) this.dust(e.x + (Math.random() - 0.5) * p.w, e.y + (Math.random() - 0.5) * p.h, 1 + Math.random() * 1.2, e.vx * 0.2, 0.3, 4 + Math.random() * 3, 0.42);
          }
          break;
        }
        case 'crack': {
          this.dust(e.x, e.y, 0.35 + e.strength * 0.5, 0, -0.4, 1.6, 0.35, 0.5);
          for (let i = 0; i < 3; i++) this.chunk(e.x + (Math.random() - 0.5) * 0.5, e.y, (Math.random() - 0.5) * 1.5, 0, 0.05 + Math.random() * 0.08, '#9a948a');
          break;
        }
        case 'blast': {
          // A cutter is a sharp bright cut; a blast charge throws a ring of dust and grit.
          const big = e.kind === 'blast';
          this.ring(e.x, e.y, big ? 11 : 7, 0.55, true);
          this.ring(e.x, e.y, big ? 18 : 11, 0.9);
          this.fireball(e.x, e.y, big ? 1.6 : 1.1);
          this.shake = Math.max(this.shake, big ? 1.3 : 0.9);
          this.punch = Math.max(this.punch, big ? 0.07 : 0.05);
          this.flash = 1;
          this.flashX = e.x;
          this.flashY = e.y;
          const n = Math.round((big ? 40 : 22) * q);
          for (let i = 0; i < n; i++) {
            const ang = Math.random() * Math.PI * 2;
            const sp = (big ? 8 : 5) + Math.random() * (big ? 14 : 9);
            this.chunk(e.x, e.y, Math.cos(ang) * sp, Math.sin(ang) * sp + 2, 0.06 + Math.random() * 0.2, i % 4 === 0 ? '#ffd27a' : (CHUNK_COLORS.concrete[i % 4] as string), false, 2.5);
          }
          const puffs = big ? 12 : 6;
          for (let i = 0; i < puffs; i++) {
            const ang = (i / puffs) * Math.PI * 2;
            this.dust(e.x + Math.cos(ang) * 0.6, e.y + Math.sin(ang) * 0.6, big ? 1.6 : 1, Math.cos(ang) * (big ? 4 : 2.5), Math.sin(ang) * 2 + 1, big ? 6 : 4, 0.55, big ? 1.6 : 1.1);
          }
          break;
        }
        case 'bite': {
          if (e.target === 'air') break;
          this.shake = Math.max(this.shake, 0.25);
          const cols = CHUNK_COLORS[e.material];
          for (let i = 0; i < Math.round(9 * q); i++) this.chunk(e.x + (Math.random() - 0.5) * 0.8, e.y, (Math.random() - 0.5) * 5, Math.random() * 3, 0.08 + Math.random() * 0.2, cols[i % cols.length] as string, e.material === 'glass');
          this.dust(e.x, e.y, 0.9, 0, 0.4, 2.5, 0.45);
          break;
        }
        case 'blockBreak': {
          this.shake = Math.max(this.shake, 0.4);
          const cols = CHUNK_COLORS[e.material];
          for (let i = 0; i < Math.round(14 * q); i++) this.chunk(e.x + (Math.random() - 0.5) * 2, e.y, (Math.random() - 0.5) * 6, 1 + Math.random() * 4, 0.1 + Math.random() * 0.3, cols[i % cols.length] as string);
          for (let i = 0; i < 4; i++) this.dust(e.x + (Math.random() - 0.5) * 2, e.y, 1.2, (Math.random() - 0.5) * 2, 0.5, 4, 0.5);
          break;
        }
        case 'ram': {
          this.shake = Math.max(this.shake, 0.2);
          const cols = CHUNK_COLORS[e.material];
          for (let i = 0; i < 5; i++) this.chunk(e.x, e.y, (Math.random() - 0.5) * 4, Math.random() * 2, 0.08 + Math.random() * 0.15, cols[i % cols.length] as string, e.material === 'glass');
          break;
        }
        case 'scoop':
        case 'dump': {
          if (e.area <= 0.05) break;
          for (let i = 0; i < 3; i++) this.dust(e.x + (Math.random() - 0.5) * 1.5, e.y, 0.8 + Math.min(1, e.area / 8), (Math.random() - 0.5) * 1.2, 0.6, 3, 0.4, 0.8);
          for (let i = 0; i < Math.round(6 * q); i++) this.chunk(e.x + (Math.random() - 0.5), e.y + 0.5, (Math.random() - 0.5) * 3, Math.random() * 2, 0.08 + Math.random() * 0.15, CHUNK_COLORS.concrete[i % 4] as string);
          break;
        }
        case 'machineHit': {
          this.shake = Math.max(this.shake, 0.6);
          for (let i = 0; i < 6; i++) this.dust(e.x + (Math.random() - 0.5) * 3, e.y, 1, (Math.random() - 0.5), 1.2, 5, 0.5);
          break;
        }
        case 'detach': {
          const k = Math.min(1, e.mass / 600);
          this.shake = Math.max(this.shake, 0.15 + k * 0.4);
          break;
        }
        case 'land': {
          const k = Math.min(1, e.mass / 500);
          if (e.mass > 60) this.ring(e.x, Math.max(0.5, e.y), 4 + Math.sqrt(e.mass) * 0.6, 0.7);
          this.shake = Math.max(this.shake, 0.3 + k * 1.1);
          this.punch = Math.max(this.punch, k * 0.04);
          const spread = 2 + Math.sqrt(e.mass) * 0.35;
          const puffs = Math.round((2 + k * 7) * q);
          for (let i = 0; i < puffs; i++) {
            const side = Math.random() < 0.5 ? -1 : 1;
            // Thick at first, but it clears in a few seconds so the wreck can be read.
            this.dust(e.x + (Math.random() - 0.5) * spread, e.y + Math.random(), 1.2 + k * 2.4, side * (1.5 + Math.random() * 4 * (0.4 + k)), 0.6 + Math.random(), 3.5 + k * 2.5, 0.42, 1);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  update(dt: number, sim: WreckSim): void {
    const hm = sim.state.heightmap;
    for (let i = this.chunkCount - 1; i >= 0; i--) {
      let life = (this.clife[i] as number) - dt;
      this.cvy[i] = (this.cvy[i] as number) - 12 * dt;
      let x = (this.cx[i] as number) + (this.cvx[i] as number) * dt;
      let y = (this.cy[i] as number) + (this.cvy[i] as number) * dt;
      this.ca[i] = (this.ca[i] as number) + (this.cva[i] as number) * dt;
      const g = heightAt(hm, x) + (this.cs[i] as number) * 0.3;
      if (y < g) {
        y = g;
        this.cvy[i] = -(this.cvy[i] as number) * 0.25;
        this.cvx[i] = (this.cvx[i] as number) * 0.55;
        this.cva[i] = (this.cva[i] as number) * 0.5;
        if (Math.abs(this.cvy[i] as number) < 0.6) this.cvy[i] = 0;
        life -= dt * 0.6;
      }
      x = Math.max(-200, Math.min(300, x));
      this.cx[i] = x;
      this.cy[i] = y;
      this.clife[i] = life;
      if (life <= 0) this.removeChunk(i);
    }
    // Dust drifts downwind and rises slowly while it spreads.
    for (let i = this.dustCount - 1; i >= 0; i--) {
      const life = (this.dlife[i] as number) - dt;
      this.dlife[i] = life;
      if (life <= 0) {
        this.removeDust(i);
        continue;
      }
      this.dvx[i] = (this.dvx[i] as number) * (1 - 0.8 * dt) + 0.35 * dt;
      this.dvy[i] = (this.dvy[i] as number) * (1 - 0.8 * dt) + 0.12 * dt;
      this.dx[i] = (this.dx[i] as number) + (this.dvx[i] as number) * dt;
      this.dy[i] = Math.max(heightAt(hm, this.dx[i] as number) + (this.dr[i] as number) * 0.3, (this.dy[i] as number) + (this.dvy[i] as number) * dt);
      this.dr[i] = (this.dr[i] as number) + (this.dgrow[i] as number) * dt;
    }
    // Falling sections shed dust and grit from their undersides.
    for (const b of sim.state.bodies) {
      if (b.state !== 'moving') continue;
      const speed = Math.hypot(b.vx, b.vy);
      if (speed < 3 || Math.random() > Math.min(1, b.mass / 120) * 0.5 * this.quality) continue;
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * b.radius * 0.6;
      this.dust(b.x + Math.cos(ang) * r, b.y + Math.sin(ang) * r, 0.8 + Math.random() * 1.5, b.vx * 0.3, b.vy * 0.15, 3 + Math.random() * 3, 0.32, 0.8);
      if (Math.random() < 0.5) this.chunk(b.x + Math.cos(ang) * r, b.y + Math.sin(ang) * r, b.vx + (Math.random() - 0.5) * 2, b.vy, 0.06 + Math.random() * 0.15, '#9a948a', false, 2.5);
    }
    // The dozer's pile churns as it is pushed.
    const d = sim.state.dozer;
    if (d.bladeDown && Math.abs(d.speed) > 0.5 && d.load > 0.5 && Math.random() < 0.35 * this.quality) {
      const f = d.x + d.dir * 3.25;
      this.dust(f + d.dir * (0.5 + Math.random() * 2), heightAt(hm, f + d.dir) + 0.4, 0.7 + Math.random() * 0.6, d.dir * 0.8, 0.3, 2.5, 0.35, 0.7);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i] as (typeof this.rings)[number];
      r.life -= dt;
      r.r += (r.max - r.r) * Math.min(1, dt * 7);
      if (r.life <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.fire.length - 1; i >= 0; i--) {
      const f = this.fire[i] as (typeof this.fire)[number];
      f.life -= dt;
      f.vx *= 1 - dt * 2.5;
      f.vy = f.vy * (1 - dt * 2.5) + dt * 3;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.r += dt * 1.5;
      if (f.life <= 0) this.fire.splice(i, 1);
    }
    const decay = this.reducedMotion ? 10 : 3.2;
    this.shake = Math.max(0, this.shake - dt * decay);
    this.punch = Math.max(0, this.punch - dt * 0.35);
    this.flash = Math.max(0, this.flash - dt * 6);
  }

  drawChunks(ctx: CanvasRenderingContext2D, scale: number): void {
    const minPx = 1.2 / scale;
    for (let i = 0; i < this.chunkCount; i++) {
      const s = Math.max(minPx, this.cs[i] as number);
      const life = this.clife[i] as number;
      ctx.globalAlpha = Math.min(1, life);
      ctx.fillStyle = this.ccol[i] as string;
      const x = this.cx[i] as number;
      const y = this.cy[i] as number;
      if (this.cglass[i]) {
        // Glass glints as it turns.
        const glint = 0.55 + 0.45 * Math.abs(Math.sin((this.ca[i] as number) * 2));
        ctx.globalAlpha = Math.min(1, life) * glint;
        ctx.fillRect(x - s / 2, y - s / 6, s, s / 3);
        continue;
      }
      const a = this.ca[i] as number;
      const c = Math.cos(a) * s * 0.5;
      const d = Math.sin(a) * s * 0.5;
      ctx.beginPath();
      ctx.moveTo(x + c, y + d);
      ctx.lineTo(x - d * 0.8, y + c * 0.8);
      ctx.lineTo(x - c, y - d);
      ctx.lineTo(x + d * 0.6, y - c * 0.6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Shockwaves and fireballs, drawn over the dust. */
  drawBlast(ctx: CanvasRenderingContext2D): void {
    for (const r of this.rings) {
      const k = r.life / r.total;
      ctx.strokeStyle = r.hot ? `rgba(255,214,120,${k * 0.9})` : `rgba(255,255,255,${k * 0.6})`;
      ctx.lineWidth = 0.15 + k * 0.5;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.r, r.r * 0.8, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (!this.fire.length) return;
    const prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    for (const f of this.fire) {
      const k = f.life / f.total;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      g.addColorStop(0, `rgba(255,246,200,${k * 0.9})`);
      g.addColorStop(0.4, `rgba(255,150,40,${k * 0.7})`);
      g.addColorStop(1, 'rgba(200,40,10,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = prev;
  }

  drawDust(ctx: CanvasRenderingContext2D): void {
    if (!this.dustSprites.length) return;
    for (let i = 0; i < this.dustCount; i++) {
      const life = this.dlife[i] as number;
      const max = this.dmax[i] as number;
      const age = 1 - life / max;
      // Swells in quickly, then thins out.
      const a = (this.dalpha[i] as number) * Math.min(1, age * 8) * Math.min(1, (life / max) * 1.6);
      if (a <= 0.01) continue;
      const r = this.dr[i] as number;
      ctx.globalAlpha = a;
      ctx.drawImage(this.dustSprites[this.dtint[i] as number] as HTMLCanvasElement, (this.dx[i] as number) - r, (this.dy[i] as number) - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
  }

  get dustAmount(): number {
    return this.dustCount;
  }
}
