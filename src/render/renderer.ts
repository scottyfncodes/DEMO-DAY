import { easeOutCubic } from '../core/format';
import { hashString } from '../core/rng';
import type { ChargeType, DecorKind, Direction, Material, MemberKind, PlacedCharge } from '../core/types';
import { CHARGES } from '../data/charges';
import { MATERIALS } from '../data/materials';
import { corners, type Chunk, type Simulation } from '../sim/simulation';
import { chargeAxisLength, chargePoint, isVerticalMember, type Building, type Member } from '../structure/building';
import { APRON, type World } from '../world/world';
import { zoomTier, type Camera } from './camera';
import { drawCharge } from './charges';
import { RUBBLE_MATERIALS, type Effects } from './effects';
import { WorldRenderer, makeProjector, px, py, type Projector } from './world';

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
  /** The district around the job. */
  world?: World;
  /** Where the next charge would go on the selected member. */
  aim?: { memberId: string; at: number; type: ChargeType; direction?: Direction };
  /** Draw the minimap and scale bar (planning only). */
  hud?: boolean;
}

/** Screen rectangle of the minimap, for tap handling. */
export interface MinimapRect {
  x: number;
  y: number;
  w: number;
  h: number;
  minX: number;
  maxX: number;
}

/** Delay between charges switching on during the arm sequence. */
export const ARM_STAGGER = 0.11;

export const UI_FONT = "'Barlow Condensed', 'Avenir Next Condensed', 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif";

