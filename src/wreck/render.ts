import type { Camera } from '../render/camera';
import type { WreckFx } from './fx';
import { BALL_R, HEIGHTMAP, PIECE_FALLING, PIECE_STANDING, craneFoot, craneHook, type Prediction, type WreckSim } from './sim';
import { GROUND, type PieceDef } from './structure';
import { drawBlocks, drawChargeMarks, drawChargeTargets, drawDozer, drawExcavator, drawFlawMarks, drawFloaters, drawNeighbour, drawSiteMarks, drawToolMarks, type Floater } from './render-site';
import type { Tool } from './tools';

/**
 * Canvas renderer for the wrecking-ball slice. Draws in world metres with a
 * y-up transform; everything structural comes straight from the simulation.
 */

export interface DrawOptions {
  time: number;
  prediction?: Prediction;
  stressView: boolean;
  /** Show the grab rings on the hook and the ball. */
  handles: boolean;
  /** Which handle the finger holds. */
  holding?: 'ball' | 'hook';
  /** Pieces to outline (the replay's decisive hit). */
  highlight?: number;
  /** The tool in hand: decides which guides are drawn. */
  tool?: Tool;
  floaters?: Floater[];
  /** performance.now(), for the floaters. */
  now?: number;
  /** Draw the job site (pad, pit, machines, charges). Off for the bare title hero. */
  site?: boolean;
}

const C = {
  skyTop: '#101722',
  skyMid: '#252c3a',
  skyLow: '#5b4a43',
  horizon: '#9a6e4f',
  farA: '#1e2632',
  farB: '#283140',
  farWin: '#3f4a5a',
  ground: '#2a2521',
  groundTop: '#3a332d',
  rubble: '#6f675e',
  rubbleTop: '#8d857a',
  concrete: '#a29c92',
  concreteShade: '#7b766e',
  slab: '#b5aea3',
  slabEdge: '#8a847b',
  core: '#8a847b',
  glassTop: '#41566a',
  glassLow: '#243241',
  mullion: '#6f7c87',
  brick: '#8a4a35',
  mortar: '#6b3727',
  sill: '#c4b49b',
  steel: '#58646c',
  steelDark: '#39424a',
  wood: '#7a5636',
  ply: '#a5814e',
  crack: '#2b2622',
  rebar: '#9b6440',
  strain: '255,176,32',
  fail: '255,90,54',
  crane: '#e1a623',
  craneShade: '#a8791a',
  cable: '#15171a',
  ball: '#2c2f34',
};

