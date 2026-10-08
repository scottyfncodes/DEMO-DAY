import { hashString } from '../core/rng';
import type { NeighborDef } from '../core/types';
import { APRON, BACK_K, SKY_K, type BackItem, type Crossing, type Lot, type Prop, type World } from '../world/world';

/**
 * Draws the world around a job as a night-time miniature: skyline, the next
 * block back, the ground plane with its lots and cross streets, the props on
 * each lot and the street in front.
 *
 * Depth is a scale `k` (1 = the play plane). A point at depth k sits higher
 * on screen the further back it is and is drawn k times as large, so moving
 * the camera gives parallax for free. Props are drawn in their own metres
 * with y up, so a car is 4.4 m long whatever the zoom; detail switches on as
 * the pixels per metre allow.
 */

/** Metres the horizon rises per unit of depth, scaled with zoom. */
export const HORIZON_LIFT = 6;
/** Never flatter than this, so the overview still reads as a receding plane of lots and streets. */
export const MIN_LIFT_PX = 84;

export interface Projector {
  /** Pixels per metre on the play plane. */
  s: number;
  camX: number;
  /** Screen x of the camera centre (includes shake). */
  cx: number;
  /** Screen y of the ground line on the play plane. */
  groundY: number;
  /** Pixels the ground rises per unit of depth. */
  lift: number;
  width: number;
  height: number;
  dpr: number;
}

export function makeProjector(s: number, camX: number, cx: number, groundY: number, width: number, height: number, dpr: number): Projector {
  return { s, camX, cx, groundY, lift: Math.max(MIN_LIFT_PX, HORIZON_LIFT * s), width, height, dpr };
}

export function px(P: Projector, wx: number, k: number): number {
  return P.cx + (wx - P.camX) * P.s * k;
}

export function py(P: Projector, wy: number, k: number): number {
  return P.groundY + (k - 1) * P.lift - wy * P.s * k;
}

/** World x at the left / right screen edge for a given depth. */
function visibleRange(P: Projector, k: number): [number, number] {
  const half = P.width / 2 / (P.s * k);
  const off = (P.cx - P.width / 2) / (P.s * k);
  return [P.camX - half - off, P.camX + half - off];
}

// ------------------------------------------------------------------ colour

const FOG = [26, 35, 49];
const tintCache = new Map<string, string>();

/** Mixes a colour toward the night haze: further back reads fainter. */
function fog(hex: string, f: number): string {
  if (f <= 0.01) return hex;
  const q = Math.round(Math.min(0.9, f) * 20) / 20;
  const key = hex + q;
  const hit = tintCache.get(key);
  if (hit) return hit;
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - q) + (FOG[0] as number) * q);
  const g = Math.round(((n >> 8) & 255) * (1 - q) + (FOG[1] as number) * q);
  const b = Math.round((n & 255) * (1 - q) + (FOG[2] as number) * q);
  const out = `rgb(${r},${g},${b})`;
  tintCache.set(key, out);
  return out;
}

function fogFor(k: number): number {
  return k >= 1 ? 0 : Math.min(0.75, (1 - k) * 1.5);
}

const WALLS = ['#5d6b78', '#6f6257', '#5f6f62', '#7a6c5b', '#5a5f73', '#73685f'];
const ROOFS = ['#3a3236', '#2f3640', '#45362f', '#3b3f38', '#40333a'];
const CARS = ['#b8403a', '#3f6fa8', '#cfcdc4', '#2d3138', '#5b8a5a', '#c79a3a'];
const TRIM = '#b9b3a6';
const LIT = '#ffd27a';
const LIT2 = '#f3b65e';
const DARK_GLASS = '#1a2230';

function pick<T>(list: readonly T[], seed: number): T {
  return list[seed % list.length] as T;
}

function lit(seed: number, i: number, rate = 0.45): boolean {
  return (hashString(`${seed}:${i}`) % 1000) / 1000 < rate;
}

// --------------------------------------------------------------- renderer

export class WorldRenderer {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  /** Puts the context in a prop's local metres: origin at its bottom-left, y up. */
  private local(P: Projector, x: number, k: number, w: number, flip = false): number {
    const sk = P.s * k;
    const sx = px(P, x, k);
    const sy = py(P, 0, k);
    const d = P.dpr;
    if (flip) this.ctx.setTransform(-d * sk, 0, 0, -d * sk, d * (sx + w * sk), d * sy);
    else this.ctx.setTransform(d * sk, 0, 0, -d * sk, d * sx, d * sy);
    return sk;
  }

  private reset(P: Projector): void {
    this.ctx.setTransform(P.dpr, 0, 0, P.dpr, 0, 0);
  }

  // ------------------------------------------------------------ layers