const COLORS = {
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
  decor?: DecorKind[];
  label?: string;
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
  private readonly world: WorldRenderer;
  width = 1;
  height = 1;
  /** Where the minimap was last drawn (undefined when hidden). */
  minimap?: MinimapRect;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.world = new WorldRenderer(ctx);
  }

  private projector(cam: Camera): Projector {
    const ground = cam.worldToScreen(0, 0);
    const centre = cam.worldToScreen(cam.x, 0);
    return makeProjector(cam.drawScale, cam.x, centre.x, ground.y, this.width, this.height, this.dpr);
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
    const P = this.projector(cam);
    const closed = state.armedAt !== undefined || state.mode === 'sim';
    // Back to front: sky, the ground plane with its lots and streets, what stands behind the site,
    // the site itself, then the street furniture and crew in front of it.
    this.world.drawSky(P, state.world, state.time);
    this.world.drawGround(P, state.world, state.time, closed);
    this.world.drawBackProps(P, state.world, state.time);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawZone(state, cam, P);
    for (const n of state.building.def.neighbors ?? []) {
      const hit = state.sim ? (state.sim.result().neighborHits[n.id] ?? 0) > 0 : false;
      this.world.drawNeighbor(P, n, hit, state.time);
      this.drawNeighborLabel(n.label, n.x, n.w, n.h, hit, cam);
    }
    const blocks = this.collectBlocks(state);
    this.drawContactShadows(blocks, P);
    if (state.sim) this.drawRubble(state.sim, cam, fx);
    // Standing and resting first so falling pieces draw on top.
    blocks.sort((a, b) => (a.isFragment ? 1 : 0) - (b.isFragment ? 1 : 0));
    for (const b of blocks) this.drawBlock(b, cam, state, fx);
    this.world.drawFrontProps(P, state.world, state.time);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    if (state.mode === 'plan') {
      if (state.armedAt === undefined) this.drawLinks(state, cam);
      if (state.armedAt === undefined && cam.drawScale >= 4) this.drawAim(state, cam);
      this.drawCharges(state, cam);
      this.drawRemoved(state, cam);
      if (state.armedAt === undefined && cam.drawScale >= 4) this.drawSelection(state, cam);
    }
    this.drawEffects(fx, cam);
    this.minimap = undefined;
    if (state.world && state.mode === 'plan' && state.armedAt === undefined && cam.drawScale < 4) this.drawJobPin(state, cam);
    if (state.hud && state.world) {
      this.drawMinimap(state.world, state.building, cam);
      this.drawScaleBar(cam);
    }
  }

  /**
   * The landing zone: taped off on the ground and across the sidewalk, so it
   * reads as a marked-out area of the lot rather than a box on the screen.
   */
  private drawZone(state: SceneState, cam: Camera, P: Projector): void {
    const ctx = this.ctx;
    const z = state.building.def.footprint;
    const x1 = z.x;
    const x2 = z.x + z.w;
    // Tinted patch of ground from the back of the lot to the curb.
    const quad = (k1: number, k2: number): void => {
      ctx.beginPath();
      ctx.moveTo(px(P, x1, k1), py(P, 0, k1));
      ctx.lineTo(px(P, x2, k1), py(P, 0, k1));
      ctx.lineTo(px(P, x2, k2), py(P, 0, k2));
      ctx.lineTo(px(P, x1, k2), py(P, 0, k2));
      ctx.closePath();
    };
    ctx.fillStyle = 'rgba(255, 176, 32, 0.07)';
    quad(0.9, 1);
    ctx.fill();
    ctx.fillStyle = COLORS.zone;
    quad(APRON.walk[0], APRON.walk[1]);
    ctx.fill();
    // Tape lines along the edges of the zone, running into the lot.
    ctx.strokeStyle = COLORS.zoneEdge;
    ctx.lineWidth = Math.max(1.5, Math.min(3, cam.drawScale * 0.06));
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    for (const x of [x1, x2]) {
      ctx.moveTo(px(P, x, 0.9), py(P, 0, 0.9));
      ctx.lineTo(px(P, x, APRON.walk[1]), py(P, 0, APRON.walk[1]));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Flags on the corners at true size (1.2 m poles).
    const s = cam.drawScale;
    for (const x of [x1, x2]) {
      const bx = px(P, x, APRON.walk[1]);
      const by = py(P, 0, APRON.walk[1]);
      const hgt = Math.max(10, 1.2 * s * APRON.walk[1]);
      ctx.fillStyle = '#e8e6e1';
      ctx.fillRect(bx - 1, by - hgt, 2, hgt);
      ctx.fillStyle = COLORS.zoneEdge;
      const fw = Math.max(5, 0.35 * s);
      ctx.beginPath();
      ctx.moveTo(bx + 1, by - hgt);
      ctx.lineTo(bx + 1 + fw, by - hgt + fw * 0.4);
      ctx.lineTo(bx + 1, by - hgt + fw * 0.8);
      ctx.fill();
    }
    const a = px(P, x1, APRON.walk[1]);
    const b = px(P, x2, APRON.walk[1]);
    const ty = py(P, 0, (APRON.walk[1] + APRON.road[0]) / 2 + 0.03);
    ctx.fillStyle = COLORS.zoneEdge;
    ctx.font = `600 ${Math.max(10, Math.min(14, s * 0.4))}px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (b - a > 70) ctx.fillText('LANDING ZONE', (a + b) / 2, ty + 4);
  }

  private drawNeighborLabel(label: string, x: number, w: number, hgt: number, hit: boolean, cam: Camera): void {
    const ctx = this.ctx;
    const s = cam.drawScale;
    if (s < 6) return;
    const a = cam.worldToScreen(x, Math.max(hgt, 0.35));
    const b = cam.worldToScreen(x + w, 0);
    ctx.fillStyle = hit ? '#ff6a4d' : 'rgba(232, 230, 225, 0.8)';
    ctx.font = `600 ${Math.max(10, Math.min(13, s * 0.4))}px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText((hit ? '⚠ ' : '') + label.toUpperCase(), (a.x + b.x) / 2, a.y - 6);
  }

  /** Soft shadow where standing members meet the ground: anchors the building to its lot. */
  private drawContactShadows(blocks: Block[], P: Projector): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    for (const b of blocks) {
      if (b.isFragment || b.angle !== 0) continue;
      const bottom = b.cy - b.h / 2;
      if (bottom > 0.3) continue;
      const x1 = b.cx - b.w / 2 - 0.25;
      const x2 = b.cx + b.w / 2 + 0.25;
      ctx.beginPath();
      ctx.moveTo(px(P, x1, 0.965), py(P, 0, 0.965));
      ctx.lineTo(px(P, x2, 0.965), py(P, 0, 0.965));
      ctx.lineTo(px(P, x2 + 0.15, 1.004), py(P, 0, 1.004));
      ctx.lineTo(px(P, x1 - 0.15, 1.004), py(P, 0, 1.004));
      ctx.fill();
    }
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
          decor: c.isFragment ? undefined : state.building.members.get(c.memberId)?.decor,
          label: state.building.members.get(c.memberId)?.label,
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
        decor: m.decor,
        label: m.label,
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
    // Material texture at true scale, then the architectural details, as the zoom allows.
    if (s > 4) this.drawMaterialDetail(b, x0, y0, w, hgt, s);
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
    // Edge: hairline when far, a firm outline up close.
    ctx.strokeStyle = mat.edge;
    ctx.lineWidth = Math.max(0.75, Math.min(2, s * 0.025));
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

  /**
   * Material texture at real dimensions (65 mm brick courses, 150 mm
   * clapboard, 200 mm steel ribs), faded in as the zoom makes it legible,
   * plus the member's architectural details.
   */
  private drawMaterialDetail(b: Block, x0: number, y0: number, w: number, hgt: number, s: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, w, hgt);
    ctx.clip();
    const bottom = y0 + hgt;
    const vertical = hgt >= w;
    // Light from above-left: a highlight on the top edge and shade toward the base.
    const shade = ctx.createLinearGradient(0, y0, 0, bottom);
    shade.addColorStop(0, 'rgba(255,255,255,0.08)');
    shade.addColorStop(0.5, 'rgba(255,255,255,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.14)');
    ctx.fillStyle = shade;
    ctx.fillRect(x0, y0, w, hgt);
    const line = (alpha: number): number => Math.max(0, Math.min(1, alpha));
    switch (b.material) {
      case 'brick': {
        const course = 0.075 * s;
        const brick = 0.225 * s;
        if (course >= 2.2) {
          ctx.strokeStyle = `rgba(60, 20, 10, ${line(0.12 + course * 0.03)})`;
          ctx.lineWidth = Math.max(0.6, Math.min(1.6, s * 0.01));
          ctx.beginPath();
          let row = 0;
          for (let y = bottom - course; y > y0 - course; y -= course, row++) {
            ctx.moveTo(x0, y);
            ctx.lineTo(x0 + w, y);
            if (brick >= 4) {
              const off = row % 2 ? brick / 2 : 0;
              for (let x = x0 + off; x < x0 + w; x += brick) {
                ctx.moveTo(x, y);
                ctx.lineTo(x, y + course);
              }
            }
          }
          ctx.stroke();
          // A few bricks a shade off, so the wall is not a printed pattern.
          if (brick >= 8) {
            const seed = hashString(b.id);
            ctx.fillStyle = 'rgba(0,0,0,0.08)';
            let n = 0;
            for (let y = bottom - course; y > y0 - course; y -= course) {
              for (let x = x0; x < x0 + w; x += brick) {
                if ((seed + n++ * 2654435761) % 7 === 0) ctx.fillRect(x + 1, y + 1, brick - 2, course - 2);
              }
            }
          }
        } else {
          ctx.fillStyle = 'rgba(60, 20, 10, 0.12)';
          for (let y = bottom - 0.3 * s; y > y0; y -= 0.3 * s) ctx.fillRect(x0, y, w, 1);
        }
        break;
      }
      case 'concrete': {
        // Formwork lift lines every 1.2 m and tie holes on a 0.6 m grid.
        ctx.strokeStyle = 'rgba(0,0,0,0.14)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const lift = (b.kind === 'core' ? 0.9 : 1.2) * s;
        if (vertical) {
          for (let y = bottom - lift; y > y0; y -= lift) {
            ctx.moveTo(x0, y);
            ctx.lineTo(x0 + w, y);
          }
        }
        ctx.stroke();
        if (s > 22) {
          ctx.fillStyle = 'rgba(0,0,0,0.18)';
          const step = 0.6 * s;
          const r = Math.max(1, 0.025 * s);
          for (let y = bottom - step / 2; y > y0; y -= step) {
            for (let x = x0 + step / 2; x < x0 + w; x += step) {
              ctx.beginPath();
              ctx.arc(x, y, r, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        if (!vertical) {
          // Slab edge: a drip line under the nose.
          ctx.fillStyle = 'rgba(0,0,0,0.16)';
          ctx.fillRect(x0, bottom - Math.max(1.5, hgt * 0.22), w, Math.max(1.5, hgt * 0.22));
        }
        if (b.preDamage > 0.2 && s > 18) {
          // Spalled cover with rebar showing.
          ctx.fillStyle = 'rgba(70, 60, 55, 0.6)';
          const sx = x0 + w * 0.15;
          const sy = bottom - hgt * 0.45;
          ctx.fillRect(sx, sy, w * 0.6, hgt * 0.16);
          ctx.strokeStyle = '#8a4a2a';
          ctx.lineWidth = Math.max(1, s * 0.016);
          ctx.beginPath();
          for (let x = sx + w * 0.08; x < sx + w * 0.6; x += w * 0.18) {
            ctx.moveTo(x, sy - 2);
            ctx.lineTo(x, sy + hgt * 0.16 + 2);
          }
          ctx.stroke();
        }
        break;
      }
      case 'wood': {
        if (b.kind === 'wall') {
          // Clapboard, 150 mm to the weather, with a shadow under each lap.
          const board = 0.15 * s;
          if (board >= 2) {
            ctx.fillStyle = 'rgba(70, 35, 8, 0.22)';
            for (let y = bottom - board; y > y0 - board; y -= board) ctx.fillRect(x0, y, w, Math.max(0.8, board * 0.16));
          }
          // Corner boards.
          ctx.fillStyle = 'rgba(255, 240, 220, 0.12)';
          ctx.fillRect(x0, y0, Math.max(1, 0.08 * s), hgt);
          ctx.fillRect(x0 + w - Math.max(1, 0.08 * s), y0, Math.max(1, 0.08 * s), hgt);
        } else if (b.kind === 'roof') {
          // Shingle courses on the deck, a fascia board under them.
          const course = 0.14 * s;
          ctx.fillStyle = '#5b4a40';
          ctx.fillRect(x0, y0, w, hgt * 0.55);
          if (course >= 2.5) {
            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let x = x0 + course; x < x0 + w; x += course * 1.6) {
              ctx.moveTo(x, y0);
              ctx.lineTo(x, y0 + hgt * 0.55);
            }
            ctx.stroke();
          }
          ctx.fillStyle = 'rgba(255, 240, 220, 0.18)';
          ctx.fillRect(x0, y0 + hgt * 0.55, w, Math.max(1, hgt * 0.12));
        } else {
          // Grain along the length of posts, joists and boards.
          const step = Math.max(2.5, 0.05 * s);
          ctx.strokeStyle = 'rgba(80, 40, 10, 0.25)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          if (vertical) {
            for (let x = x0 + step; x < x0 + w; x += step) {
              ctx.moveTo(x, y0);
              ctx.lineTo(x + Math.sin(x) * 0.6, bottom);
            }
          } else {
            for (let y = y0 + step; y < bottom; y += step) {
              ctx.moveTo(x0, y);
              ctx.lineTo(x0 + w, y + Math.sin(y) * 0.6);
            }
          }
          ctx.stroke();
          if (s > 26) {
            // Galvanised post bases and joist hangers.
            ctx.fillStyle = 'rgba(190, 196, 204, 0.75)';
            if (vertical) {
              ctx.fillRect(x0 - 1, bottom - 0.12 * s, w + 2, 0.12 * s);
              ctx.fillRect(x0 - 1, y0, w + 2, 0.08 * s);
            } else if (b.kind === 'slab') {
              for (let x = x0 + 0.4 * s; x < x0 + w - 0.2 * s; x += 0.4 * s) ctx.fillRect(x, y0 + hgt * 0.2, Math.max(1, 0.05 * s), hgt * 0.6);
            }
            if (s > 60) {
              // Nail heads on the plates.
              ctx.fillStyle = 'rgba(40, 40, 44, 0.6)';
              if (vertical) {
                for (const fy of [bottom - 0.06 * s, y0 + 0.04 * s]) {
                  ctx.fillRect(x0 + w * 0.3, fy - 1, 2, 2);
                  ctx.fillRect(x0 + w * 0.7, fy - 1, 2, 2);
                }
              }
            }
          }
        }
        break;
      }
      case 'steel': {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        if (b.kind === 'wall') {
          // Trapezoidal sheeting ribs every 200 mm.
          const rib = 0.2 * s;
          if (rib >= 2.5) {
            ctx.fillStyle = 'rgba(0,0,0,0.2)';
            for (let x = x0 + rib; x < x0 + w; x += rib) ctx.fillRect(x, y0, Math.max(0.8, rib * 0.2), hgt);
            ctx.fillStyle = 'rgba(255,255,255,0.1)';
            for (let x = x0 + rib * 0.4; x < x0 + w; x += rib) ctx.fillRect(x, y0, Math.max(0.6, rib * 0.12), hgt);
          }
        } else if (w > hgt) {
          // I-section: flanges top and bottom, bolts along the web.
          ctx.fillRect(x0, y0, w, Math.max(1.5, hgt * 0.18));
          ctx.fillRect(x0, bottom - Math.max(1.5, hgt * 0.18), w, Math.max(1.5, hgt * 0.18));
          if (s > 30) {
            ctx.fillStyle = 'rgba(20, 30, 40, 0.55)';
            for (let x = x0 + 0.15 * s; x < x0 + w; x += 0.3 * s) {
              ctx.beginPath();
              ctx.arc(x, y0 + hgt / 2, Math.max(1, 0.025 * s), 0, Math.PI * 2);
              ctx.fill();
            }
          }
        } else {
          ctx.fillRect(x0, y0, Math.max(1.5, w * 0.2), hgt);
          ctx.fillRect(x0 + w - Math.max(1.5, w * 0.2), y0, Math.max(1.5, w * 0.2), hgt);
          if (b.kind === 'core') {
            ctx.fillStyle = 'rgba(0,0,0,0.18)';
            for (let x = x0 + 0.25 * s; x < x0 + w; x += 0.25 * s) ctx.fillRect(x, y0, 1, hgt);
          }
        }
        break;
      }
    }
    if (b.decor && s > 6) for (const d of b.decor) this.drawDecor(d, b, x0, y0, w, hgt, s);
    ctx.restore();
  }

  /** Doors, windows, ladders and the rest: real sizes, scaled down to fit small members. */
  private drawDecor(d: DecorKind, b: Block, x0: number, y0: number, w: number, hgt: number, s: number): void {
    const ctx = this.ctx;
    const bottom = y0 + hgt;
    const mw = w / s;
    const mh = hgt / s;
    const seed = hashString(b.id);
    const fine = s > 22;
    const trim = b.material === 'brick' ? '#d8cdb8' : b.material === 'wood' ? '#e8e2d4' : '#9aa3ad';
    switch (d) {
      case 'window': {
        if (mh < 1.4 || mw < 0.6) return;
        const ww = Math.min(1.0, mw * 0.55) * s;
        const wh = Math.min(1.25, mh * 0.42) * s;
        const wx = x0 + (w - ww) / 2;
        const wy = bottom - Math.min(0.95 * s, hgt * 0.35) - wh;
        // Condemned: some windows are boarded up, the rest are dark.
        const boarded = seed % 3 === 0;
        ctx.fillStyle = trim;
        ctx.fillRect(wx - 0.07 * s, wy - 0.08 * s, ww + 0.14 * s, wh + 0.2 * s);
        ctx.fillStyle = '#1b2230';
        ctx.fillRect(wx, wy, ww, wh);
        if (boarded) {
          ctx.fillStyle = '#a88a5c';
          ctx.fillRect(wx - 0.04 * s, wy + wh * 0.05, ww + 0.08 * s, wh * 0.9);
          if (fine) {
            ctx.strokeStyle = 'rgba(80, 55, 25, 0.6)';
            ctx.lineWidth = Math.max(1, 0.03 * s);
            ctx.beginPath();
            ctx.moveTo(wx, wy + wh * 0.1);
            ctx.lineTo(wx + ww, wy + wh * 0.9);
            ctx.moveTo(wx + ww, wy + wh * 0.1);
            ctx.lineTo(wx, wy + wh * 0.9);
            ctx.stroke();
          }
        } else {
          ctx.fillStyle = 'rgba(150, 180, 220, 0.14)';
          ctx.beginPath();
          ctx.moveTo(wx, wy + wh * 0.35);
          ctx.lineTo(wx + ww * 0.45, wy);
          ctx.lineTo(wx + ww * 0.65, wy);
          ctx.lineTo(wx, wy + wh * 0.6);
          ctx.fill();
          ctx.fillStyle = trim;
          ctx.fillRect(wx + ww / 2 - Math.max(0.5, 0.025 * s), wy, Math.max(1, 0.05 * s), wh);
          ctx.fillRect(wx, wy + wh / 2 - Math.max(0.5, 0.025 * s), ww, Math.max(1, 0.05 * s));
        }
        if (b.material === 'brick' && fine) {
          // Soldier-course lintel over the opening.
          ctx.fillStyle = '#8c3a2b';
          ctx.fillRect(wx - 0.1 * s, wy - 0.25 * s, ww + 0.2 * s, 0.17 * s);
        }
        return;
      }
      case 'door': {
        if (mh < 1.2) return;
        const dw = Math.min(0.9, mw * 0.5) * s;
        const dh = Math.min(2.05, mh * 0.6) * s;
        const dx = x0 + (w - dw) / 2;
        if (b.kind === 'core' && b.material === 'brick') {
          // Arched flue access with iron bars.
          ctx.fillStyle = '#16120f';
          ctx.beginPath();
          ctx.moveTo(dx, bottom);
          ctx.lineTo(dx, bottom - dh * 0.7);
          ctx.arc(dx + dw / 2, bottom - dh * 0.7, dw / 2, Math.PI, 0);
          ctx.lineTo(dx + dw, bottom);
          ctx.fill();
          ctx.fillStyle = '#4a4a4e';
          for (let x = dx + dw * 0.2; x < dx + dw; x += dw * 0.25) ctx.fillRect(x, bottom - dh * 0.95, Math.max(1, 0.03 * s), dh * 0.95);
          return;
        }
        ctx.fillStyle = trim;
        ctx.fillRect(dx - 0.06 * s, bottom - dh - 0.08 * s, dw + 0.12 * s, dh + 0.08 * s);
        ctx.fillStyle = b.material === 'wood' ? '#5a3a24' : b.material === 'concrete' ? '#5a646e' : '#3d4a58';
        ctx.fillRect(dx, bottom - dh, dw, dh);
        if (fine) {
          ctx.strokeStyle = 'rgba(0,0,0,0.3)';
          ctx.lineWidth = 1;
          ctx.strokeRect(dx + dw * 0.15, bottom - dh * 0.9, dw * 0.7, dh * 0.35);
          ctx.strokeRect(dx + dw * 0.15, bottom - dh * 0.48, dw * 0.7, dh * 0.38);
          ctx.fillStyle = '#e0c060';
          ctx.fillRect(dx + dw * 0.8, bottom - dh * 0.5, Math.max(1.5, 0.05 * s), Math.max(1.5, 0.05 * s));
        }
        return;
      }
      case 'garageDoor': {
        // Roller drum boxed into the lintel.
        ctx.fillStyle = '#4b5865';
        ctx.fillRect(x0 + w * 0.06, y0 + hgt * 0.25, w * 0.88, hgt * 0.6);
        if (fine) {
          ctx.fillStyle = 'rgba(255,255,255,0.15)';
          for (let x = x0 + w * 0.08; x < x0 + w * 0.92; x += 0.4 * s) ctx.fillRect(x, y0 + hgt * 0.3, 1, hgt * 0.5);
        }
        return;
      }
      case 'vent': {
        if (mh < 1) return;
        const vw = Math.min(0.45, mw * 0.5) * s;
        const vh = 0.3 * s;
        const vx = x0 + (w - vw) / 2;
        const vy = y0 + Math.min(0.5 * s, hgt * 0.12);
        ctx.fillStyle = '#2a2d31';
        ctx.fillRect(vx, vy, vw, vh);
        if (fine) {
          ctx.fillStyle = 'rgba(200,200,200,0.35)';
          for (let y = vy + vh * 0.2; y < vy + vh; y += vh * 0.25) ctx.fillRect(vx, y, vw, Math.max(0.6, 0.015 * s));
        }
        return;
      }
      case 'ladder': {
        if (s < 9) return;
        const lx = x0 + w * 0.78;
        const lw = 0.45 * s;
        ctx.strokeStyle = 'rgba(60, 64, 70, 0.9)';
        ctx.lineWidth = Math.max(1, 0.04 * s);
        ctx.beginPath();
        ctx.moveTo(lx, y0);
        ctx.lineTo(lx, bottom);
        ctx.moveTo(lx + lw, y0);
        ctx.lineTo(lx + lw, bottom);
        for (let y = bottom - 0.3 * s; y > y0; y -= 0.3 * s) {
          ctx.moveTo(lx, y);
          ctx.lineTo(lx + lw, y);
        }
        ctx.stroke();
        if (fine) {
          // Safety cage hoops.
          ctx.strokeStyle = 'rgba(60, 64, 70, 0.5)';
          ctx.beginPath();
          for (let y = bottom - 0.9 * s; y > y0; y -= 0.9 * s) {
            ctx.moveTo(lx - 0.12 * s, y);
            ctx.quadraticCurveTo(lx + lw / 2, y - 0.25 * s, lx + lw + 0.12 * s, y);
          }
          ctx.stroke();
        }
        return;
      }
      case 'lettering': {
        if (s < 8) return;
        const letters = 'FEED';
        const lh = Math.min(0.75 * s, hgt / (letters.length + 1));
        ctx.fillStyle = 'rgba(150, 40, 30, 0.75)';
        ctx.font = `800 ${lh.toFixed(1)}px ${UI_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < letters.length; i++) ctx.fillText(letters[i] as string, x0 + w * 0.4, y0 + hgt * 0.12 + lh * (i + 0.6) * 1.05);
        return;
      }
      case 'truss': {
        // Warren truss web inside the chords.
        ctx.strokeStyle = 'rgba(30, 50, 70, 0.75)';
        ctx.lineWidth = Math.max(1, 0.04 * s);
        const bay = Math.max(hgt, 0.5 * s);
        ctx.beginPath();
        for (let x = x0, up = true; x < x0 + w; x += bay, up = !up) {
          ctx.moveTo(x, up ? bottom : y0);
          ctx.lineTo(x + bay, up ? y0 : bottom);
        }
        ctx.stroke();
        return;
      }
      case 'ribbon': {
        // A band of factory glazing two thirds of the way up.
        const by = y0 + hgt * 0.22;
        const bh = Math.min(0.9 * s, hgt * 0.22);
        ctx.fillStyle = '#1b2230';
        ctx.fillRect(x0 + 0.2 * s, by, w - 0.4 * s, bh);
        ctx.fillStyle = 'rgba(150, 180, 220, 0.18)';
        const pane = 0.9 * s;
        for (let x = x0 + 0.2 * s; x < x0 + w - 0.4 * s; x += pane) {
          if ((seed + Math.round(x)) % 4 === 0) {
            ctx.fillStyle = 'rgba(10, 12, 16, 0.9)';
            ctx.fillRect(x + 1, by + 1, pane - 2, bh - 2);
            ctx.fillStyle = 'rgba(150, 180, 220, 0.18)';
          } else {
            ctx.fillRect(x + 1, by + 1, pane * 0.35, bh - 2);
          }
          ctx.fillStyle = '#5a6a7a';
          ctx.fillRect(x, by, Math.max(1, 0.04 * s), bh);
          ctx.fillStyle = 'rgba(150, 180, 220, 0.18)';
        }
        return;
      }
      case 'cap': {
        // Cap band and the iron crown (or chimney pots).
        const band = Math.min(0.35 * s, hgt * 0.1);
        ctx.fillStyle = '#3a3532';
        ctx.fillRect(x0, y0, w, band);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(x0, y0 + band, w, Math.max(1, band * 0.25));
        if (b.kind === 'core') {
          // Iron hoops down the stack.
          ctx.fillStyle = 'rgba(40, 40, 44, 0.55)';
          for (let y = y0 + 1.2 * s; y < bottom; y += 1.5 * s) ctx.fillRect(x0, y, w, Math.max(1, 0.06 * s));
        }
        return;
      }
      case 'louvre': {
        ctx.fillStyle = 'rgba(20, 30, 40, 0.5)';
        const lx = x0 + w * 0.15;
        const lw = w * 0.4;
        for (let y = y0 + hgt * 0.25; y < y0 + hgt * 0.75; y += Math.max(2, 0.12 * s)) ctx.fillRect(lx, y, lw, Math.max(1, 0.05 * s));
        ctx.fillStyle = '#1b2230';
        ctx.fillRect(x0 + w * 0.65, y0 + hgt * 0.3, w * 0.2, hgt * 0.3);
        return;
      }
    }
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

  /**
   * Charges are drawn near their real size (a 0.5 m bundle) so they sit on
   * the structure like hardware, with a floor so they stay readable and tappable.
   */
  private chargeSize(cam: Camera): number {
    return Math.max(15, Math.min(40, cam.drawScale * 0.5));
  }

  /** Straps that visibly bind a charge to the member it sits on. */
  private drawStraps(m: Member, cam: Camera, size: number, at: number | undefined): void {
    const ctx = this.ctx;
    const pt = chargePoint(m, at);
    const p = cam.worldToScreen(pt.x, pt.y);
    const a = cam.worldToScreen(m.x, m.y + m.h);
    const b = cam.worldToScreen(m.x + m.w, m.y);
    const vertical = isVerticalMember(m);
    const band = Math.max(2, size * 0.1);
    ctx.save();
    ctx.fillStyle = '#1b2021';
    ctx.strokeStyle = 'rgba(255, 210, 120, 0.55)';
    ctx.lineWidth = 1;
    for (const off of [-1, 1]) {
      if (vertical) {
        const y = p.y + off * size * 0.3;
        ctx.fillRect(a.x - 2, y - band / 2, b.x - a.x + 4, band);
        ctx.strokeRect(a.x - 2, y - band / 2, b.x - a.x + 4, band);
      } else {
        const x = p.x + off * size * 0.3;
        ctx.fillRect(x - band / 2, a.y - 2, band, b.y - a.y + 4);
        ctx.strokeRect(x - band / 2, a.y - 2, band, b.y - a.y + 4);
      }
    }
    ctx.restore();
  }

  private drawCharges(state: SceneState, cam: Camera): void {
    const ctx = this.ctx;
    const size = this.chargeSize(cam);
    const armed = state.armedAt !== undefined;
    // Charges that share a spot on the same member spread out side by side.
    const spots = new Map<string, number>();
    const slot = new Map<string, number>();
    for (const c of state.charges) {
      const m = state.building.members.get(c.memberId);
      if (!m) continue;
      const pt = chargePoint(m, c.at);
      const key = `${c.memberId}:${Math.round(pt.x * 4)}:${Math.round(pt.y * 4)}`;
      const n = spots.get(key) ?? 0;
      slot.set(c.id, n);
      spots.set(key, n + 1);
    }
    const countAt = (c: PlacedCharge): number => {
      const m = state.building.members.get(c.memberId) as Member;
      const pt = chargePoint(m, c.at);
      return spots.get(`${c.memberId}:${Math.round(pt.x * 4)}:${Math.round(pt.y * 4)}`) ?? 1;
    };
    state.charges.forEach((c, index) => {
      const m = state.building.members.get(c.memberId);
      if (!m) return;
      const def = CHARGES[c.type];
      const pt = chargePoint(m, c.at);
      const p = cam.worldToScreen(pt.x, pt.y);
      const n = countAt(c);
      const i = slot.get(c.id) ?? 0;
      if (i === 0) this.drawStraps(m, cam, size, c.at);
      const phase = (hashString(c.id) % 100) / 100;
      const off = (i - (n - 1) / 2) * (size * 0.95);
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
      if (c.type === 'directional') this.drawPushHint(m, c.direction ?? 'left', cam, state, size, state.selectedId === c.memberId || armed, c.at);
    });
  }

  /**
   * The aim marker on the selected member: a ruler along the member in
   * 0.5 m ticks, a ghost of the charge at the snapped point and its blast radius.
   */
  private drawAim(state: SceneState, cam: Camera): void {
    const aim = state.aim;
    if (!aim || aim.memberId !== state.selectedId) return;
    const m = state.building.members.get(aim.memberId);
    if (!m || m.protect) return;
    const ctx = this.ctx;
    const s = cam.drawScale;
    const vertical = isVerticalMember(m);
    const len = chargeAxisLength(m);
    const pt = chargePoint(m, aim.at);
    const p = cam.worldToScreen(pt.x, pt.y);
    const size = this.chargeSize(cam);
    ctx.save();
    // Ruler: a rail beside the member with ticks every 0.1 m (when they fit), 0.5 m and 1 m.
    const a = cam.worldToScreen(m.x, m.y);
    const b = cam.worldToScreen(m.x + m.w, m.y + m.h);
    const railOff = 8;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 1;
    ctx.font = `600 10px ${UI_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.beginPath();
    const fine = 0.1 * s >= 5;
    const step = fine ? 0.1 : 0.5;
    for (let d = 0; d <= len + 1e-6; d += step) {
      const major = Math.abs(d - Math.round(d)) < 1e-6;
      const half = Math.abs(d * 2 - Math.round(d * 2)) < 1e-6;
      const t = major ? 7 : half ? 5 : 3;
      if (vertical) {
        const y = cam.worldToScreen(0, m.y + d).y;
        ctx.moveTo(b.x + railOff, y);
        ctx.lineTo(b.x + railOff + t, y);
        if (major && s * 1 > 14) ctx.fillText(`${Math.round(d)}`, b.x + railOff + 9, y);
      } else {
        const x = cam.worldToScreen(m.x + d, 0).x;
        ctx.moveTo(x, b.y - railOff);
        ctx.lineTo(x, b.y - railOff - t);
      }
    }
    if (vertical) {
      ctx.moveTo(b.x + railOff, a.y);
      ctx.lineTo(b.x + railOff, b.y);
    } else {
      ctx.moveTo(a.x, b.y - railOff);
      ctx.lineTo(b.x, b.y - railOff);
    }
    ctx.stroke();
    // Crosshair through the aim point.
    const def = CHARGES[aim.type];
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (vertical) {
      ctx.moveTo(a.x - 6, p.y);
      ctx.lineTo(b.x + railOff + 8, p.y);
    } else {
      ctx.moveTo(p.x, b.y - railOff - 8);
      ctx.lineTo(p.x, a.y + 6);
    }
    ctx.stroke();
    // Blast radius at true scale.
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(size * 0.6, def.radius * s), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = this.rgba(def.color, 0.06);
    ctx.fill();
    // Ghost charge.
    ctx.globalAlpha = 0.5 + 0.15 * Math.sin(state.time * 5);
    drawCharge(ctx, aim.type, p.x, p.y, size, { time: state.time, direction: aim.direction });
    ctx.globalAlpha = 1;
    // Readout: how far along the member.
    const along = len * aim.at;
    const text = vertical ? `${along.toFixed(1)} m up` : `${along.toFixed(1)} m in`;
    ctx.font = `700 11px ${UI_FONT}`;
    const tw = ctx.measureText(text).width + 10;
    const tx = vertical ? b.x + railOff + 12 : p.x - tw / 2;
    const ty = vertical ? p.y - 9 : b.y - railOff - 30;
    ctx.fillStyle = 'rgba(12, 14, 18, 0.88)';
    this.roundRect(tx, ty, tw, 18, 5);
    ctx.fill();
    ctx.fillStyle = def.color;
    ctx.textAlign = 'left';
    ctx.fillText(text, tx + 5, ty + 9);
    ctx.restore();
  }

  /** Marching chevrons and a tipping arrow: which way this charge will lay the structure down. */
  private drawPushHint(m: Member, direction: Direction, cam: Camera, state: SceneState, size: number, strong: boolean, at?: number): void {
    const ctx = this.ctx;
    const dir = direction === 'left' ? -1 : 1;
    const pt = chargePoint(m, at);
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

  // ------------------------------------------------------------------ HUD

  /** Zoomed out, the job is marked with a pin so it is never lost in the district. */
  private drawJobPin(state: SceneState, cam: Camera): void {
    const ctx = this.ctx;
    const b = state.building.bounds;
    const p = cam.worldToScreen((b.minX + b.maxX) / 2, b.maxY);
    const bob = Math.sin(state.time * 3) * 2;
    const y = p.y - 10 + bob;
    ctx.save();
    ctx.fillStyle = '#ffb020';
    ctx.beginPath();
    ctx.moveTo(p.x, y);
    ctx.lineTo(p.x - 6, y - 9);
    ctx.lineTo(p.x + 6, y - 9);
    ctx.fill();
    const label = state.world ? `LOT ${state.world.site.lotNumber}` : 'JOB';
    ctx.font = `700 11px ${UI_FONT}`;
    const tw = ctx.measureText(label).width + 12;
    ctx.fillStyle = '#ffb020';
    this.roundRect(p.x - tw / 2, y - 27, tw, 18, 5);
    ctx.fill();
    ctx.fillStyle = '#16181c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, p.x, y - 18);
    ctx.restore();
  }

  /**
   * A strip map of the whole district: every structure as a silhouette, the
   * job lot in amber and a frame for what the camera sees. Tap it to travel.
   */
  private drawMinimap(world: World, building: Building, cam: Camera): void {
    const ctx = this.ctx;
    const w = Math.min(196, Math.max(130, this.width * 0.42));
    const h = 38;
    const x = 12;
    const y = cam.insetTop + 6;
    const minX = world.minX;
    const maxX = world.maxX;
    const sx = (wx: number): number => x + 6 + ((wx - minX) / (maxX - minX)) * (w - 12);
    const groundY = y + h - 6;
    const vScale = (h - 20) / 30;
    ctx.save();
    ctx.fillStyle = 'rgba(12, 14, 18, 0.78)';
    this.roundRect(x, y, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(x + 2, y + 2, w - 4, h - 4);
    ctx.clip();
    // Cross streets as gaps, structures as silhouettes.
    for (const c of world.crossings) {
      ctx.fillStyle = c.kind === 'river' ? 'rgba(60, 130, 180, 0.7)' : 'rgba(255,255,255,0.12)';
      ctx.fillRect(sx(c.x), groundY, Math.max(1, sx(c.x + c.w) - sx(c.x)), 2);
    }
    ctx.fillStyle = 'rgba(160, 172, 190, 0.45)';
    for (const p of world.props) {
      if (p.h < 2.5 || p.k < 0.75 || p.k > 1) continue;
      const hh = Math.min(h - 20, p.h * vScale);
      ctx.fillRect(sx(p.x), groundY - hh, Math.max(1, sx(p.x + p.w) - sx(p.x)), hh);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(x + 4, groundY, w - 8, 1);
    // The job: lot outline and the building.
    ctx.fillStyle = 'rgba(255, 176, 32, 0.22)';
    ctx.fillRect(sx(world.lot.x), y + 16, sx(world.lot.x + world.lot.w) - sx(world.lot.x), h - 22);
    ctx.fillStyle = '#ffb020';
    const bb = building.bounds;
    const bh = Math.min(h - 20, Math.max(4, bb.maxY * vScale));
    ctx.fillRect(sx(bb.minX), groundY - bh, Math.max(2, sx(bb.maxX) - sx(bb.minX)), bh);
    // What the camera sees.
    const left = cam.screenToWorld(0, 0).x;
    const right = cam.screenToWorld(this.width, 0).x;
    const vx1 = Math.max(x + 3, sx(left));
    const vx2 = Math.min(x + w - 3, sx(right));
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vx1, y + 15, Math.max(3, vx2 - vx1), h - 18);
    ctx.restore();
    // Where you are, in words.
    ctx.font = `700 9px ${UI_FONT}`;
    ctx.fillStyle = 'rgba(232, 230, 225, 0.6)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${world.site.districtName.toUpperCase()} · ${world.site.street.toUpperCase()}`, x + 7, y + 4);
    this.minimap = { x, y, w, h, minX, maxX };
  }

  /** Map-style scale bar with the current level of the hierarchy. */
  private drawScaleBar(cam: Camera): void {
    const ctx = this.ctx;
    const s = cam.drawScale;
    const steps = [0.5, 1, 2, 5, 10, 20, 50, 100, 200];
    let metres = steps[0] as number;
    for (const m of steps) {
      if (m * s <= 90) metres = m;
    }
    const len = metres * s;
    const x = 14;
    const y = cam.insetTop + 6 + 38 + 16;
    ctx.save();
    ctx.strokeStyle = 'rgba(232, 230, 225, 0.75)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.lineTo(x + len, y - 4);
    ctx.moveTo(x + len / 2, y - 2);
    ctx.lineTo(x + len / 2, y);
    ctx.stroke();
    ctx.font = `700 10px ${UI_FONT}`;
    ctx.fillStyle = 'rgba(232, 230, 225, 0.8)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${metres} m`, x + len + 6, y - 2);
    ctx.fillStyle = 'rgba(255, 176, 32, 0.85)';
    ctx.fillText(zoomTier(s).toUpperCase(), x + len + 6 + ctx.measureText(`${metres} m`).width + 8, y - 2);
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
    // Keep the tag below the header (and clear of the minimap) even when the member reaches the top of the view.
    const underMap = state.hud && tx < 12 + Math.min(196, Math.max(130, this.width * 0.42)) + 6;
    const ty = Math.max(cam.insetTop + (underMap ? 74 : 4), a.y - 30);
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
