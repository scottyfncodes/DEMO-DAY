import { easeOutCubic } from '../core/format';
import { hashString } from '../core/rng';
import type { ChargeType, Direction, Material, MemberKind, NeighborDef, PlacedCharge } from '../core/types';
import { CHARGES } from '../data/charges';
import { MATERIALS } from '../data/materials';
import { corners, type Chunk, type Simulation } from '../sim/simulation';
import { chargePoint, type Building, type Member } from '../structure/building';
import type { Camera } from './camera';
import { drawCharge } from './charges';
import { RUBBLE_MATERIALS, type Effects } from './effects';

/** A charge that was just taken off, animating away. */
export interface RemovedCharge {
  type: ChargeType;
  direction?: Direction;
  x: number;
  y: number;
  at: number;
}

export interface SceneState {
  building: Building;
  sim?: Simulation;
  charges: PlacedCharge[];
  selectedId?: string;
  /** Draw support links for every member (structural scanner). */
  showAllLinks: boolean;
  /** Load / capacity per member, for the scanner overlay. */
  loadRatio?: Map<string, number>;
  mode: 'plan' | 'sim';
  time: number;
  /** When each charge was placed (seconds, same clock as `time`). */
  placedAt?: Map<string, number>;
  removed?: RemovedCharge[];
  /** Set once the job is armed: charges light up one after another. */
  armedAt?: number;
  /** Countdown progress 0..1: fuses burn down, lights race. */
  burn?: number;
  /** Members about to give way, 0..1: they shudder and crack first. */
  strain?: Map<string, number>;
  /** Landed pieces breaking up into rubble, 0..1; 1 = gone into the heap. */
  crumble?: Map<string, number>;
}

/** Delay between charges switching on during the arm sequence. */
export const ARM_STAGGER = 0.11;

export const UI_FONT = "'Barlow Condensed', 'Avenir Next Condensed', 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif";

const COLORS = {
  skyTop: '#0d1219',
  skyMid: '#1a2331',
  horizon: '#3a3b47',
  ground: '#17130f',
  groundLine: '#5a4a3a',
  zone: 'rgba(255, 176, 32, 0.12)',
  zoneEdge: 'rgba(255, 176, 32, 0.8)',
  select: '#ffffff',
  supportLink: '#38c6ff',
  carryLink: '#ffb020',
  protect: '#4be38a',
  rubble: '#3b3230',
  rubbleTop: '#5a4d48',
  text: '#e8e6e1',
};

interface Block {
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
  material: Material;
  kind: MemberKind;
  integrity: number;
  id: string;
  memberId: string;
  protect: boolean;
  isFragment: boolean;
  preDamage: number;
  /** 0..1 while a landed piece breaks up into the rubble heap. */
  squash?: number;
}