export class WreckRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  width = 1;
  height = 1;
  dpr = 1;
  private skyline: Array<{ x: number; w: number; h: number; layer: number; seed: number }> = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let layer = 0; layer < 2; layer++) {
      let x = -260;
      while (x < 340) {
        const w = 8 + rnd() * 22;
        const h = (layer === 0 ? 20 : 12) + rnd() * (layer === 0 ? 60 : 40);
        this.skyline.push({ x, w, h, layer, seed: Math.floor(rnd() * 1e6) });
        x += w + rnd() * 6;
      }
    }
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

  draw(sim: WreckSim, cam: Camera, fx: WreckFx, opt: DrawOptions): void {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const s = cam.drawScale;
    const o = cam.worldToScreen(0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawSky(ctx, o.y);
    this.drawSkyline(ctx, cam);
    ctx.setTransform(s * dpr, 0, 0, -s * dpr, o.x * dpr, o.y * dpr);
    const view = {
      minX: cam.screenToWorld(0, 0).x,
      maxX: cam.screenToWorld(this.width, 0).x,
      minY: cam.screenToWorld(0, this.height).y,
      maxY: cam.screenToWorld(0, 0).y,
    };
    const site = opt.site !== false;
    const tool = opt.tool ?? 'ball';
    if (site) drawNeighbour(ctx, s);
    this.drawGround(ctx, view, sim);
    if (site) {
      drawSiteMarks(ctx, s, sim);
      drawBlocks(ctx, sim, s, 'vault', tool, opt.time);
    }
    this.drawRubble(ctx, view, sim);
    if (site) drawBlocks(ctx, sim, s, 'debris', tool, opt.time);
    const detail = s;
    // Settled sections first, then the standing building, then anything in motion.
    for (const b of sim.state.bodies) if (b.state === 'rubble') this.drawBody(ctx, sim, b, detail, opt);
    this.drawStanding(ctx, sim, detail, opt);
    if (site && tool === 'charge') drawChargeTargets(ctx, sim, s);
    for (const b of sim.state.bodies) if (b.state !== 'rubble') this.drawBody(ctx, sim, b, detail, opt);
    if (site) {
      drawExcavator(ctx, sim, s, opt.time, tool === 'excavator');
      drawDozer(ctx, sim, s, opt.time, tool === 'dozer');
    }
    fx.drawChunks(ctx, s);
    this.drawCrane(ctx, sim, s, opt);
    fx.drawDust(ctx);
    if (fx.flash > 0) {
      ctx.globalAlpha = fx.flash * 0.6;
      ctx.fillStyle = '#fff6e0';
      ctx.beginPath();
      ctx.arc(fx.flashX, fx.flashY, 1.2 + fx.flash * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (opt.prediction) this.drawPrediction(ctx, sim, opt.prediction, s);
    if (opt.highlight !== undefined && opt.highlight >= 0) this.drawHighlight(ctx, sim, opt.highlight, s, opt.time);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (site) {
      drawFlawMarks(ctx, sim, cam, opt.time);
      drawChargeMarks(ctx, sim, cam, opt.time);
      if (opt.handles) drawToolMarks(ctx, sim, cam, tool);
    }
    if (opt.handles && tool === 'ball') this.drawHandles(ctx, sim, cam, opt);
    if (opt.floaters?.length) drawFloaters(ctx, cam, opt.floaters, opt.now ?? 0);
  }

  // ----------------------------------------------------------- backdrop

  private drawSky(ctx: CanvasRenderingContext2D, groundY: number): void {
    const g = ctx.createLinearGradient(0, 0, 0, Math.max(groundY, 10));
    g.addColorStop(0, C.skyTop);
    g.addColorStop(0.55, C.skyMid);
    g.addColorStop(0.88, C.skyLow);
    g.addColorStop(1, C.horizon);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private drawSkyline(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const ground = cam.worldToScreen(0, 0).y;
    for (const layer of [0, 1]) {
      // Distant blocks move less than the site: parallax sells the size of the building.
      const k = layer === 0 ? 0.35 : 0.55;
      const scale = cam.drawScale * k;
      const cx = this.width / 2 - cam.x * scale;
      ctx.fillStyle = layer === 0 ? C.farA : C.farB;
      for (const b of this.skyline) {
        if (b.layer !== layer) continue;
        const x = cx + b.x * scale;
        const w = b.w * scale;
        if (x + w < 0 || x > this.width) continue;
        const h = b.h * scale;
        ctx.fillRect(x, ground - h, w + 0.5, h);
        if (layer === 1 && scale > 2.2) {
          ctx.fillStyle = C.farWin;
          let r = b.seed;
          for (let wy = 3; wy < b.h - 2; wy += 3.4) {
            for (let wx = 1.5; wx < b.w - 1; wx += 2.6) {
              r = (r * 1103515245 + 12345) & 0x7fffffff;
              if (r % 7 === 0) ctx.fillRect(x + wx * scale, ground - wy * scale, scale * 0.9, scale * 1.1);
            }
          }
          ctx.fillStyle = C.farB;
        }
      }
    }
  }

  private drawGround(ctx: CanvasRenderingContext2D, v: { minX: number; maxX: number; minY: number }, _sim: WreckSim): void {
    ctx.fillStyle = C.ground;
    ctx.fillRect(v.minX - 5, Math.min(-1, v.minY - 5), v.maxX - v.minX + 10, -Math.min(-1, v.minY - 5));
    ctx.fillStyle = C.groundTop;
    ctx.fillRect(v.minX - 5, -0.35, v.maxX - v.minX + 10, 0.35);
    // Site hoarding behind the lot.
    ctx.fillStyle = '#353029';
    for (let x = Math.floor(v.minX / 3) * 3; x < v.maxX; x += 3) {
      if (x > -50 && x < 90) continue;
      ctx.fillRect(x, 0, 2.9, 2.2);
    }
    ctx.fillStyle = '#4a4238';
    for (let x = Math.floor(v.minX / 3) * 3; x < v.maxX; x += 3) {
      if (x > -50 && x < 90) continue;
      ctx.fillRect(x, 2.05, 2.9, 0.15);
    }
  }

  private drawRubble(ctx: CanvasRenderingContext2D, v: { minX: number; maxX: number }, sim: WreckSim): void {
    const hm = sim.state.heightmap;
    const cell = HEIGHTMAP.cell;
    const i0 = Math.max(0, Math.floor((v.minX - HEIGHTMAP.minX) / cell) - 1);
    const i1 = Math.min(hm.length - 1, Math.ceil((v.maxX - HEIGHTMAP.minX) / cell) + 1);
    let any = false;
    for (let i = i0; i <= i1; i++) if ((hm[i] as number) > 0.02) any = true;
    if (!any) return;
    ctx.fillStyle = C.rubble;
    ctx.beginPath();
    ctx.moveTo(HEIGHTMAP.minX + i0 * cell, 0);
    for (let i = i0; i <= i1; i++) ctx.lineTo(HEIGHTMAP.minX + i * cell, hm[i] as number);
    ctx.lineTo(HEIGHTMAP.minX + i1 * cell, 0);
    ctx.closePath();
    ctx.fill();
    // Lumps and rebar along the crest.
    for (let i = i0; i <= i1; i++) {
      const h = hm[i] as number;
      if (h < 0.15) continue;
      const x = HEIGHTMAP.minX + i * cell;
      const r = ((i * 2654435761) >>> 0) % 1000;
      ctx.fillStyle = r % 3 === 0 ? C.rubbleTop : r % 3 === 1 ? '#5c554d' : '#a09687';
      const sz = 0.25 + (r % 7) * 0.08;
      ctx.fillRect(x - sz / 2, h - sz * 0.7, sz, sz * 0.8);
      if (r % 11 === 0 && h > 0.8) {
        ctx.strokeStyle = C.rebar;
        ctx.lineWidth = 0.06;
        ctx.beginPath();
        ctx.moveTo(x, h - 0.2);
        ctx.lineTo(x + ((r % 5) - 2) * 0.25, h + 0.6);
        ctx.stroke();
      }
    }
  }

  // ---------------------------------------------------------- structure

  private drawStanding(ctx: CanvasRenderingContext2D, sim: WreckSim, scale: number, opt: DrawOptions): void {
    const st = sim.state;
    const def = sim.def;
    const sol = sim.solution;
    // Strain shows as sag: a piece that is giving way sinks a little, and drags what it carries with it.
    const sag = new Float32Array(def.pieces.length);
    for (let i = 0; i < def.pieces.length; i++) sag[i] = Math.min(1, st.strain[i] as number) * 0.22;
    for (const j of def.joints) {
      const k = Math.min(1, st.jointStrain[j.id] as number) * 0.18;
      if (k <= 0 || !st.jointOk[j.id]) continue;
      if ((sag[j.a] as number) < k) sag[j.a] = k;
    }
    // Carried pieces inherit the sag of their supports (one pass, from the ground up is close enough).
    const order = def.pieces.map((p) => p.id).sort((a, b) => (def.pieces[a] as PieceDef).y - (def.pieces[b] as PieceDef).y);
    for (const id of order) {
      if (st.status[id] !== PIECE_STANDING) continue;
      let inherited = 0;
      for (const jid of sim.h.adj.joints[id] as number[]) {
        if (!st.jointOk[jid]) continue;
        const j = def.joints[jid];
        if (!j || j.b === GROUND) continue;
        const other = j.a === id ? j.b : j.a;
        if ((sol.dist[other] as number) < (sol.dist[id] as number)) inherited = Math.max(inherited, sag[other] as number);
      }
      if (inherited > (sag[id] as number)) sag[id] = inherited;
    }
    for (const p of def.pieces) {
      if (st.status[p.id] !== PIECE_STANDING) continue;
      const strain = st.strain[p.id] as number;
      let ox = 0;
      if (strain > 0.5) ox = Math.sin(opt.time * 70 + p.seed) * 0.03 * strain;
      this.drawPiece(ctx, sim, p, p.x + ox, p.y - (sag[p.id] as number), scale, opt);
    }
    // Joints giving way: hairline cracks and a glow that means "this is about to go".
    for (const j of def.joints) {
      const strain = st.jointStrain[j.id] as number;
      if (!st.jointOk[j.id] || strain <= 0.02) continue;
      const a = st.status[j.a] === PIECE_STANDING;
      const b = j.b === GROUND || st.status[j.b] === PIECE_STANDING;
      if (!a || !b) continue;
      const pa = def.pieces[j.a] as PieceDef;
      if (!pa.carriesOthers) continue;
      const k = Math.min(1, strain);
      const y = j.y - (sag[j.a] as number);
      ctx.fillStyle = `rgba(${k > 0.6 ? C.fail : C.strain},${0.25 + k * 0.5})`;
      ctx.beginPath();
      ctx.arc(j.x, y, 0.25 + k * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = C.crack;
      ctx.lineWidth = 0.05 + k * 0.05;
      ctx.beginPath();
      const r = j.id * 7919;
      ctx.moveTo(j.x - 0.5 * k, y + ((r % 5) - 2) * 0.1);
      ctx.lineTo(j.x, y);
      ctx.lineTo(j.x + 0.6 * k, y - ((r % 3) - 1) * 0.2 * k);
      ctx.stroke();
    }
    if (opt.stressView) this.drawStress(ctx, sim, sag);
  }

  private drawStress(ctx: CanvasRenderingContext2D, sim: WreckSim, sag: Float32Array): void {
    const st = sim.state;
    const sol = sim.solution;
    for (const p of sim.def.pieces) {
      if (st.status[p.id] !== PIECE_STANDING || !p.carriesOthers) continue;
      let stress = sol.pieceStress[p.id] as number;
      for (const jid of sim.h.adj.joints[p.id] as number[]) {
        if (st.jointOk[jid] && (sol.jointLoad[jid] as number) > 0) {
          const j = sim.def.joints[jid];
          if (j && j.a === p.id) stress = Math.max(stress, sol.jointStress[jid] as number);
        }
      }
      if (stress < 0.35) continue;
      const k = Math.min(1, (stress - 0.35) / 0.65);
      const col = stress >= 1 ? C.fail : C.strain;
      ctx.fillStyle = `rgba(${col},${0.12 + k * 0.5})`;
      ctx.fillRect(p.x, p.y - (sag[p.id] as number), p.w, p.h);
    }
  }

  private drawBody(ctx: CanvasRenderingContext2D, sim: WreckSim, b: WreckSim['state']['bodies'][number], scale: number, opt: DrawOptions): void {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.a);
    for (let k = 0; k < b.pieces.length; k++) {
      const id = b.pieces[k] as number;
      if (id < 0 || sim.state.status[id] !== PIECE_FALLING) continue;
      const p = sim.def.pieces[id] as PieceDef;
      this.drawPiece(ctx, sim, p, (b.lx[k] as number) - p.w / 2, (b.ly[k] as number) - p.h / 2, scale, opt, b.state === 'rubble');
    }
    ctx.restore();
  }

  private drawPiece(ctx: CanvasRenderingContext2D, sim: WreckSim, p: PieceDef, x: number, y: number, scale: number, opt: DrawOptions, dim = false): void {
    const hpFrac = p.hp > 0 ? Math.max(0, sim.state.hp[p.id] as number) / p.hp : 1;
    const fine = scale > 9;
    const finer = scale > 18;
    switch (p.kind) {
      case 'column': {
        ctx.fillStyle = C.concrete;
        ctx.fillRect(x, y, p.w, p.h);
        ctx.fillStyle = C.concreteShade;
        ctx.fillRect(x + p.w * 0.62, y, p.w * 0.38, p.h);
        if (finer) {
          ctx.fillStyle = 'rgba(0,0,0,0.12)';
          for (let yy = y + 1.2; yy < y + p.h - 0.3; yy += 1.2) ctx.fillRect(x, yy, p.w, 0.03);
        }
        break;
      }
      case 'beam':
      case 'roof': {
        const dock = p.zone === 'dock';
        ctx.fillStyle = dock && p.kind === 'roof' ? '#6b7278' : C.slab;
        ctx.fillRect(x, y, p.w, p.h);
        ctx.fillStyle = C.slabEdge;
        ctx.fillRect(x, y, p.w, p.h * 0.28);
        if (p.kind === 'roof' && !dock) {
          // Parapet cap.
          ctx.fillStyle = '#c9c2b6';
          ctx.fillRect(x, y + p.h - 0.08, p.w, 0.08);
        }
        if (dock && p.kind === 'roof' && fine) {
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          for (let xx = x + 0.3; xx < x + p.w; xx += 0.45) ctx.fillRect(xx, y, 0.06, p.h);
        }
        break;
      }
      case 'glass': {
        const g = ctx.createLinearGradient(0, y, 0, y + p.h);
        g.addColorStop(0, C.glassLow);
        g.addColorStop(1, C.glassTop);
        ctx.fillStyle = g;
        ctx.fillRect(x, y, p.w, p.h);
        const r = p.seed % 100;
        if (r < 9) {
          // Boarded up.
          ctx.fillStyle = C.ply;
          ctx.fillRect(x + 0.1, y + 0.1, p.w - 0.2, p.h - 0.2);
          if (fine) {
            ctx.fillStyle = 'rgba(0,0,0,0.18)';
            ctx.fillRect(x + p.w / 2 - 0.02, y + 0.1, 0.04, p.h - 0.2);
          }
        } else if (r < 15) {
          // Pane already out: dark interior.
          ctx.fillStyle = '#12161c';
          ctx.fillRect(x + 0.08, y + 0.08, p.w - 0.16, p.h - 0.16);
        } else {
          // Reflection band.
          ctx.fillStyle = 'rgba(190,170,150,0.10)';
          ctx.fillRect(x, y + p.h * 0.55, p.w, p.h * 0.18);
        }
        if (fine) {
          ctx.fillStyle = C.mullion;
          const n = 3;
          for (let i = 1; i < n; i++) ctx.fillRect(x + (p.w * i) / n - 0.03, y, 0.06, p.h);
          ctx.fillRect(x, y + p.h * 0.72, p.w, 0.05);
        }
        break;
      }
      case 'shopfront': {
        ctx.fillStyle = '#1a2129';
        ctx.fillRect(x, y, p.w, p.h);
        ctx.fillStyle = 'rgba(160,190,205,0.14)';
        ctx.fillRect(x, y + 0.6, p.w, p.h - 1.6);
        // Awning.
        ctx.fillStyle = (p.seed & 1) === 0 ? '#7c2f22' : '#2f5d4f';
        ctx.fillRect(x - 0.1, y + p.h - 1.0, p.w + 0.2, 0.45);
        if (fine) {
          ctx.fillStyle = '#d8cfbf';
          for (let xx = x; xx < x + p.w; xx += 0.6) ctx.fillRect(xx, y + p.h - 1.0, 0.3, 0.45);
          ctx.fillStyle = C.mullion;
          ctx.fillRect(x + p.w / 2 - 0.03, y, 0.06, p.h - 1.0);
        }
        break;
      }
      case 'brick': {
        ctx.fillStyle = C.brick;
        ctx.fillRect(x, y, p.w, p.h);
        if (finer) {
          ctx.fillStyle = C.mortar;
          for (let yy = y + 0.3; yy < y + p.h; yy += 0.3) ctx.fillRect(x, yy, p.w, 0.03);
        }
        // Window.
        const ww = Math.min(1.6, p.w * 0.5);
        const wh = Math.min(2.2, p.h * 0.55);
        const wx = x + (p.w - ww) / 2;
        const wy = y + p.h * 0.28;
        ctx.fillStyle = '#161a20';
        ctx.fillRect(wx, wy, ww, wh);
        ctx.fillStyle = C.sill;
        ctx.fillRect(wx - 0.12, wy - 0.12, ww + 0.24, 0.12);
        ctx.fillRect(wx - 0.08, wy + wh, ww + 0.16, 0.18);
        if (fine) {
          ctx.fillStyle = '#5a6670';
          ctx.fillRect(wx + ww / 2 - 0.03, wy, 0.06, wh);
          ctx.fillRect(wx, wy + wh * 0.55, ww, 0.05);
        }
        break;
      }
      case 'core': {
        ctx.fillStyle = C.core;
        ctx.fillRect(x, y, p.w, p.h);
        if (fine) {
          ctx.fillStyle = 'rgba(0,0,0,0.14)';
          for (let xx = x + 0.6; xx < x + p.w; xx += 1.1) ctx.fillRect(xx, y, 0.03, p.h);
          ctx.fillStyle = 'rgba(255,255,255,0.05)';
          ctx.fillRect(x, y + p.h - 0.4, p.w, 0.4);
        }
        break;
      }
      case 'truss': {
        ctx.fillStyle = '#2a3036';
        ctx.fillRect(x, y, p.w, p.h);
        ctx.strokeStyle = C.steel;
        ctx.lineWidth = 0.28;
        ctx.strokeRect(x + 0.14, y + 0.14, p.w - 0.28, p.h - 0.28);
        ctx.beginPath();
        ctx.moveTo(x + 0.14, y + 0.14);
        ctx.lineTo(x + p.w - 0.14, y + p.h - 0.14);
        ctx.moveTo(x + 0.14, y + p.h - 0.14);
        ctx.lineTo(x + p.w - 0.14, y + 0.14);
        ctx.stroke();
        break;
      }
      case 'legs': {
        ctx.strokeStyle = C.steel;
        ctx.lineWidth = 0.18;
        ctx.beginPath();
        ctx.moveTo(x + 0.2, y);
        ctx.lineTo(x + 0.5, y + p.h);
        ctx.moveTo(x + p.w - 0.2, y);
        ctx.lineTo(x + p.w - 0.5, y + p.h);
        ctx.moveTo(x + 0.3, y + 0.2);
        ctx.lineTo(x + p.w - 0.4, y + p.h - 0.3);
        ctx.moveTo(x + p.w - 0.3, y + 0.2);
        ctx.lineTo(x + 0.4, y + p.h - 0.3);
        ctx.stroke();
        ctx.fillStyle = C.steelDark;
        ctx.fillRect(x, y + p.h - 0.2, p.w, 0.2);
        break;
      }
      case 'tank': {
        ctx.fillStyle = C.wood;
        ctx.fillRect(x + 0.1, y, p.w - 0.2, p.h - 0.9);
        ctx.fillStyle = '#5a3f27';
        ctx.beginPath();
        ctx.moveTo(x - 0.1, y + p.h - 0.9);
        ctx.lineTo(x + p.w / 2, y + p.h);
        ctx.lineTo(x + p.w + 0.1, y + p.h - 0.9);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#33271c';
        for (let yy = y + 0.5; yy < y + p.h - 1; yy += 0.8) ctx.fillRect(x + 0.05, yy, p.w - 0.1, 0.09);
        if (fine) {
          ctx.fillStyle = 'rgba(0,0,0,0.15)';
          for (let xx = x + 0.4; xx < x + p.w - 0.2; xx += 0.35) ctx.fillRect(xx, y, 0.03, p.h - 0.9);
        }
        break;
      }
      case 'mast': {
        ctx.fillStyle = C.steel;
        ctx.fillRect(x, y, p.w, p.h);
        ctx.fillRect(x - 0.5, y + p.h * 0.6, p.w + 1, 0.08);
        ctx.fillRect(x - 0.3, y + p.h * 0.8, p.w + 0.6, 0.08);
        const on = Math.sin(opt.time * 3) > 0.2;
        if (!dim) {
          ctx.fillStyle = on ? '#ff4a2a' : '#5a1e16';
          ctx.beginPath();
          ctx.arc(x + p.w / 2, y + p.h, 0.28, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'sign': {
        ctx.strokeStyle = C.steelDark;
        ctx.lineWidth = 0.12;
        ctx.beginPath();
        for (let xx = x + 0.4; xx < x + p.w; xx += 1.3) {
          ctx.moveTo(xx, y);
          ctx.lineTo(xx, y + 0.5);
        }
        ctx.stroke();
        ctx.save();
        ctx.translate(x + p.w / 2, y + 0.55);
        ctx.scale(1, -1);
        ctx.font = `800 2.2px 'Avenir Next Condensed', 'Barlow Condensed', 'Arial Narrow', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = dim ? '#8c7a5c' : '#e8d9b8';
        ctx.fillText('HALDEN', 0, 0, p.w);
        ctx.restore();
        break;
      }
    }
    if (hpFrac < 0.92) this.drawDamage(ctx, p, x, y, hpFrac, scale);
    const strain = sim.state.strain[p.id] as number;
    if (strain > 0.02 && sim.state.status[p.id] === PIECE_STANDING) {
      ctx.strokeStyle = `rgba(${strain > 0.6 ? C.fail : C.strain},${0.35 + strain * 0.5})`;
      ctx.lineWidth = Math.max(0.06, 1.5 / scale);
      ctx.strokeRect(x, y, p.w, p.h);
    }
    if (dim) {
      ctx.fillStyle = 'rgba(30,26,22,0.35)';
      ctx.fillRect(x, y, p.w, p.h);
    }
  }

  /** Cracks spread with damage; past half, the cover spalls off and rebar shows. */
  private drawDamage(ctx: CanvasRenderingContext2D, p: PieceDef, x: number, y: number, hpFrac: number, scale: number): void {
    const dmg = 1 - hpFrac;
    let r = p.seed;
    const rnd = (): number => {
      r = (Math.imul(r, 1103515245) + 12345) >>> 0;
      return (r >>> 8) / 16777216;
    };
    if (p.material === 'glass') {
      ctx.strokeStyle = 'rgba(230,240,245,0.55)';
      ctx.lineWidth = Math.max(0.03, 1 / scale);
      const cx = x + p.w * (0.3 + rnd() * 0.4);
      const cy = y + p.h * (0.3 + rnd() * 0.4);
      ctx.beginPath();
      for (let i = 0; i < 5 + dmg * 6; i++) {
        const a = rnd() * Math.PI * 2;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * p.w * 0.6, cy + Math.sin(a) * p.h * 0.5);
      }
      ctx.stroke();
      return;
    }
    if (dmg > 0.45) {
      // Spalled patches with exposed bars.
      ctx.fillStyle = 'rgba(60,54,48,0.85)';
      const n = Math.ceil((dmg - 0.4) * 5);
      for (let i = 0; i < n; i++) {
        const px = x + rnd() * p.w * 0.7;
        const py = y + rnd() * p.h * 0.85;
        const pw = p.w * (0.25 + rnd() * 0.4);
        const ph = Math.min(p.h * 0.3, 0.3 + rnd() * 0.9);
        ctx.fillRect(px, py, pw, ph);
        if (p.material === 'concrete') {
          ctx.fillStyle = C.rebar;
          ctx.fillRect(px + pw * 0.3, py, 0.05, ph);
          ctx.fillStyle = 'rgba(60,54,48,0.85)';
        }
      }
    }
    ctx.strokeStyle = C.crack;
    ctx.lineWidth = Math.max(0.035, 1.1 / scale);
    ctx.beginPath();
    const lines = 1 + Math.floor(dmg * 7);
    for (let i = 0; i < lines; i++) {
      let cx = x + rnd() * p.w;
      let cy = y + rnd() * p.h;
      ctx.moveTo(cx, cy);
      const steps = 2 + Math.floor(dmg * 4);
      for (let k = 0; k < steps; k++) {
        cx = Math.max(x, Math.min(x + p.w, cx + (rnd() - 0.5) * Math.min(1.2, p.w)));
        cy = Math.max(y, Math.min(y + p.h, cy + (rnd() - 0.5) * 1.2));
        ctx.lineTo(cx, cy);
      }
    }
    ctx.stroke();
  }

  // -------------------------------------------------------------- crane

  private drawCrane(ctx: CanvasRenderingContext2D, sim: WreckSim, scale: number, opt: DrawOptions): void {
    const st = sim.state;
    const foot = craneFoot(st.crane);
    const tip = craneHook(st.crane);
    const bx = st.crane.baseX;
    // Tracks and body.
    ctx.fillStyle = '#25272a';
    ctx.beginPath();
    roundRect(ctx, bx - 5.2, 0, 10.4, 1.3, 0.6);
    ctx.fill();
    ctx.fillStyle = '#3b3e42';
    for (let x = bx - 4.6; x < bx + 4.8; x += 0.8) ctx.fillRect(x, 0.15, 0.35, 0.2);
    ctx.fillStyle = C.craneShade;
    ctx.fillRect(bx - 4.2, 1.3, 8.4, 0.5);
    ctx.fillStyle = C.crane;
    ctx.fillRect(bx - 5.6, 1.8, 7.2, 2.6);
    // Counterweight.
    ctx.fillStyle = '#4a4d52';
    ctx.fillRect(bx - 6.4, 1.9, 1.6, 2.2);
    // Cab.
    ctx.fillStyle = C.crane;
    ctx.fillRect(bx + 0.6, 1.8, 2.6, 3.4);
    ctx.fillStyle = '#1d2a33';
    ctx.fillRect(bx + 1.6, 3.2, 1.4, 1.6);
    // A-frame and pendant lines to the tip.
    const ax = bx - 2.6;
    const ay = 8.5;
    ctx.strokeStyle = C.craneShade;
    ctx.lineWidth = 0.3;
    ctx.beginPath();
    ctx.moveTo(bx - 4.5, 4.4);
    ctx.lineTo(ax, ay);
    ctx.lineTo(bx - 0.5, 4.4);
    ctx.stroke();
    ctx.strokeStyle = C.cable;
    ctx.lineWidth = Math.max(0.05, 1 / scale);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(tip.x - 0.4, tip.y + 0.4);
    ctx.stroke();
    // Lattice boom.
    const dx = tip.x - foot.x;
    const dy = tip.y - foot.y;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const half = 0.55;
    ctx.strokeStyle = C.crane;
    ctx.lineWidth = 0.22;
    ctx.beginPath();
    ctx.moveTo(foot.x + nx * half, foot.y + ny * half);
    ctx.lineTo(tip.x + nx * half * 0.6, tip.y + ny * half * 0.6);
    ctx.moveTo(foot.x - nx * half, foot.y - ny * half);
    ctx.lineTo(tip.x - nx * half * 0.6, tip.y - ny * half * 0.6);
    ctx.stroke();
    if (scale > 3.5) {
      ctx.lineWidth = 0.1;
      ctx.strokeStyle = C.craneShade;
      ctx.beginPath();
      const step = 1.6;
      let side = 1;
      for (let d = 0; d < len - 0.5; d += step) {
        const w0 = half * (1 - (0.4 * d) / len);
        const w1 = half * (1 - (0.4 * (d + step)) / len);
        ctx.moveTo(foot.x + ux * d + nx * w0 * side, foot.y + uy * d + ny * w0 * side);
        ctx.lineTo(foot.x + ux * (d + step) - nx * w1 * side, foot.y + uy * (d + step) - ny * w1 * side);
        side = -side;
      }
      ctx.stroke();
    }
    // Sheave at the tip.
    ctx.fillStyle = '#2f3236';
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 0.55, 0, Math.PI * 2);
    ctx.fill();
    // Cable and ball.
    const ball = st.ball;
    const slack = Math.max(0, ball.cable - Math.hypot(ball.x - tip.x, ball.y - tip.y));
    ctx.strokeStyle = C.cable;
    ctx.lineWidth = Math.max(0.07, 1.4 / scale);
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    if (slack > 0.2) {
      const mx = (tip.x + ball.x) / 2;
      const my = (tip.y + ball.y) / 2 - slack * 0.5;
      ctx.quadraticCurveTo(mx, my, ball.x, ball.y + BALL_R);
    } else ctx.lineTo(ball.x, ball.y + BALL_R);
    ctx.stroke();
    // Chain shackle.
    ctx.fillStyle = '#1f2125';
    ctx.fillRect(ball.x - 0.18, ball.y + BALL_R - 0.1, 0.36, 0.5);
    const g = ctx.createRadialGradient(ball.x - 0.35, ball.y + 0.4, 0.1, ball.x, ball.y, BALL_R);
    g.addColorStop(0, '#6b6f76');
    g.addColorStop(0.5, C.ball);
    g.addColorStop(1, '#141619');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    if (ball.aiming && opt.holding === 'ball') {
      ctx.strokeStyle = 'rgba(255,176,32,0.9)';
      ctx.lineWidth = Math.max(0.08, 2 / scale);
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, BALL_R + 0.25, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawPrediction(ctx: CanvasRenderingContext2D, sim: WreckSim, pr: Prediction, scale: number): void {
    const path = pr.path;
    ctx.strokeStyle = 'rgba(255,176,32,0.75)';
    ctx.lineWidth = Math.max(0.06, 1.6 / scale);
    ctx.setLineDash([0.5, 0.5]);
    ctx.beginPath();
    ctx.moveTo(path[0] as number, path[1] as number);
    for (let i = 2; i < path.length; i += 2) ctx.lineTo(path[i] as number, path[i + 1] as number);
    ctx.stroke();
    ctx.setLineDash([]);
    if (pr.hitPiece >= 0) {
      const p = sim.def.pieces[pr.hitPiece] as PieceDef;
      ctx.strokeStyle = 'rgba(255,176,32,0.95)';
      ctx.lineWidth = Math.max(0.08, 2 / scale);
      const m = 0.15;
      const x0 = p.x - m;
      const y0 = p.y - m;
      const x1 = p.x + p.w + m;
      const y1 = p.y + p.h + m;
      const c = Math.min(0.8, Math.min(p.w, p.h) * 0.5 + 0.2);
      ctx.beginPath();
      // Corner brackets.
      ctx.moveTo(x0, y0 + c);
      ctx.lineTo(x0, y0);
      ctx.lineTo(x0 + c, y0);
      ctx.moveTo(x1 - c, y0);
      ctx.lineTo(x1, y0);
      ctx.lineTo(x1, y0 + c);
      ctx.moveTo(x1, y1 - c);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x1 - c, y1);
      ctx.moveTo(x0 + c, y1);
      ctx.lineTo(x0, y1);
      ctx.lineTo(x0, y1 - c);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,176,32,0.5)';
      ctx.beginPath();
      ctx.arc(pr.hitX, pr.hitY, BALL_R, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawHighlight(ctx: CanvasRenderingContext2D, sim: WreckSim, id: number, scale: number, time: number): void {
    const p = sim.def.pieces[id] as PieceDef;
    const a = 0.55 + 0.35 * Math.sin(time * 6);
    ctx.strokeStyle = `rgba(255,176,32,${a})`;
    ctx.lineWidth = Math.max(0.1, 2.5 / scale);
    ctx.strokeRect(p.x - 0.2, p.y - 0.2, p.w + 0.4, p.h + 0.4);
  }

  private drawHandles(ctx: CanvasRenderingContext2D, sim: WreckSim, cam: Camera, opt: DrawOptions): void {
    const hook = craneHook(sim.state.crane);
    const hs = cam.worldToScreen(hook.x, hook.y);
    const ball = sim.state.ball;
    const bs = cam.worldToScreen(ball.x, ball.y);
    ctx.lineWidth = 2;
    if (opt.holding !== 'ball') {
      ctx.strokeStyle = opt.holding === 'hook' ? 'rgba(255,176,32,0.95)' : 'rgba(255,176,32,0.55)';
      ctx.beginPath();
      ctx.arc(hs.x, hs.y, 16, 0, Math.PI * 2);
      ctx.stroke();
      // Four ticks: this one moves in any direction.
      ctx.beginPath();
      for (const [dx, dy] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ] as const) {
        ctx.moveTo(hs.x + dx * 20, hs.y + dy * 20);
        ctx.lineTo(hs.x + dx * 25, hs.y + dy * 25);
      }
      ctx.stroke();
    }
    if (!opt.holding) {
      const r = Math.max(18, BALL_R * cam.drawScale + 8);
      ctx.strokeStyle = 'rgba(255,176,32,0.55)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(bs.x, bs.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
}
