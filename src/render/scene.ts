import type { MachineId } from '../data/fleet';
import type { MovePlan } from '../game/moves';
import type { Camera } from './camera';
import type { Setting } from '../wreck/buildings';
import type { WreckFx } from '../wreck/fx';
import { GROUND, type PieceDef } from '../wreck/structure';
import { HEIGHTMAP, PIECE_FALLING, PIECE_STANDING, heightAt, type Body, type Halden, type WreckSim } from '../wreck/sim';
import { FLAW_SHOWN, chargePos, type Block } from '../wreck/tools';
import { baseColor, drawDamage, drawFacade, styleFor, topColor, type Style } from './facade';
import { drawBall, drawCrane, drawDozer, drawExcavator, drawLoader, drawTruck } from './machines';
import { FONT, KX, KY, box, hash, mix, prism, px, py, rotRect, shade, worldText, type Ctx } from './paint';

/**
 * The demolition site as a lit diorama: a slab of ground cut away at the
 * front, the lot and its neighbours on top, the building standing in it and
 * the fleet working in front. All structure, rubble and machine poses come
 * straight from the simulation; the renderer only decides how they look.
 */

export interface Floater {
  text: string;
  x: number;
  y: number;
  born: number;
  tone: 'gold' | 'white' | 'red' | 'green';
  big?: boolean;
}

export interface DrawOptions {
  time: number;
  now: number;
  machine?: MachineId;
  plan?: MovePlan;
  /** Inspect mode: tint every member by how close it is to its limit. */
  stress?: boolean;
  /** A piece the player is inspecting. */
  inspect?: number;
  floaters?: Floater[];
  /** Fraction of the lot cleared, for the ground's before-and-after look. */
  clear?: number;
  /** Draw machines and site overlays (off for the title backdrop). */
  site?: boolean;
  /** Machines on this job (others stay parked off site). */
  machines?: MachineId[];
}

interface Palette {
  skyTop: string;
  skyLow: string;
  haze: string;
  far1: string;
  far2: string;
  ground: string;
  lot: string;
  lotClean: string;
  soil: string;
  soil2: string;
  soilDark: string;
  sun: string;
}

const PALETTES: Record<Setting, Palette> = {
  town: { skyTop: '#8fb4cc', skyLow: '#f1dcb4', haze: '#e9d3ad', far1: '#a9b1b4', far2: '#c5c3b6', ground: '#77746c', lot: '#8b7660', lotClean: '#a89a85', soil: '#6d4c35', soil2: '#5a3e2c', soilDark: '#3b2a1f', sun: '#fff1cf' },
  suburb: { skyTop: '#9cc1d6', skyLow: '#f3e6c8', haze: '#e6dcc0', far1: '#9fb19a', far2: '#bcc7ad', ground: '#7d8f5c', lot: '#8d775c', lotClean: '#a99b83', soil: '#6a4a33', soil2: '#58402d', soilDark: '#392a1e', sun: '#fff4d8' },
  farm: { skyTop: '#86a9c4', skyLow: '#f4cf98', haze: '#eac590', far1: '#9aa77a', far2: '#c2b37e', ground: '#97945a', lot: '#94785a', lotClean: '#ad9b7c', soil: '#71503a', soil2: '#5c412f', soilDark: '#3d2b1f', sun: '#ffe2a8' },
  yard: { skyTop: '#98a6ad', skyLow: '#dcd2c0', haze: '#d3c8b4', far1: '#8e9293', far2: '#aeaca3', ground: '#6d6a64', lot: '#7f6d5b', lotClean: '#9a9083', soil: '#5e4433', soil2: '#4e392b', soilDark: '#33261d', sun: '#f6ead2' },
  wharf: { skyTop: '#7fa6c4', skyLow: '#f0c99a', haze: '#e1c197', far1: '#8d9ca5', far2: '#b4b2a5', ground: '#6f6f6a', lot: '#86705b', lotClean: '#a19584', soil: '#5f4635', soil2: '#4e3a2c', soilDark: '#31251d', sun: '#ffe0b0' },
  city: { skyTop: '#7f9cb7', skyLow: '#f2c18e', haze: '#e3bc90', far1: '#8d96a0', far2: '#a9a8a2', ground: '#6b6964', lot: '#86705c', lotClean: '#a09485', soil: '#5d4434', soil2: '#4c392c', soilDark: '#30251d', sun: '#ffdcae' },
};

/** Ground in front of the building face, and how far back the yard runs. */
const ZF = 7;

interface Skyline {
  x: number;
  w: number;
  h: number;
  layer: number;
  kind: number;
  seed: number;
}

interface Prepared {
  order: number[];
  /** Pieces standing against each piece's right face. */
  right: number[][];
}