function easeOutBack(t: number): number {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * Canvas 2D renderer. Draws either the planned building (plan mode) or the
 * live simulation (sim mode) plus overlays: landing zone, neighbours, charges,
 * support links, selection, rubble and dust.
 */
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  width = 1;
  height = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
  }

  resize(width: number, height: number): void {
    // Cap the backing store: a 3x iPhone canvas is 3x the fill cost for no visible gain.
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }

  // ------------------------------------------------------------------ draw

  draw(state: SceneState, cam: Camera, fx: Effects): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawSky(cam);
    this.drawGround(state, cam);
    this.drawZone(state, cam);
    for (const n of state.building.def.neighbors ?? []) this.drawNeighbor(n, cam, state.sim);
    if (state.sim) this.drawRubble(state.sim, cam, fx);

    const blocks = this.collectBlocks(state);
    // Standing and resting first so falling pieces draw on top.
    blocks.sort((a, b) => (a.isFragment ? 1 : 0) - (b.isFragment ? 1 : 0));
    for (const b of blocks) this.drawBlock(b, cam, state, fx);

    if (state.mode === 'plan') {
      if (state.armedAt === undefined) this.drawLinks(state, cam);
      this.drawCharges(state, cam);
      this.drawRemoved(state, cam);
      if (state.armedAt === undefined) this.drawSelection(state, cam);
    }
    this.drawEffects(fx, cam);
  }

  private drawSky(cam: Camera): void {
    const ctx = this.ctx;
    const horizon = cam.worldToScreen(0, 0).y;
    const grad = ctx.createLinearGradient(0, 0, 0, Math.max(1, horizon));
    grad.addColorStop(0, COLORS.skyTop);
    grad.addColorStop(0.7, COLORS.skyMid);
    grad.addColorStop(1, COLORS.horizon);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);
    // Distant skyline silhouettes for depth.
    ctx.fillStyle = 'rgba(20, 26, 36, 0.9)';
    const base = horizon;
    const seed = 11;
    for (let i = 0; i < 26; i++) {
      const hgt = 18 + ((i * 37 + seed) % 60);
      const wdt = 26 + ((i * 53) % 44);
      const x = ((i * 97) % 1400) * (this.width / 1400) - 20 + (cam.x * -0.4 * cam.drawScale) / 20;
      ctx.fillRect(x, base - hgt, wdt, hgt + 2);
    }
  }

  private drawGround(state: SceneState, cam: Camera): void {
    const ctx = this.ctx;
    const g = state.building.def.ground ?? { x: -40, w: 120 };
    const top = cam.worldToScreen(0, 0).y;
    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(0, top, this.width, Math.max(0, this.height - top));
    const l = cam.worldToScreen(g.x, 0).x;
    const r = cam.worldToScreen(g.x + g.w, 0).x;
    ctx.fillStyle = COLORS.groundLine;
    ctx.fillRect(l, top - 1, r - l, 3);
    // Subtle grid every 5 metres for scale.
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    const startX = Math.floor(g.x / 5) * 5;
    for (let x = startX; x <= g.x + g.w; x += 5) {
      const sx = cam.worldToScreen(x, 0).x;
      ctx.beginPath();
      ctx.moveTo(sx, top + 2);
      ctx.lineTo(sx, this.height);
      ctx.stroke();
    }
  }

  private drawZone(state: SceneState, cam: Camera): void {
    const ctx = this.ctx;
    const z = state.building.def.footprint;
    const a = cam.worldToScreen(z.x, 0);
    const b = cam.worldToScreen(z.x + z.w, -0.9);
    ctx.fillStyle = COLORS.zone;
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.strokeStyle = COLORS.zoneEdge;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - 4);
    ctx.lineTo(a.x, b.y);
    ctx.moveTo(b.x, a.y - 4);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.zoneEdge;
    ctx.font = `600 ${Math.max(11, Math.min(15, cam.drawScale * 0.5))}px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('LANDING ZONE', (a.x + b.x) / 2, (a.y + b.y) / 2);
  }

  private drawNeighbor(n: NeighborDef, cam: Camera, sim?: Simulation): void {
    const ctx = this.ctx;
    const a = cam.worldToScreen(n.x, n.h);
    const b = cam.worldToScreen(n.x + n.w, 0);
    const w = b.x - a.x;
    const hgt = b.y - a.y;
    const hit = sim ? (sim.result().neighborHits[n.id] ?? 0) > 0 : false;
    const style = n.style ?? 'house';
    ctx.save();
    switch (style) {
      case 'road': {
        ctx.fillStyle = '#2b2d33';
        ctx.fillRect(a.x, a.y, w, hgt);
        ctx.strokeStyle = '#d9c46a';
        ctx.lineWidth = Math.max(1, cam.drawScale * 0.08);
        ctx.setLineDash([cam.drawScale * 0.8, cam.drawScale * 0.6]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y + hgt / 2);
        ctx.lineTo(b.x, a.y + hgt / 2);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      case 'water': {
        ctx.fillStyle = '#1f4d6b';
        ctx.fillRect(a.x, a.y, w, hgt + cam.drawScale * 1.2);
        ctx.strokeStyle = 'rgba(160, 220, 255, 0.5)';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          const yy = a.y + 4 + i * Math.max(4, cam.drawScale * 0.25);
          for (let x = a.x; x <= b.x; x += 6) {
            const off = Math.sin(x / 9 + i) * 2;
            if (x === a.x) ctx.moveTo(x, yy + off);
            else ctx.lineTo(x, yy + off);
          }
          ctx.stroke();
        }
        break;
      }
      case 'fence': {
        ctx.fillStyle = '#7b6a55';
        const picket = Math.max(3, cam.drawScale * 0.12);
        const gap = Math.max(4, cam.drawScale * 0.22);
        for (let x = a.x; x < b.x; x += picket + gap) ctx.fillRect(x, a.y, picket, hgt);
        ctx.fillRect(a.x, a.y + hgt * 0.35, w, Math.max(2, cam.drawScale * 0.08));
        break;
      }
      case 'tank': {
        ctx.fillStyle = '#c9ced4';
        const r = Math.min(w, hgt) * 0.3;
        this.roundRect(a.x, a.y, w, hgt * 0.8, r);
        ctx.fill();
        ctx.fillStyle = '#6d7480';
        ctx.fillRect(a.x + w * 0.15, a.y + hgt * 0.8, w * 0.1, hgt * 0.2);
        ctx.fillRect(a.x + w * 0.75, a.y + hgt * 0.8, w * 0.1, hgt * 0.2);
        break;
      }
      case 'shed': {
        ctx.fillStyle = '#4f6a5e';
        ctx.fillRect(a.x, a.y + hgt * 0.3, w, hgt * 0.7);
        ctx.fillStyle = '#3b5147';
        ctx.beginPath();
        ctx.moveTo(a.x - 2, a.y + hgt * 0.3);
        ctx.lineTo(a.x + w / 2, a.y);
        ctx.lineTo(b.x + 2, a.y + hgt * 0.3);
        ctx.closePath();
        ctx.fill();
        break;
      }
      default: {
        ctx.fillStyle = '#4a5568';
        ctx.fillRect(a.x, a.y + hgt * 0.22, w, hgt * 0.78);
        ctx.fillStyle = '#374151';
        ctx.beginPath();
        ctx.moveTo(a.x - 3, a.y + hgt * 0.22);
        ctx.lineTo(a.x + w / 2, a.y);
        ctx.lineTo(b.x + 3, a.y + hgt * 0.22);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#f4e3a1';
        const wx = Math.max(4, cam.drawScale * 0.6);
        const wy = Math.max(4, cam.drawScale * 0.7);
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 2; j++) {
            const px = a.x + w * (0.15 + i * 0.3);
            const py = a.y + hgt * (0.35 + j * 0.3);
            if (px + wx < b.x) ctx.fillRect(px, py, wx, wy);
          }
        }
      }
    }
    if (hit) {
      ctx.fillStyle = 'rgba(255, 70, 50, 0.35)';
      ctx.fillRect(a.x, a.y, w, hgt);
    }
    ctx.restore();
    ctx.fillStyle = hit ? '#ff6a4d' : 'rgba(232, 230, 225, 0.85)';
    ctx.font = `600 ${Math.max(11, Math.min(14, cam.drawScale * 0.45))}px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText((hit ? '⚠ ' : '') + n.label.toUpperCase(), (a.x + b.x) / 2, a.y - 6);
  }

  private drawRubble(sim: Simulation, cam: Camera, fx: Effects): void {
    const ctx = this.ctx;
    const hm = sim.heightmap;
    const cell = (sim.groundMaxX - sim.groundMinX) / (hm.length - 1 || 1);
    const extra = fx.rubble && fx.rubble.h.length === hm.length ? fx.rubble : undefined;
    const raw = (i: number): number => (hm[i] as number) + (extra ? (extra.h[i] as number) : 0);
    // Draw the heap softened (a small moving average) so it reads as a pile, not a row of spikes.
    const R = 4;
    const smooth = new Float32Array(hm.length);
    for (let i = 0; i < hm.length; i++) {
      let sum = 0;
      let n = 0;
      for (let k = Math.max(0, i - R); k <= Math.min(hm.length - 1, i + R); k++) {
        sum += raw(k);
        n++;
      }
      smooth[i] = sum / n;
    }
    const heightAt = (i: number): number => smooth[i] as number;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < hm.length; i++) {
      const x = sim.groundMinX + i * cell;
      const hgt = heightAt(i);
      const p = cam.worldToScreen(x, Math.max(0, hgt));
      if (!started) {
        ctx.moveTo(p.x, cam.worldToScreen(x, 0).y);
        started = true;
      }
      ctx.lineTo(p.x, p.y);
    }
    const last = cam.worldToScreen(sim.groundMaxX, 0);
    ctx.lineTo(last.x, last.y);
    ctx.closePath();
    ctx.fillStyle = COLORS.rubble;
    ctx.fill();
    ctx.strokeStyle = COLORS.rubbleTop;
    ctx.lineWidth = 2;
    ctx.stroke();
    if (!extra) return;
    // Broken pieces in the heap, coloured by what fell there. Positions are hashed so they do not shimmer.
    const s = cam.drawScale;
    for (let i = 0; i < hm.length; i++) {
      const top = heightAt(i);
      const m = extra.mat[i] as number;
      if (top < 0.08 || m === 255) continue;
      const mat = MATERIALS[RUBBLE_MATERIALS[m] as Material];
      const x = sim.groundMinX + i * cell;
      const count = Math.min(4, 1 + Math.floor(top * 2));
      for (let k = 0; k < count; k++) {
        const hsh = hashString(`${i}:${k}`);
        const px = x + ((hsh % 100) / 100) * cell;
        const py = top * (((hsh >>> 8) % 100) / 100) * 0.95;
        const size = Math.max(1.5, (0.08 + ((hsh >>> 16) % 10) / 60) * s);
        const p = cam.worldToScreen(px, py);
        ctx.fillStyle = k % 3 === 0 ? mat.edge : k % 3 === 1 ? mat.rubble : mat.color;
        ctx.fillRect(p.x - size / 2, p.y - size * 0.35, size, size * 0.7);
      }
    }
  }

  private collectBlocks(state: SceneState): Block[] {
    const out: Block[] = [];
    if (state.sim) {
      for (const c of state.sim.chunks) {
        if (c.state === 'gone') continue;
        const crumble = state.crumble?.get(c.id) ?? 0;
        if (crumble >= 1) continue;
        out.push({
          squash: crumble,
          cx: c.cx,
          cy: c.cy,
          w: c.w,
          h: c.h,
          angle: c.angle,
          material: c.material,
          kind: c.kind,
          integrity: c.maxHp > 0 ? Math.max(0, c.hp) / c.maxHp : 1,
          id: c.id,
          memberId: c.memberId,
          protect: c.protect,
          isFragment: c.isFragment,
          preDamage: c.isFragment ? 0 : (state.building.members.get(c.memberId)?.damage ?? 0),
        });
      }
      return out;
    }
    for (const id of state.building.order) {
      const m = state.building.members.get(id) as Member;
      out.push({
        cx: m.x + m.w / 2,
        cy: m.y + m.h / 2,
        w: m.w,
        h: m.h,
        angle: 0,
        material: m.material,
        kind: m.kind,
        integrity: 1,
        id: m.id,
        memberId: m.id,
        protect: !!m.protect,
        isFragment: false,
        preDamage: m.damage ?? 0,
      });
    }
    return out;
  }

  private drawBlock(b: Block, cam: Camera, state: SceneState, fx: Effects): void {
    const ctx = this.ctx;
    const s = cam.drawScale;
    const p = cam.worldToScreen(b.cx, b.cy);
    const w = b.w * s;
    const hgt = b.h * s;
    const mat = MATERIALS[b.material];
    const strain = b.isFragment ? 0 : (state.strain?.get(b.memberId) ?? 0);
    ctx.save();
    ctx.translate(p.x, p.y);
    if (strain > 0) {
      // Shudder before giving way: tiny, fast, growing.
      const seed = hashString(b.id) % 7;
      ctx.translate(Math.sin(state.time * 71 + seed) * 1.6 * strain, Math.cos(state.time * 53 + seed) * 0.8 * strain);
      ctx.rotate(Math.sin(state.time * 47 + seed) * 0.012 * strain);
    }
    const squash = b.squash ?? 0;
    if (squash > 0) {
      // Sag into the ground and spread as it breaks up.
      ctx.translate(0, (hgt / 2) * squash * 0.9);
      ctx.scale(1 + squash * 0.25, Math.max(0.05, 1 - squash * 0.95));
      ctx.globalAlpha = 1 - squash * 0.4;
    }
    ctx.rotate(-b.angle);
    const x0 = -w / 2;
    const y0 = -hgt / 2;
    ctx.fillStyle = mat.color;
    ctx.fillRect(x0, y0, w, hgt);
    // Material detail (only when large enough to read).
    if (s > 14 && !b.isFragment) this.drawMaterialDetail(b, x0, y0, w, hgt, s);
    // Damage tint.
    const damage = 1 - b.integrity;
    if (damage > 0.05 || b.preDamage > 0.2) {
      ctx.fillStyle = `rgba(20, 10, 5, ${Math.min(0.55, Math.max(damage * 0.6, b.preDamage * 0.35))})`;
      ctx.fillRect(x0, y0, w, hgt);
    }
    if ((b.preDamage > 0.3 || damage > 0.35 || strain > 0.25) && !b.isFragment && s > 10) this.drawCracks(b, x0, y0, w, hgt);
    if (strain > 0) {
      ctx.fillStyle = `rgba(255, 90, 40, ${0.28 * strain})`;
      ctx.fillRect(x0, y0, w, hgt);
    }
    const stress = fx.stress.get(b.memberId);
    if (stress) this.drawStress(stress.kind, fx.now - stress.at, x0, y0, w, hgt, s, b.isFragment);
    // Edge.
    ctx.strokeStyle = mat.edge;
    ctx.lineWidth = Math.max(1, Math.min(3, s * 0.05));
    ctx.strokeRect(x0, y0, w, hgt);
    if (b.protect) {
      ctx.strokeStyle = COLORS.protect;
      ctx.lineWidth = Math.max(2, s * 0.08);
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(x0 - 3, y0 - 3, w + 6, hgt + 6);
      ctx.setLineDash([]);
    }
    if (state.mode === 'plan' && state.loadRatio) {
      const ratio = state.loadRatio.get(b.id);
      if (ratio !== undefined && ratio > 0.55) {
        ctx.strokeStyle = ratio > 0.85 ? 'rgba(255, 90, 54, 0.95)' : 'rgba(255, 176, 32, 0.9)';
        ctx.lineWidth = Math.max(2, s * 0.07);
        ctx.strokeRect(x0 - 2, y0 - 2, w + 4, hgt + 4);
      }
    }
    ctx.restore();
  }

  /** Flash that tells the player which member just went and which one now carries the load. */
  private drawStress(kind: 'blast' | 'fail' | 'load' | 'strain', age: number, x0: number, y0: number, w: number, hgt: number, s: number, fragment: boolean): void {
    const ctx = this.ctx;
    if (kind === 'load') {
      if (fragment || age > 0.9) return;
      const a = (1 - age / 0.9) * (0.6 + 0.4 * Math.sin(age * 30));
      ctx.strokeStyle = `rgba(255, 176, 32, ${a})`;
      ctx.lineWidth = Math.max(2, s * 0.09);
      ctx.strokeRect(x0 - 2, y0 - 2, w + 4, hgt + 4);
      return;
    }
    const life = kind === 'blast' ? 0.3 : 0.5;
    if (age > life) return;
    const k = 1 - age / life;
    ctx.fillStyle = kind === 'blast' ? `rgba(255, 245, 220, ${0.85 * k})` : `rgba(255, ${170 + 60 * k}, ${120 + 100 * k}, ${0.6 * k})`;
    ctx.fillRect(x0, y0, w, hgt);
    if (!fragment) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * k})`;
      ctx.lineWidth = Math.max(2, s * 0.08);
      ctx.strokeRect(x0 - 1, y0 - 1, w + 2, hgt + 2);
    }
  }

  private drawMaterialDetail(b: Block, x0: number, y0: number, w: number, hgt: number, s: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, w, hgt);
    ctx.clip();
    switch (b.material) {
      case 'brick': {
        ctx.strokeStyle = 'rgba(60, 20, 10, 0.35)';
        ctx.lineWidth = 1;
        const course = Math.max(4, s * 0.22);
        let row = 0;
        for (let y = y0 + course; y < y0 + hgt; y += course, row++) {
          ctx.beginPath();
          ctx.moveTo(x0, y);
          ctx.lineTo(x0 + w, y);
          ctx.stroke();
          const off = row % 2 ? course : 0;
          for (let x = x0 + off; x < x0 + w; x += course * 2) {
            ctx.beginPath();
            ctx.moveTo(x, y - course);
            ctx.lineTo(x, y);
            ctx.stroke();
          }
        }
        break;
      }
      case 'concrete': {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(x0, y0, w, Math.max(2, hgt * 0.12));
        ctx.fillStyle = 'rgba(0,0,0,0.1)';
        ctx.fillRect(x0, y0 + hgt - Math.max(2, hgt * 0.1), w, Math.max(2, hgt * 0.1));
        if (b.kind === 'core') {
          ctx.strokeStyle = 'rgba(0,0,0,0.18)';
          ctx.lineWidth = 1;
          const step = Math.max(6, s * 0.9);
          for (let y = y0 + step; y < y0 + hgt; y += step) {
            ctx.beginPath();
            ctx.moveTo(x0, y);
            ctx.lineTo(x0 + w, y);
            ctx.stroke();
          }
        }
        break;
      }
      case 'wood': {
        ctx.strokeStyle = 'rgba(80, 40, 10, 0.3)';
        ctx.lineWidth = 1;
        const horizontal = w > hgt;
        const step = Math.max(4, s * 0.16);
        if (horizontal) {
          for (let y = y0 + step; y < y0 + hgt; y += step) {
            ctx.beginPath();
            ctx.moveTo(x0, y);
            ctx.lineTo(x0 + w, y);
            ctx.stroke();
          }
        } else {
          for (let x = x0 + step; x < x0 + w; x += step) {
            ctx.beginPath();
            ctx.moveTo(x, y0);
            ctx.lineTo(x, y0 + hgt);
            ctx.stroke();
          }
        }
        if (b.kind === 'wall') {
          ctx.strokeStyle = 'rgba(60, 30, 5, 0.35)';
          const board = Math.max(5, s * 0.3);
          for (let y = y0 + board; y < y0 + hgt; y += board) {
            ctx.beginPath();
            ctx.moveTo(x0, y);
            ctx.lineTo(x0 + w, y);
            ctx.stroke();
          }
        }
        break;
      }
      case 'steel': {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        if (w > hgt) {
          ctx.fillRect(x0, y0, w, Math.max(2, hgt * 0.2));
          ctx.fillRect(x0, y0 + hgt - Math.max(2, hgt * 0.2), w, Math.max(2, hgt * 0.2));
        } else {
          ctx.fillRect(x0, y0, Math.max(2, w * 0.2), hgt);
          ctx.fillRect(x0 + w - Math.max(2, w * 0.2), y0, Math.max(2, w * 0.2), hgt);
        }
        if (b.kind === 'wall') {
          ctx.strokeStyle = 'rgba(0,0,0,0.25)';
          ctx.lineWidth = 1;
          const step = Math.max(5, s * 0.25);
          for (let x = x0 + step; x < x0 + w; x += step) {
            ctx.beginPath();
            ctx.moveTo(x, y0);
            ctx.lineTo(x, y0 + hgt);
            ctx.stroke();
          }
        }
        break;
      }
    }
    ctx.restore();
  }

  private drawCracks(b: Block, x0: number, y0: number, w: number, hgt: number): void {
    const ctx = this.ctx;
    const seed = hashString(b.id);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, w, hgt);
    ctx.clip();
    ctx.strokeStyle = 'rgba(10, 5, 0, 0.75)';
    ctx.lineWidth = Math.max(1, Math.min(2.5, w * 0.03));
    const n = 2 + (seed % 2);
    for (let k = 0; k < n; k++) {
      let x = x0 + w * (((seed >> (k * 3)) % 7) / 8 + 0.1);
      let y = y0 + hgt * (k === 0 ? 0.85 : 0.5);
      ctx.beginPath();
      ctx.moveTo(x, y);
      const steps = 5;
      for (let i = 0; i < steps; i++) {
        x += ((((seed >> (i + k)) & 3) - 1.5) * w) / 6;
        y -= hgt / (steps + 2);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawLinks(state: SceneState, cam: Camera): void {
    const ctx = this.ctx;
    const b = state.building;
    const drawFor = (m: Member, alpha: number): void => {
      ctx.lineWidth = Math.max(1.5, cam.drawScale * 0.06);
      for (const link of m.restsOn) {
        const s = b.members.get(link.id) as Member;
        const from = cam.worldToScreen((link.from + link.to) / 2, m.y);
        const to = cam.worldToScreen((link.from + link.to) / 2, Math.min(s.y + s.h, m.y) - 0.35);
        ctx.strokeStyle = `rgba(56, 198, 255, ${alpha})`;
        ctx.fillStyle = `rgba(56, 198, 255, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(to.x, to.y, Math.max(3, cam.drawScale * 0.1), 0, Math.PI * 2);
        ctx.fill();
      }
      for (const id of m.carries) {
        const c = b.members.get(id) as Member;
        const link = c.restsOn.find((l) => l.id === m.id);
        const mid = link ? (link.from + link.to) / 2 : c.x + c.w / 2;
        const from = cam.worldToScreen(mid, m.y + m.h);
        const to = cam.worldToScreen(mid, Math.max(c.y, m.y + m.h) + 0.35);
        ctx.strokeStyle = `rgba(255, 176, 32, ${alpha})`;
        ctx.fillStyle = `rgba(255, 176, 32, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(to.x - 5, to.y + 4);
        ctx.lineTo(to.x + 5, to.y + 4);
        ctx.lineTo(to.x, to.y - 4);
        ctx.closePath();
        ctx.fill();
      }
      if (m.anchors) {
        ctx.strokeStyle = `rgba(56, 198, 255, ${alpha * 0.8})`;
        ctx.setLineDash([4, 4]);
        for (const a of m.anchors) {
          const t = b.members.get(a) as Member;
          const from = cam.worldToScreen(m.x + m.w / 2, m.y + m.h / 2);
          const to = cam.worldToScreen(t.x + t.w / 2, m.y + m.h / 2);
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(to.x, to.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    };
    if (state.showAllLinks) {
      for (const id of b.order) drawFor(b.members.get(id) as Member, 0.35);
    }
    if (state.selectedId) {
      const m = b.members.get(state.selectedId);
      if (m) drawFor(m, 0.95);
    }
  }

  private chargeSize(cam: Camera): number {
    return Math.max(26, Math.min(46, cam.drawScale * 0.8));
  }

  /** Straps that visibly bind the charges to the member they sit on. */
  private drawStraps(m: Member, cam: Camera, size: number, count: number): void {
    const ctx = this.ctx;
    const pt = chargePoint(m);
    const p = cam.worldToScreen(pt.x, pt.y);
    const a = cam.worldToScreen(m.x, m.y + m.h);
    const b = cam.worldToScreen(m.x + m.w, m.y);
    const vertical = m.kind === 'column' || m.kind === 'core' || m.kind === 'wall' || m.h > m.w;
    const band = Math.max(3, size * 0.12);
    ctx.save();
    ctx.fillStyle = '#1b1d21';
    ctx.strokeStyle = 'rgba(255, 210, 120, 0.55)';
    ctx.lineWidth = 1;
    const spread = size * (0.28 + 0.27 * (count - 1));
    for (const off of [-1, 1]) {
      if (vertical) {
        const y = p.y + off * size * 0.3;
        ctx.fillRect(a.x - 3, y - band / 2, b.x - a.x + 6, band);
        ctx.strokeRect(a.x - 3, y - band / 2, b.x - a.x + 6, band);
      } else {
        const x = p.x + off * spread;
        ctx.fillRect(x - band / 2, a.y - 3, band, b.y - a.y + 6);
        ctx.strokeRect(x - band / 2, a.y - 3, band, b.y - a.y + 6);
      }
    }
    ctx.restore();
  }

  private drawCharges(state: SceneState, cam: Camera): void {
    const ctx = this.ctx;
    const grouped = new Map<string, PlacedCharge[]>();
    for (const c of state.charges) {
      const list = grouped.get(c.memberId) ?? [];
      list.push(c);
      grouped.set(c.memberId, list);
    }
    const size = this.chargeSize(cam);
    const armed = state.armedAt !== undefined;
    let index = 0;
    for (const [memberId, list] of grouped) {
      const m = state.building.members.get(memberId);
      if (!m) continue;
      const pt = chargePoint(m);
      const p = cam.worldToScreen(pt.x, pt.y);
      this.drawStraps(m, cam, size, list.length);
      list.forEach((c, i) => {
        const def = CHARGES[c.type];
        const phase = (hashString(c.id) % 100) / 100;
        const off = (i - (list.length - 1) / 2) * (size * 0.95);
        let x = p.x + off;
        let y = p.y + Math.sin(state.time * 2.4 + phase * 6) * size * 0.025;
        let scale = 1;
        let alpha = 1;
        // Placement: drops onto the member, overshoots and locks.
        const placed = state.placedAt?.get(c.id);
        const age = placed === undefined ? 10 : state.time - placed;
        if (age < 0.2) {
          const t = Math.max(0, age / 0.2);
          y -= (1 - easeOutBack(t)) * size * 0.9;
          scale = 1 + (1 - t) * 0.3;
          alpha = Math.min(1, t * 3);
        }
        // Arming: each charge switches on in turn.
        let lit = 0;
        let litAge = -1;
        if (armed) {
          litAge = state.time - (state.armedAt as number) - index * ARM_STAGGER;
          lit = Math.max(0, Math.min(1, litAge / 0.12));
          if (lit > 0) lit = Math.max(lit, 0.6 + (state.burn ?? 0) * 0.4);
        }
        // Soft halo so charges read against any material.
        const pulse = 0.5 + 0.5 * Math.sin(state.time * (armed ? 9 + (state.burn ?? 0) * 12 : 3) + phase * 6);
        const haloR = size * (0.85 + 0.25 * pulse + lit * 0.3);
        const g = ctx.createRadialGradient(x, y, 0, x, y, haloR);
        g.addColorStop(0, this.rgba(def.color, (armed ? 0.35 + 0.25 * lit : 0.22) * alpha));
        g.addColorStop(1, this.rgba(def.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, haloR, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.globalAlpha = alpha;
        if (scale !== 1) {
          ctx.translate(x, y);
          ctx.scale(scale, scale);
          x = 0;
          y = 0;
        }
        drawCharge(ctx, c.type, x, y, size, { time: state.time, lit, burn: state.burn, direction: c.direction, phase });
        ctx.restore();
        // "Locked in" ring after placement, and again when it goes live.
        const ringAge = litAge >= 0 && litAge < 0.4 ? litAge : age >= 0.14 && age < 0.5 ? age - 0.14 : -1;
        if (ringAge >= 0) {
          const k = ringAge / (litAge >= 0 ? 0.4 : 0.36);
          ctx.strokeStyle = this.rgba(litAge >= 0 ? '#ffffff' : def.color, 1 - k);
          ctx.lineWidth = 3 * (1 - k) + 1;
          ctx.beginPath();
          ctx.arc(p.x + off, p.y, size * (0.55 + k * 0.7), 0, Math.PI * 2);
          ctx.stroke();
        }
        if (c.type === 'directional') this.drawPushHint(m, c.direction ?? 'left', cam, state, size, state.selectedId === memberId || armed);
        index++;
      });
      // Blast radius hint for the last charge on the selected member.
      if (state.selectedId === memberId && !armed) {
        const last = list[list.length - 1] as PlacedCharge;
        const def = CHARGES[last.type];
        ctx.strokeStyle = def.color;
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(size * 0.7, def.radius * cam.drawScale), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }
  }

  /** Marching chevrons and a tipping arrow: which way this charge will lay the structure down. */
  private drawPushHint(m: Member, direction: Direction, cam: Camera, state: SceneState, size: number, strong: boolean): void {
    const ctx = this.ctx;
    const dir = direction === 'left' ? -1 : 1;
    const pt = chargePoint(m);
    const p = cam.worldToScreen(pt.x, pt.y);
    const alpha = strong ? 0.95 : 0.6;
    ctx.save();
    ctx.fillStyle = `rgba(56, 198, 255, ${alpha})`;
    const step = size * 0.42;
    for (let i = 0; i < 3; i++) {
      const t = (state.time * 1.8 + i / 3) % 1;
      const cx = p.x + dir * (size * 0.95 + t * step * 3);
      const a = alpha * Math.sin(t * Math.PI);
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.moveTo(cx - dir * size * 0.14, p.y - size * 0.24);
      ctx.lineTo(cx + dir * size * 0.14, p.y);
      ctx.lineTo(cx - dir * size * 0.14, p.y + size * 0.24);
      ctx.lineTo(cx - dir * size * 0.02, p.y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Tipping arrow over the member: the structure above falls this way.
    const top = cam.worldToScreen(m.x + m.w / 2, m.y + m.h);
    const span = Math.max(size * 1.6, cam.drawScale * 2.2);
    const sx = top.x;
    const sy = top.y - size * 0.6;
    const ex = sx + dir * span;
    const ey = sy + span * 0.55;
    const cx = sx + dir * span * 0.85;
    const cy = sy - span * 0.35;
    ctx.strokeStyle = `rgba(56, 198, 255, ${alpha * 0.85})`;
    ctx.lineWidth = Math.max(2.5, size * 0.1);
    ctx.setLineDash([size * 0.25, size * 0.18]);
    ctx.lineDashOffset = -state.time * 30 * dir;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);
    // Arrowhead along the curve's end tangent.
    const tx = ex - cx;
    const ty = ey - cy;
    const len = Math.hypot(tx, ty) || 1;
    const ux = tx / len;
    const uy = ty / len;
    const hs = size * 0.36;
    ctx.fillStyle = `rgba(56, 198, 255, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(ex + ux * hs * 0.6, ey + uy * hs * 0.6);
    ctx.lineTo(ex - ux * hs + uy * hs * 0.6, ey - uy * hs - ux * hs * 0.6);
    ctx.lineTo(ex - ux * hs - uy * hs * 0.6, ey - uy * hs + ux * hs * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** A removed charge pops off the member and fades. */
  private drawRemoved(state: SceneState, cam: Camera): void {
    if (!state.removed?.length) return;
    const ctx = this.ctx;
    const size = this.chargeSize(cam);
    for (const r of state.removed) {
      const k = (state.time - r.at) / 0.24;
      if (k < 0 || k >= 1) continue;
      const p = cam.worldToScreen(r.x, r.y);
      const e = easeOutCubic(k);
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.translate(p.x + e * size * 0.3, p.y - e * size * 0.8);
      ctx.rotate(e * 0.6);
      ctx.scale(1 - k * 0.45, 1 - k * 0.45);
      drawCharge(ctx, r.type, 0, 0, size, { time: state.time, direction: r.direction });
      ctx.restore();
    }
  }

  private rgba(hex: string, a: number): string {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, a))})`;
  }

  private drawSelection(state: SceneState, cam: Camera): void {
    if (!state.selectedId) return;
    const m = state.building.members.get(state.selectedId);
    if (!m) return;
    const ctx = this.ctx;
    const a = cam.worldToScreen(m.x, m.y + m.h);
    const b = cam.worldToScreen(m.x + m.w, m.y);
    const pulse = 0.6 + 0.4 * Math.sin(state.time * 6);
    ctx.save();
    ctx.strokeStyle = COLORS.select;
    ctx.lineWidth = 3;
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 8 + pulse * 10;
    ctx.strokeRect(a.x - 3, a.y - 3, b.x - a.x + 6, b.y - a.y + 6);
    ctx.restore();
    // Label tag above.
    const label = (m.label ?? m.id).toUpperCase();
    ctx.font = `700 13px ${UI_FONT}`;
    const tw = ctx.measureText(label).width + 16;
    const tx = (a.x + b.x) / 2 - tw / 2;
    // Keep the tag below the header even when the member reaches the top of the view.
    const ty = Math.max(cam.insetTop + 4, a.y - 30);
    ctx.fillStyle = 'rgba(12, 14, 18, 0.9)';
    this.roundRect(tx, ty, tw, 22, 6);
    ctx.fill();
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, tx + tw / 2, ty + 11);
  }

  private drawEffects(fx: Effects, cam: Camera): void {
    const ctx = this.ctx;
    const sc = cam.drawScale;
    // Dust and smoke first so flashes and debris sit on top.
    for (const p of fx.puffs) {
      if (p.fire) continue;
      const t = p.life / p.maxLife;
      const sp = cam.worldToScreen(p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha * (1 - t) * (1 - t);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, Math.max(1, p.r * sc), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Debris chips, drawn with a direct transform (no save/restore per piece).
    const dpr = this.dpr;
    for (const d of fx.debris) {
      const sp = cam.worldToScreen(d.x, d.y);
      const fade = d.life > d.maxLife - 0.4 ? (d.maxLife - d.life) / 0.4 : 1;
      const cos = Math.cos(-d.a);
      const sin = Math.sin(-d.a);
      ctx.setTransform(dpr * cos, dpr * sin, -dpr * sin, dpr * cos, dpr * sp.x, dpr * sp.y);
      ctx.globalAlpha = fade;
      ctx.fillStyle = d.color;
      const w = Math.max(2, d.w * sc);
      const h = Math.max(1.5, d.h * sc);
      ctx.fillRect(-w / 2, -h / 2, w, h);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    // Shock rings.
    for (const r of fx.rings) {
      const t = r.life / r.maxLife;
      const e = easeOutCubic(t);
      const rad = (r.r0 + (r.r1 - r.r0) * e) * sc;
      const p = cam.worldToScreen(r.x + r.drift * e, r.y);
      ctx.strokeStyle = `rgba(${r.color}, ${(1 - t) * (r.ground ? 0.5 : 0.9)})`;
      ctx.lineWidth = Math.max(1, r.width * (1 - t) + 1);
      ctx.beginPath();
      if (r.ground) {
        ctx.ellipse(p.x, p.y, rad * r.stretch * 0.6, rad * 0.16 + 2, 0, Math.PI, Math.PI * 2);
      } else {
        ctx.ellipse(p.x, p.y, rad * r.stretch, rad, 0, 0, Math.PI * 2);
      }
      ctx.stroke();
    }
    // Fire, additive while hot.
    ctx.globalCompositeOperation = 'lighter';
    for (const p of fx.puffs) {
      if (!p.fire) continue;
      const t = p.life / p.maxLife;
      const sp = cam.worldToScreen(p.x, p.y);
      const g = Math.round(200 - t * 150);
      const b = Math.round(90 - t * 80);
      ctx.fillStyle = `rgba(255, ${g}, ${Math.max(0, b)}, ${p.alpha * (1 - t) * (1 - t)})`;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, Math.max(1, p.r * sc), 0, Math.PI * 2);
      ctx.fill();
    }
    for (const j of fx.jets) {
      const t = j.life / j.maxLife;
      const p = cam.worldToScreen(j.x, j.y);
      const len = j.length * sc * (0.4 + 0.6 * easeOutCubic(Math.min(1, t * 2.5)));
      const wid = Math.max(3, j.width * sc * (1 - t * 0.6));
      const ang = -j.angle;
      const ex = p.x + Math.cos(ang) * len;
      const ey = p.y + Math.sin(ang) * len;
      const g = ctx.createLinearGradient(p.x, p.y, ex, ey);
      g.addColorStop(0, `rgba(${j.core}, ${1 - t})`);
      g.addColorStop(0.5, `rgba(${j.edge}, ${(1 - t) * 0.7})`);
      g.addColorStop(1, `rgba(${j.edge}, 0)`);
      ctx.strokeStyle = g;
      ctx.lineCap = 'round';
      ctx.lineWidth = wid;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
    for (const f of fx.flashes) {
      const t = f.life / f.maxLife;
      const p = cam.worldToScreen(f.x, f.y);
      const r = (f.r * (0.6 + 1.4 * easeOutCubic(t))) * sc;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grad.addColorStop(0, `rgba(255, 255, 245, ${1 - t})`);
      grad.addColorStop(0.25, `rgba(255, 240, 200, ${(1 - t) * 0.9})`);
      grad.addColorStop(0.55, `rgba(${f.tint}, ${(1 - t) * 0.6})`);
      grad.addColorStop(1, `rgba(${f.tint}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'butt';
    for (const s of fx.sparks) {
      const t = s.life / s.maxLife;
      const p = cam.worldToScreen(s.x, s.y);
      const q = cam.worldToScreen(s.x - s.vx * 0.03, s.y - s.vy * 0.03);
      ctx.strokeStyle = s.color;
      ctx.globalAlpha = 1 - t;
      ctx.lineWidth = s.width ?? 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  // ------------------------------------------------------------- hit test

  /** Finds the member under a screen point, with a touch-friendly slop. */
  hitTest(building: Building, cam: Camera, sx: number, sy: number): string | undefined {
    const w = cam.screenToWorld(sx, sy);
    const slop = Math.max(0.15, 14 / cam.drawScale);
    let best: { id: string; dist: number; area: number } | undefined;
    for (const id of building.order) {
      const m = building.members.get(id) as Member;
      const dx = Math.max(m.x - w.x, 0, w.x - (m.x + m.w));
      const dy = Math.max(m.y - w.y, 0, w.y - (m.y + m.h));
      const dist = Math.hypot(dx, dy);
      if (dist > slop) continue;
      const area = m.w * m.h;
      // Prefer the closest; on a tie prefer the smaller member (thin columns beside big walls).
      if (!best || dist < best.dist - 1e-6 || (Math.abs(dist - best.dist) < 1e-6 && area < best.area)) {
        best = { id, dist, area };
      }
    }
    return best?.id;
  }

  /** Utility for tests and debugging: chunk corners in screen space. */
  chunkCorners(c: Chunk, cam: Camera): Array<{ x: number; y: number }> {
    return corners(c).map(([x, y]) => cam.worldToScreen(x, y));
  }
}
