import type { IncidentDef } from '../wreck/buildings';
import { PIECE_STANDING, type WreckSim } from '../wreck/sim';
import type { PieceDef } from '../wreck/structure';
import type { Block } from '../wreck/tools';
import { KX, KY, box, hash, prism, px, py, rotRect, shade, type Ctx } from './paint';

/**
 * Everything the fight left behind, drawn: monster parts and mech wreckage
 * on the lot, a tentacle still round the silo, frost on Maple Street, laser
 * scorches, fires, and the kaiju walking off over the horizon.
 */

const SKIN = '#3f7a62';
const SKIN_DARK = '#2b5444';
const SUCKER = '#e6c9a8';
const MECH = '#8c98a3';
const MECH_DARK = '#4b555e';
const GLOW = '#59e0ff';

/** A relic on the ground, by its look. Pulses gold so it reads as worth saving. */
export function drawRelic(ctx: Ctx, b: Block, D: number, time: number): void {
  const z0 = D * 0.2;
  const z1 = z0 + Math.min(D * 0.55, Math.max(1.4, b.w * 0.7));
  const tilt = ((b.seed % 9) - 4) * 0.03;
  const cx = b.x;
  const y = b.y;
  switch (b.look) {
    case 'shield': {
      // Lying face up where it landed: red rim, cream face, the bolt.
      prism(ctx, rotRect(cx, y + b.h / 2, b.w, b.h, tilt), z0, z0 + 1.7, { front: '#a3251b', top: '#c8342a' });
      const mz = z0 + 0.85;
      ctx.fillStyle = '#f4ead2';
      ctx.beginPath();
      ctx.ellipse(px(cx, mz), py(y + b.h + 0.01, mz), b.w * 0.33, 0.85 * 0.33 * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      lightning(ctx, px(cx, mz), py(y + b.h + 0.02, mz), 0.32, '#f2b705');
      break;
    }
    case 'mech-arm': {
      // Forearm, wrist joint and three fat fingers, sparking at the torn elbow.
      prism(ctx, rotRect(cx - 0.6, y + 0.7, b.w * 0.7, 1.2, tilt), z0, z1, { front: MECH, top: shade(MECH, 1.15) });
      prism(ctx, rotRect(cx + b.w * 0.32, y + 0.65, 1.1, 1.3, tilt), z0, z1, { front: MECH_DARK });
      for (let k = 0; k < 3; k++) prism(ctx, rotRect(cx + b.w * 0.5, y + 0.25 + k * 0.42, 0.9, 0.3, 0.2), z0 + k * 0.4, z0 + k * 0.4 + 0.5, { front: MECH });
      ctx.fillStyle = MECH_DARK;
      for (let k = 0; k < 4; k++) ctx.fillRect(px(cx - 1.8 + k * 0.6, z0), py(y + 0.35, z0), 0.12, 0.7);
      spark(ctx, px(cx - b.w * 0.38, z0), py(y + 0.8, z0), time);
      break;
    }
    case 'plating': {
      prism(ctx, rotRect(cx, y + 0.3, b.w, 0.6, tilt), z0, z1, { front: MECH, top: '#a9b3bc' });
      ctx.fillStyle = '#f2b705';
      for (let k = 0; k < 3; k++) ctx.fillRect(px(cx - b.w / 2 + 0.3 + k * 0.7, z0), py(y + 0.15, z0), 0.35, 0.3);
      break;
    }
    case 'freeze-ray': {
      prism(ctx, rotRect(cx, y + 0.4, b.w, 0.5, tilt), z0, z0 + 0.5, { front: '#d9e6ee', top: '#f4fbff' });
      prism(ctx, [cx + 0.7, y + 0.15, cx + 1.1, y + 0.05, cx + 1.1, y + 0.75, cx + 0.7, y + 0.65], z0, z0 + 0.5, { front: '#7fd3f5' });
      ctx.fillStyle = `rgba(127,211,245,${0.35 + Math.sin(time * 5) * 0.2})`;
      ctx.beginPath();
      ctx.arc(px(cx + 1.15, z0), py(y + 0.4, z0), 0.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'tentacle': {
      // A severed length of Gorrath: a fat tapering coil, suckers up.
      const n = 9;
      const pts: number[] = [];
      const top: number[] = [];
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const x = cx - b.w / 2 + u * b.w;
        const r = b.h * (0.55 - u * 0.35);
        const wave = Math.sin(u * 5 + b.seed) * 0.25;
        pts.push(x, y + wave * 0.3);
        top.push(x, y + r * 2 + wave);
      }
      const poly = [...pts];
      for (let i = top.length - 2; i >= 0; i -= 2) poly.push(top[i] as number, top[i + 1] as number);
      prism(ctx, poly, z0, z1, { front: SKIN, top: shade(SKIN, 1.15), side: SKIN_DARK });
      ctx.fillStyle = SUCKER;
      for (let i = 1; i < n; i += 1) {
        const x = cx - b.w / 2 + (i / n) * b.w;
        ctx.beginPath();
        ctx.ellipse(px(x, z0), py(y + 0.3, z0), 0.16 * (1 - i / n / 1.5), 0.1, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#7a1f2a';
      ctx.beginPath();
      ctx.ellipse(px(cx - b.w / 2, z0 + 0.6), py(y + b.h * 0.55, z0 + 0.6), 0.3, b.h * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'tooth': {
      prism(ctx, [cx - 0.7, y, cx + 0.7, y, cx + 0.25, y + b.h * 0.8, cx - 0.05, y + b.h, cx - 0.4, y + b.h * 0.7], z0, z0 + 1.2, { front: '#eee4cf', top: '#fff8e8', side: '#c9bfa8' });
      ctx.fillStyle = '#8f3a2c';
      ctx.fillRect(px(cx - 0.7, z0), py(y, z0), 1.4, 0.25);
      break;
    }
    case 'helmet': {
      prism(ctx, [cx - 0.9, y, cx + 0.9, y, cx + 0.9, y + 1.0, cx + 0.5, y + 1.6, cx - 0.5, y + 1.6, cx - 0.9, y + 1.0], z0, z0 + 1.6, { front: '#5b5f63', top: '#73787c' });
      ctx.fillStyle = '#e2392b';
      ctx.fillRect(px(cx - 0.65, z0), py(y + 0.75, z0), 1.3, 0.25);
      ctx.fillStyle = `rgba(255,80,40,${0.5 + Math.sin(time * 3) * 0.3})`;
      ctx.fillRect(px(cx - 0.55, z0), py(y + 0.78, z0), 1.1, 0.18);
      break;
    }
    case 'scale': {
      prism(ctx, [cx - b.w / 2, y, cx + b.w / 2, y, cx + b.w * 0.3, y + b.h, cx - b.w * 0.3, y + b.h * 0.9], z0, z1, { front: '#4a8a6a', top: '#66a884', side: SKIN_DARK });
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      for (let k = 1; k < 4; k++) {
        ctx.moveTo(px(cx - b.w / 2 + k * 0.6, z0), py(y + 0.1, z0));
        ctx.quadraticCurveTo(px(cx - b.w / 2 + k * 0.6 + 0.2, z0), py(y + b.h * 0.6, z0), px(cx - b.w / 2 + k * 0.6 + 0.4, z0), py(y + b.h * 0.8, z0));
      }
      ctx.stroke();
      break;
    }
    case 'claw': {
      // Three hooked talons on a knuckle.
      prism(ctx, rotRect(cx - b.w * 0.25, y + 0.6, b.w * 0.5, 1.2, tilt), z0, z1, { front: SKIN_DARK, top: SKIN });
      for (let k = 0; k < 3; k++) {
        const ox = cx + k * 0.15;
        const oz = z0 + 0.3 + k * 0.9;
        prism(ctx, [ox, y + 0.2, ox + 1.5, y, ox + 2.1, y + 0.6, ox + 1.9, y + 1.9, ox + 1.5, y + 0.9, ox + 0.2, y + 1.1], oz, oz + 0.5, { front: '#ece0c6', top: '#fff7e6', side: '#b9ad94' });
      }
      break;
    }
    case 'core': {
      prism(ctx, rotRect(cx, y + b.h / 2, b.w, b.h, tilt), z0, z0 + b.w, { front: MECH_DARK, top: MECH });
      const pulse = 0.5 + Math.sin(time * 6) * 0.5;
      const g = ctx.createRadialGradient(px(cx, z0), py(y + b.h / 2, z0), 0.1, px(cx, z0), py(y + b.h / 2, z0), 1.6);
      g.addColorStop(0, `rgba(160,245,255,${0.9})`);
      g.addColorStop(0.35, `rgba(89,224,255,${0.5 + pulse * 0.3})`);
      g.addColorStop(1, 'rgba(89,224,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px(cx, z0), py(y + b.h / 2, z0), 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = GLOW;
      ctx.beginPath();
      ctx.arc(px(cx, z0), py(y + b.h / 2, z0), 0.45, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default:
      prism(ctx, rotRect(cx, y + b.h / 2, b.w, b.h, tilt), z0, z1, { front: MECH });
  }
  // The "worth saving" ring.
  const glow = 0.5 + Math.sin(time * 4 + b.seed) * 0.5;
  ctx.strokeStyle = `rgba(242,183,5,${0.35 + glow * 0.45})`;
  ctx.lineWidth = 0.13;
  ctx.setLineDash([0.5, 0.3]);
  ctx.beginPath();
  ctx.ellipse(px(cx, z0 + 0.8), py(0.05, z0 + 0.8), b.w / 2 + 0.9, 0.9, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** The kaiju egg: it glows, it wobbles, it is definitely alive. */
export function drawEgg(ctx: Ctx, b: Block, D: number, time: number): void {
  const z = D * 0.3;
  const wob = Math.sin(time * 2.2) * 0.05;
  const cx = px(b.x, z);
  const cy = py(b.y + b.h / 2, z);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(wob);
  const g = ctx.createRadialGradient(-0.3, 0.4, 0.1, 0, 0, b.h * 0.7);
  g.addColorStop(0, '#b9f0c9');
  g.addColorStop(0.5, '#5fae7c');
  g.addColorStop(1, '#2f5f45');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,240,170,0.75)';
  for (let k = 0; k < 6; k++) {
    ctx.beginPath();
    ctx.arc(Math.cos(k * 1.7) * b.w * 0.25, Math.sin(k * 2.3) * b.h * 0.3, 0.09, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#18301f';
  ctx.lineWidth = 0.06;
  ctx.beginPath();
  ctx.moveTo(-0.2, b.h * 0.3);
  ctx.lineTo(0.05, b.h * 0.15);
  ctx.lineTo(-0.1, 0);
  ctx.lineTo(0.15, -0.15);
  ctx.stroke();
  ctx.restore();
}

function lightning(ctx: Ctx, x: number, y: number, s: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + 0.1 * s, y + s);
  ctx.lineTo(x - 0.4 * s, y - 0.1 * s);
  ctx.lineTo(x, y - 0.05 * s);
  ctx.lineTo(x - 0.15 * s, y - s);
  ctx.lineTo(x + 0.4 * s, y + 0.15 * s);
  ctx.lineTo(x, y + 0.1 * s);
  ctx.closePath();
  ctx.fill();
}

function spark(ctx: Ctx, x: number, y: number, time: number): void {
  const on = Math.sin(time * 23) > 0.3;
  if (!on) return;
  ctx.strokeStyle = '#fff2a8';
  ctx.lineWidth = 0.06;
  ctx.beginPath();
  for (let k = 0; k < 5; k++) {
    const a = k * 1.3 + time * 7;
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * 0.6, y + Math.sin(a) * 0.6);
  }
  ctx.stroke();
}

const standing = (sim: WreckSim, label: string): PieceDef | undefined => {
  const p = sim.def.pieces.find((q) => q.label === label);
  return p && sim.state.status[p.id] === PIECE_STANDING ? p : undefined;
};

/** Marks of the fight on whatever still stands. Drawn over the building's front. */
export function drawScars(ctx: Ctx, sim: WreckSim, inc: IncidentDef, D: number, time: number): void {
  const s = sim.state;
  const pieces = sim.def.pieces;
  switch (inc.scar) {
    case 'ice': {
      // Frost on every face and icicles off every slab.
      for (const p of pieces) {
        if (s.status[p.id] !== PIECE_STANDING) continue;
        ctx.fillStyle = 'rgba(190,228,246,0.2)';
        ctx.fillRect(p.x, p.y, p.w, p.h);
        if (!(p.horizontal && p.carriesOthers)) continue;
        ctx.fillStyle = 'rgba(236,249,255,0.4)';
        ctx.beginPath();
        ctx.moveTo(px(p.x, 0), py(p.y + p.h, 0));
        ctx.lineTo(px(p.x + p.w, 0), py(p.y + p.h, 0));
        ctx.lineTo(px(p.x + p.w, D), py(p.y + p.h, D));
        ctx.lineTo(px(p.x, D), py(p.y + p.h, D));
        ctx.fill();
        if (p.horizontal && p.carriesOthers) {
          ctx.fillStyle = 'rgba(220,244,255,0.85)';
          for (let x = p.x + 0.2; x < p.x + p.w - 0.2; x += 0.55) {
            const len = 0.25 + hash(Math.round(x * 10), p.id) * 0.6;
            ctx.beginPath();
            ctx.moveTo(x, p.y);
            ctx.lineTo(x + 0.18, p.y);
            ctx.lineTo(x + 0.09, p.y - len);
            ctx.fill();
          }
        }
      }
      break;
    }
    case 'tentacle': {
      // Gorrath's arm, still wound round the silo, holding on to whatever stands.
      const walls = pieces.filter((p) => p.kind === 'core' && s.status[p.id] === PIECE_STANDING);
      if (!walls.length) break;
      let x0 = Infinity;
      let x1 = -Infinity;
      for (const p of walls) {
        x0 = Math.min(x0, p.x - 0.7);
        x1 = Math.max(x1, p.x + p.w + 0.7);
      }
      const top = Math.max(...walls.map((p) => p.y + p.h));
      for (let band = 0; band < 3; band++) {
        const by = 5 + band * 6.5;
        if (by > top - 1) break;
        const sway = Math.sin(time * 1.3 + band) * 0.2;
        ctx.fillStyle = SKIN;
        ctx.beginPath();
        ctx.moveTo(x0, by + sway);
        ctx.bezierCurveTo(x0 + (x1 - x0) * 0.3, by + 2.2 + sway, x0 + (x1 - x0) * 0.7, by - 0.6, x1, by + 1.8);
        ctx.lineTo(x1, by + 0.4);
        ctx.bezierCurveTo(x0 + (x1 - x0) * 0.7, by - 2, x0 + (x1 - x0) * 0.3, by + 0.8 + sway, x0, by - 1.3 + sway);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = SUCKER;
        for (let k = 1; k < 6; k++) {
          const u = k / 6;
          ctx.beginPath();
          ctx.ellipse(x0 + (x1 - x0) * u, by + 0.15 + Math.sin(u * 3) * 0.6, 0.22, 0.14, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'mech-arm': {
      const col = standing(sim, 'Column E · floor 2') ?? standing(sim, 'Column E · floor 1');
      if (!col) break;
      // The arm comes down through the hole in the roof, fist buried in the floor.
      const ax = 20.5;
      const top = col.y + col.h + 3;
      const z = D * 0.45;
      prism(ctx, [ax - 0.8, 0.4, ax + 0.9, 0.4, ax + 2.6, top, ax + 1.0, top + 0.6], z, z + 1.6, { front: MECH, top: shade(MECH, 1.2) });
      box(ctx, ax + 1.6, top - 0.2, 2.4, 1.6, z - 0.2, z + 1.8, { front: MECH_DARK });
      spark(ctx, px(ax + 2.8, z), py(top + 0.6, z), time);
      ctx.fillStyle = '#f2b705';
      for (let k = 0; k < 3; k++) ctx.fillRect(px(ax - 0.2 + k * 0.6, z), py(1.6 + k * 1.3, z), 0.35, 0.2);
      break;
    }
    case 'crater':
    case 'laser':
    case 'claw-marks':
    case 'bite':
    case 'footprint': {
      for (const p of pieces) {
        if (s.status[p.id] !== PIECE_STANDING) continue;
        const r = hash(p.id, 77);
        if (inc.scar === 'laser' && r < 0.18) {
          // Captain Photon missed. A lot.
          ctx.strokeStyle = 'rgba(30,18,12,0.75)';
          ctx.lineWidth = 0.35;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y + p.h * r * 4);
          ctx.lineTo(p.x + p.w, p.y + p.h * (1 - r * 3));
          ctx.stroke();
          ctx.strokeStyle = `rgba(255,140,40,${0.45 + Math.sin(time * 4 + p.id) * 0.25})`;
          ctx.lineWidth = 0.1;
          ctx.stroke();
        } else if (inc.scar === 'claw-marks' && p.y > 30 && p.y < 48 && p.x > 16 && p.x < 36 && p.kind !== 'core') {
          ctx.strokeStyle = 'rgba(22,16,12,0.8)';
          ctx.lineWidth = 0.4;
          ctx.beginPath();
          for (let k = 0; k < 3; k++) {
            const o = k * 1.2;
            ctx.moveTo(p.x + o, p.y + p.h);
            ctx.lineTo(p.x + o + 1.2, p.y);
          }
          ctx.stroke();
        } else if ((inc.scar === 'crater' || inc.scar === 'bite' || inc.scar === 'footprint') && r < 0.3) {
          ctx.fillStyle = 'rgba(25,18,14,0.35)';
          ctx.beginPath();
          ctx.arc(p.x + p.w * r * 3, p.y + p.h * 0.7, Math.min(p.w, p.h) * 0.45, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
  }
  void KX;
  void KY;
}

/** Flames on whatever is still burning, and the smoke going up from it. */
export function drawFires(ctx: Ctx, sim: WreckSim, labels: string[], D: number, time: number): void {
  for (const label of labels) {
    const p = standing(sim, label);
    if (!p) continue;
    const z = 0.05;
    const baseY = p.y + p.h * 0.35;
    // Smoke first, so the flames sit in front of it.
    for (let k = 0; k < 5; k++) {
      const u = (time * 0.22 + k / 5 + hash(p.id, k) * 0.2) % 1;
      const sx = px(p.x + p.w * 0.5 + u * 3 + Math.sin(u * 6 + k) * 0.6, D * 0.4);
      const sy = py(baseY + 1 + u * 9, D * 0.4);
      ctx.fillStyle = `rgba(40,36,34,${0.4 * (1 - u)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, 0.8 + u * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    const prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    const n = Math.max(3, Math.round(p.w / 0.9));
    for (let i = 0; i < n; i++) {
      const fx = p.x + 0.3 + ((p.w - 0.6) * (i + 0.5)) / n;
      const flick = 0.75 + Math.sin(time * 11 + i * 2.1 + p.id) * 0.25;
      const hgt = (0.9 + hash(p.id, i) * 1.1) * flick;
      for (const [col, k] of [
        ['rgba(255,90,20,0.55)', 1],
        ['rgba(255,190,60,0.6)', 0.62],
        ['rgba(255,245,200,0.6)', 0.3],
      ] as Array<[string, number]>) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(px(fx - 0.35 * k, z), py(baseY, z));
        ctx.quadraticCurveTo(px(fx - 0.3 * k, z), py(baseY + hgt * k * 0.6, z), px(fx + Math.sin(time * 7 + i) * 0.12, z), py(baseY + hgt * k, z));
        ctx.quadraticCurveTo(px(fx + 0.3 * k, z), py(baseY + hgt * k * 0.6, z), px(fx + 0.35 * k, z), py(baseY, z));
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = prev;
  }
}

/** Screen-space: whatever started all this, still out there. */
export function drawHorizonEvent(ctx: Ctx, cause: IncidentDef['cause'], width: number, horizon: number, scale: number, time: number): void {
  if (cause === 'kaiju') {
    // Gorrath, wandering off toward the next city.
    const h = Math.min(220, Math.max(70, scale * 30));
    const span = width + h * 3;
    const x = ((time * 6) % span) - h * 1.5;
    const step = Math.sin(time * 1.6) * h * 0.02;
    ctx.fillStyle = 'rgba(78,92,96,0.55)';
    ctx.beginPath();
    ctx.moveTo(x - h * 0.6, horizon);
    ctx.lineTo(x - h * 0.35, horizon - h * 0.5 + step);
    ctx.quadraticCurveTo(x - h * 0.25, horizon - h * 0.95, x + h * 0.05, horizon - h * 0.95);
    ctx.lineTo(x + h * 0.32, horizon - h * 0.88);
    ctx.lineTo(x + h * 0.22, horizon - h * 0.76);
    ctx.lineTo(x + h * 0.08, horizon - h * 0.78);
    ctx.quadraticCurveTo(x + h * 0.15, horizon - h * 0.45, x + h * 0.05, horizon - step);
    ctx.lineTo(x - h * 0.05, horizon);
    ctx.lineTo(x - h * 0.18, horizon - h * 0.3);
    ctx.lineTo(x - h * 0.3, horizon);
    ctx.closePath();
    ctx.fill();
    // Back spikes and a tail.
    for (let k = 0; k < 5; k++) {
      const sx = x - h * 0.33 + k * h * 0.07;
      const sy = horizon - h * (0.55 + k * 0.08);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - h * 0.08, sy - h * 0.06);
      ctx.lineTo(sx + h * 0.02, sy - h * 0.02);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(x - h * 0.55, horizon - h * 0.2);
    ctx.quadraticCurveTo(x - h * 1.1, horizon - h * 0.05, x - h * 1.4, horizon);
    ctx.lineTo(x - h * 0.5, horizon);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,214,90,0.8)';
    ctx.beginPath();
    ctx.arc(x + h * 0.14, horizon - h * 0.88, Math.max(1.5, h * 0.015), 0, Math.PI * 2);
    ctx.fill();
  } else if (cause === 'hero') {
    // A hero streaking across the sky every few seconds, leaving a trail.
    const cycle = 7;
    const t = (time % cycle) / 1.6;
    if (t < 1) {
      const x = -60 + t * (width + 120);
      const y = horizon * 0.25 + Math.sin(t * 3) * 20;
      const g = ctx.createLinearGradient(x - 160, y + 30, x, y);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(255,238,170,0.85)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x - 160, y + 30);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = '#c8342a';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (cause === 'mech') {
    // A distant mech, one eye glowing, standing very still.
    const h = Math.min(200, Math.max(60, scale * 26));
    const x = width * 0.82;
    ctx.fillStyle = 'rgba(80,92,104,0.5)';
    ctx.fillRect(x - h * 0.12, horizon - h * 0.95, h * 0.24, h * 0.42);
    ctx.fillRect(x - h * 0.2, horizon - h * 0.55, h * 0.4, h * 0.2);
    ctx.fillRect(x - h * 0.18, horizon - h * 0.35, h * 0.12, h * 0.35);
    ctx.fillRect(x + h * 0.06, horizon - h * 0.35, h * 0.12, h * 0.35);
    ctx.fillRect(x - h * 0.34, horizon - h * 0.55, h * 0.12, h * 0.36);
    ctx.fillStyle = `rgba(89,224,255,${0.6 + Math.sin(time * 2) * 0.3})`;
    ctx.fillRect(x - h * 0.04, horizon - h * 0.85, h * 0.08, h * 0.04);
  } else {
    // The villain's frost cloud hanging over the street.
    ctx.fillStyle = 'rgba(210,236,250,0.35)';
    for (let k = 0; k < 5; k++) {
      ctx.beginPath();
      ctx.arc(width * (0.15 + k * 0.18) + Math.sin(time * 0.4 + k) * 10, horizon * 0.35 + (k % 2) * 14, 40 + k * 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** The news helicopter that turns up at every one of these. */
export function drawHelicopter(ctx: Ctx, width: number, horizon: number, time: number): void {
  const x = width * 0.5 + Math.sin(time * 0.18) * width * 0.4;
  const y = horizon * 0.3 + Math.sin(time * 0.7) * 8;
  const dir = Math.cos(time * 0.18) >= 0 ? 1 : -1;
  ctx.fillStyle = '#2e3236';
  ctx.beginPath();
  ctx.ellipse(x, y, 11, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - dir * 24, y - 2, dir * 16, 3);
  ctx.fillStyle = '#9cc3d3';
  ctx.beginPath();
  ctx.ellipse(x + dir * 5, y - 1, 4, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,30,30,0.6)';
  ctx.lineWidth = 2;
  const blade = Math.cos(time * 40) * 20;
  ctx.beginPath();
  ctx.moveTo(x - blade, y - 8);
  ctx.lineTo(x + blade, y - 8);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 7px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('NEWS', x - 2, y + 2.5);
}
