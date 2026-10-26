import type { PieceDef } from '../wreck/structure';
import { hash, shade, worldText, type Ctx } from './paint';

/**
 * Front-face detail for every kind of building part: brick coursing, window
 * frames, roller doors, formwork lines, the sign lettering. Detail fades in
 * with zoom so the far view stays clean and the close view has texture.
 */

export interface Style {
  concrete: string;
  brick: string;
  mortar: string;
  trim: string;
  siding: string;
  roof: string;
  door: string;
  awning: string;
  steel: string;
  wood: string;
  glass: string;
  sign: string;
  signText: string;
}

const BASE: Style = {
  concrete: '#bdb4a5',
  brick: '#9a4e35',
  mortar: '#7a3a27',
  trim: '#e3d8c3',
  siding: '#c8b58e',
  roof: '#4c4a48',
  door: '#7b8a8f',
  awning: '#2f6b5a',
  steel: '#6d7a82',
  wood: '#8a6a45',
  glass: '#58798e',
  sign: '#20262b',
  signText: '#f2b705',
};

export const STYLES: Record<string, Style> = {
  corner: { ...BASE, brick: '#a4553a', awning: '#b8402e', trim: '#efe3cc', sign: '#1f3a33', signText: '#f4ead2' },
  garage: { ...BASE, steel: '#55697a', door: '#8f9ba1', concrete: '#c4bcaf', sign: '#d23f2c', signText: '#fff4e0' },
  house: { ...BASE, siding: '#9fb3a2', trim: '#f1ece0', roof: '#5b3b30', brick: '#8c4a37', wood: '#7a5a3a' },
  silo: { ...BASE, concrete: '#cfc7b8', siding: '#a94a33', wood: '#7d5b3b', roof: '#5f6b70' },
  stack: { ...BASE, brick: '#8e4732', mortar: '#6d3324', steel: '#4f5a60', door: '#59666b' },
  warehouse: { ...BASE, brick: '#8b4634', concrete: '#b3ab9d', door: '#3f5a66', sign: '#e8dcc2', signText: '#3a2a22' },
  parkade: { ...BASE, concrete: '#c2bcb0', awning: '#f2b705' },
  halden: { ...BASE, concrete: '#b5ad9f', glass: '#4f6f86', sign: '#1c2329', signText: '#efe6d2' },
};

export function styleFor(id: string): Style {
  return STYLES[id] ?? BASE;
}

/** Base front colour for a piece, before light. */
export function baseColor(p: PieceDef, st: Style): string {
  switch (p.kind) {
    case 'column':
      return p.material === 'brick' ? st.brick : p.material === 'steel' ? st.steel : p.material === 'wood' ? st.wood : st.concrete;
    case 'beam':
    case 'roof':
      return p.material === 'wood' ? shade(st.wood, 1.1) : p.material === 'steel' ? st.steel : p.material === 'brick' ? st.brick : shade(st.concrete, 1.06);
    case 'glass':
      return st.glass;
    case 'shopfront':
      return '#27323a';
    case 'brick':
      return p.material === 'concrete' ? '#a9a49a' : st.brick;
    case 'siding':
      return st.siding;
    case 'door':
      return st.door;
    case 'core':
      return shade(st.concrete, 0.93);
    case 'stack':
      return st.brick;
    case 'truss':
      return '#39434b';
    case 'parapet':
      return st.concrete;
    case 'gable':
      return st.siding;
    case 'tank':
      return '#8a6440';
    case 'sign':
      return st.sign;
    default:
      return st.steel;
  }
}

/** Colour of the top face (roof surfaces get their membrane). */
export function topColor(p: PieceDef, st: Style, front: string): string {
  if (p.kind === 'roof') return p.material === 'steel' ? '#7c878d' : p.material === 'wood' ? '#5d5650' : '#8c877d';
  if (p.kind === 'gable') return st.roof;
  return shade(front, 1.14);
}