export class SceneRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: Ctx;
  width = 1;
  height = 1;
  dpr = 1;
  private skyline = new Map<Setting, Skyline[]>();
  private prepared = new WeakMap<Halden, Prepared>();
  /** Ground cells machines have driven over, for track marks. */
  private treads = new Uint8Array(Math.ceil(220 / 0.5));
  private treadsFor?: WreckSim;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false }) as Ctx;
  }

  resize(width: number, height: number): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  private prep(h: Halden): Prepared {
    let p = this.prepared.get(h);
    if (p) return p;
    const pieces = h.def.pieces;
    const order = pieces.map((q) => q.id).sort((a, b) => {
      const pa = pieces[a] as PieceDef;
      const pb = pieces[b] as PieceDef;
      return Math.round(pa.y * 20) - Math.round(pb.y * 20) || pa.x - pb.x;
    });
    const right: number[][] = pieces.map(() => []);
    for (const a of pieces) {
      for (const b of pieces) {
        if (a === b) continue;
        if (Math.abs(b.x - (a.x + a.w)) > 0.12 && !(b.x < a.x + a.w - 0.05 && b.x + b.w > a.x + a.w + 0.05)) continue;
        if (b.y >= a.y + a.h - 0.02 || b.y + b.h <= a.y + 0.02) continue;
        (right[a.id] as number[]).push(b.id);
      }
    }
    p = { order, right };
    this.prepared.set(h, p);
    return p;
  }

  draw(sim: WreckSim, cam: Camera, fx: WreckFx, opt: DrawOptions): void {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const b = sim.h.building;
    const pal = PALETTES[b.setting];
    const st = styleFor(b.id);
    const D = b.depth;
    const s = cam.drawScale;
    const o = cam.worldToScreen(0, 0);
    if (this.treadsFor !== sim) {
      this.treads.fill(0);
      this.treadsFor = sim;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawSky(ctx, cam, pal, b.setting, D);
    ctx.setTransform(s * dpr, 0, 0, -s * dpr, o.x * dpr, o.y * dpr);
    const view = {
      minX: cam.screenToWorld(0, 0).x - 30,
      maxX: cam.screenToWorld(this.width, 0).x + 10,
      minY: cam.screenToWorld(0, this.height).y,
      maxY: cam.screenToWorld(0, 0).y,
    };
    const site = opt.site !== false;
    const ZB = D + 16;
    this.drawGround(ctx, sim, pal, view, D, ZB, opt.clear ?? 0, site);
    this.drawBackProps(ctx, sim, pal, D, ZB, site);
    this.drawNeighbour(ctx, sim, st, pal);
    this.drawShadows(ctx, sim, D);
    this.drawRubble(ctx, sim, pal, view, D);
    this.drawWreck(ctx, sim, st, D, s);
    this.drawBlocks(ctx, sim, D, opt.time);
    this.drawStanding(ctx, sim, st, D, s, opt);
    for (const body of sim.state.bodies) if (body.state !== 'rubble') this.drawBody(ctx, sim, body, st, D, s);
    if (site) {
      const on = (m: MachineId): boolean => !opt.machines || opt.machines.includes(m);
      if (on('ball')) drawCrane(ctx, sim, opt.time, opt.machine === 'ball');
      if (on('excavator')) drawExcavator(ctx, sim, opt.time, opt.machine === 'excavator');
      if (on('loader')) drawLoader(ctx, sim, opt.time, opt.machine === 'loader');
      if (on('dozer')) drawDozer(ctx, sim, opt.time, opt.machine === 'dozer');
      if (on('ball')) drawBall(ctx, sim, sim.state.kit);
      this.markTreads(sim, opt.machines);
    } else {
      drawCrane(ctx, sim, opt.time, false);
      drawBall(ctx, sim, sim.state.kit);
    }
    ctx.save();
    ctx.translate(D * 0.35 * KX, D * 0.35 * KY);
    fx.drawChunks(ctx, s);
    fx.drawDust(ctx);
    ctx.restore();
    if (fx.flash > 0) {
      ctx.globalAlpha = fx.flash * 0.6;
      ctx.fillStyle = '#fff6e0';
      ctx.beginPath();
      ctx.arc(fx.flashX, fx.flashY, 1.2 + fx.flash * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    this.drawFrontProps(ctx, sim, pal, site);
    this.drawSoil(ctx, pal, view);
    if (site) {
      this.drawCharges(ctx, sim, opt.time);
      if (opt.plan) this.drawPlan(ctx, sim, opt.plan, D, opt.time);
      if (opt.inspect !== undefined && opt.inspect >= 0) this.outline(ctx, sim, opt.inspect, D, '#ffffff', 0.12);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (site) {
      this.drawFlaws(ctx, sim, cam, opt.time);
      if (opt.floaters?.length) this.drawFloaters(ctx, cam, opt.floaters, opt.now);
    }
  }

  // ---------------------------------------------------------------- sky

  private skylineFor(setting: Setting): Skyline[] {
    let list = this.skyline.get(setting);
    if (list) return list;
    list = [];
    let seed = setting.length * 977 + 13;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let layer = 0; layer < 2; layer++) {
      let x = -320;
      while (x < 360) {
        const tall = setting === 'city' ? 26 : setting === 'wharf' || setting === 'yard' ? 14 : 8;
        const w = (setting === 'farm' ? 14 : 7) + rnd() * 16;
        const h = (layer === 0 ? tall : tall * 0.6) + rnd() * tall * (layer === 0 ? 1.5 : 1);
        list.push({ x, w, h, layer, kind: Math.floor(rnd() * 4), seed: Math.floor(rnd() * 1e6) });
        x += w + rnd() * (setting === 'farm' ? 30 : 5);
      }
    }
    this.skyline.set(setting, list);
    return list;
  }

  private drawSky(ctx: Ctx, cam: Camera, pal: Palette, setting: Setting, D: number): void {
    const horizon = cam.worldToScreen(0, (D + 16) * KY).y;
    const g = ctx.createLinearGradient(0, 0, 0, Math.max(horizon, 40));
    g.addColorStop(0, pal.skyTop);
    g.addColorStop(0.75, pal.skyLow);
    g.addColorStop(1, pal.haze);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.width, this.height);
    // Sun glow, low on the left.
    const sx = this.width * 0.08;
    const sy = horizon - this.height * 0.28;
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, this.width * 0.6);
    sg.addColorStop(0, 'rgba(255,240,205,0.55)');
    sg.addColorStop(1, 'rgba(255,240,205,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, this.width, this.height);
    for (const layer of [0, 1]) {
      const k = layer === 0 ? 0.32 : 0.55;
      const scale = cam.drawScale * k;
      const cx = this.width / 2 - cam.x * scale;
      ctx.fillStyle = layer === 0 ? pal.far2 : pal.far1;
      for (const b of this.skylineFor(setting)) {
        if (b.layer !== layer) continue;
        const x = cx + b.x * scale;
        const w = b.w * scale;
        if (x + w < -20 || x > this.width + 20) continue;
        const h = b.h * scale;
        if (setting === 'farm') {
          // Rolling fields and the odd barn.
          ctx.beginPath();
          ctx.ellipse(x + w / 2, horizon, w * 0.9, h * 0.35, 0, Math.PI, 0);
          ctx.fill();
          if (b.kind === 0 && layer === 1) {
            ctx.fillRect(x + w * 0.3, horizon - h * 0.35, w * 0.25, h * 0.2);
            ctx.beginPath();
            ctx.moveTo(x + w * 0.27, horizon - h * 0.35);
            ctx.lineTo(x + w * 0.425, horizon - h * 0.48);
            ctx.lineTo(x + w * 0.58, horizon - h * 0.35);
            ctx.fill();
          }
          continue;
        }
        if ((setting === 'suburb' || setting === 'town') && b.kind < 2) {
          // Pitched roofs and round trees.
          ctx.fillRect(x, horizon - h * 0.6, w, h * 0.6);
          ctx.beginPath();
          ctx.moveTo(x - w * 0.05, horizon - h * 0.6);
          ctx.lineTo(x + w / 2, horizon - h);
          ctx.lineTo(x + w * 1.05, horizon - h * 0.6);
          ctx.fill();
          continue;
        }
        if ((setting === 'suburb' || setting === 'town') && b.kind === 2) {
          ctx.beginPath();
          ctx.arc(x + w / 2, horizon - h * 0.5, Math.min(w, h) * 0.5, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        ctx.fillRect(x, horizon - h, w + 0.5, h);
        if ((setting === 'yard' || setting === 'wharf') && b.kind === 3) {
          // Chimneys and cranes against the sky.
          ctx.fillRect(x + w * 0.4, horizon - h * 1.9, w * 0.12, h * 0.9);
        }
        if (setting === 'city' && layer === 1 && scale > 1.5) {
          ctx.fillStyle = shade(pal.far1, 1.12);
          for (let wy = 4; wy < b.h - 3; wy += 4) for (let wx = 1.5; wx < b.w - 1.5; wx += 3) if (hash(b.seed, wx * 13 + wy) < 0.35) ctx.fillRect(x + wx * scale, horizon - wy * scale, scale * 1.4, scale * 1.6);
          ctx.fillStyle = pal.far1;
        }
      }
    }
  }

  // -------------------------------------------------------------- ground

  private drawGround(ctx: Ctx, sim: WreckSim, pal: Palette, v: { minX: number; maxX: number }, D: number, ZB: number, clear: number, site: boolean): void {
    const L = sim.h.site;
    const x0 = v.minX - 40;
    const x1 = v.maxX + 40;
    const plane = (a: number, b: number, za: number, zb: number, col: string): void => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(px(a, za), py(0, za));
      ctx.lineTo(px(b, za), py(0, za));
      ctx.lineTo(px(b, zb), py(0, zb));
      ctx.lineTo(px(a, zb), py(0, zb));
      ctx.closePath();
      ctx.fill();
    };
    plane(x0, x1, -ZF, ZB, pal.ground);
    // Street kerb along the front and a pavement band.
    plane(x0, x1, -ZF, -ZF + 1.6, shade(pal.ground, 1.12));
    // The lot: churned dirt, turning to graded gravel as it is cleared.
    const lotCol = mix(pal.lot, pal.lotClean, Math.min(1, clear));
    plane(L.lotMin, L.lotMax, -ZF + 1.6, ZB - 4, lotCol);
    // Track marks where the machines have been.
    ctx.fillStyle = 'rgba(40,30,22,0.16)';
    for (let i = 0; i < this.treads.length; i++) {
      if (!this.treads[i]) continue;
      const x = -90 + i * 0.5;
      for (const z of [-3.2, -0.6]) {
        ctx.beginPath();
        ctx.moveTo(px(x, z), py(0.01, z));
        ctx.lineTo(px(x + 0.5, z), py(0.01, z));
        ctx.lineTo(px(x + 0.5, z + 0.7), py(0.01, z + 0.7));
        ctx.lineTo(px(x, z + 0.7), py(0.01, z + 0.7));
        ctx.fill();
      }
    }
    if (clear > 0.85) {
      // A cleared lot gets graded and staked out for whatever comes next.
      const a = Math.min(1, (clear - 0.85) / 0.1);
      ctx.globalAlpha = a;
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      for (let z = 0; z < ZB - 6; z += 1.2) {
        ctx.moveTo(px(L.lotMin + 1, z), py(0.01, z));
        ctx.lineTo(px(L.lotMax - 1, z), py(0.01, z));
      }
      ctx.stroke();
      for (const [sx, sz] of [
        [L.lotMin + 2, 0],
        [L.lotMax - 2, 0],
        [L.lotMin + 2, D],
        [L.lotMax - 2, D],
      ] as Array<[number, number]>) {
        box(ctx, sx - 0.06, 0, 0.12, 1.1, sz, sz + 0.12, { front: '#d9c79f' });
        ctx.fillStyle = '#f06b1f';
        ctx.fillRect(px(sx, sz), py(0.95, sz), 0.5, 0.25);
      }
      ctx.globalAlpha = 1;
    }
    if (!site) return;
    // Salvage pad: steel plates.
    plane(L.padMin, L.padMax, -4.5, D + 2, '#9b968c');
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    for (let x = L.padMin + 2; x < L.padMax; x += 2) {
      ctx.moveTo(px(x, -4.5), py(0.01, -4.5));
      ctx.lineTo(px(x, D + 2), py(0.01, D + 2));
    }
    ctx.stroke();
    this.groundLabel(ctx, 'SALVAGE', (L.padMin + L.padMax) / 2, -2.2, '#f2b705');
    // Haul pit: a hole, its far wall lit, and the truck beyond.
    const pz0 = -4.5;
    const pz1 = D + 2;
    ctx.fillStyle = pal.soilDark;
    ctx.beginPath();
    ctx.moveTo(px(L.pitMin, pz0), py(0, pz0));
    ctx.lineTo(px(L.pitMax, pz0), py(0, pz0));
    ctx.lineTo(px(L.pitMax, pz1), py(0, pz1));
    ctx.lineTo(px(L.pitMin, pz1), py(0, pz1));
    ctx.fill();
    ctx.fillStyle = pal.soil;
    ctx.beginPath();
    ctx.moveTo(px(L.pitMin, pz1), py(0, pz1));
    ctx.lineTo(px(L.pitMax, pz1), py(0, pz1));
    ctx.lineTo(px(L.pitMax, pz1), py(-2.2, pz1));
    ctx.lineTo(px(L.pitMin + 0.8, pz1), py(-2.2, pz1));
    ctx.fill();
    ctx.fillStyle = pal.soil2;
    ctx.beginPath();
    ctx.moveTo(px(L.pitMin, pz0), py(0, pz0));
    ctx.lineTo(px(L.pitMin, pz1), py(0, pz1));
    ctx.lineTo(px(L.pitMin + 0.8, pz1), py(-2.2, pz1));
    ctx.lineTo(px(L.pitMin + 0.8, pz0), py(-2.2, pz0));
    ctx.fill();
    this.groundLabel(ctx, 'HAUL', (L.pitMin + L.pitMax) / 2, -2.2, '#ffffff');
    // Lot lines and the neighbour's line.
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 0.12;
    ctx.setLineDash([0.8, 0.6]);
    ctx.beginPath();
    for (const x of [L.lotMin, L.lotMax]) {
      ctx.moveTo(px(x, -ZF + 1.6), py(0.02, -ZF + 1.6));
      ctx.lineTo(px(x, ZB - 4), py(0.02, ZB - 4));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(214,74,44,0.85)';
    ctx.lineWidth = 0.18;
    ctx.beginPath();
    ctx.moveTo(px(L.neighbourX, -ZF + 1.6), py(0.02, -ZF + 1.6));
    ctx.lineTo(px(L.neighbourX, ZB - 4), py(0.02, ZB - 4));
    ctx.stroke();
  }

  private groundLabel(ctx: Ctx, text: string, x: number, z: number, color: string): void {
    // Painted on the ground: squash it into the ground plane.
    ctx.save();
    ctx.transform(1, 0, KX, KY, px(x, z), py(0.02, z));
    ctx.globalAlpha = 0.8;
    worldText(ctx, text, 0, 0, 1.6, color, 'center', 800);
    ctx.restore();
  }

  private markTreads(sim: WreckSim, machines?: MachineId[]): void {
    const s = sim.state;
    const mark = (x: number, half: number): void => {
      for (let u = x - half; u <= x + half; u += 0.5) {
        const i = Math.round((u + 90) / 0.5);
        if (i >= 0 && i < this.treads.length) this.treads[i] = 1;
      }
    };
    const on = (m: MachineId): boolean => !machines || machines.includes(m);
    if (on('dozer') && Math.abs(s.dozer.speed) > 0.1) mark(s.dozer.x, 2.4);
    if (on('excavator')) mark(s.exc.x, 2.8);
    if (on('loader') && Math.abs(s.loader.speed) > 0.1) mark(s.loader.x, 2);
  }

  private drawBackProps(ctx: Ctx, sim: WreckSim, pal: Palette, D: number, ZB: number, site: boolean): void {
    const L = sim.h.site;
    const setting = sim.h.building.setting;
    // Hoarding along the back of the yard.
    const zf = ZB - 3;
    for (let x = L.lotMin - 30; x < L.neighbourX - 2; x += 3) {
      box(ctx, x, 0, 2.9, 2.4, zf, zf + 0.2, { front: hash(Math.round(x)) < 0.5 ? '#3f4a52' : '#46525a' });
    }
    if (setting === 'suburb' || setting === 'farm' || setting === 'town') {
      for (let i = 0; i < 6; i++) {
        const x = L.lotMin - 40 + i * 13 + hash(i, 7) * 6;
        if (x > L.lotMin - 6 && x < L.neighbourX + 14) continue;
        this.tree(ctx, x, ZB - 6 - hash(i, 3) * 6, 3 + hash(i, 5) * 2.5, pal);
      }
    }
    if (!site) return;
    // Site office by the pad, a floodlight and a material pile.
    const ox = L.padMin - 1;
    box(ctx, ox, 0, 6, 2.7, D + 3, D + 5.6, { front: '#d9d2c3' });
    ctx.fillStyle = '#3d5562';
    ctx.fillRect(px(ox + 1, D + 3), py(1.2, D + 3), 1.6, 0.9);
    ctx.fillRect(px(ox + 3.4, D + 3), py(1.2, D + 3), 1.6, 0.9);
    box(ctx, ox - 0.2, 2.7, 6.4, 0.18, D + 2.9, D + 5.7, { front: '#9f998b' });
    const fl = L.lotMax + 0.5;
    box(ctx, fl, 0, 0.18, 9, D + 2, D + 2.2, { front: '#59636a' });
    box(ctx, fl - 0.9, 9, 2, 0.7, D + 1.9, D + 2.3, { front: '#2c3236' });
    ctx.fillStyle = 'rgba(255,240,200,0.9)';
    ctx.fillRect(px(fl - 0.75, D + 1.9), py(9.1, D + 1.9), 1.7, 0.45);
    // The truck at the pit.
    const tz = D + 3.5;
    const pc = (L.pitMin + L.pitMax) / 2;
    drawTruck(ctx, pc + 1.5, tz, (sim.state.tally.hauled % 40) / 40, 1);
  }

  private tree(ctx: Ctx, x: number, z: number, r: number, pal: Palette): void {
    box(ctx, x - 0.2, 0, 0.4, r * 0.9, z, z + 0.4, { front: '#5b4331' });
    const g = mix('#5f7a43', pal.ground, 0.15);
    for (let k = 0; k < 3; k++) {
      ctx.fillStyle = k === 0 ? shade(g, 0.8) : k === 1 ? g : shade(g, 1.12);
      ctx.beginPath();
      ctx.arc(px(x + (k - 1) * r * 0.25, z), py(r * 0.9 + r * 0.55 + k * 0.15, z), r * (0.75 - k * 0.12), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawFrontProps(ctx: Ctx, sim: WreckSim, pal: Palette, site: boolean): void {
    if (!site) return;
    const L = sim.h.site;
    const z = -ZF + 2.2;
    // Water-filled barriers along the lot front, red and white.
    for (let x = L.lotMin; x < L.lotMax - 1.9; x += 2.1) {
      if (Math.abs(x - (L.lotMin + L.lotMax) / 2) < 3) continue;
      const red = Math.round((x - L.lotMin) / 2.1) % 2 === 0;
      prism(ctx, [x, 0, x + 1.9, 0, x + 1.7, 0.95, x + 0.2, 0.95], z, z + 0.55, { front: red ? '#cf3b2a' : '#efeae0' });
    }
    // Cones at the pad and pit.
    for (const x of [L.padMax + 0.6, L.pitMin - 0.6]) {
      prism(ctx, [x - 0.3, 0, x + 0.3, 0, x + 0.06, 0.8, x - 0.06, 0.8], z + 0.5, z + 0.9, { front: '#f06b1f' });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px(x - 0.16, z + 0.5), py(0.4, z + 0.5), 0.32, 0.12);
    }
    void pal;
  }

  private drawSoil(ctx: Ctx, pal: Palette, v: { minX: number; maxX: number; minY: number }): void {
    const top = -ZF * KY;
    const xs = -ZF * KX;
    const bottom = Math.min(top - 2, v.minY - 2);
    const g = ctx.createLinearGradient(0, top, 0, top - 6);
    g.addColorStop(0, pal.soil);
    g.addColorStop(1, pal.soilDark);
    ctx.fillStyle = g;
    ctx.fillRect(v.minX + xs - 50, bottom, v.maxX - v.minX + 120, top - bottom);
    // Strata and stones in the cut face.
    ctx.fillStyle = pal.soil2;
    ctx.fillRect(v.minX + xs - 50, top - 1.7, v.maxX - v.minX + 120, 0.35);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(v.minX + xs - 50, top - 0.12, v.maxX - v.minX + 120, 0.12);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let x = Math.floor(v.minX / 2.3) * 2.3; x < v.maxX + 20; x += 2.3) {
      const u = hash(Math.round(x * 10));
      ctx.fillRect(x + xs, top - 0.6 - u * 3.2, 0.3 + u * 0.4, 0.18);
    }
    // Asphalt and kerb edge on top.
    ctx.fillStyle = '#4b4945';
    ctx.fillRect(v.minX + xs - 50, top - 0.45, v.maxX - v.minX + 120, 0.45);
  }

  // ----------------------------------------------------------- neighbour

  private drawNeighbour(ctx: Ctx, sim: WreckSim, st: Style, pal: Palette): void {
    const L = sim.h.site;
    const n = sim.h.building.neighbour;
    const x = L.neighbourX + 1.2;
    const z0 = 0;
    const z1 = Math.min(14, sim.h.building.depth);
    const hit = Math.min(1, collateralNear(sim) / 6);
    const wall = n.look === 'farmhouse' || n.look === 'house' ? '#e6dccb' : n.look === 'pumphouse' ? '#9c5a3f' : n.look === 'office' ? '#b9b7b0' : n.look === 'tyres' ? '#c9c3b5' : '#c7a77f';
    box(ctx, x, 0, n.w, n.h, z0, z1, { front: wall });
    // Roof.
    if (n.look === 'farmhouse' || n.look === 'house') {
      prism(ctx, [x - 0.5, n.h, x + n.w + 0.5, n.h, x + n.w / 2, n.h + 3.2], z0, z1, { front: shade(wall, 0.92), top: '#6a3e33' });
    } else {
      box(ctx, x - 0.2, n.h, n.w + 0.4, 0.4, z0, z1, { front: shade(wall, 0.8) });
    }
    // Windows (smashed as debris arrives), door and a sign.
    const cols = Math.max(2, Math.round(n.w / 3));
    const rows = Math.max(1, Math.floor((n.h - 1) / 3.2));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const wx = x + 0.8 + (c * (n.w - 1.6)) / cols;
        const wy = 1.2 + r * 3.2;
        const broken = hash(c, r) < hit;
        ctx.fillStyle = broken ? '#1b1f22' : r === 0 && c === 1 ? '#e7c27c' : '#6c8a9b';
        ctx.fillRect(wx, wy, (n.w - 1.6) / cols - 0.6, 1.8);
        if (broken) {
          ctx.strokeStyle = '#d7e5ec';
          ctx.lineWidth = 0.05;
          ctx.beginPath();
          ctx.moveTo(wx, wy + 1.8);
          ctx.lineTo(wx + 0.5, wy + 0.6);
          ctx.lineTo(wx + 0.2, wy);
          ctx.stroke();
        }
      }
    }
    const label = n.name.replace(/^the /, '').toUpperCase();
    ctx.fillStyle = shade(wall, 0.7);
    ctx.fillRect(x + 0.6, n.h - 1.3, n.w - 1.2, 0.9);
    worldText(ctx, label, x + n.w / 2, n.h - 0.85, 0.62, '#f6efe1', 'center', 700);
    void st;
    void pal;
  }

  // ------------------------------------------------------------- shadows

  private drawShadows(ctx: Ctx, sim: WreckSim, D: number): void {
    const s = sim.state;
    // Sun from the upper left and in front: shadows fall right and back.
    const sx = 0.55;
    const sz = 0.5;
    ctx.fillStyle = 'rgba(30,24,20,0.24)';
    ctx.beginPath();
    for (const p of sim.def.pieces) {
      if (s.status[p.id] !== PIECE_STANDING || p.y > 40) continue;
      const top = p.y + p.h;
      const pts: Array<[number, number]> = [];
      for (const [x, y, z] of [
        [p.x, p.y, 0],
        [p.x + p.w, p.y, 0],
        [p.x + p.w, p.y, D],
        [p.x, p.y, D],
        [p.x, top, 0],
        [p.x + p.w, top, 0],
        [p.x + p.w, top, D],
        [p.x, top, D],
      ] as Array<[number, number, number]>) {
        const gx = x + y * sx;
        const gz = z + y * sz;
        pts.push([px(gx, gz), py(0, gz)]);
      }
      const hull = convexHull(pts);
      hull.forEach(([hx, hy], i) => (i === 0 ? ctx.moveTo(hx, hy) : ctx.lineTo(hx, hy)));
      ctx.closePath();
    }
    ctx.fill('nonzero');
    // Contact shadow under machines and heaps.
    void D;
  }

  // -------------------------------------------------------------- rubble

  private drawRubble(ctx: Ctx, sim: WreckSim, pal: Palette, v: { minX: number; maxX: number }, D: number): void {
    const hm = sim.state.heightmap;
    const cell = HEIGHTMAP.cell;
    const i0 = Math.max(0, Math.floor((v.minX - HEIGHTMAP.minX) / cell) - 2);
    const i1 = Math.min(hm.length - 2, Math.ceil((v.maxX - HEIGHTMAP.minX) / cell) + 2);
    const zA = -2.4;
    const zB = D * 0.22;
    const zC = D * 0.72;
    const zD = D + 1.2;
    const base = '#8d8578';
    // Back slope, crest and front slope per cell, then the front face.
    for (let pass = 0; pass < 3; pass++) {
      for (let i = i0; i <= i1; i++) {
        const h0 = hm[i] as number;
        const h1 = hm[i + 1] as number;
        if (h0 < 0.02 && h1 < 0.02) continue;
        const x0 = HEIGHTMAP.minX + i * cell;
        const x1 = x0 + cell;
        const slope = (h1 - h0) / cell;
        const lit = 1 + Math.max(-0.25, Math.min(0.25, -slope * 0.35));
        let za: number;
        let zb: number;
        let ka: number;
        let kb: number;
        let k: number;
        if (pass === 0) {
          za = zC;
          zb = zD;
          ka = 1;
          kb = 0.15;
          k = 0.86;
        } else if (pass === 1) {
          za = zB;
          zb = zC;
          ka = 1;
          kb = 1;
          k = 1.12;
        } else {
          za = zA;
          zb = zB;
          ka = 0.2;
          kb = 1;
          k = 0.98;
        }
        ctx.fillStyle = shade(base, k * lit * (0.94 + hash(i) * 0.1));
        ctx.beginPath();
        ctx.moveTo(px(x0, za), py(h0 * ka, za));
        ctx.lineTo(px(x1, za), py(h1 * ka, za));
        ctx.lineTo(px(x1, zb), py(h1 * kb, zb));
        ctx.lineTo(px(x0, zb), py(h0 * kb, zb));
        ctx.closePath();
        ctx.fill();
        if (pass === 1 && h0 > 0.25) {
          // Lumps of concrete, brick and the odd bar of rebar on the crest.
          for (let k2 = 0; k2 < 3; k2++) {
            const u = hash(i, k2);
            const z = zB + (zC - zB) * hash(i, k2 + 5);
            const sz = 0.18 + u * 0.35;
            const c = u < 0.3 ? '#a19a8f' : u < 0.55 ? '#7a4a38' : u < 0.8 ? '#6f685f' : '#b9b1a5';
            ctx.fillStyle = c;
            ctx.fillRect(px(x0 + u * cell, z), py(h0 - 0.05, z), sz, sz * 0.7);
          }
          if (hash(i, 31) < 0.1 && h0 > 0.7) {
            ctx.strokeStyle = '#8c5432';
            ctx.lineWidth = 0.05;
            ctx.beginPath();
            const z = zB + (zC - zB) * hash(i, 9);
            ctx.moveTo(px(x0, z), py(h0, z));
            ctx.lineTo(px(x0 + 0.6, z + 0.4), py(h0 + 0.9, z + 0.4));
            ctx.stroke();
          }
        }
      }
    }
    // Front face of the heap.
    ctx.fillStyle = shade(base, 0.72);
    ctx.beginPath();
    let started = false;
    for (let i = i0; i <= i1; i++) {
      const h = (hm[i] as number) * 0.2;
      const x = HEIGHTMAP.minX + i * cell;
      if (!started) {
        ctx.moveTo(px(x, zA), py(0, zA));
        started = true;
      }
      ctx.lineTo(px(x, zA), py(h, zA));
    }
    ctx.lineTo(px(HEIGHTMAP.minX + i1 * cell, zA), py(0, zA));
    ctx.fill();
    void pal;
  }

  // ----------------------------------------------------------- structure

  private pieceDepth(p: PieceDef, D: number): [number, number] {
    switch (p.kind) {
      case 'sign':
        return [0.2, 0.6];
      case 'mast':
        return [D * 0.5 - 0.15, D * 0.5 + 0.15];
      case 'tank':
        return [D * 0.35, D * 0.35 + p.w];
      case 'legs':
        return [D * 0.35 - 0.1, D * 0.35 + p.w + 0.1];
      case 'parapet':
        return [0, 0.35];
      case 'stack':
        return p.label.startsWith('Chimney') ? [D * 0.15, D * 0.15 + 1.4] : [0, D];
      default:
        return [0, D];
    }
  }

  private drawStanding(ctx: Ctx, sim: WreckSim, st: Style, D: number, scale: number, opt: DrawOptions): void {
    const s = sim.state;
    const def = sim.def;
    const prep = this.prep(sim.h);
    const sol = sim.solution;
    const sag = new Float32Array(def.pieces.length);
    for (let i = 0; i < def.pieces.length; i++) sag[i] = Math.min(1, s.strain[i] as number) * 0.25;
    for (const j of def.joints) {
      const k = Math.min(1, s.jointStrain[j.id] as number) * 0.2;
      if (k > 0 && s.jointOk[j.id] && (sag[j.a] as number) < k) sag[j.a] = k;
    }
    for (const id of prep.order) {
      if (s.status[id] !== PIECE_STANDING) continue;
      let inherited = 0;
      for (const jid of sim.h.adj.joints[id] as number[]) {
        if (!s.jointOk[jid]) continue;
        const j = def.joints[jid];
        if (!j || j.b === GROUND) continue;
        const other = j.a === id ? j.b : j.a;
        if ((sol.dist[other] as number) < (sol.dist[id] as number)) inherited = Math.max(inherited, sag[other] as number);
      }
      if (inherited > (sag[id] as number)) sag[id] = inherited;
    }
    const sign = sim.h.building.sign;
    // Back copies of parapets, so open decks read as decks.
    for (const id of prep.order) {
      const p = def.pieces[id] as PieceDef;
      if (p.kind !== 'parapet' || s.status[id] !== PIECE_STANDING) continue;
      box(ctx, p.x, p.y - (sag[id] as number), p.w, p.h, D - 0.35, D, { front: shade(baseColor(p, st), 0.85) });
    }
    for (const id of prep.order) {
      if (s.status[id] !== PIECE_STANDING) continue;
      const p = def.pieces[id] as PieceDef;
      const strain = s.strain[id] as number;
      const ox = strain > 0.45 ? Math.sin(opt.time * 70 + p.seed) * 0.035 * strain : 0;
      const x = p.x + ox;
      const y = p.y - (sag[id] as number);
      const [z0, z1] = this.pieceDepth(p, D);
      // Which part of the right face is open to view.
      const open: Array<[number, number]> | 'all' = openIntervals(p, prep.right[id] as number[], s.status, def.pieces);
      this.piece(ctx, p, x, y, z0, z1, st, scale, sim.h.building.id, sign, open, opt.stress ? stressOf(sim, id) : -1);
      if (p.hp > 0) drawDamage(ctx, p, x, y, 1 - Math.max(0, s.hp[id] as number) / p.hp, scale);
    }
    // Joints giving way: a glow that means "this is about to go", and the crack.
    for (const j of def.joints) {
      const strain = s.jointStrain[j.id] as number;
      if (!s.jointOk[j.id] || strain <= 0.03) continue;
      const pa = def.pieces[j.a] as PieceDef;
      if (!pa.carriesOthers || s.status[j.a] !== PIECE_STANDING) continue;
      if (j.b !== GROUND && s.status[j.b] !== PIECE_STANDING) continue;
      const k = Math.min(1, strain);
      const y = j.y - (sag[j.a] as number);
      ctx.fillStyle = `rgba(${k > 0.6 ? '255,92,48' : '255,186,40'},${0.3 + k * 0.5})`;
      ctx.beginPath();
      ctx.arc(j.x, y, 0.25 + k * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < def.pieces.length; i++) {
      if (s.status[i] !== PIECE_STANDING) continue;
      const strain = s.strain[i] as number;
      if (strain < 0.08) continue;
      const p = def.pieces[i] as PieceDef;
      ctx.fillStyle = `rgba(255,${strain > 0.6 ? 92 : 170},40,${0.12 + strain * 0.3})`;
      ctx.fillRect(p.x, p.y - (sag[i] as number), p.w, p.h);
    }
  }

  private piece(ctx: Ctx, p: PieceDef, x: number, y: number, z0: number, z1: number, st: Style, scale: number, id: string, sign: string | undefined, open: Array<[number, number]> | 'all', stress: number): void {
    const front = baseColor(p, st);
    const top = topColor(p, st, front);
    if (p.kind === 'gable') {
      prism(ctx, [x, y, x + p.w, y, x + p.w / 2, y + p.h], z0, z1, { front, top });
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + p.w, y);
      ctx.lineTo(x + p.w / 2, y + p.h);
      ctx.clip();
      drawFacade(ctx, p, x, y, st, scale, id);
      ctx.restore();
      return;
    }
    if (p.kind === 'legs') {
      for (const lx of [x + 0.15, x + p.w - 0.35]) box(ctx, lx, y, 0.2, p.h, z0, z1, { front: st.steel });
      box(ctx, x, y + p.h - 0.25, p.w, 0.25, z0, z1, { front: shade(st.steel, 0.8) });
      ctx.strokeStyle = st.steel;
      ctx.lineWidth = 0.1;
      ctx.beginPath();
      ctx.moveTo(x + 0.25, y);
      ctx.lineTo(x + p.w - 0.25, y + p.h - 0.25);
      ctx.moveTo(x + p.w - 0.25, y);
      ctx.lineTo(x + 0.25, y + p.h - 0.25);
      ctx.stroke();
      return;
    }
    if (p.kind === 'tank') {
      box(ctx, x + 0.1, y, p.w - 0.2, p.h - 0.9, z0, z1, { front, top: shade(front, 1.1) });
      prism(ctx, [x - 0.1, y + p.h - 0.9, x + p.w + 0.1, y + p.h - 0.9, x + p.w / 2, y + p.h], z0, z1, { front: '#4f3826', top: '#5f4430' });
      drawFacade(ctx, p, x, y, st, scale, id);
      return;
    }
    if (open === 'all') {
      box(ctx, x, y, p.w, p.h, z0, z1, { front, top });
    } else {
      box(ctx, x, y, p.w, p.h, z0, z1, { front, top }, true);
      if (open.length) {
        ctx.fillStyle = shade(front, 0.68);
        for (const [a, b] of open) {
          const ya = a - p.y + y;
          const yb = b - p.y + y;
          ctx.beginPath();
          ctx.moveTo(px(x + p.w, z0), py(ya, z0));
          ctx.lineTo(px(x + p.w, z0), py(yb, z0));
          ctx.lineTo(px(x + p.w, z1), py(yb, z1));
          ctx.lineTo(px(x + p.w, z1), py(ya, z1));
          ctx.fill();
        }
      }
    }
    if (z0 !== 0) {
      ctx.save();
      ctx.translate(z0 * KX, z0 * KY);
      drawFacade(ctx, p, x, y, st, scale, id, sign);
      ctx.restore();
    } else drawFacade(ctx, p, x, y, st, scale, id, sign);
    if (stress >= 0.3) {
      const k = Math.min(1, (stress - 0.3) / 0.7);
      ctx.fillStyle = stress >= 1 ? `rgba(255,70,40,${0.35 + k * 0.4})` : `rgba(255,${Math.round(220 - k * 120)},40,${0.15 + k * 0.45})`;
      ctx.fillRect(x, y, p.w, p.h);
    }
  }

  private drawBody(ctx: Ctx, sim: WreckSim, b: Body, st: Style, D: number, scale: number): void {
    const cos = Math.cos(b.a);
    const sin = Math.sin(b.a);
    const id = sim.h.building.id;
    const order = b.pieces.map((pid, k) => ({ pid, k })).filter((e) => e.pid >= 0 && sim.state.status[e.pid] === PIECE_FALLING);
    order.sort((a, c) => (b.ly[a.k] as number) * cos + (b.lx[a.k] as number) * sin - ((b.ly[c.k] as number) * cos + (b.lx[c.k] as number) * sin));
    for (const { pid, k } of order) {
      const p = sim.def.pieces[pid] as PieceDef;
      const lx = b.lx[k] as number;
      const ly = b.ly[k] as number;
      const cx = b.x + lx * cos - ly * sin;
      const cy = b.y + lx * sin + ly * cos;
      const [z0, z1] = this.pieceDepth(p, D);
      const front = baseColor(p, st);
      prism(ctx, rotRect(cx, cy, p.w, p.h, b.a), z0, z1, { front, top: topColor(p, st, front) });
      if (scale > 5 && p.kind !== 'sign') {
        ctx.save();
        ctx.translate(px(cx, z0), py(cy, z0));
        ctx.rotate(b.a);
        drawFacade(ctx, p, -p.w / 2, -p.h / 2, st, scale * 0.6, id);
        ctx.restore();
      }
    }
  }

  /** Members lying where their section came down, half sunk in the heap. */
  private drawWreck(ctx: Ctx, sim: WreckSim, st: Style, D: number, scale: number): void {
    const hm = sim.state.heightmap;
    for (const w of sim.state.wreck) {
      const p = sim.def.pieces[w.piece] as PieceDef;
      const y = w.y + (heightAt(hm, w.x) - w.g);
      const u = hash(p.seed, 4);
      const z0 = u * D * 0.45;
      const z1 = z0 + D * (0.3 + hash(p.seed, 6) * 0.35);
      const front = shade(baseColor(p, st), 0.9);
      prism(ctx, rotRect(w.x, y, p.w, Math.min(p.h, 3.2), w.a), z0, z1, { front });
      void scale;
    }
  }

  private drawBlocks(ctx: Ctx, sim: WreckSim, D: number, time: number): void {
    for (const b of sim.state.blocks) {
      if (b.kind === 'vault') {
        this.prize(ctx, sim, b, D, time);
        continue;
      }
      const z0 = D * 0.25;
      const z1 = z0 + Math.min(D * 0.6, b.w * 0.9);
      const heavy = b.mass > sim.state.kit.heavyPush;
      const col = b.kind === 'steel' ? '#6d7a83' : heavy ? '#9a948a' : '#b0a99c';
      prism(ctx, rotRect(b.x, b.y + b.h / 2, b.w, b.h, ((b.seed % 7) - 3) * 0.03), z0, z1, { front: col });
      if (b.kind === 'steel') {
        ctx.fillStyle = '#4a555c';
        ctx.fillRect(b.x - b.w / 2, b.y + b.h * 0.35, b.w, b.h * 0.3);
      } else if (heavy) {
        // Heavy slabs carry a hatch so you can tell them from the rest.
        ctx.strokeStyle = 'rgba(60,50,44,0.45)';
        ctx.lineWidth = 0.08;
        ctx.beginPath();
        for (let x = b.x - b.w / 2 + 0.3; x < b.x + b.w / 2; x += 0.6) {
          ctx.moveTo(x, b.y + 0.1);
          ctx.lineTo(x + 0.4, b.y + b.h - 0.1);
        }
        ctx.stroke();
      }
    }
  }

  private prize(ctx: Ctx, sim: WreckSim, b: Block, D: number, time: number): void {
    const look = sim.h.building.prize?.look ?? 'safe';
    const z0 = D * 0.3;
    const glow = 0.5 + Math.sin(time * 4) * 0.5;
    if (look === 'bell') {
      prism(ctx, [b.x - b.w / 2, b.y, b.x + b.w / 2, b.y, b.x + b.w * 0.32, b.y + b.h * 0.75, b.x, b.y + b.h, b.x - b.w * 0.32, b.y + b.h * 0.75], z0, z0 + b.w, { front: '#b8873a', top: '#d4a457' });
    } else {
      box(ctx, b.x - b.w / 2, b.y, b.w, b.h, z0, z0 + b.w * 0.9, { front: '#3c4449' });
      ctx.fillStyle = '#c9a75a';
      ctx.beginPath();
      ctx.arc(px(b.x, z0), py(b.y + b.h * 0.55, z0), Math.min(b.w, b.h) * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = `rgba(242,183,5,${0.35 + glow * 0.4})`;
    ctx.lineWidth = 0.12;
    ctx.strokeRect(px(b.x - b.w / 2 - 0.3, z0), py(b.y - 0.2, z0), b.w + 0.6, b.h + 0.5);
  }

  // ------------------------------------------------------------ markers

  private drawCharges(ctx: Ctx, sim: WreckSim, time: number): void {
    const s = sim.state;
    let n = 0;
    for (const c of s.charges) {
      if (c.state === 2) continue;
      n++;
      const pos = chargePos(sim, c);
      const blink = c.state === 1 ? Math.sin(time * 30) > 0 : Math.sin(time * 5 + c.id) > 0.3;
      const col = c.kind === 'shaped' ? '#c43b2f' : c.kind === 'blast' ? '#d9822b' : '#e0b130';
      box(ctx, pos.x - 0.35, pos.y - 0.45, 0.7, 0.9, -0.35, 0.05, { front: col });
      ctx.fillStyle = blink ? '#ff3b1f' : '#5a1a10';
      ctx.fillRect(pos.x - 0.1, pos.y + 0.18, 0.2, 0.16);
      worldText(ctx, String(n), px(pos.x, -0.35), py(pos.y - 0.12, -0.35), 0.5, '#1b1b1b');
    }
  }

  private drawFlaws(ctx: Ctx, sim: WreckSim, cam: Camera, time: number): void {
    const s = sim.state;
    for (const id of sim.h.flaws) {
      if (s.flaw[id] !== FLAW_SHOWN || s.status[id] !== PIECE_STANDING) continue;
      const p = sim.def.pieces[id] as PieceDef;
      const q = cam.worldToScreen(p.x + p.w / 2, p.y + p.h * 0.5);
      const r = 8 + Math.sin(time * 4) * 1.2;
      ctx.fillStyle = 'rgba(20,20,20,0.75)';
      ctx.beginPath();
      ctx.moveTo(q.x, q.y - r - 2);
      ctx.lineTo(q.x + r + 2, q.y);
      ctx.lineTo(q.x, q.y + r + 2);
      ctx.lineTo(q.x - r - 2, q.y);
      ctx.fill();
      ctx.fillStyle = '#f2b705';
      ctx.beginPath();
      ctx.moveTo(q.x, q.y - r);
      ctx.lineTo(q.x + r, q.y);
      ctx.lineTo(q.x, q.y + r);
      ctx.lineTo(q.x - r, q.y);
      ctx.fill();
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(q.x - 1.1, q.y - 5, 2.2, 6);
      ctx.fillRect(q.x - 1.1, q.y + 2.5, 2.2, 2.2);
    }
  }

  private drawFloaters(ctx: Ctx, cam: Camera, floaters: Floater[], now: number): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of floaters) {
      const age = (now - f.born) / 1000;
      if (age > 1.8) continue;
      const q = cam.worldToScreen(f.x, f.y);
      const a = age < 1.2 ? 1 : 1 - (age - 1.2) / 0.6;
      const size = f.big ? 26 : 17;
      ctx.font = `800 ${size}px ${FONT}`;
      ctx.globalAlpha = a;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(16,16,16,0.85)';
      const y = q.y - age * 34;
      ctx.strokeText(f.text, q.x, y);
      ctx.fillStyle = f.tone === 'gold' ? '#f7c531' : f.tone === 'red' ? '#ff7a59' : f.tone === 'green' ? '#a8dd7a' : '#ffffff';
      ctx.fillText(f.text, q.x, y);
    }
    ctx.globalAlpha = 1;
  }

  private outline(ctx: Ctx, sim: WreckSim, id: number, D: number, color: string, width: number): void {
    const p = sim.def.pieces[id];
    if (!p || sim.state.status[id] !== PIECE_STANDING) return;
    const [z0, z1] = this.pieceDepth(p, D);
    // The face you tapped, tinted, with its top and side edges traced.
    const x0 = px(p.x, z0);
    const y0 = py(p.y, z0);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(x0, y0, p.w, p.h);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.strokeRect(x0, y0, p.w, p.h);
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + p.h);
    ctx.lineTo(px(p.x, z1), py(p.y + p.h, z1));
    ctx.lineTo(px(p.x + p.w, z1), py(p.y + p.h, z1));
    ctx.lineTo(x0 + p.w, y0 + p.h);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------- preview

  private drawPlan(ctx: Ctx, sim: WreckSim, plan: MovePlan, D: number, time: number): void {
    const pulse = 0.5 + Math.sin(time * 6) * 0.5;
    const tone = !plan.ok ? '#ff6b4a' : plan.verdict === 'breaks' ? '#ffd23f' : plan.verdict === 'heavy' ? '#ffb03a' : '#e8e2d4';
    if (plan.affected) for (const id of plan.affected) this.outline(ctx, sim, id, D, 'rgba(255,170,60,0.85)', 0.1);
    if (plan.piece !== undefined && plan.piece >= 0) this.outline(ctx, sim, plan.piece, D, tone, 0.18 + pulse * 0.08);
    if (plan.path && plan.path.length > 3) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 0.14;
      ctx.setLineDash([0.5, 0.45]);
      ctx.beginPath();
      for (let i = 0; i < plan.path.length; i += 2) {
        const x = plan.path[i] as number;
        const y = plan.path[i + 1] as number;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (plan.release) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 0.1;
        ctx.beginPath();
        ctx.arc(plan.release.bx, plan.release.by, sim.ballR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(plan.release.hx, plan.release.hy);
        ctx.lineTo(plan.release.bx, plan.release.by);
        ctx.stroke();
      }
    }
    if (plan.hitX !== undefined && plan.hitY !== undefined) {
      const r = (plan.radius ?? 0.7) + pulse * 0.15;
      ctx.strokeStyle = tone;
      ctx.lineWidth = 0.16;
      ctx.beginPath();
      ctx.arc(plan.hitX, plan.hitY, r, 0, Math.PI * 2);
      ctx.stroke();
      if (plan.radius) {
        ctx.fillStyle = 'rgba(255,140,50,0.14)';
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(plan.hitX - 0.5, plan.hitY);
      ctx.lineTo(plan.hitX + 0.5, plan.hitY);
      ctx.moveTo(plan.hitX, plan.hitY - 0.5);
      ctx.lineTo(plan.hitX, plan.hitY + 0.5);
      ctx.stroke();
    }
    if (plan.jaw) {
      ctx.strokeStyle = tone;
      ctx.lineWidth = 0.16;
      ctx.beginPath();
      ctx.arc(plan.jaw.x, plan.jaw.y, 0.9 + pulse * 0.2, 0, Math.PI * 2);
      ctx.stroke();
      // Ghost of where the excavator will stand.
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.setLineDash([0.4, 0.3]);
      ctx.lineWidth = 0.1;
      ctx.strokeRect(px(plan.jaw.standX - 3.2, -1.6), py(0, -1.6), 6.4, 3.6);
      ctx.setLineDash([]);
    }
    if (plan.arrow) this.groundArrow(ctx, plan.arrow.from, plan.arrow.stop, tone, plan.arrow.stop !== plan.arrow.to);
    if (plan.scoop) {
      const sc = plan.scoop;
      ctx.strokeStyle = tone;
      ctx.lineWidth = 0.16;
      ctx.strokeRect(px(sc.x - sc.half, -1.6), py(0, -1.6), sc.half * 2, Math.max(1.2, heightAt(sim.state.heightmap, sc.x) + 0.6));
      this.groundArrow(ctx, sc.x, sc.dumpX, 'rgba(255,255,255,0.75)', false);
    }
  }

  private groundArrow(ctx: Ctx, from: number, to: number, color: string, blocked: boolean): void {
    const z = -1.6;
    const dir = Math.sign(to - from) || 1;
    const y = 0.05;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.9;
    const w = 0.5;
    const tip = to;
    const neck = tip - dir * 1.4;
    ctx.beginPath();
    ctx.moveTo(px(from, z - w), py(y, z - w));
    ctx.lineTo(px(neck, z - w), py(y, z - w));
    ctx.lineTo(px(neck, z - w * 2.4), py(y, z - w * 2.4));
    ctx.lineTo(px(tip, z), py(y, z));
    ctx.lineTo(px(neck, z + w * 2.4), py(y, z + w * 2.4));
    ctx.lineTo(px(neck, z + w), py(y, z + w));
    ctx.lineTo(px(from, z + w), py(y, z + w));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    if (blocked) {
      ctx.strokeStyle = '#ff6b4a';
      ctx.lineWidth = 0.22;
      ctx.beginPath();
      ctx.moveTo(px(tip + dir * 0.4, z - 1.2), py(0.4, z - 1.2));
      ctx.lineTo(px(tip + dir * 0.4, z + 1.2), py(0.4, z + 1.2));
      ctx.stroke();
    }
  }
}

/** Parts of a piece's right face not covered by standing neighbours. */
function openIntervals(p: PieceDef, right: number[], status: Uint8Array, pieces: PieceDef[]): Array<[number, number]> {
  let open: Array<[number, number]> = [[p.y, p.y + p.h]];
  for (const id of right) {
    if (status[id] !== PIECE_STANDING) continue;
    const q = pieces[id] as PieceDef;
    const q0 = q.y;
    const q1 = q.y + q.h;
    const next: Array<[number, number]> = [];
    for (const [a, b] of open) {
      if (q1 <= a || q0 >= b) {
        next.push([a, b]);
        continue;
      }
      if (q0 > a) next.push([a, q0]);
      if (q1 < b) next.push([q1, b]);
    }
    open = next;
    if (!open.length) break;
  }
  return open.filter(([a, b]) => b - a > 0.05);
}

function stressOf(sim: WreckSim, id: number): number {
  const p = sim.def.pieces[id] as PieceDef;
  if (!p.carriesOthers) return -1;
  let stress = sim.solution.pieceStress[id] as number;
  for (const jid of sim.h.adj.joints[id] as number[]) {
    const j = sim.def.joints[jid];
    if (j && j.a === id && sim.state.jointOk[jid]) stress = Math.max(stress, sim.solution.jointStress[jid] as number);
  }
  return stress;
}

function collateralNear(sim: WreckSim): number {
  const hm = sim.state.heightmap;
  const nx = sim.h.site.neighbourX;
  let a = 0;
  for (let i = Math.ceil((nx - HEIGHTMAP.minX) / HEIGHTMAP.cell); i < hm.length; i++) a += (hm[i] as number) * HEIGHTMAP.cell;
  return a;
}

function convexHull(points: Array<[number, number]>): Array<[number, number]> {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2] as [number, number], lower[lower.length - 1] as [number, number], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Array<[number, number]> = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i] as [number, number];
    while (upper.length >= 2 && cross(upper[upper.length - 2] as [number, number], upper[upper.length - 1] as [number, number], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