  /** Sky, stars and the distant skyline. */
  drawSky(P: Projector, world: World | undefined, time: number): void {
    const ctx = this.ctx;
    const horizon = py(P, 0, SKY_K);
    const grad = ctx.createLinearGradient(0, 0, 0, Math.max(2, horizon));
    grad.addColorStop(0, '#0a0f17');
    grad.addColorStop(0.65, '#162030');
    grad.addColorStop(1, '#2c3242');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, P.width, P.height);
    // Stars drift a touch with the camera so the sky feels far, not painted on.
    ctx.fillStyle = 'rgba(220, 230, 255, 0.55)';
    const drift = (P.camX * P.s * 0.02) % P.width;
    for (let i = 0; i < 70; i++) {
      const h = hashString(`star${i}`);
      const sx = ((((h % 1000) / 1000) * P.width * 1.2 - drift) % P.width + P.width) % P.width;
      const sy = (((h >>> 10) % 1000) / 1000) * Math.max(10, horizon - 40);
      const tw = 0.6 + 0.4 * Math.sin(time * (1 + (h % 5)) + i);
      ctx.globalAlpha = 0.25 + 0.5 * tw * (((h >>> 20) % 10) / 10);
      ctx.fillRect(sx, sy, 1.4, 1.4);
    }
    ctx.globalAlpha = 1;
    if (!world) return;
    const [l, r] = visibleRange(P, SKY_K);
    for (const item of world.skyline) {
      if (item.x + item.w < l - 40 || item.x > r + 40) continue;
      this.drawBack(P, item, SKY_K, true, time);
    }
    this.reset(P);
    this.veil(P, py(P, 0, SKY_K) + 2, (P.s - 6) / 70);
  }

  /**
   * Haze over the far layers when zoomed in: close up the eye is on the lot,
   * so the distance drops back like a shallow depth of field.
   */
  private veil(P: Projector, bottom: number, amount: number): void {
    const a = Math.max(0, Math.min(0.7, amount));
    if (a <= 0.01) return;
    this.ctx.fillStyle = `rgba(22, 30, 43, ${a.toFixed(3)})`;
    this.ctx.fillRect(0, 0, P.width, Math.max(0, bottom));
  }

  /**
   * The ground plane from the horizon to the street: lots, cross streets,
   * the back row of buildings and the street in front of the lots.
   */
  drawGround(P: Projector, world: World | undefined, time: number, closed: boolean): void {
    const ctx = this.ctx;
    const yHorizon = py(P, 0, SKY_K);
    const yFront = py(P, 0, APRON.end);
    const grad = ctx.createLinearGradient(0, yHorizon, 0, P.groundY);
    grad.addColorStop(0, '#1b2028');
    grad.addColorStop(1, '#20231f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, yHorizon, P.width, Math.max(0, P.groundY - yHorizon) + 1);
    // Below the front street: the near verge, fading to dark.
    const below = ctx.createLinearGradient(0, yFront, 0, P.height);
    below.addColorStop(0, '#1d211c');
    below.addColorStop(1, '#0e100f');
    ctx.fillStyle = below;
    ctx.fillRect(0, yFront, P.width, Math.max(0, P.height - yFront));
    if (!world) {
      this.drawApron(P, undefined);
      return;
    }
    for (const lot of world.lots) this.drawLotSurface(P, lot, lot === world.lot);
    // Back row of buildings sits on the far edge of the lots.
    const [l, r] = visibleRange(P, BACK_K);
    for (const item of world.backRow) {
      if (item.x + item.w < l - 10 || item.x > r + 10) continue;
      this.drawBack(P, item, BACK_K, false, time);
    }
    this.reset(P);
    this.veil(P, py(P, 0, BACK_K) + 1, (P.s - 6) / 42);
    this.drawApron(P, world);
    for (const c of world.crossings) this.drawCrossing(P, c, world);
    this.drawTraffic(P, world, time, closed);
    this.drawLabels(P, world);
  }

  /** Props behind the play plane (k < 1). */
  drawBackProps(P: Projector, world: World | undefined, time: number): void {
    if (!world) return;
    this.drawProps(P, world, (k) => k < 1, time);
  }

  /** Props in front of the play plane (k >= 1): the sidewalk, the crew, parked cars. */
  drawFrontProps(P: Projector, world: World | undefined, time: number): void {
    if (!world) return;
    this.drawProps(P, world, (k) => k >= 1, time);
  }

  private drawProps(P: Projector, world: World, which: (k: number) => boolean, time: number): void {
    const poles: Prop[] = [];
    for (const p of world.props) {
      if (!which(p.k)) continue;
      const [l, r] = visibleRange(P, p.k);
      if (p.type === 'pole') poles.push(p);
      if (p.x + p.w < l - 2 || p.x > r + 2) continue;
      this.drawProp(P, p, time);
    }
    this.reset(P);
    if (poles.length > 1) this.drawWires(P, poles);
  }

  // ------------------------------------------------------------- ground

  private quad(P: Projector, x1: number, x2: number, k1: number, k2: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(px(P, x1, k1), py(P, 0, k1));
    ctx.lineTo(px(P, x2, k1), py(P, 0, k1));
    ctx.lineTo(px(P, x2, k2), py(P, 0, k2));
    ctx.lineTo(px(P, x1, k2), py(P, 0, k2));
    ctx.closePath();
  }

  private drawLotSurface(P: Projector, lot: Lot, isJob: boolean): void {
    const ctx = this.ctx;
    const k1 = BACK_K + 0.02;
    const [l, r] = visibleRange(P, 1);
    if (lot.x + lot.w < l - 60 || lot.x > r + 60) return;
    const colour: Record<Lot['surface'], string> = {
      lawn: '#1f2b20',
      field: '#2b2818',
      gravel: '#2a2927',
      paving: '#2a2c30',
      dirt: '#2f2820',
      asphalt: '#232529',
    };
    const g = ctx.createLinearGradient(0, py(P, 0, k1), 0, P.groundY);
    g.addColorStop(0, fog(colour[lot.surface], 0.55));
    g.addColorStop(1, colour[lot.surface]);
    ctx.fillStyle = g;
    this.quad(P, lot.x, lot.x + lot.w, k1, 1);
    ctx.fill();
    const s = P.s;
    // Crop rows and mowing stripes run into the distance.
    if (lot.surface === 'field' && s > 1.2) {
      ctx.strokeStyle = 'rgba(120, 104, 60, 0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = k1 + 0.02; k < 1; k += 0.03) {
        ctx.moveTo(px(P, lot.x, k), py(P, 0, k));
        ctx.lineTo(px(P, lot.x + lot.w, k), py(P, 0, k));
      }
      ctx.stroke();
    } else if (lot.surface === 'lawn' && s > 4) {
      ctx.fillStyle = 'rgba(255,255,255,0.025)';
      for (let x = lot.x; x < lot.x + lot.w; x += 2) {
        if (Math.floor(x / 2) % 2) continue;
        this.quad(P, x, Math.min(lot.x + lot.w, x + 1), 0.86, 1);
        ctx.fill();
      }
    }
    // Property lines.
    if (s > 3) {
      ctx.strokeStyle = isJob ? 'rgba(255, 176, 32, 0.55)' : 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = isJob ? 1.5 : 1;
      if (isJob) ctx.setLineDash([6, 5]);
      ctx.beginPath();
      for (const x of [lot.x, lot.x + lot.w]) {
        ctx.moveTo(px(P, x, k1 + 0.1), py(P, 0, k1 + 0.1));
        ctx.lineTo(px(P, x, 1), py(P, 0, 1));
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /** The street in front of the lots: sidewalk, curb, parking lane, two lanes, the far sidewalk. */
  private drawApron(P: Projector, world: World | undefined): void {
    const ctx = this.ctx;
    const [l, r] = visibleRange(P, APRON.end);
    const x1 = l - 5;
    const x2 = r + 5;
    const farm = world?.district === 'farmland';
    // Sidewalk (gravel shoulder in the country).
    ctx.fillStyle = farm ? '#2e2b25' : '#363940';
    this.quad(P, x1, x2, APRON.walk[0], APRON.walk[1]);
    ctx.fill();
    // Curb.
    ctx.fillStyle = farm ? '#3a362e' : '#5a5d63';
    this.quad(P, x1, x2, APRON.walk[1], APRON.curb + 0.004);
    ctx.fill();
    // Road.
    const road = ctx.createLinearGradient(0, py(P, 0, APRON.road[0]), 0, py(P, 0, APRON.road[1]));
    road.addColorStop(0, '#202329');
    road.addColorStop(1, '#1a1c21');
    ctx.fillStyle = road;
    this.quad(P, x1, x2, APRON.road[0], APRON.road[1]);
    ctx.fill();
    ctx.fillStyle = farm ? '#26261f' : '#30333a';
    this.quad(P, x1, x2, APRON.farWalk[0], APRON.farWalk[1]);
    ctx.fill();
    const s = P.s;
    if (s < 1.5) return;
    // Paving joints run into the screen: perspective for free.
    if (!farm && s > 5) {
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const step = 1.5;
      for (let x = Math.floor(x1 / step) * step; x < x2; x += step) {
        ctx.moveTo(px(P, x, APRON.walk[0]), py(P, 0, APRON.walk[0]));
        ctx.lineTo(px(P, x, APRON.walk[1]), py(P, 0, APRON.walk[1]));
      }
      ctx.stroke();
    }
    // Lane markings: parking lane edge and a dashed centre line (3 m dash, 6 m gap).
    const kc = (APRON.road[0] + APRON.road[1]) / 2 + 0.03;
    ctx.fillStyle = farm ? 'rgba(230, 230, 220, 0.55)' : 'rgba(217, 196, 106, 0.7)';
    const dash = farm ? 3 : 3;
    const gap = 6;
    for (let x = Math.floor(x1 / (dash + gap)) * (dash + gap); x < x2; x += dash + gap) {
      this.quad(P, x, x + dash, kc - 0.004, kc + 0.004);
      ctx.fill();
    }
    if (!farm) {
      ctx.strokeStyle = 'rgba(230, 230, 220, 0.25)';
      ctx.lineWidth = Math.max(1, s * 0.05);
      ctx.beginPath();
      ctx.moveTo(px(P, x1, 1.13), py(P, 0, 1.13));
      ctx.lineTo(px(P, x2, 1.13), py(P, 0, 1.13));
      ctx.stroke();
    }
  }

  private drawCrossing(P: Projector, c: Crossing, world: World): void {
    const ctx = this.ctx;
    const [l, r] = visibleRange(P, 1);
    if (c.x + c.w < l - 40 || c.x > r + 40) return;
    const kBack = BACK_K - 0.1;
    const kFront = APRON.end;
    const x1 = c.x;
    const x2 = c.x + c.w;
    switch (c.kind) {
      case 'river': {
        const g = ctx.createLinearGradient(0, py(P, 0, kBack), 0, py(P, 0, kFront));
        g.addColorStop(0, '#1c3346');
        g.addColorStop(1, '#173d57');
        ctx.fillStyle = g;
        this.quad(P, x1, x2, kBack, kFront + 0.1);
        ctx.fill();
        // Banks.
        ctx.fillStyle = '#3a3a36';
        this.quad(P, x1 - 0.5, x1, kBack, kFront + 0.1);
        ctx.fill();
        this.quad(P, x2, x2 + 0.5, kBack, kFront + 0.1);
        ctx.fill();
        // The front street crosses on a bridge deck.
        ctx.fillStyle = '#2b2e34';
        this.quad(P, x1 - 0.5, x2 + 0.5, APRON.walk[0], APRON.farWalk[1]);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        this.quad(P, x1 - 0.5, x2 + 0.5, APRON.farWalk[1], APRON.farWalk[1] + 0.03);
        ctx.fill();
        break;
      }
      case 'rail': {
        ctx.fillStyle = '#34302b';
        this.quad(P, x1, x2, kBack, kFront);
        ctx.fill();
        const mid = (x1 + x2) / 2;
        // Sleepers every half metre of depth-ish, two rails.
        ctx.strokeStyle = '#4a3a2c';
        ctx.lineWidth = Math.max(1, P.s * 0.12);
        ctx.beginPath();
        for (let k = kBack; k < kFront; k += 0.012) {
          ctx.moveTo(px(P, mid - 1.3, k), py(P, 0, k));
          ctx.lineTo(px(P, mid + 1.3, k), py(P, 0, k));
        }
        ctx.stroke();
        ctx.strokeStyle = '#9aa1a8';
        ctx.lineWidth = Math.max(1, P.s * 0.07);
        ctx.beginPath();
        for (const off of [-0.72, 0.72]) {
          ctx.moveTo(px(P, mid + off, kBack), py(P, 0, kBack));
          ctx.lineTo(px(P, mid + off, kFront), py(P, 0, kFront));
        }
        ctx.stroke();
        break;
      }
      default: {
        const highway = c.kind === 'highway';
        ctx.fillStyle = highway ? '#24272d' : '#202329';
        this.quad(P, x1, x2, kBack, kFront);
        ctx.fill();
        if (c.walk > 0) {
          ctx.fillStyle = '#363940';
          this.quad(P, x1, x1 + c.walk, kBack, APRON.walk[0]);
          ctx.fill();
          this.quad(P, x2 - c.walk, x2, kBack, APRON.walk[0]);
          ctx.fill();
        }
        const rx1 = x1 + c.walk;
        const rx2 = x2 - c.walk;
        // Lane lines along the depth.
        const lanes = highway ? 4 : 2;
        const lw = (rx2 - rx1) / lanes;
        ctx.lineWidth = Math.max(1, P.s * 0.08);
        for (let i = 1; i < lanes; i++) {
          const x = rx1 + i * lw;
          const centre = i === lanes / 2;
          ctx.strokeStyle = centre ? 'rgba(217, 196, 106, 0.75)' : 'rgba(230, 230, 220, 0.5)';
          ctx.setLineDash(centre ? [] : [Math.max(2, P.s * 1.2), Math.max(3, P.s * 1.8)]);
          ctx.beginPath();
          ctx.moveTo(px(P, x, kBack), py(P, 0, kBack));
          ctx.lineTo(px(P, x, kFront), py(P, 0, kFront));
          ctx.stroke();
        }
        ctx.setLineDash([]);
        if (highway) {
          ctx.strokeStyle = 'rgba(230, 230, 220, 0.6)';
          ctx.beginPath();
          for (const x of [rx1 + 0.3, rx2 - 0.3]) {
            ctx.moveTo(px(P, x, kBack), py(P, 0, kBack));
            ctx.lineTo(px(P, x, kFront), py(P, 0, kFront));
          }
          ctx.stroke();
        }
        // Zebra crossing where it meets the front street.
        if (!highway && P.s > 2.5 && world.district !== 'farmland') {
          ctx.fillStyle = 'rgba(230, 230, 220, 0.5)';
          for (let x = rx1 + 0.3; x < rx2 - 0.5; x += 1.0) {
            this.quad(P, x, x + 0.5, APRON.walk[0] + 0.005, APRON.walk[1] - 0.005);
            ctx.fill();
          }
        }
        // The front street runs straight through the junction.
        ctx.fillStyle = '#202329';
        this.quad(P, rx1, rx2, APRON.road[0], APRON.road[1]);
        ctx.fill();
      }
    }
  }

  /** Cars running up and down the cross streets. Stops while a crossing is closed for the blast. */
  private drawTraffic(P: Projector, world: World, time: number, closed: boolean): void {
    if (P.s < 1.2) return;
    for (const c of world.crossings) {
      if (c.kind === 'rail' || c.kind === 'river') continue;
      const onSite = c.x + c.w > world.siteMinX && c.x < world.siteMaxX;
      if (onSite && closed) continue;
      const [l, r] = visibleRange(P, 1);
      if (c.x + c.w < l - 30 || c.x > r + 30) continue;
      const lanes = c.kind === 'highway' ? 4 : 2;
      const lw = (c.w - c.walk * 2) / lanes;
      const n = c.kind === 'highway' ? 3 : 1;
      for (let lane = 0; lane < lanes; lane++) {
        const toward = lane >= lanes / 2;
        for (let i = 0; i < n; i++) {
          const seed = hashString(`${c.name}${lane}${i}`);
          const period = (c.kind === 'highway' ? 7 : 13) + (seed % 7);
          let t = ((time + (seed % 997) / 997 * period * 3 + i * period / n) / period) % 1;
          if (!toward) t = 1 - t;
          const k = BACK_K + t * (APRON.end + 0.05 - BACK_K);
          if (k > APRON.end) continue;
          const x = c.x + c.walk + lane * lw + lw / 2 - 0.9;
          this.drawCarHead(P, x, k, toward, pick(CARS, seed >>> 3));
        }
      }
    }
    this.reset(P);
  }

  /** A car seen from the front (headlights) or the back (tail lights). */
  private drawCarHead(P: Projector, x: number, k: number, toward: boolean, colour: string): void {
    const ctx = this.ctx;
    const sk = this.local(P, x, k, 1.8);
    const f = fogFor(k);
    ctx.fillStyle = fog(colour, f);
    roundRect(ctx, 0, 0.25, 1.8, 0.7, 0.18);
    ctx.fill();
    ctx.fillStyle = fog('#2a2f38', f);
    roundRect(ctx, 0.22, 0.9, 1.36, 0.55, 0.15);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.fillRect(0.12, 0, 0.32, 0.3);
    ctx.fillRect(1.36, 0, 0.32, 0.3);
    if (sk > 2) {
      ctx.fillStyle = toward ? '#fff4d0' : '#ff3b2e';
      ctx.fillRect(0.1, 0.55, 0.3, 0.16);
      ctx.fillRect(1.4, 0.55, 0.3, 0.16);
    }
    if (toward) {
      // Headlight cones on the road.
      this.reset(P);
      const a = px(P, x + 0.9, k + 0.03);
      const b = py(P, 0, k + 0.03);
      const g = ctx.createRadialGradient(a, b, 0, a, b, sk * 2.2);
      g.addColorStop(0, 'rgba(255, 240, 200, 0.16)');
      g.addColorStop(1, 'rgba(255, 240, 200, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(a - sk * 2.2, b - sk * 2.2, sk * 4.4, sk * 4.4);
    }
  }

  /** District, street and lot labels appear at the zoom where they mean something. */
  private drawLabels(P: Projector, world: World): void {
    const ctx = this.ctx;
    this.reset(P);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const s = P.s;
    // Street names on the cross streets.
    if (s > 1.4 && s < 40) {
      ctx.font = `600 ${Math.round(Math.min(14, Math.max(9, s * 0.9)))}px ${LABEL_FONT}`;
      for (const c of world.crossings) {
        if (c.kind === 'river' || c.kind === 'rail') continue;
        const x = px(P, c.x + c.w / 2, 1.2);
        if (x < -100 || x > P.width + 100) continue;
        if (c.x + c.w > world.siteMinX && c.x < world.siteMaxX) continue;
        ctx.fillStyle = 'rgba(232, 230, 225, 0.45)';
        ctx.fillText(c.name.toUpperCase(), x, py(P, 0, 1.2));
      }
    }
    // Lot numbers stencilled on the sidewalk.
    if (s > 5 && s < 60) {
      ctx.font = `600 ${Math.round(Math.min(12, Math.max(9, s * 0.4)))}px ${LABEL_FONT}`;
      for (const lot of world.lots) {
        const x = px(P, lot.x + 1.2, 1.03);
        if (x < -40 || x > P.width + 40) continue;
        const job = lot === world.lot;
        ctx.fillStyle = job ? 'rgba(255, 176, 32, 0.85)' : 'rgba(232, 230, 225, 0.25)';
        ctx.textAlign = 'left';
        ctx.fillText(job ? `LOT ${lot.number} · ${world.site.street.toUpperCase()}` : `${lot.number}`, x, py(P, 0, 1.028));
      }
      ctx.textAlign = 'center';
    }
  }

  // --------------------------------------------------------- far layers

  private drawBack(P: Projector, item: BackItem, k: number, sky: boolean, time: number): void {
    const ctx = this.ctx;
    const sk = this.local(P, item.x, k, item.w);
    const base = sky ? '#141b26' : '#1b2330';
    const body = sky ? '#18202c' : '#222b38';
    const { w, h, seed } = item;
    switch (item.type) {
      case 'hill': {
        ctx.fillStyle = sky ? '#121821' : base;
        ctx.beginPath();
        ctx.moveTo(-w * 0.1, -2);
        ctx.bezierCurveTo(w * 0.2, h * 1.1, w * 0.6, h * 0.9, w * 1.1, -2);
        ctx.closePath();
        ctx.fill();
        return;
      }
      case 'tree': {
        ctx.fillStyle = sky ? '#131a21' : '#1a2420';
        ctx.beginPath();
        ctx.ellipse(w / 2, h * 0.62, w / 2, h * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(w * 0.45, 0, w * 0.1, h * 0.3);
        return;
      }
      case 'turbine': {
        ctx.fillStyle = '#2a3240';
        ctx.fillRect(w / 2 - 0.6, 0, 1.2, h);
        ctx.strokeStyle = '#2f3846';
        ctx.lineWidth = 1.1;
        const a = time * 0.6 + (seed % 10);
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const ang = a + (i * Math.PI * 2) / 3;
          ctx.moveTo(w / 2, h);
          ctx.lineTo(w / 2 + Math.cos(ang) * h * 0.42, h + Math.sin(ang) * h * 0.42);
        }
        ctx.stroke();
        if (Math.sin(time * 2 + seed) > 0.6) {
          ctx.fillStyle = '#ff4030';
          ctx.fillRect(w / 2 - 0.8, h - 0.6, 1.6, 1.2);
        }
        return;
      }
      case 'bridge': {
        ctx.strokeStyle = '#1f2834';
        ctx.lineWidth = 2;
        ctx.fillStyle = '#1c2430';
        ctx.fillRect(0, h * 0.35, w, 2.4);
        for (const tx of [w * 0.3, w * 0.7]) {
          ctx.fillRect(tx - 1.6, 0, 3.2, h);
          ctx.beginPath();
          for (let i = 1; i <= 6; i++) {
            ctx.moveTo(tx, h * 0.95);
            ctx.lineTo(tx - i * w * 0.045, h * 0.37);
            ctx.moveTo(tx, h * 0.95);
            ctx.lineTo(tx + i * w * 0.045, h * 0.37);
          }
          ctx.stroke();
        }
        // Lights along the deck.
        ctx.fillStyle = 'rgba(255, 214, 140, 0.8)';
        for (let x = 2; x < w; x += 8) ctx.fillRect(x, h * 0.35 + 2.4, 0.8, 0.8);
        return;
      }
      case 'stack': {
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(w * 0.15, h);
        ctx.lineTo(w * 0.85, h);
        ctx.lineTo(w, 0);
        ctx.fill();
        if (Math.sin(time * 1.6 + seed) > 0) {
          ctx.fillStyle = '#ff3b2e';
          ctx.fillRect(w * 0.3, h - 0.8, w * 0.4, 0.8);
        }
        return;
      }
      case 'crane': {
        ctx.strokeStyle = body;
        ctx.lineWidth = 0.9;
        ctx.strokeRect(w * 0.2, 0, 1.4, h);
        ctx.beginPath();
        ctx.moveTo(w * 0.2 - w * 0.2, h);
        ctx.lineTo(w * 1.1, h);
        ctx.moveTo(w * 0.9, h);
        ctx.lineTo(w * 0.9, h * 0.6);
        ctx.stroke();
        return;
      }
      case 'silo': {
        ctx.fillStyle = body;
        ctx.fillRect(0, 0, w, h);
        ctx.beginPath();
        ctx.ellipse(w / 2, h, w / 2, w * 0.35, 0, Math.PI, 0, true);
        ctx.fill();
        return;
      }
      case 'barn': {
        ctx.fillStyle = sky ? body : '#2c2224';
        ctx.fillRect(0, 0, w, h * 0.55);
        ctx.beginPath();
        ctx.moveTo(-0.3, h * 0.55);
        ctx.lineTo(w * 0.2, h * 0.85);
        ctx.lineTo(w / 2, h);
        ctx.lineTo(w * 0.8, h * 0.85);
        ctx.lineTo(w + 0.3, h * 0.55);
        ctx.fill();
        if (lit(seed, 1, 0.5) && sk > 1) {
          ctx.fillStyle = LIT2;
          ctx.fillRect(w * 0.45, h * 0.6, w * 0.1, h * 0.08);
        }
        return;
      }
      case 'house': {
        ctx.fillStyle = body;
        ctx.fillRect(0, 0, w, h * 0.62);
        ctx.beginPath();
        ctx.moveTo(-0.4, h * 0.62);
        ctx.lineTo(w / 2, h);
        ctx.lineTo(w + 0.4, h * 0.62);
        ctx.fill();
        if (sk > 1) {
          for (let i = 0; i < 4; i++) {
            if (!lit(seed, i, 0.35)) continue;
            ctx.fillStyle = i % 2 ? LIT : LIT2;
            ctx.fillRect(w * (0.15 + (i % 2) * 0.5), i < 2 ? h * 0.12 : h * 0.38, w * 0.18, h * 0.13);
          }
        }
        return;
      }
      case 'factory': {
        ctx.fillStyle = body;
        ctx.fillRect(0, 0, w, h * 0.7);
        const teeth = Math.max(2, Math.round(w / 5));
        ctx.beginPath();
        for (let i = 0; i < teeth; i++) {
          const a = (i / teeth) * w;
          const b = ((i + 1) / teeth) * w;
          ctx.moveTo(a, h * 0.7);
          ctx.lineTo(a, h);
          ctx.lineTo(b, h * 0.7);
        }
        ctx.fill();
        if (sk > 0.8) this.windowGrid(0.5, 1.5, w - 1, h * 0.5, 3.2, 3.5, seed, 0.25, sky);
        return;
      }
      case 'warehouse': {
        ctx.fillStyle = body;
        ctx.fillRect(0, 0, w, h * 0.85);
        ctx.beginPath();
        ctx.moveTo(0, h * 0.85);
        ctx.lineTo(w / 2, h);
        ctx.lineTo(w, h * 0.85);
        ctx.fill();
        if (sk > 0.8) this.windowGrid(1, h * 0.55, w - 2, h * 0.15, 2.4, 3, seed, 0.3, sky);
        return;
      }
      default: {
        // block / tower: windows on a grid, a few lit.
        ctx.fillStyle = item.type === 'tower' ? body : base;
        ctx.fillRect(0, 0, w, h);
        if (item.type === 'tower' && seed % 3 === 0) {
          ctx.fillRect(w * 0.45, h, w * 0.1, h * 0.12);
          if (Math.sin(time * 1.3 + seed) > 0.3) {
            ctx.fillStyle = '#ff3b2e';
            ctx.fillRect(w * 0.45, h * 1.12, w * 0.1, 1);
          }
        }
        if (sk > 0.5) this.windowGrid(1, 1.5, w - 2, h - 3, 2.6, 3.2, seed, sky ? 0.22 : 0.3, sky);
      }
    }
  }

  private windowGrid(x: number, y: number, w: number, h: number, dx: number, dy: number, seed: number, rate: number, faint: boolean): void {
    const ctx = this.ctx;
    const cols = Math.max(1, Math.floor(w / dx));
    const rows = Math.max(1, Math.floor(h / dy));
    const ox = x + (w - cols * dx) / 2;
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        i++;
        if (!lit(seed, i, rate)) continue;
        ctx.fillStyle = faint ? 'rgba(255, 210, 122, 0.5)' : i % 3 ? LIT : LIT2;
        ctx.fillRect(ox + c * dx + dx * 0.25, y + r * dy + dy * 0.3, dx * 0.5, dy * 0.4);
      }
    }
  }

  // -------------------------------------------------------------- props

  private drawProp(P: Projector, p: Prop, time: number): void {
    const ctx = this.ctx;
    const sk = this.local(P, p.x, p.k, p.w, p.flip);
    const f = fogFor(p.k);
    const { w, h, seed } = p;
    const fine = sk > 10;
    switch (p.type) {
      case 'house':
      case 'bungalow':
      case 'farmhouse': {
        const wall = fog(pick(WALLS, seed), f);
        const roof = fog(pick(ROOFS, seed >>> 4), f);
        const storeys = p.type === 'bungalow' ? 1 : 2;
        const eave = p.type === 'bungalow' ? h * 0.6 : h * 0.66;
        ctx.fillStyle = fog('#2a2a2c', f);
        ctx.fillRect(-0.1, 0, w + 0.2, 0.4);
        ctx.fillStyle = wall;
        ctx.fillRect(0, 0.4, w, eave - 0.4);
        // Gable or hip roof with overhang.
        ctx.fillStyle = roof;
        ctx.beginPath();
        ctx.moveTo(-0.45, eave);
        if (seed % 2) {
          ctx.lineTo(w * 0.25, h);
          ctx.lineTo(w * 0.75, h);
        } else {
          ctx.lineTo(w / 2, h);
        }
        ctx.lineTo(w + 0.45, eave);
        ctx.closePath();
        ctx.fill();
        if (sk > 2.5) {
          if (fine) {
            // Siding courses.
            ctx.strokeStyle = 'rgba(0,0,0,0.12)';
            ctx.lineWidth = 0.025;
            ctx.beginPath();
            for (let y = 0.6; y < eave; y += 0.2) {
              ctx.moveTo(0, y);
              ctx.lineTo(w, y);
            }
            ctx.stroke();
            // Shingle courses.
            ctx.strokeStyle = 'rgba(0,0,0,0.2)';
            ctx.beginPath();
            for (let y = eave + 0.25; y < h - 0.1; y += 0.25) {
              const t = (y - eave) / (h - eave);
              const inset = seed % 2 ? t * w * 0.25 : t * w * 0.5;
              ctx.moveTo(-0.45 + inset, y);
              ctx.lineTo(w + 0.45 - inset, y);
            }
            ctx.stroke();
            // Gutter and fascia.
            ctx.fillStyle = fog(TRIM, f);
            ctx.fillRect(-0.45, eave - 0.12, w + 0.9, 0.12);
            ctx.fillRect(w - 0.25, 0.4, 0.07, eave - 0.5);
          }
          // Windows: two per storey, door on the ground floor.
          const storeyH = (eave - 0.4) / storeys;
          const door = seed % 3 === 0 ? w * 0.18 : w * 0.62;
          for (let st = 0; st < storeys; st++) {
            const y0 = 0.4 + st * storeyH;
            const cols = Math.max(2, Math.floor(w / 3));
            for (let c = 0; c < cols; c++) {
              const wx = (w / cols) * (c + 0.5) - 0.5;
              if (st === 0 && Math.abs(wx + 0.5 - (door + 0.5)) < 1.2) continue;
              this.window(wx, y0 + storeyH * 0.38, 1.0, Math.min(1.3, storeyH * 0.45), lit(seed, st * 10 + c, 0.42), f, fine);
            }
          }
          ctx.fillStyle = fog('#3b2a22', f);
          ctx.fillRect(door, 0.4, 0.95, 2.05);
          if (fine) {
            ctx.fillStyle = fog(TRIM, f);
            ctx.fillRect(door - 0.08, 2.45, 1.11, 0.08);
            ctx.fillStyle = '#e9c46a';
            ctx.fillRect(door + 0.75, 1.35, 0.06, 0.06);
            // Porch light.
            ctx.fillStyle = 'rgba(255, 214, 140, 0.9)';
            ctx.fillRect(door + 1.1, 2.1, 0.14, 0.2);
          }
          // Chimney.
          if (seed % 4 === 1) {
            ctx.fillStyle = fog('#6e3b2e', f);
            ctx.fillRect(w * 0.7, eave + (h - eave) * 0.4, 0.6, (h - eave) * 0.75);
          }
        }
        return;
      }
      case 'apartment': {
        const wall = fog(pick(['#4f5866', '#5b5148', '#545b52'], seed), f);
        ctx.fillStyle = wall;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = fog('#2e333b', f);
        ctx.fillRect(-0.2, h - 0.3, w + 0.4, 0.3);
        if (sk > 2) {
          const floors = Math.max(2, Math.round(h / 3));
          const fh = (h - 0.6) / floors;
          const cols = Math.max(2, Math.floor(w / 2.4));
          for (let fl = 0; fl < floors; fl++) {
            for (let c = 0; c < cols; c++) {
              const wx = (w / cols) * c + (w / cols - 1.2) / 2;
              this.window(wx, 0.3 + fl * fh + fh * 0.3, 1.2, fh * 0.5, lit(seed, fl * 20 + c, 0.4), f, fine);
            }
            if (fine && fl > 0) {
              ctx.fillStyle = fog('#3a3f47', f);
              ctx.fillRect(0, 0.3 + fl * fh - 0.08, w, 0.08);
            }
          }
          ctx.fillStyle = fog('#22262c', f);
          ctx.fillRect(w / 2 - 0.8, 0, 1.6, 2.3);
        }
        return;
      }
      case 'shop': {
        ctx.fillStyle = fog(pick(['#6a4f45', '#4e5a67', '#5f6150'], seed), f);
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = fog('#2b2d31', f);
        ctx.fillRect(-0.15, h - 0.5, w + 0.3, 0.5);
        if (sk > 2) {
          // Shopfront glazing, glowing.
          ctx.fillStyle = 'rgba(255, 214, 140, 0.75)';
          ctx.fillRect(0.5, 0.5, w - 1, 2.3);
          ctx.fillStyle = fog('#22252b', f);
          ctx.fillRect(w * 0.42, 0, 1.0, 2.6);
          // Striped awning.
          const stripes = Math.floor(w / 0.6);
          for (let i = 0; i < stripes; i++) {
            ctx.fillStyle = i % 2 ? fog('#e8e2d0', f) : fog(pick(['#b8403a', '#3f6fa8', '#4c8a5a'], seed >>> 2), f);
            ctx.beginPath();
            ctx.moveTo((i / stripes) * w, 3.4);
            ctx.lineTo(((i + 1) / stripes) * w, 3.4);
            ctx.lineTo(((i + 1) / stripes) * w + 0.05, 2.9);
            ctx.lineTo((i / stripes) * w + 0.05, 2.9);
            ctx.fill();
          }
          // Upper windows and sign band.
          ctx.fillStyle = fog('#1f2228', f);
          ctx.fillRect(0.6, 3.7, w - 1.2, 0.7);
          if (fine) this.text(P, p, w / 2, 4.05, pick(['DELI', 'HARDWARE', 'LAUNDRY', 'BAKERY', 'CORNER STORE'], seed >>> 5), 0.45, '#ffcf7a');
          for (let c = 0; c < Math.floor(w / 2.5); c++) this.window(0.8 + c * 2.5, h - 1.6 > 4.6 ? 4.6 : h - 1.6, 1.0, 0.8, lit(seed, c, 0.4), f, fine);
        }
        return;
      }
      case 'garage':
      case 'shed': {
        ctx.fillStyle = fog(pick(WALLS, seed), f);
        ctx.fillRect(0, 0, w, h * 0.8);
        ctx.fillStyle = fog(pick(ROOFS, seed), f);
        ctx.beginPath();
        ctx.moveTo(-0.2, h * 0.8);
        ctx.lineTo(w / 2, h);
        ctx.lineTo(w + 0.2, h * 0.8);
        ctx.fill();
        if (sk > 3) {
          ctx.fillStyle = fog('#8a8a86', f);
          ctx.fillRect(w * 0.12, 0, w * 0.76, h * 0.68);
          if (fine) {
            ctx.strokeStyle = 'rgba(0,0,0,0.25)';
            ctx.lineWidth = 0.03;
            ctx.beginPath();
            for (let y = 0.3; y < h * 0.68; y += 0.3) {
              ctx.moveTo(w * 0.12, y);
              ctx.lineTo(w * 0.88, y);
            }
            ctx.stroke();
          }
        }
        return;
      }
      case 'barn': {
        ctx.fillStyle = fog('#6b2e2a', f);
        ctx.fillRect(0, 0, w, h * 0.55);
        ctx.fillStyle = fog('#3a3236', f);
        ctx.beginPath();
        ctx.moveTo(-0.4, h * 0.55);
        ctx.lineTo(w * 0.18, h * 0.85);
        ctx.lineTo(w / 2, h);
        ctx.lineTo(w * 0.82, h * 0.85);
        ctx.lineTo(w + 0.4, h * 0.55);
        ctx.fill();
        if (sk > 2.5) {
          ctx.strokeStyle = fog('#d9d0c0', f);
          ctx.lineWidth = 0.15;
          const dw = w * 0.34;
          const dx = (w - dw) / 2;
          ctx.strokeRect(dx, 0, dw, h * 0.45);
          ctx.beginPath();
          ctx.moveTo(dx, 0);
          ctx.lineTo(dx + dw, h * 0.45);
          ctx.moveTo(dx + dw, 0);
          ctx.lineTo(dx, h * 0.45);
          ctx.stroke();
          this.window(w / 2 - 0.6, h * 0.62, 1.2, 1.2, lit(seed, 1, 0.6), f, fine);
          if (fine) {
            ctx.strokeStyle = 'rgba(0,0,0,0.18)';
            ctx.lineWidth = 0.03;
            ctx.beginPath();
            for (let x = 0.3; x < w; x += 0.3) {
              ctx.moveTo(x, 0);
              ctx.lineTo(x, h * 0.55);
            }
            ctx.stroke();
          }
        }
        return;
      }
      case 'grainBin': {
        ctx.fillStyle = fog('#8c949c', f);
        ctx.fillRect(0, 0, w, h * 0.78);
        ctx.beginPath();
        ctx.moveTo(-0.15, h * 0.78);
        ctx.lineTo(w / 2, h);
        ctx.lineTo(w + 0.15, h * 0.78);
        ctx.fill();
        if (sk > 3) {
          ctx.strokeStyle = 'rgba(0,0,0,0.2)';
          ctx.lineWidth = 0.05;
          ctx.beginPath();
          for (let y = 0.8; y < h * 0.78; y += 0.8) {
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
          }
          ctx.stroke();
          ctx.strokeStyle = fog('#5a6068', f);
          ctx.lineWidth = 0.06;
          ctx.beginPath();
          ctx.moveTo(w * 0.85, 0.5);
          ctx.lineTo(w * 0.85, h * 0.9);
          ctx.stroke();
        }
        return;
      }
      case 'warehouse':
      case 'factory': {
        const factory = p.type === 'factory';
        ctx.fillStyle = fog(factory ? '#4d4a4a' : pick(['#4f5a66', '#5a5650', '#4a5552'], seed), f);
        ctx.fillRect(0, 0, w, h * 0.78);
        ctx.fillStyle = fog('#2f3338', f);
        if (factory) {
          const teeth = Math.max(2, Math.round(w / 4.5));
          ctx.beginPath();
          for (let i = 0; i < teeth; i++) {
            const a = (i / teeth) * w;
            const b = ((i + 1) / teeth) * w;
            ctx.moveTo(a, h * 0.78);
            ctx.lineTo(a, h);
            ctx.lineTo(b, h * 0.78);
          }
          ctx.fill();
          if (sk > 2) {
            ctx.fillStyle = 'rgba(255, 210, 122, 0.35)';
            for (let i = 0; i < teeth; i++) ctx.fillRect((i / teeth) * w + 0.15, h * 0.8, 0.35, h * 0.16);
          }
        } else {
          ctx.beginPath();
          ctx.moveTo(-0.3, h * 0.78);
          ctx.lineTo(w / 2, h);
          ctx.lineTo(w + 0.3, h * 0.78);
          ctx.fill();
        }
        if (sk > 2) {
          // Loading doors, a pedestrian door and a high window band.
          const doors = Math.max(1, Math.floor(w / 9));
          for (let i = 0; i < doors; i++) {
            const dx = (w / doors) * (i + 0.5) - 2;
            ctx.fillStyle = fog('#7a7c7a', f);
            ctx.fillRect(dx, 0, 4, 4.2);
            if (fine) {
              ctx.strokeStyle = 'rgba(0,0,0,0.25)';
              ctx.lineWidth = 0.04;
              ctx.beginPath();
              for (let y = 0.35; y < 4.2; y += 0.35) {
                ctx.moveTo(dx, y);
                ctx.lineTo(dx + 4, y);
              }
              ctx.stroke();
            }
          }
          for (let x = 1; x < w - 1.5; x += 2.2) {
            ctx.fillStyle = lit(seed, Math.round(x), 0.35) ? 'rgba(255, 210, 122, 0.7)' : fog(DARK_GLASS, f);
            ctx.fillRect(x, h * 0.6, 1.6, 0.9);
          }
          if (fine) {
            ctx.strokeStyle = 'rgba(0,0,0,0.12)';
            ctx.lineWidth = 0.03;
            ctx.beginPath();
            for (let x = 0.25; x < w; x += 0.25) {
              ctx.moveTo(x, 4.4);
              ctx.lineTo(x, h * 0.58);
            }
            ctx.stroke();
          }
        }
        return;
      }
      case 'tank': {
        ctx.fillStyle = fog('#a7acb0', f);
        ctx.fillRect(0, 0, w, h * 0.92);
        ctx.beginPath();
        ctx.ellipse(w / 2, h * 0.92, w / 2, h * 0.08, 0, 0, Math.PI);
        ctx.fill();
        if (sk > 3) {
          ctx.strokeStyle = 'rgba(0,0,0,0.2)';
          ctx.lineWidth = 0.05;
          ctx.beginPath();
          for (let y = 1.2; y < h * 0.9; y += 1.2) {
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
          }
          ctx.stroke();
          ctx.strokeStyle = fog('#4d5257', f);
          ctx.lineWidth = 0.06;
          for (let y = 0.4; y < h * 0.9; y += 0.4) {
            ctx.beginPath();
            ctx.moveTo(w * 0.1, y);
            ctx.lineTo(w * 0.1 + 0.5, y);
            ctx.stroke();
          }
        }
        return;
      }
      case 'stack': {
        ctx.fillStyle = fog('#6e3b2e', f);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(w * 0.15, h);
        ctx.lineTo(w * 0.85, h);
        ctx.lineTo(w, 0);
        ctx.fill();
        ctx.fillStyle = fog('#2a2a2c', f);
        for (let y = h * 0.2; y < h; y += h * 0.22) ctx.fillRect(0, y, w, 0.2);
        if (Math.sin(time * 1.6 + seed) > 0) {
          ctx.fillStyle = '#ff3b2e';
          ctx.fillRect(w * 0.3, h - 0.4, w * 0.4, 0.3);
        }
        return;
      }
      case 'crane': {
        ctx.strokeStyle = fog('#c99a2e', f);
        ctx.lineWidth = Math.max(0.12, 1 / sk);
        const mx = w * 0.2;
        ctx.beginPath();
        for (let y = 0; y < h; y += 1.4) {
          ctx.moveTo(mx, y);
          ctx.lineTo(mx + 1.2, y + 1.4);
          ctx.moveTo(mx + 1.2, y);
          ctx.lineTo(mx, y + 1.4);
        }
        ctx.moveTo(mx, 0);
        ctx.lineTo(mx, h);
        ctx.moveTo(mx + 1.2, 0);
        ctx.lineTo(mx + 1.2, h);
        ctx.moveTo(-1, h);
        ctx.lineTo(w, h);
        ctx.moveTo(-1, h + 1);
        ctx.lineTo(w, h + 1);
        ctx.stroke();
        ctx.lineWidth = Math.max(0.04, 0.6 / sk);
        ctx.beginPath();
        const hook = w * 0.85;
        ctx.moveTo(hook, h);
        ctx.lineTo(hook, h * 0.45 + Math.sin(time * 0.5 + seed) * 0.6);
        ctx.stroke();
        return;
      }
      case 'trailer': {
        ctx.fillStyle = fog('#d4d2c8', f);
        ctx.fillRect(0, 0.5, w, h - 0.5);
        ctx.fillStyle = fog('#2b2d31', f);
        ctx.fillRect(0.4, 0, 0.3, 0.5);
        ctx.fillRect(w - 0.7, 0, 0.3, 0.5);
        if (sk > 3) {
          this.window(0.8, 1.5, 1.4, 0.8, true, f, fine);
          this.window(w - 2.2, 1.5, 1.4, 0.8, false, f, fine);
          ctx.fillStyle = fog('#7d7f80', f);
          ctx.fillRect(w * 0.5 - 0.45, 0.5, 0.9, 1.95);
          ctx.fillStyle = fog('#ffb020', f);
          ctx.fillRect(0, h - 0.35, w, 0.18);
          if (fine) this.text(P, p, w / 2, h - 0.75, 'SITE OFFICE', 0.32, '#3a3d42');
        }
        return;
      }
      case 'tree':
      case 'pine': {
        ctx.fillStyle = fog('#3b2a1e', f);
        ctx.fillRect(w / 2 - 0.13, 0, 0.26, h * 0.42);
        const canopy = fog(p.type === 'pine' ? '#1d3a2a' : pick(['#24402b', '#2c4a2e', '#2f4428', '#3a4a2a'], seed), f);
        const shade = fog(p.type === 'pine' ? '#16301f' : '#1b3221', f);
        if (p.type === 'pine') {
          ctx.fillStyle = canopy;
          for (let i = 0; i < 4; i++) {
            const y0 = h * (0.18 + i * 0.19);
            const hw = (w / 2) * (1 - i * 0.2);
            ctx.beginPath();
            ctx.moveTo(w / 2 - hw, y0);
            ctx.lineTo(w / 2, y0 + h * 0.36);
            ctx.lineTo(w / 2 + hw, y0);
            ctx.fill();
          }
        } else {
          // A few overlapping lobes so it reads as a crown, not a ball.
          for (let i = 0; i < 5; i++) {
            const hs = hashString(`${seed}l${i}`);
            const lx = w * (0.25 + ((hs % 100) / 100) * 0.5);
            const ly = h * (0.55 + (((hs >>> 8) % 100) / 100) * 0.3);
            const lr = w * (0.24 + (((hs >>> 16) % 100) / 100) * 0.14);
            ctx.fillStyle = i < 2 ? shade : canopy;
            ctx.beginPath();
            ctx.arc(lx, ly, lr, 0, Math.PI * 2);
            ctx.fill();
          }
          if (fine) {
            ctx.fillStyle = 'rgba(160, 200, 120, 0.08)';
            ctx.beginPath();
            ctx.arc(w * 0.4, h * 0.82, w * 0.22, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        return;
      }
      case 'hedge': {
        ctx.fillStyle = fog('#21382a', f);
        roundRect(ctx, 0, 0, w, h, Math.min(0.4, h / 2));
        ctx.fill();
        if (fine) {
          ctx.fillStyle = 'rgba(120, 170, 110, 0.12)';
          for (let x = 0.2; x < w; x += 0.45) {
            ctx.beginPath();
            ctx.arc(x, h - 0.12, 0.16, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        return;
      }
      case 'bale': {
        ctx.fillStyle = fog('#b08d45', f);
        ctx.beginPath();
        ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        if (fine) {
          ctx.strokeStyle = 'rgba(80, 60, 20, 0.5)';
          ctx.lineWidth = 0.04;
          ctx.beginPath();
          ctx.ellipse(w / 2, h / 2, w * 0.3, h * 0.3, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        return;
      }
      case 'picket': {
        ctx.fillStyle = fog('#c9c3b5', f * 1.3 + 0.15);
        if (sk < 6) {
          ctx.fillRect(0, h * 0.2, w, h * 0.12);
          ctx.fillRect(0, h * 0.65, w, h * 0.12);
          ctx.globalAlpha = 0.6;
          ctx.fillRect(0, 0, w, h);
          ctx.globalAlpha = 1;
          return;
        }
        for (let x = 0; x < w - 0.05; x += 0.14) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h - 0.08);
          ctx.lineTo(x + 0.045, h);
          ctx.lineTo(x + 0.09, h - 0.08);
          ctx.lineTo(x + 0.09, 0);
          ctx.fill();
        }
        ctx.fillRect(0, h * 0.22, w, 0.07);
        ctx.fillRect(0, h * 0.68, w, 0.07);
        return;
      }
      case 'railFence': {
        ctx.fillStyle = fog('#6a5a46', f);
        for (let x = 0; x < w; x += 2.4) ctx.fillRect(x, 0, 0.14, h);
        ctx.fillRect(0, h * 0.45, w, 0.1);
        ctx.fillRect(0, h * 0.85, w, 0.1);
        return;
      }
      case 'chainlink':
      case 'siteFence': {
        const site = p.type === 'siteFence';
        ctx.fillStyle = fog('#7d848c', f);
        const step = site ? w : 3;
        for (let x = 0; x <= w + 0.01; x += step) ctx.fillRect(Math.min(x, w - 0.06), 0, 0.06, h);
        ctx.fillRect(0, h - 0.05, w, 0.05);
        if (site) {
          // Feet and orange scrim.
          ctx.fillStyle = fog('#3b3d40', f);
          ctx.fillRect(-0.3, 0, 0.6, 0.15);
          ctx.fillStyle = fog('#b8641f', f);
          ctx.globalAlpha = 0.32;
          ctx.fillRect(0.05, 0.3, w - 0.1, h * 0.55);
          ctx.globalAlpha = 1;
        }
        if (sk > 8) {
          // Diamond mesh, clipped to the panel.
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, w, h);
          ctx.clip();
          ctx.strokeStyle = 'rgba(160, 168, 176, 0.25)';
          ctx.lineWidth = 0.015;
          ctx.beginPath();
          for (let x = -h; x < w; x += 0.12) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x + h, h);
            ctx.moveTo(x + h, 0);
            ctx.lineTo(x, h);
          }
          ctx.stroke();
          ctx.restore();
        } else {
          ctx.fillStyle = 'rgba(160, 168, 176, 0.12)';
          ctx.fillRect(0, 0, w, h);
        }
        return;
      }
      case 'streetlight': {
        ctx.fillStyle = fog('#3d4249', f);
        ctx.fillRect(0, 0, 0.14, h);
        ctx.fillRect(0, h - 0.08, 1.4, 0.1);
        ctx.fillRect(-0.08, 0, 0.3, 0.6);
        ctx.fillStyle = '#ffe2a6';
        ctx.fillRect(1.05, h - 0.2, 0.45, 0.12);
        // Light pool on the sidewalk and a soft halo.
        this.reset(P);
        const lx = px(P, p.flip ? p.x + p.w - 1.27 : p.x + 1.27, p.k);
        const ly = py(P, h - 0.15, p.k);
        const gy = py(P, 0, p.k);
        const r = sk * 4.5;
        const g = this.ctx.createRadialGradient(lx, gy, 0, lx, gy, r);
        g.addColorStop(0, 'rgba(255, 220, 150, 0.16)');
        g.addColorStop(1, 'rgba(255, 220, 150, 0)');
        this.ctx.fillStyle = g;
        this.ctx.fillRect(lx - r, gy - r * 0.35, r * 2, r * 0.7);
        const hr = Math.max(6, sk * 1.2);
        const g2 = this.ctx.createRadialGradient(lx, ly, 0, lx, ly, hr);
        g2.addColorStop(0, 'rgba(255, 230, 170, 0.5)');
        g2.addColorStop(1, 'rgba(255, 230, 170, 0)');
        this.ctx.fillStyle = g2;
        this.ctx.fillRect(lx - hr, ly - hr, hr * 2, hr * 2);
        return;
      }
      case 'pole': {
        ctx.fillStyle = fog('#4a3a2c', f);
        ctx.fillRect(0, 0, w, h);
        ctx.fillRect(-0.9, h - 0.7, w + 1.8, 0.12);
        if (sk > 4) {
          ctx.fillStyle = fog('#9aa0a6', f);
          for (const x of [-0.8, -0.2, 0.45, 1.0]) ctx.fillRect(x, h - 0.58, 0.08, 0.14);
          ctx.fillStyle = fog('#5c6168', f);
          ctx.fillRect(w, h * 0.7, 0.55, 0.85);
        }
        return;
      }
      case 'hydrant': {
        ctx.fillStyle = fog('#c23b2b', f);
        ctx.fillRect(0.06, 0, w - 0.12, h * 0.8);
        ctx.beginPath();
        ctx.arc(w / 2, h * 0.8, (w - 0.12) / 2, 0, Math.PI);
        ctx.fill();
        ctx.fillRect(-0.04, h * 0.45, w + 0.08, 0.1);
        return;
      }
      case 'mailbox': {
        ctx.fillStyle = fog('#4a3a2c', f);
        ctx.fillRect(w / 2 - 0.04, 0, 0.08, h * 0.75);
        ctx.fillStyle = fog(pick(['#3b4a5a', '#7a2f2a', '#2f3d33'], seed), f);
        roundRect(ctx, 0, h * 0.72, w, h * 0.28, 0.08);
        ctx.fill();
        if (fine && seed % 2) {
          ctx.fillStyle = '#d43c2c';
          ctx.fillRect(w - 0.06, h * 0.86, 0.04, 0.22);
        }
        return;
      }
      case 'bin': {
        ctx.fillStyle = fog(pick(['#2f5a3a', '#3a3f47', '#2f4a6a'], seed), f);
        ctx.fillRect(0.03, 0, w - 0.06, h * 0.92);
        ctx.fillRect(0, h * 0.9, w, 0.08);
        return;
      }
      case 'bench': {
        ctx.fillStyle = fog('#6a5038', f);
        ctx.fillRect(0, 0.42, w, 0.07);
        ctx.fillRect(0, 0.65, w, 0.07);
        ctx.fillRect(0, 0.8, w, 0.07);
        ctx.fillStyle = fog('#2b2d31', f);
        ctx.fillRect(0.12, 0, 0.06, 0.88);
        ctx.fillRect(w - 0.18, 0, 0.06, 0.88);
        return;
      }
      case 'trafficLight': {
        ctx.fillStyle = fog('#2f3339', f);
        ctx.fillRect(0, 0, 0.12, h);
        ctx.fillRect(-0.12, h - 1.0, 0.36, 1.0);
        const phase = Math.floor((time + (seed % 30)) / 6) % 3;
        const colours = ['#ff3b2e', '#ffb020', '#3bd16f'];
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = i === phase ? (colours[i] as string) : '#1a1c20';
          ctx.beginPath();
          ctx.arc(0.06, h - 0.2 - i * 0.3, 0.1, 0, Math.PI * 2);
          ctx.fill();
        }
        return;
      }
      case 'streetSign': {
        ctx.fillStyle = fog('#5a5f66', f);
        ctx.fillRect(w / 2 - 0.03, 0, 0.06, h);
        ctx.fillStyle = fog('#2e6b45', f);
        ctx.fillRect(0, h - 0.32, w, 0.24);
        return;
      }
      case 'stake': {
        ctx.fillStyle = fog('#a07a50', f);
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#ff6a2a';
        ctx.fillRect(0, h - 0.15, w + 0.18, 0.1);
        return;
      }
      case 'jobSign': {
        ctx.fillStyle = fog('#4a4f57', f);
        ctx.fillRect(0.2, 0, 0.1, h * 0.55);
        ctx.fillRect(w - 0.3, 0, 0.1, h * 0.55);
        ctx.fillStyle = '#ffb020';
        ctx.fillRect(0, h * 0.5, w, h * 0.5);
        ctx.fillStyle = '#16181c';
        ctx.fillRect(0.06, h * 0.52, w - 0.12, h * 0.16);
        if (sk > 9) {
          this.text(P, p, w / 2, h * 0.6, 'DEMO DAY', 0.22, '#ffb020');
          this.text(P, p, w / 2, h * 0.79, 'DEMOLITION', 0.17, '#16181c');
          this.text(P, p, w / 2, h * 0.9, 'KEEP CLEAR', 0.15, '#16181c');
        }
        return;
      }
      case 'cone': {
        ctx.fillStyle = '#f26a1f';
        ctx.beginPath();
        ctx.moveTo(0.04, 0.05);
        ctx.lineTo(w / 2, h);
        ctx.lineTo(w - 0.04, 0.05);
        ctx.fill();
        ctx.fillStyle = '#eee';
        ctx.fillRect(w * 0.26, h * 0.42, w * 0.48, h * 0.12);
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, w, 0.05);
        return;
      }
      case 'barrier': {
        ctx.fillStyle = '#2b2d31';
        ctx.fillRect(0.1, 0, 0.06, h);
        ctx.fillRect(w - 0.16, 0, 0.06, h);
        for (const y of [h * 0.55, h * 0.85]) {
          for (let x = 0; x < w; x += 0.3) {
            ctx.fillStyle = Math.round(x / 0.3) % 2 ? '#f2f0ea' : '#e0412c';
            ctx.fillRect(x, y - 0.08, Math.min(0.3, w - x), 0.16);
          }
        }
        if (Math.sin(time * 5 + seed) > 0) {
          ctx.fillStyle = '#ffb020';
          ctx.beginPath();
          ctx.arc(w / 2, h + 0.08, 0.08, 0, Math.PI * 2);
          ctx.fill();
        }
        return;
      }
      case 'car':
      case 'van':
      case 'pickup': {
        this.car(p, f, fine);
        return;
      }
      case 'truck': {
        const body = fog(pick(['#3f6fa8', '#b8403a', '#d0cfc7', '#3c4a3c'], seed), f);
        ctx.fillStyle = fog('#d8d6cc', f);
        ctx.fillRect(0, 0.9, w * 0.7, h - 0.9);
        ctx.fillStyle = body;
        roundRect(ctx, w * 0.72, 0.6, w * 0.28, h * 0.8, 0.25);
        ctx.fill();
        ctx.fillStyle = fog(DARK_GLASS, f);
        ctx.fillRect(w * 0.82, h * 0.48, w * 0.15, h * 0.28);
        this.wheels([w * 0.12, w * 0.24, w * 0.86], 0.5, f);
        return;
      }
      case 'excavator': {
        const yellow = fog('#e3a21a', f);
        ctx.fillStyle = fog('#2b2d31', f);
        roundRect(ctx, 0.2, 0, w * 0.55, 0.85, 0.4);
        ctx.fill();
        ctx.fillStyle = yellow;
        ctx.fillRect(0.4, 0.95, w * 0.5, 0.95);
        ctx.fillRect(0.6, 1.9, w * 0.28, 1.2);
        ctx.fillStyle = fog(DARK_GLASS, f);
        ctx.fillRect(0.75, 2.05, w * 0.18, 0.8);
        // Boom folded up and over, bucket resting on the ground in front of the tracks.
        ctx.strokeStyle = yellow;
        ctx.lineWidth = 0.3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(w * 0.8, 1.6);
        ctx.lineTo(w * 0.98, h * 0.98);
        ctx.lineTo(w * 1.1, 0.7);
        ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.fillStyle = fog('#3a3c40', f);
        ctx.beginPath();
        ctx.moveTo(w * 1.02, 0.75);
        ctx.lineTo(w * 1.2, 0.75);
        ctx.lineTo(w * 1.16, 0.05);
        ctx.lineTo(w * 1.04, 0.05);
        ctx.fill();
        return;
      }
      case 'dumpster': {
        ctx.fillStyle = fog('#c2581d', f);
        ctx.beginPath();
        ctx.moveTo(0, h);
        ctx.lineTo(0.4, 0);
        ctx.lineTo(w - 0.4, 0);
        ctx.lineTo(w, h);
        ctx.fill();
        if (sk > 4) {
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          for (let x = 0.7; x < w - 0.5; x += 0.6) ctx.fillRect(x, 0.15, 0.08, h - 0.3);
          ctx.fillStyle = fog('#6f5a48', f);
          ctx.fillRect(0.2, h - 0.05, w - 0.4, 0.2);
        }
        return;
      }
      case 'container': {
        ctx.fillStyle = fog(pick(['#8a3a2a', '#2f5a7a', '#3f6a3a', '#9a7a2a', '#5a5f66'], p.variant), f);
        ctx.fillRect(0, 0, w, h);
        if (sk > 3) {
          ctx.fillStyle = 'rgba(0,0,0,0.18)';
          for (let x = 0.2; x < w; x += 0.3) ctx.fillRect(x, 0.1, 0.1, h - 0.2);
        }
        return;
      }
      case 'worker': {
        // A tiny figure in a hard hat and hi-vis.
        const skin = pick(['#c99a7a', '#8a5a3c', '#e0b08a', '#6a4a32'], seed);
        ctx.fillStyle = '#2b2f38';
        ctx.fillRect(w * 0.18, 0, w * 0.26, h * 0.46);
        ctx.fillRect(w * 0.56, 0, w * 0.26, h * 0.46);
        ctx.fillStyle = '#f26a1f';
        roundRect(ctx, w * 0.1, h * 0.44, w * 0.8, h * 0.36, 0.06);
        ctx.fill();
        if (sk > 12) {
          ctx.fillStyle = '#e8ff5a';
          ctx.fillRect(w * 0.1, h * 0.56, w * 0.8, 0.04);
        }
        ctx.fillStyle = skin;
        ctx.beginPath();
        ctx.arc(w / 2, h * 0.87, w * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = pick(['#ffd23a', '#f2f0ea', '#ffd23a'], p.variant);
        ctx.beginPath();
        ctx.arc(w / 2, h * 0.9, w * 0.23, 0, Math.PI);
        ctx.fill();
        ctx.fillRect(w * 0.2, h * 0.895, w * 0.62, 0.03);
        return;
      }
    }
  }

  private window(x: number, y: number, w: number, h: number, on: boolean, f: number, fine: boolean): void {
    const ctx = this.ctx;
    if (fine) {
      ctx.fillStyle = fog(TRIM, f);
      ctx.fillRect(x - 0.07, y - 0.1, w + 0.14, h + 0.17);
    }
    ctx.fillStyle = on ? (hashString(`${x}${y}`) % 2 ? LIT : LIT2) : fog(DARK_GLASS, f);
    ctx.fillRect(x, y, w, h);
    if (fine) {
      ctx.fillStyle = fog(TRIM, f);
      ctx.fillRect(x + w / 2 - 0.025, y, 0.05, h);
      ctx.fillRect(x, y + h / 2 - 0.025, w, 0.05);
      if (!on) {
        ctx.fillStyle = 'rgba(160, 190, 230, 0.12)';
        ctx.beginPath();
        ctx.moveTo(x, y + h * 0.3);
        ctx.lineTo(x + w * 0.4, y + h);
        ctx.lineTo(x + w * 0.6, y + h);
        ctx.lineTo(x, y + h * 0.1);
        ctx.fill();
      }
    }
  }

  private car(p: Prop, f: number, fine: boolean): void {
    const ctx = this.ctx;
    const { w, h, seed } = p;
    const body = fog(p.type === 'pickup' && p.variant === 0 ? '#e8e4d8' : pick(CARS, seed), f);
    ctx.fillStyle = body;
    if (p.type === 'van') {
      roundRect(ctx, 0, 0.3, w, h + 0.45, 0.3);
      ctx.fill();
      ctx.fillStyle = fog(DARK_GLASS, f);
      ctx.fillRect(w * 0.76, h * 0.75, w * 0.19, h * 0.42);
      ctx.fillRect(w * 0.08, h * 0.8, w * 0.6, h * 0.35);
    } else {
      roundRect(ctx, 0, 0.3, w, h * 0.42, 0.22);
      ctx.fill();
      ctx.beginPath();
      if (p.type === 'pickup') {
        ctx.moveTo(w * 0.52, h * 0.6);
        ctx.lineTo(w * 0.58, h);
        ctx.lineTo(w * 0.86, h);
        ctx.lineTo(w * 0.94, h * 0.6);
      } else {
        ctx.moveTo(w * 0.18, h * 0.6);
        ctx.lineTo(w * 0.32, h);
        ctx.lineTo(w * 0.72, h);
        ctx.lineTo(w * 0.86, h * 0.6);
      }
      ctx.fill();
      ctx.fillStyle = fog(DARK_GLASS, f);
      ctx.beginPath();
      if (p.type === 'pickup') {
        ctx.moveTo(w * 0.56, h * 0.64);
        ctx.lineTo(w * 0.6, h * 0.94);
        ctx.lineTo(w * 0.84, h * 0.94);
        ctx.lineTo(w * 0.9, h * 0.64);
      } else {
        ctx.moveTo(w * 0.22, h * 0.64);
        ctx.lineTo(w * 0.34, h * 0.94);
        ctx.lineTo(w * 0.7, h * 0.94);
        ctx.lineTo(w * 0.82, h * 0.64);
      }
      ctx.fill();
      if (p.type === 'pickup' && p.variant === 0 && fine) {
        // The crew truck: amber beacon and a stripe.
        ctx.fillStyle = '#ffb020';
        ctx.fillRect(w * 0.66, h, 0.3, 0.12);
        ctx.fillRect(0, h * 0.5, w, 0.06);
      }
    }
    if (fine) {
      ctx.fillStyle = '#ffe9b0';
      ctx.fillRect(w - 0.08, h * 0.52, 0.08, 0.12);
      ctx.fillStyle = '#b02a20';
      ctx.fillRect(0, h * 0.52, 0.07, 0.12);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 0.025;
      ctx.beginPath();
      ctx.moveTo(w * 0.52, 0.35);
      ctx.lineTo(w * 0.52, h * 0.68);
      ctx.stroke();
    }
    this.wheels([w * 0.2, w * 0.8], 0.33, f);
  }

  private wheels(xs: number[], r: number, f: number): void {
    const ctx = this.ctx;
    for (const x of xs) {
      ctx.fillStyle = '#121316';
      ctx.beginPath();
      ctx.arc(x, r, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = fog('#8a8f96', f);
      ctx.beginPath();
      ctx.arc(x, r, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Upright text inside a prop's local frame. */
  private text(P: Projector, p: Prop, lx: number, ly: number, text: string, size: number, colour: string): void {
    const ctx = this.ctx;
    const sk = P.s * p.k;
    const x = px(P, p.flip ? p.x + p.w - lx : p.x + lx, p.k);
    const y = py(P, ly, p.k);
    const fontPx = size * sk;
    if (fontPx < 5) return;
    ctx.save();
    ctx.setTransform(P.dpr, 0, 0, P.dpr, 0, 0);
    ctx.font = `700 ${fontPx.toFixed(1)}px ${LABEL_FONT}`;
    ctx.fillStyle = colour;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  private drawWires(P: Projector, poles: Prop[]): void {
    const ctx = this.ctx;
    poles.sort((a, b) => a.k - b.k || a.x - b.x);
    ctx.strokeStyle = 'rgba(20, 22, 26, 0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < poles.length; i++) {
      const a = poles[i - 1] as Prop;
      const b = poles[i] as Prop;
      if (a.k !== b.k || b.x - a.x > 58) continue;
      const k = a.k;
      const ax = px(P, a.x + a.w / 2, k);
      const bx = px(P, b.x + b.w / 2, k);
      if (Math.max(ax, bx) < -20 || Math.min(ax, bx) > P.width + 20) continue;
      for (const [off, dy] of [[-0.75, 0.5], [0.5, 0.5], [0.1, 1.4]] as Array<[number, number]>) {
        const y = py(P, a.h - dy, k);
        const sag = P.s * k * (b.x - a.x) * 0.03;
        const x1 = ax + off * P.s * k;
        const x2 = bx + off * P.s * k;
        ctx.moveTo(x1, y);
        ctx.quadraticCurveTo((x1 + x2) / 2, y + sag * 2, x2, y);
      }
    }
    ctx.stroke();
  }

  // --------------------------------------------------------- neighbours

  /** The gameplay neighbours, drawn at true scale with real detail. */
  drawNeighbor(P: Projector, n: NeighborDef, hit: boolean, time: number): void {
    const ctx = this.ctx;
    const style = n.style ?? 'house';
    const p: Prop = { type: 'house', x: n.x, w: n.w, h: n.h, k: 1, variant: 0, seed: hashString(n.id) };
    const sk = this.local(P, n.x, 1, n.w);
    const fine = sk > 10;
    const { w, h } = n;
    switch (style) {
      case 'road':
      case 'rail':
      case 'water':
        // These run into the screen and are drawn as crossings; mark the edge on the play plane.
        ctx.fillStyle = style === 'water' ? '#1f4d6b' : style === 'rail' ? '#4a4038' : '#2b2d33';
        ctx.fillRect(0, -0.05, w, Math.max(0.1, h));
        if (style === 'road') {
          ctx.fillStyle = '#9aa0a6';
          for (const x of [0.2, w - 0.35]) {
            ctx.fillRect(x, 0, 0.15, 0.75);
          }
          ctx.fillRect(0.2, 0.55, 0.15, 0.2);
          ctx.fillStyle = '#c8ccd0';
          ctx.fillRect(0.1, 0.55, 0.4, 0.12);
          ctx.fillRect(w - 0.45, 0.55, 0.4, 0.12);
        }
        if (style === 'water' && fine) {
          ctx.strokeStyle = 'rgba(160, 220, 255, 0.35)';
          ctx.lineWidth = 0.04;
          ctx.beginPath();
          for (let x = 0; x < w; x += 0.6) {
            const o = Math.sin(time * 1.5 + x) * 0.04;
            ctx.moveTo(x, 0.08 + o);
            ctx.lineTo(x + 0.3, 0.1 + o);
          }
          ctx.stroke();
        }
        break;
      case 'fence':
        p.type = 'picket';
        this.drawProp(P, { ...p, type: 'picket', k: 1 }, time);
        this.local(P, n.x, 1, n.w);
        ctx.fillStyle = '#7b6a55';
        for (let x = 0; x < w; x += 1.0) ctx.fillRect(x, 0, 0.1, h + 0.05);
        break;
      case 'tank': {
        ctx.fillStyle = '#d6dade';
        roundRect(ctx, 0, h * 0.18, w, h * 0.72, h * 0.36);
        ctx.fill();
        ctx.fillStyle = '#6d7480';
        ctx.fillRect(w * 0.15, 0, w * 0.08, h * 0.25);
        ctx.fillRect(w * 0.77, 0, w * 0.08, h * 0.25);
        ctx.fillRect(w * 0.45, h * 0.88, w * 0.1, h * 0.12);
        if (fine) {
          ctx.fillStyle = '#c23b2b';
          ctx.fillRect(w * 0.3, h * 0.48, w * 0.4, h * 0.14);
          this.text(P, { ...p, k: 1 }, w / 2, h * 0.55, 'PROPANE', Math.min(0.14, h * 0.1), '#ffffff');
        }
        break;
      }
      case 'greenhouse': {
        ctx.fillStyle = 'rgba(150, 200, 180, 0.28)';
        ctx.fillRect(0, 0, w, h * 0.7);
        ctx.beginPath();
        ctx.moveTo(0, h * 0.7);
        ctx.lineTo(w / 2, h);
        ctx.lineTo(w, h * 0.7);
        ctx.fill();
        // Plants inside.
        ctx.fillStyle = '#3c6a3e';
        for (let x = 0.2; x < w - 0.2; x += 0.42) {
          ctx.beginPath();
          ctx.arc(x + 0.1, 0.55 + (hashString(`${x}`) % 4) * 0.05, 0.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#5a4630';
        ctx.fillRect(0.1, 0, w - 0.2, 0.45);
        // Glazing bars.
        ctx.strokeStyle = '#d8e4e0';
        ctx.lineWidth = 0.05;
        ctx.beginPath();
        for (let x = 0; x <= w + 0.01; x += w / 6) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h * 0.7 + (x <= w / 2 ? x / (w / 2) : (w - x) / (w / 2)) * h * 0.3);
        }
        ctx.moveTo(0, h * 0.7);
        ctx.lineTo(w, h * 0.7);
        ctx.moveTo(0, h * 0.35);
        ctx.lineTo(w, h * 0.35);
        ctx.moveTo(0, h * 0.7);
        ctx.lineTo(w / 2, h);
        ctx.lineTo(w, h * 0.7);
        ctx.stroke();
        break;
      }
      case 'substation': {
        ctx.fillStyle = '#3d4249';
        ctx.fillRect(0, 0, w, 0.25);
        // Two transformers with insulators.
        for (const tx of [w * 0.12, w * 0.55]) {
          ctx.fillStyle = '#7d8a7a';
          ctx.fillRect(tx, 0.25, w * 0.33, h * 0.55);
          ctx.fillStyle = '#5d6a5a';
          for (let x = tx + 0.08; x < tx + w * 0.33; x += 0.16) ctx.fillRect(x, 0.35, 0.06, h * 0.42);
          ctx.fillStyle = '#c8b89a';
          for (let i = 0; i < 3; i++) {
            const ix = tx + w * 0.05 + i * w * 0.1;
            for (let j = 0; j < 4; j++) ctx.fillRect(ix - 0.05 - (j % 2) * 0.02, h * 0.8 + j * 0.09, 0.1 + (j % 2) * 0.04, 0.07);
          }
        }
        // Security fence and sign.
        ctx.strokeStyle = 'rgba(170, 176, 184, 0.6)';
        ctx.lineWidth = 0.03;
        ctx.strokeRect(-0.1, 0, w + 0.2, h * 0.65);
        ctx.fillStyle = '#ffd23a';
        ctx.fillRect(w * 0.42, h * 0.3, 0.45, 0.32);
        if (fine) this.text(P, { ...p, k: 1 }, w * 0.42 + 0.225, h * 0.46, '⚡', 0.24, '#111');
        break;
      }
      case 'shed': {
        ctx.fillStyle = '#4f6a5e';
        ctx.fillRect(0, 0, w, h * 0.7);
        ctx.fillStyle = '#3b5147';
        ctx.beginPath();
        ctx.moveTo(-0.1, h * 0.7);
        ctx.lineTo(w / 2, h);
        ctx.lineTo(w + 0.1, h * 0.7);
        ctx.fill();
        break;
      }
      default: {
        // A neighbour's house: real windows, a door, a gutter and a roof.
        this.drawProp(P, { ...p, type: 'house', variant: 2, seed: 7 }, time);
      }
    }
    this.reset(P);
    if (hit && style !== 'road' && style !== 'rail' && style !== 'water') {
      const a = { x: px(P, n.x, 1), y: py(P, n.h, 1) };
      const b = { x: px(P, n.x + n.w, 1), y: py(P, 0, 1) };
      ctx.fillStyle = 'rgba(255, 70, 50, 0.35)';
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    } else if (hit) {
      ctx.fillStyle = 'rgba(255, 70, 50, 0.3)';
      ctx.beginPath();
      ctx.moveTo(px(P, n.x, BACK_K), py(P, 0, BACK_K));
      ctx.lineTo(px(P, n.x + n.w, BACK_K), py(P, 0, BACK_K));
      ctx.lineTo(px(P, n.x + n.w, APRON.end), py(P, 0, APRON.end));
      ctx.lineTo(px(P, n.x, APRON.end), py(P, 0, APRON.end));
      ctx.fill();
    }
  }
}

export const LABEL_FONT = "'Barlow Condensed', 'Avenir Next Condensed', 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif";

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
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
