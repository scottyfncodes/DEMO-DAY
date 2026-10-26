import type { Camera } from '../render/camera';
import { drawCharge } from '../render/charges';
import { DT, PIECE_STANDING, type WreckSim } from './sim';
import type { PieceDef } from './structure';
import {
  CHARGE_KINDS,
  FLAW_SHOWN,
  FUSE_TICKS,
  HEAVY_BLOCK,
  SITE_LAYOUT,
  chargePos,
  dozerBlade,
  excavatorArm,
  type Block,
  type Tool,
} from './tools';

/**
 * Everything drawn for the job beyond the building and the crane: the site,
 * debris blocks, the machines, charges, weak points and score call-outs.
 * World-space functions expect the y-up metre transform; screen-space ones
 * expect CSS pixels.
 */

export interface Floater {
  text: string;
  x: number;
  y: number;
  /** performance.now() when it appeared. */
  at: number;
  tone: 'gold' | 'white' | 'red';
  big?: boolean;
}

const M = {
  exc: '#d98a2b',
  excShade: '#9d5f1d',
  dozer: '#e2b23a',
  dozerShade: '#a37d22',
  track: '#25272a',
  trackLug: '#3b3e42',
  glass: '#1d2a33',
  steel: '#58646c',
  steelDark: '#39424a',
  hazard: '#ffb020',
};

const FONT = `'Avenir Next Condensed', 'Barlow Condensed', 'Arial Narrow', sans-serif`;

// ------------------------------------------------------------------- site