/**
 * Detail over the front face of a piece at (x, y). `fine` is pixels per
 * metre: cheap marks at a distance, texture close up.
 */
export function drawFacade(ctx: Ctx, p: PieceDef, x: number, y: number, st: Style, fine: number, buildingId: string, sign?: string): void {
  const w = p.w;
  const h = p.h;
  const seed = p.seed;
  switch (p.kind) {
    case 'column': {
      if (p.material === 'steel') {
        ctx.fillStyle = shade(st.steel, 0.7);
        ctx.fillRect(x + w * 0.42, y, w * 0.16, h);
        ctx.fillStyle = shade(st.steel, 1.2);
        ctx.fillRect(x, y, w * 0.12, h);
        if (fine > 14) {
          ctx.fillStyle = shade(st.steel, 0.55);
          for (let yy = y + 0.6; yy < y + h; yy += 1.4) ctx.fillRect(x + w * 0.2, yy, w * 0.6, 0.06);
        }
      } else if (p.material === 'brick') {
        brickTexture(ctx, x, y, w, h, st, fine, seed);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(x, y, w * 0.18, h);
      } else if (p.material === 'wood') {
        ctx.fillStyle = shade(st.wood, 0.8);
        ctx.fillRect(x + w * 0.65, y, w * 0.35, h);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fillRect(x, y, w * 0.2, h);
        ctx.fillStyle = 'rgba(0,0,0,0.10)';
        ctx.fillRect(x + w * 0.72, y, w * 0.28, h);
        if (fine > 16) {
          ctx.fillStyle = 'rgba(0,0,0,0.10)';
          for (let yy = y + 1.2; yy < y + h - 0.3; yy += 1.2) ctx.fillRect(x, yy, w, 0.03);
        }
      }
      break;
    }
    case 'beam':
    case 'roof': {
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(x, y, w, h * 0.3);
      if (p.kind === 'roof') {
        ctx.fillStyle = shade(st.trim, 0.95);
        ctx.fillRect(x, y + h - 0.12, w, 0.12);
      }
      if (p.material === 'wood' && fine > 10) {
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        for (let xx = x + 0.4; xx < x + w; xx += 0.6) ctx.fillRect(xx, y + 0.05, 0.08, h - 0.1);
      }
      if (buildingId === 'parkade' && fine > 6) {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(x, y + h * 0.55, w, 0.05);
      }
      break;
    }
    case 'glass': {
      window(ctx, x, y, w, h, st, fine, seed, buildingId === 'house' ? st.trim : '#3a454e', buildingId === 'house' || buildingId === 'corner');
      break;
    }
    case 'shopfront': {
      ctx.fillStyle = '#1b2228';
      ctx.fillRect(x, y, w, h);
      // Lit interior and a reflection.
      ctx.fillStyle = hash(seed) < 0.5 ? 'rgba(236,196,120,0.35)' : 'rgba(150,186,200,0.25)';
      ctx.fillRect(x + 0.15, y + 0.25, w - 0.3, h - 1.5);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath();
      ctx.moveTo(x + w * 0.15, y + 0.25);
      ctx.lineTo(x + w * 0.35, y + 0.25);
      ctx.lineTo(x + w * 0.6, y + h - 1.3);
      ctx.lineTo(x + w * 0.4, y + h - 1.3);
      ctx.fill();
      // Striped awning.
      ctx.fillStyle = st.awning;
      ctx.fillRect(x - 0.15, y + h - 1.15, w + 0.3, 0.6);
      if (fine > 7) {
        ctx.fillStyle = st.trim;
        for (let xx = x; xx < x + w; xx += 0.7) ctx.fillRect(xx, y + h - 1.15, 0.35, 0.6);
      }
      ctx.fillStyle = '#4a5560';
      ctx.fillRect(x + w / 2 - 0.04, y, 0.08, h - 1.15);
      break;
    }
    case 'brick': {
      if (p.material === 'concrete') {
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        if (fine > 9) for (let yy = y + 0.4; yy < y + h; yy += 0.4) ctx.fillRect(x, yy, w, 0.03);
        if (fine > 9) for (let yy = y; yy < y + h; yy += 0.4) for (let xx = x + ((Math.round((yy - y) / 0.4) % 2) * 0.4); xx < x + w; xx += 0.8) ctx.fillRect(xx, yy, 0.03, 0.4);
        break;
      }
      brickTexture(ctx, x, y, w, h, st, fine, seed);
      if (h > 2) punched(ctx, x, y, w, h, st, fine, seed);
      break;
    }
    case 'siding': {
      ctx.fillStyle = 'rgba(0,0,0,0.13)';
      if (fine > 6) for (let yy = y + 0.25; yy < y + h; yy += 0.25) ctx.fillRect(x, yy, w, 0.035);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x, y, 0.12, h);
      if (buildingId === 'house' && p.y < 1 && h > 2) {
        // Front door with a lamp.
        const dw = 1.1;
        const dx = x + (w - dw) / 2;
        ctx.fillStyle = st.trim;
        ctx.fillRect(dx - 0.12, y, dw + 0.24, 2.25);
        ctx.fillStyle = '#6b2f2a';
        ctx.fillRect(dx, y, dw, 2.1);
        ctx.fillStyle = '#e9c27a';
        ctx.fillRect(dx + dw + 0.3, y + 1.7, 0.18, 0.25);
      } else if (h > 2) window(ctx, x + w * 0.25, y + h * 0.3, w * 0.5, h * 0.48, st, fine, seed, st.trim, true);
      break;
    }
    case 'door': {
      ctx.fillStyle = shade(st.door, 0.85);
      ctx.fillRect(x + 0.15, y, w - 0.3, h - 0.25);
      if (fine > 5) {
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        for (let yy = y + 0.2; yy < y + h - 0.3; yy += 0.22) ctx.fillRect(x + 0.15, yy, w - 0.3, 0.04);
      }
      ctx.fillStyle = '#f2b705';
      ctx.fillRect(x + 0.15, y, w - 0.3, 0.12);
      break;
    }
    case 'core': {
      if (buildingId === 'silo') {
        // Slip-formed staves and the steel hoops round them.
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        for (let xx = x + 0.4; xx < x + w; xx += 0.55) ctx.fillRect(xx, y, 0.04, h);
        ctx.fillStyle = shade(st.steel, 0.8);
        ctx.fillRect(x, y + h * 0.3, w, 0.08);
        ctx.fillRect(x, y + h * 0.75, w, 0.08);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(x, y, w * 0.2, h);
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        if (fine > 8) for (let xx = x + 0.6; xx < x + w; xx += 1.2) ctx.fillRect(xx, y, 0.03, h);
        if (fine > 14) {
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          for (let xx = x + 0.3; xx < x + w; xx += 0.6) for (let yy = y + 0.45; yy < y + h; yy += 0.9) ctx.fillRect(xx, yy, 0.06, 0.06);
        }
      }
      break;
    }
    case 'stack': {
      brickTexture(ctx, x, y, w, h, st, fine, seed);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x, y + h - 0.35, w, 0.35);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x, y, w * 0.25, h);
      break;
    }
    case 'truss': {
      ctx.fillStyle = 'rgba(14,18,22,0.6)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = st.steel;
      ctx.lineWidth = Math.min(0.24, h * 0.12);
      ctx.strokeRect(x + 0.12, y + 0.12, w - 0.24, h - 0.24);
      ctx.beginPath();
      const bays = Math.max(1, Math.round(w / Math.max(1.2, h)));
      for (let i = 0; i < bays; i++) {
        const x0 = x + 0.12 + ((w - 0.24) * i) / bays;
        const x1 = x + 0.12 + ((w - 0.24) * (i + 1)) / bays;
        ctx.moveTo(x0, i % 2 ? y + h - 0.12 : y + 0.12);
        ctx.lineTo(x1, i % 2 ? y + 0.12 : y + h - 0.12);
        ctx.moveTo(x1, y + 0.12);
        ctx.lineTo(x1, y + h - 0.12);
      }
      ctx.stroke();
      break;
    }
    case 'parapet': {
      ctx.fillStyle = 'rgba(0,0,0,0.1)';
      ctx.fillRect(x, y, w, 0.1);
      ctx.fillStyle = '#f2b705';
      ctx.fillRect(x, y + h - 0.22, w, 0.12);
      if (fine > 8) {
        ctx.fillStyle = '#1d1f21';
        for (let xx = x; xx < x + w; xx += 0.6) ctx.fillRect(xx, y + h - 0.22, 0.3, 0.12);
      }
      break;
    }
    case 'gable': {
      // Shingle courses up the gable end, and a vent.
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      if (fine > 6) for (let yy = y + 0.25; yy < y + h; yy += 0.25) ctx.fillRect(x, yy, w, 0.035);
      ctx.fillStyle = st.trim;
      ctx.fillRect(x + w / 2 - 0.4, y + h * 0.35, 0.8, 0.6);
      break;
    }
    case 'tank': {
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      for (let yy = y + 0.5; yy < y + h - 0.8; yy += 0.7) ctx.fillRect(x + 0.1, yy, w - 0.2, 0.09);
      break;
    }
    case 'sign': {
      ctx.fillStyle = shade(st.sign, 0.75);
      ctx.fillRect(x, y, w, 0.12);
      ctx.fillRect(x, y + h - 0.12, w, 0.12);
      if (sign) worldText(ctx, sign, x + w / 2, y + h / 2, Math.min(h * 0.62, (w / Math.max(4, sign.length)) * 1.55), st.signText);
      break;
    }
    case 'legs':
    case 'mast':
      break;
  }
}

