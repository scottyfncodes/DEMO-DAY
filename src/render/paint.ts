/**
 * Shared drawing helpers for the diorama: the oblique projection, face
 * shading and prisms. Everything is drawn in world metres (x right, y up)
 * through a y-up canvas transform; depth z runs into the scene and is drawn
 * as a constant up-and-right offset, so a 2D simulation reads as a 3D site.
 */

/** Screen offset per metre of depth (in world units). */
export const KX = 0.42;
export const KY = 0.34;

export type Ctx = CanvasRenderingContext2D;

export function px(x: number, z: number): number {
  return x + z * KX;
}

export function py(y: number, z: number): number {
  return y + z * KY;
}

const shadeCache = new Map<string, string>();

/** Multiplies a #rrggbb colour (k < 1 darkens, k > 1 lightens toward white). */
export function shade(hex: string, k: number): string {
  const key = `${hex}|${k.toFixed(3)}`;
  const hit = shadeCache.get(key);
  if (hit) return hit;
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (k <= 1) {
    r *= k;
    g *= k;
    b *= k;
  } else {
    const t = Math.min(1, k - 1);
    r += (255 - r) * t;
    g += (255 - g) * t;
    b += (255 - b) * t;
  }
  const out = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
  if (shadeCache.size > 4000) shadeCache.clear();
  shadeCache.set(key, out);
  return out;
}

/** Mixes two #rrggbb colours. */
export function mix(a: string, b: string, t: number): string {
  const na = parseInt(a.slice(1), 16);
  const nb = parseInt(b.slice(1), 16);
  const ch = (s: number): number => Math.round(((na >> s) & 255) * (1 - t) + ((nb >> s) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/** Light: how bright each face orientation is. The sun is high on the left, in front. */
export const LIGHT = { front: 1, top: 1.14, side: 0.7, back: 0.55 };

export interface PrismColors {
  front: string;
  top?: string;
  side?: string;
}

/**
 * An extruded convex polygon between depths z0 and z1. Faces turned away
 * from the viewer are skipped; `skipSide` drops the right-hand faces (when
 * something stands against them).
 */
export function prism(ctx: Ctx, pts: number[], z0: number, z1: number, col: PrismColors, skipSide = false, skipTop = false): void {
  const n = pts.length / 2;
  const dx = (z1 - z0) * KX;
  const dy = (z1 - z0) * KY;
  const ox = z0 * KX;
  const oy = z0 * KY;
  const top = col.top ?? shade(col.front, LIGHT.top);
  const side = col.side ?? shade(col.front, LIGHT.side);
  // Polygon winding, so outward normals are known whichever way it was given.
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += (pts[i * 2] as number) * (pts[j * 2 + 1] as number) - (pts[j * 2] as number) * (pts[i * 2 + 1] as number);
  }
  const ccw = area > 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = pts[i * 2] as number;
    const ay = pts[i * 2 + 1] as number;
    const bx = pts[j * 2] as number;
    const by = pts[j * 2 + 1] as number;
    // Outward normal of edge a→b.
    let nx = by - ay;
    let ny = -(bx - ax);
    if (!ccw) {
      nx = -nx;
      ny = -ny;
    }
    // Visible when it faces the depth offset direction (up and right).
    const facing = nx * KX + ny * KY;
    if (facing <= 1e-6) continue;
    const isTop = ny > Math.abs(nx) * 0.6;
    if (isTop && skipTop) continue;
    if (!isTop && skipSide) continue;
    ctx.fillStyle = isTop ? top : side;
    ctx.beginPath();
    ctx.moveTo(ax + ox, ay + oy);
    ctx.lineTo(bx + ox, by + oy);
    ctx.lineTo(bx + ox + dx, by + oy + dy);
    ctx.lineTo(ax + ox + dx, ay + oy + dy);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = col.front;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (pts[i * 2] as number) + ox;
    const y = (pts[i * 2 + 1] as number) + oy;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/** Axis-aligned box from (x, y) size w × h, depth z0..z1. */
export function box(ctx: Ctx, x: number, y: number, w: number, h: number, z0: number, z1: number, col: PrismColors, skipSide = false, skipTop = false): void {
  prism(ctx, [x, y, x + w, y, x + w, y + h, x, y + h], z0, z1, col, skipSide, skipTop);
}

/** A rectangle rotated by `a` about (cx, cy), as polygon points. */
export function rotRect(cx: number, cy: number, w: number, h: number, a: number): number[] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const hw = w / 2;
  const hh = h / 2;
  const out: number[] = [];
  for (const [u, v] of [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ] as const) {
    out.push(cx + u * c - v * s, cy + u * s + v * c);
  }
  return out;
}

/** Deterministic 0..1 noise from integers. */
export function hash(a: number, b = 0): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Text drawn the right way up inside the y-up world transform. */
export function worldText(ctx: Ctx, text: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center', weight = 800): void {
  ctx.save();
  ctx.translate(x, y);
  // Fonts are set at 100px and scaled, so tiny world sizes render crisply everywhere.
  ctx.scale(size / 100, -size / 100);
  ctx.font = `${weight} 100px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export const FONT = `'Avenir Next Condensed', 'AvenirNextCondensed-DemiBold', 'Barlow Condensed', 'Roboto Condensed', 'Arial Narrow', sans-serif`;