export function drawNeighbour(ctx: CanvasRenderingContext2D, scale: number): void {
  // Pellow's Bakery: a two-storey brick shop next door. Debris past the tape lands on it.
  const x0 = 68;
  const x1 = 86;
  ctx.fillStyle = '#6e3d2e';
  ctx.fillRect(x0, 0, x1 - x0, 10.5);
  ctx.fillStyle = '#5a3125';
  ctx.fillRect(x0 - 0.3, 10.5, x1 - x0 + 0.6, 0.6);
  // Upper windows.
  ctx.fillStyle = '#2a2420';
  for (let x = x0 + 1.4; x < x1 - 1; x += 3.4) ctx.fillRect(x, 6.2, 1.7, 2.6);
  ctx.fillStyle = '#c4b49b';
  for (let x = x0 + 1.4; x < x1 - 1; x += 3.4) ctx.fillRect(x - 0.1, 6.05, 1.9, 0.15);
  // Shopfront and awning.
  ctx.fillStyle = '#1b2026';
  ctx.fillRect(x0 + 1, 0, x1 - x0 - 2, 3.6);
  ctx.fillStyle = 'rgba(255,210,150,0.18)';
  ctx.fillRect(x0 + 1.4, 0.3, x1 - x0 - 2.8, 2.9);
  for (let x = x0 + 0.6; x < x1 - 0.6; x += 0.9) {
    ctx.fillStyle = Math.round((x - x0) / 0.9) % 2 === 0 ? '#2f5d4f' : '#d8cfbf';
    ctx.fillRect(x, 3.6, 0.9, 0.7);
  }
  if (scale > 3) {
    ctx.save();
    ctx.translate((x0 + x1) / 2, 4.7);
    ctx.scale(1, -1);
    ctx.font = `800 1.3px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8d9b8';
    ctx.fillText('PELLOW’S BAKERY', 0, 0);
    ctx.restore();
  }
}

export function drawSiteMarks(ctx: CanvasRenderingContext2D, scale: number, sim: WreckSim): void {
  const L = SITE_LAYOUT;
  // Haul pit: a sunken hopper the trucks load from.
  ctx.fillStyle = '#16130f';
  ctx.beginPath();
  ctx.moveTo(L.pitMin, 0);
  ctx.lineTo(L.pitMin + 1.2, -2.6);
  ctx.lineTo(L.pitMax - 1.2, -2.6);
  ctx.lineTo(L.pitMax, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#4a4d52';
  ctx.fillRect(L.pitMin - 0.4, -0.2, 0.4, 0.9);
  ctx.fillRect(L.pitMax, -0.2, 0.4, 0.9);
  hazardStripe(ctx, L.pitMin - 0.4, 0.55, L.pitMax - L.pitMin + 0.8, 0.18);
  // Salvage pad: a raised slab with a steel rack at the back.
  ctx.fillStyle = '#5b574f';
  ctx.fillRect(L.padMin, 0, L.padMax - L.padMin, 0.18);
  ctx.strokeStyle = M.steelDark;
  ctx.lineWidth = 0.14;
  ctx.beginPath();
  for (let x = L.padMin + 0.6; x < L.padMax; x += 2.4) {
    ctx.moveTo(x, 0.18);
    ctx.lineTo(x, 2.4);
  }
  ctx.moveTo(L.padMin + 0.6, 2.3);
  ctx.lineTo(L.padMax - 0.6, 2.3);
  ctx.moveTo(L.padMin + 0.6, 1.3);
  ctx.lineTo(L.padMax - 0.6, 1.3);
  ctx.stroke();
  // What has been salvaged so far, stacked on the rack.
  const t = sim.state.tally;
  const bars = Math.min(10, Math.round(t.steelSalvaged / 6));
  ctx.fillStyle = '#6d7a82';
  for (let i = 0; i < bars; i++) ctx.fillRect(L.padMin + 1 + (i % 5) * 1.6, 0.18 + Math.floor(i / 5) * 0.32, 1.4, 0.26);
  if (t.vaultSaved >= 0) drawVaultShape(ctx, L.padMax - 2.6, 0.18, 2.2, 1.9, scale);
  // Lot tape posts, and the line Pellow's starts at.
  for (const [x, col] of [
    [L.lotMin, '#ffb020'],
    [L.lotMax, '#ffb020'],
    [L.neighbourX, '#ff5a36'],
  ] as const) {
    ctx.fillStyle = '#3b3e42';
    ctx.fillRect(x - 0.06, 0, 0.12, 1.1);
    ctx.fillStyle = col;
    ctx.fillRect(x - 0.12, 1.0, 0.24, 0.12);
  }
  if (scale > 3.5) {
    label(ctx, 'SALVAGE', (L.padMin + L.padMax) / 2, 3.0, 1);
    label(ctx, 'HAUL PIT', (L.pitMin + L.pitMax) / 2, 1.3, 1);
  }
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, -1);
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(232,217,184,0.75)';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function hazardStripe(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = '#1c1b18';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = M.hazard;
  for (let xx = x; xx < x + w; xx += 0.8) ctx.fillRect(xx, y, 0.4, h);
}

// ----------------------------------------------------------------- blocks

export function drawBlocks(ctx: CanvasRenderingContext2D, sim: WreckSim, scale: number, which: 'vault' | 'debris', tool: Tool, time: number): void {
  for (const b of sim.state.blocks) {
    if ((b.kind === 'vault') !== (which === 'vault')) continue;
    if (b.kind === 'vault') {
      drawVaultShape(ctx, b.x - b.w / 2, b.y, b.w, b.h, scale);
      continue;
    }
    drawBlock(ctx, b, scale, (tool === 'dozer' || tool === 'excavator') && b.mass > HEAVY_BLOCK, time);
  }
}

function drawBlock(ctx: CanvasRenderingContext2D, b: Block, scale: number, warn: boolean, time: number): void {
  const x = b.x - b.w / 2;
  const tilt = (((b.seed >>> 3) % 9) - 4) * 0.02;
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(tilt);
  ctx.translate(-b.x, -b.y);
  if (b.kind === 'steel') {
    // A length of truss or frame steel: flanges and a web.
    ctx.fillStyle = M.steelDark;
    ctx.fillRect(x, b.y, b.w, b.h);
    ctx.fillStyle = M.steel;
    ctx.fillRect(x, b.y + b.h - 0.12, b.w, 0.12);
    ctx.fillRect(x, b.y, b.w, 0.12);
    if (scale > 6) {
      ctx.strokeStyle = M.steel;
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      for (let xx = x + 0.2; xx < x + b.w - 0.4; xx += 0.9) {
        ctx.moveTo(xx, b.y + 0.12);
        ctx.lineTo(xx + 0.45, b.y + b.h - 0.12);
        ctx.lineTo(xx + 0.9, b.y + 0.12);
      }
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = '#958f85';
    ctx.fillRect(x, b.y, b.w, b.h);
    ctx.fillStyle = '#7b766e';
    ctx.fillRect(x, b.y, b.w, b.h * 0.3);
    // Broken ends with bars sticking out.
    ctx.strokeStyle = '#9b6440';
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    for (const ex of [x, x + b.w]) {
      for (let k = 0; k < 3; k++) {
        const yy = b.y + b.h * (0.25 + k * 0.25);
        ctx.moveTo(ex, yy);
        ctx.lineTo(ex + (ex === x ? -1 : 1) * (0.2 + ((b.seed >> k) % 3) * 0.12), yy + 0.1);
      }
    }
    ctx.stroke();
    if (b.hp < b.maxHp) {
      ctx.strokeStyle = '#2b2622';
      ctx.lineWidth = Math.max(0.04, 1 / scale);
      ctx.beginPath();
      ctx.moveTo(b.x - 0.2, b.y + b.h);
      ctx.lineTo(b.x + 0.1, b.y + b.h * 0.5);
      ctx.lineTo(b.x - 0.1, b.y);
      ctx.stroke();
    }
  }
  if (warn) {
    // Too heavy for the dozer: the excavator has to break it first.
    ctx.strokeStyle = `rgba(255,176,32,${0.55 + 0.3 * Math.sin(time * 5)})`;
    ctx.lineWidth = Math.max(0.08, 2 / scale);
    ctx.strokeRect(x - 0.15, b.y - 0.05, b.w + 0.3, b.h + 0.2);
  }
  ctx.restore();
}

function drawVaultShape(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, scale: number): void {
  ctx.fillStyle = '#2d3238';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#454c54';
  ctx.fillRect(x + 0.12, y + 0.12, w - 0.24, h - 0.24);
  ctx.strokeStyle = '#8c949c';
  ctx.lineWidth = 0.06;
  ctx.strokeRect(x + 0.25, y + 0.25, w - 0.5, h - 0.5);
  // The dial.
  ctx.fillStyle = '#b8a47a';
  ctx.beginPath();
  ctx.arc(x + w * 0.62, y + h * 0.52, Math.min(w, h) * 0.17, 0, Math.PI * 2);
  ctx.fill();
  if (scale > 8) {
    ctx.strokeStyle = '#2d3238';
    ctx.lineWidth = 0.04;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      ctx.moveTo(x + w * 0.62, y + h * 0.52);
      ctx.lineTo(x + w * 0.62 + Math.cos(a) * Math.min(w, h) * 0.17, y + h * 0.52 + Math.sin(a) * Math.min(w, h) * 0.17);
    }
    ctx.stroke();
  }
  ctx.fillStyle = '#8c949c';
  ctx.fillRect(x + w * 0.2, y + h * 0.35, 0.1, h * 0.3);
}

// --------------------------------------------------------------- machines

function tracks(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, h: number): void {
  ctx.fillStyle = M.track;
  ctx.beginPath();
  roundRect(ctx, x0, y, x1 - x0, h, h / 2);
  ctx.fill();
  ctx.fillStyle = M.trackLug;
  for (let x = x0 + 0.4; x < x1 - 0.3; x += 0.7) ctx.fillRect(x, y + 0.1, 0.3, 0.16);
  ctx.fillStyle = '#4a4d52';
  for (let x = x0 + h * 0.5; x < x1 - h * 0.3; x += 1.2) {
    ctx.beginPath();
    ctx.arc(x, y + h / 2, h * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }
}

function beacon(ctx: CanvasRenderingContext2D, x: number, y: number, on: boolean): void {
  ctx.fillStyle = on ? '#ffb020' : '#6a4a10';
  ctx.fillRect(x - 0.15, y, 0.3, 0.3);
}

export function drawExcavator(ctx: CanvasRenderingContext2D, sim: WreckSim, scale: number, time: number, active: boolean): void {
  const e = sim.state.exc;
  const f = e.face;
  const x = e.x;
  const y = e.y;
  tracks(ctx, x - 3.2, x + 3.2, y, 1.1);
  // Upper works: counterweight at the back, cab at the front beside the boom foot.
  ctx.fillStyle = M.excShade;
  ctx.fillRect(x - 2.6, y + 1.1, 5.2, 0.45);
  ctx.fillStyle = M.exc;
  ctx.fillRect(x - 2.8, y + 1.55, 5.0, 1.9);
  ctx.fillStyle = '#4a4d52';
  // Counterweight at the back.
  ctx.fillRect(f > 0 ? x - 3.4 : x + 2.5, y + 1.6, 0.9, 1.7);
  ctx.fillStyle = M.exc;
  const cabX = f > 0 ? x + 0.3 : x - 2.1;
  ctx.fillRect(cabX, y + 3.45, 1.8, 1.6);
  ctx.fillStyle = M.glass;
  ctx.fillRect(cabX + (f > 0 ? 0.8 : 0.1), y + 3.65, 0.9, 1.2);
  beacon(ctx, cabX + 0.9, y + 5.05, e.stunned > 0 ? Math.sin(time * 12) > 0 : e.biting && Math.sin(time * 8) > 0);
  // Boom, stick and the crusher.
  const arm = excavatorArm(e, e.jawX, e.jawY);
  ctx.lineCap = 'round';
  ctx.strokeStyle = M.excShade;
  ctx.lineWidth = 0.95;
  line(ctx, arm.px, arm.py, arm.ex, arm.ey);
  ctx.strokeStyle = M.exc;
  ctx.lineWidth = 0.75;
  line(ctx, arm.px, arm.py, arm.ex, arm.ey);
  ctx.strokeStyle = M.excShade;
  ctx.lineWidth = 0.6;
  line(ctx, arm.ex, arm.ey, arm.jx, arm.jy);
  ctx.strokeStyle = M.exc;
  ctx.lineWidth = 0.45;
  line(ctx, arm.ex, arm.ey, arm.jx, arm.jy);
  // Hydraulic ram along the boom.
  ctx.strokeStyle = '#c9ccd0';
  ctx.lineWidth = 0.14;
  const mx = arm.px + (arm.ex - arm.px) * 0.55;
  const my = arm.py + (arm.ey - arm.py) * 0.55 - 0.5;
  line(ctx, arm.px + f * 0.4, arm.py - 0.8, mx, my);
  ctx.lineCap = 'butt';
  // Jaws open and close with each bite.
  const dirX = arm.jx - arm.ex;
  const dirY = arm.jy - arm.ey;
  const len = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / len;
  const uy = dirY / len;
  const open = 0.55 * (1 - e.jaw);
  ctx.fillStyle = '#2f3236';
  for (const side of [-1, 1]) {
    const nx = -uy * side;
    const ny = ux * side;
    ctx.beginPath();
    ctx.moveTo(arm.jx - ux * 0.3 + nx * 0.2, arm.jy - uy * 0.3 + ny * 0.2);
    ctx.lineTo(arm.jx + ux * 1.1 + nx * (0.25 + open), arm.jy + uy * 1.1 + ny * (0.25 + open));
    ctx.lineTo(arm.jx + ux * 1.25 + nx * open * 0.4, arm.jy + uy * 1.25 + ny * open * 0.4);
    ctx.lineTo(arm.jx + ux * 0.2, arm.jy + uy * 0.2);
    ctx.closePath();
    ctx.fill();
  }
  if (e.stunned > 0) stunMark(ctx, x, y + 5.6, time);
  if (active && scale < 5) outlineMachine(ctx, x - 3.4, y, 6.8, 5.4, scale);
}

export function drawDozer(ctx: CanvasRenderingContext2D, sim: WreckSim, scale: number, time: number, active: boolean): void {
  const d = sim.state.dozer;
  const x = d.x;
  const y = d.y;
  const f = d.dir;
  tracks(ctx, x - 2.5, x + 2.5, y, 1.0);
  ctx.fillStyle = M.dozerShade;
  ctx.fillRect(x - 2.3, y + 1.0, 4.6, 0.4);
  // Engine hood toward the blade, cab at the back.
  ctx.fillStyle = M.dozer;
  const hood0 = f > 0 ? x - 0.4 : x - 2.1;
  ctx.fillRect(hood0, y + 1.4, 2.5, 1.2);
  const cab0 = f > 0 ? x - 2.2 : x + 0.4;
  ctx.fillRect(cab0, y + 1.4, 1.8, 2.3);
  ctx.fillStyle = M.glass;
  ctx.fillRect(cab0 + 0.25, y + 2.3, 1.3, 1.1);
  ctx.fillStyle = '#2f3236';
  ctx.fillRect(f > 0 ? x + 1.4 : x - 1.6, y + 2.6, 0.2, 0.9);
  beacon(ctx, cab0 + 0.9, y + 3.7, d.stunned > 0 ? Math.sin(time * 12) > 0 : Math.abs(d.speed) > 0.3 && Math.sin(time * 8) > 0);
  // Push arm and blade, raised when reversing.
  const bx = dozerBlade(d);
  const lift = d.bladeDown ? 0 : 0.45;
  ctx.strokeStyle = M.dozerShade;
  ctx.lineWidth = 0.28;
  line(ctx, x, y + 0.7, bx - f * 0.3, y + 0.5 + lift);
  ctx.fillStyle = M.dozer;
  ctx.beginPath();
  ctx.moveTo(bx, y + lift);
  ctx.lineTo(bx, y + 1.7 + lift);
  ctx.quadraticCurveTo(bx - f * 0.55, y + 0.9 + lift, bx - f * 0.15, y + lift);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#c9ccd0';
  ctx.fillRect(Math.min(bx, bx - f * 0.12), y + lift, 0.12, 0.18);
  if (d.stunned > 0) stunMark(ctx, x, y + 4.2, time);
  if (active && scale < 5) outlineMachine(ctx, x - 3.4, y, 6.8, 4.2, scale);
}

function stunMark(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  ctx.fillStyle = `rgba(255,90,54,${0.6 + 0.4 * Math.sin(time * 10)})`;
  ctx.beginPath();
  ctx.moveTo(x, y + 1.2);
  ctx.lineTo(x - 0.7, y);
  ctx.lineTo(x + 0.7, y);
  ctx.closePath();
  ctx.fill();
}

function outlineMachine(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, scale: number): void {
  ctx.strokeStyle = 'rgba(255,176,32,0.7)';
  ctx.lineWidth = 2 / scale;
  ctx.strokeRect(x, y, w, h);
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
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

// ------------------------------------------------- charge mode (world space)

/** In charge mode, the members a charge can go on are picked out. */
export function drawChargeTargets(ctx: CanvasRenderingContext2D, sim: WreckSim, scale: number): void {
  const s = sim.state;
  ctx.strokeStyle = 'rgba(255,176,32,0.32)';
  ctx.lineWidth = Math.max(0.05, 1 / scale);
  for (const p of sim.def.pieces) {
    if (s.status[p.id] !== PIECE_STANDING || !CHARGE_KINDS.has(p.kind) || p.kind === 'beam' || p.kind === 'roof') continue;
    ctx.strokeRect(p.x, p.y, p.w, p.h);
  }
}

// --------------------------------------------------------- screen overlays

export function drawFlawMarks(ctx: CanvasRenderingContext2D, sim: WreckSim, cam: Camera, time: number): void {
  const s = sim.state;
  for (const id of sim.h.flaws) {
    if (s.flaw[id] !== FLAW_SHOWN || s.status[id] !== PIECE_STANDING) continue;
    const p = sim.def.pieces[id] as PieceDef;
    const c = cam.worldToScreen(p.x + p.w / 2, p.y + p.h * 0.72);
    const r = 7 + Math.sin(time * 4 + id) * 0.8;
    ctx.fillStyle = 'rgba(16,22,30,0.85)';
    ctx.strokeStyle = '#ffb020';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y - r);
    ctx.lineTo(c.x + r, c.y);
    ctx.lineTo(c.x, c.y + r);
    ctx.lineTo(c.x - r, c.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // A crack through it.
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(c.x - 2, c.y - r * 0.55);
    ctx.lineTo(c.x + 1.5, c.y - 1);
    ctx.lineTo(c.x - 1.5, c.y + 1.5);
    ctx.lineTo(c.x + 1, c.y + r * 0.55);
    ctx.stroke();
  }
}

export function drawChargeMarks(ctx: CanvasRenderingContext2D, sim: WreckSim, cam: Camera, time: number): void {
  const s = sim.state;
  const size = Math.max(16, Math.min(30, cam.drawScale * 0.9));
  let n = 0;
  const set = s.charges.filter((c) => c.state === 0).sort((a, b) => a.order - b.order);
  for (const c of s.charges) {
    if (c.state === 2) continue;
    const pos = chargePos(sim, c);
    const sp = cam.worldToScreen(pos.x, pos.y);
    const burn = c.state === 1 ? Math.max(0, Math.min(1, 1 - (c.fireTick - s.tick) / FUSE_TICKS)) : 0;
    drawCharge(ctx, c.kind === 'cutter' ? 'shaped' : 'heavy', sp.x, sp.y, size, { time, lit: c.state === 1 ? 1 : 0, burn, phase: c.id * 0.37 });
    if (c.state === 0) {
      n = set.indexOf(c) + 1;
      // Firing order.
      const bx = sp.x + size * 0.55;
      const by = sp.y - size * 0.55;
      ctx.fillStyle = '#ffb020';
      ctx.beginPath();
      ctx.arc(bx, by, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1a1200';
      ctx.font = `800 11px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n), bx, by + 0.5);
    } else if (c.fireTick - s.tick < 60) {
      const sec = Math.max(0, (c.fireTick - s.tick) * DT);
      ctx.fillStyle = '#ff5a36';
      ctx.font = `800 13px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(sec.toFixed(1), sp.x, sp.y - size * 0.7);
    }
  }
}

export function drawToolMarks(ctx: CanvasRenderingContext2D, sim: WreckSim, cam: Camera, tool: Tool): void {
  const s = sim.state;
  if (tool === 'excavator') {
    const e = s.exc;
    const t = cam.worldToScreen(e.targetX, Math.max(0.6, e.targetY));
    ctx.strokeStyle = 'rgba(255,176,32,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 13, 0, Math.PI * 2);
    ctx.moveTo(t.x - 19, t.y);
    ctx.lineTo(t.x - 8, t.y);
    ctx.moveTo(t.x + 8, t.y);
    ctx.lineTo(t.x + 19, t.y);
    ctx.moveTo(t.x, t.y - 19);
    ctx.lineTo(t.x, t.y - 8);
    ctx.moveTo(t.x, t.y + 8);
    ctx.lineTo(t.x, t.y + 19);
    ctx.stroke();
  } else if (tool === 'dozer') {
    const d = s.dozer;
    const g = cam.worldToScreen(d.targetX + d.dir * 3.25, 0);
    ctx.fillStyle = 'rgba(255,176,32,0.9)';
    ctx.beginPath();
    ctx.moveTo(g.x, g.y - 4);
    ctx.lineTo(g.x - 7, g.y - 16);
    ctx.lineTo(g.x + 7, g.y - 16);
    ctx.closePath();
    ctx.fill();
  }
}

export function drawFloaters(ctx: CanvasRenderingContext2D, cam: Camera, floaters: Floater[], now: number): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const f of floaters) {
    const age = (now - f.at) / 1000;
    if (age > 1.8) continue;
    const p = cam.worldToScreen(f.x, f.y);
    const rise = age * 26;
    const a = Math.min(1, (1.8 - age) * 2) * Math.min(1, age * 8);
    const size = f.big ? 26 : 17;
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.globalAlpha = a;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(10,12,16,0.85)';
    ctx.strokeText(f.text, p.x, p.y - rise);
    ctx.fillStyle = f.tone === 'gold' ? '#ffb020' : f.tone === 'red' ? '#ff5a36' : '#f2efe8';
    ctx.fillText(f.text, p.x, p.y - rise);
  }
  ctx.globalAlpha = 1;
}