function brickTexture(ctx: Ctx, x: number, y: number, w: number, h: number, st: Style, fine: number, seed: number): void {
  if (fine < 7) return;
  ctx.fillStyle = st.mortar;
  const course = fine > 22 ? 0.15 : 0.3;
  for (let yy = y + course; yy < y + h; yy += course) ctx.fillRect(x, yy, w, 0.025);
  if (fine > 16) {
    let row = 0;
    for (let yy = y; yy < y + h; yy += course) {
      const off = row++ % 2 ? 0.12 : 0;
      for (let xx = x + off; xx < x + w; xx += 0.24) ctx.fillRect(xx, yy, 0.02, course);
    }
  }
  // A few odd bricks so the wall is not a flat print.
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let i = 0; i < 4; i++) {
    const u = hash(seed, i);
    const v = hash(seed, i + 9);
    ctx.fillRect(x + u * (w - 0.3), y + v * (h - 0.2), 0.24, course * 0.8);
  }
}

function window(ctx: Ctx, x: number, y: number, w: number, h: number, st: Style, fine: number, seed: number, frame: string, sash: boolean): void {
  ctx.fillStyle = frame;
  ctx.fillRect(x, y, w, h);
  const m = Math.min(0.14, w * 0.06);
  const r = hash(seed, 3);
  // Panes: sky reflection at the top, darker below; some lit, some boarded.
  if (r < 0.08) {
    ctx.fillStyle = '#a5814e';
    ctx.fillRect(x + m, y + m, w - 2 * m, h - 2 * m);
    if (fine > 8) {
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(x + m, y + h * 0.33, w - 2 * m, 0.05);
      ctx.fillRect(x + m, y + h * 0.66, w - 2 * m, 0.05);
    }
    return;
  }
  const lit = r > 0.86;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, lit ? '#c99b55' : shade(st.glass, 0.62));
  g.addColorStop(1, lit ? '#e7c07a' : shade(st.glass, 1.12));
  ctx.fillStyle = g;
  ctx.fillRect(x + m, y + m, w - 2 * m, h - 2 * m);
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  ctx.beginPath();
  ctx.moveTo(x + m + w * 0.1, y + m);
  ctx.lineTo(x + m + w * 0.32, y + m);
  ctx.lineTo(x + w * 0.62, y + h - m);
  ctx.lineTo(x + w * 0.4, y + h - m);
  ctx.fill();
  if (fine > 6) {
    ctx.fillStyle = frame;
    if (sash) {
      ctx.fillRect(x, y + h * 0.5 - 0.04, w, 0.08);
      ctx.fillRect(x + w / 2 - 0.035, y, 0.07, h);
    } else {
      const n = Math.max(1, Math.round(w / 1.4));
      for (let i = 1; i < n; i++) ctx.fillRect(x + (w * i) / n - 0.035, y, 0.07, h);
      ctx.fillRect(x, y + h * 0.72, w, 0.05);
    }
  }
}

function punched(ctx: Ctx, x: number, y: number, w: number, h: number, st: Style, fine: number, seed: number): void {
  const ww = Math.min(1.7, w * 0.42);
  const wh = Math.min(2.2, h * 0.55);
  const wx = x + (w - ww) / 2;
  const wy = y + h * 0.26;
  window(ctx, wx, wy, ww, wh, st, fine, seed, '#3b3430', true);
  ctx.fillStyle = st.trim;
  ctx.fillRect(wx - 0.12, wy - 0.14, ww + 0.24, 0.14);
  ctx.fillRect(wx - 0.08, wy + wh, ww + 0.16, 0.16);
}

/** Cracks, chipped edges and exposed rebar as a piece loses its strength. */
export function drawDamage(ctx: Ctx, p: PieceDef, x: number, y: number, lost: number, fine: number): void {
  if (lost < 0.2 || p.material === 'glass') return;
  const n = Math.min(6, Math.floor(lost * 7));
  ctx.strokeStyle = 'rgba(28,22,18,0.75)';
  ctx.lineWidth = Math.max(0.04, 1.4 / Math.max(8, fine));
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    let cx = x + hash(p.seed, i) * p.w;
    let cy = y + hash(p.seed, i + 20) * p.h;
    ctx.moveTo(cx, cy);
    const len = Math.min(p.w, p.h) * (0.3 + lost * 0.6);
    for (let k = 0; k < 4; k++) {
      cx += (hash(p.seed, i * 7 + k) - 0.5) * len;
      cy += (hash(p.seed, i * 11 + k + 3) - 0.5) * len;
      ctx.lineTo(Math.max(x, Math.min(x + p.w, cx)), Math.max(y, Math.min(y + p.h, cy)));
    }
  }
  ctx.stroke();
  if (lost > 0.55 && p.carriesOthers) {
    // Spalled cover: a dark bite out of the edge with rebar showing.
    const by = y + p.h * (0.2 + hash(p.seed, 99) * 0.5);
    const bh = Math.min(p.h * 0.3, 1.2);
    ctx.fillStyle = 'rgba(40,32,28,0.85)';
    ctx.beginPath();
    ctx.moveTo(x, by);
    ctx.lineTo(x + p.w * 0.45, by + bh * 0.3);
    ctx.lineTo(x + p.w * 0.3, by + bh);
    ctx.lineTo(x, by + bh * 0.8);
    ctx.fill();
    if (p.material === 'concrete') {
      ctx.strokeStyle = '#a3592f';
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.moveTo(x + 0.1, by);
      ctx.lineTo(x + 0.15, by + bh);
      ctx.moveTo(x + 0.28, by + 0.05);
      ctx.lineTo(x + 0.3, by + bh * 0.9);
      ctx.stroke();
    }
  }
}
