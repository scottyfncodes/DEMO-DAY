import type { Kit } from '../wreck/kit';
import { BOOM_FOOT_Y, craneFoot, craneHook, type WreckSim } from '../wreck/sim';
import { LOADER_REACH, excavatorArm, excavatorPivot } from '../wreck/tools';
import { box, prism, px, py, shade, type Ctx } from './paint';

/**
 * The fleet, drawn chunky: safety-yellow bodies, dark running gear, glass
 * cabs, all extruded in depth like the building. Every pose comes from the
 * simulation state, so what you see the machine doing is what it is doing.
 */

export const Y = { body: '#f2b705', dark: '#262a2d', steel: '#5d676e', glass: '#9cc3d3', rubber: '#1d1f21', light: '#ffd76a', rust: '#7a4a2c' };

/** Depth band the machines drive in, in front of the building face. */
export const MZ0 = -3.6;
export const MZ1 = 0.2;

/** Polygon in machine space (u forward, v up) mapped to world x, y. */
function poly(cx: number, cy: number, dir: number, uv: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < uv.length; i += 2) out.push(cx + (uv[i] as number) * dir, cy + (uv[i + 1] as number));
  return out;
}

function wheel(ctx: Ctx, x: number, y: number, r: number, z0: number, z1: number, spin: number): void {
  const pts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  prism(ctx, pts, z0, z1, { front: Y.rubber, top: '#2c2f31', side: '#151617' });
  const fx = px(x, z0);
  const fy = py(y, z0);
  ctx.fillStyle = Y.body;
  ctx.beginPath();
  ctx.arc(fx, fy, r * 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#3a3e41';
  ctx.lineWidth = r * 0.12;
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const a = spin + (k * Math.PI * 2) / 3;
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx + Math.cos(a) * r * 0.42, fy + Math.sin(a) * r * 0.42);
  }
  ctx.stroke();
}

function tracks(ctx: Ctx, x0: number, x1: number, y: number, h: number, z0: number, z1: number, phase: number): void {
  const r = h / 2;
  const pts: number[] = [];
  for (let i = 0; i <= 6; i++) {
    const a = -Math.PI / 2 - (i / 6) * Math.PI;
    pts.push(x0 + r + Math.cos(a) * r, y + r + Math.sin(a) * r);
  }
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI / 2 - (i / 6) * Math.PI;
    pts.push(x1 - r + Math.cos(a) * r, y + r + Math.sin(a) * r);
  }
  prism(ctx, pts, z0, z1, { front: Y.dark, top: '#35393c', side: '#1a1c1e' });
  // Grousers ticking along with the motion.
  ctx.fillStyle = '#4a4f53';
  const step = 0.45;
  const off = ((phase % step) + step) % step;
  for (let x = x0 + r + off; x < x1 - r; x += step) ctx.fillRect(px(x, z0), py(y, z0), 0.16, 0.12);
  ctx.fillStyle = '#5b6064';
  for (let x = x0 + r; x <= x1 - r + 0.01; x += (x1 - x0 - 2 * r) / 3) {
    ctx.beginPath();
    ctx.arc(px(x, z0), py(y + r, z0), r * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }
}

function beacon(ctx: Ctx, x: number, y: number, z: number, on: boolean): void {
  ctx.fillStyle = on ? '#ffb02e' : '#a5651a';
  ctx.fillRect(px(x - 0.14, z), py(y, z), 0.28, 0.24);
  if (on) {
    ctx.fillStyle = 'rgba(255,176,46,0.25)';
    ctx.beginPath();
    ctx.arc(px(x, z), py(y + 0.12, z), 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ------------------------------------------------------------------ crane

export function drawCrane(ctx: Ctx, sim: WreckSim, time: number, active: boolean): void {
  const c = sim.state.crane;
  const foot = craneFoot(c);
  const hook = craneHook(c);
  const bx = c.baseX;
  // Crawler and house.
  tracks(ctx, bx - 4.2, bx + 4.2, 0, 1.3, -2.6, 2.6, bx);
  box(ctx, bx - 3.2, 1.3, 6.4, 0.5, -2, 2, { front: shade(Y.dark, 1.3) });
  box(ctx, bx - 4.6, 1.8, 5.6, 2.6, -1.8, 1.8, { front: Y.body });
  box(ctx, bx - 5.6, 1.9, 1.6, 2.1, -1.6, 1.6, { front: '#3b4044' });
  // Cab with glazing.
  prism(ctx, [bx + 0.9, 1.8, bx + 2.9, 1.8, bx + 2.9, 3.9, bx + 1.5, 4.3, bx + 0.9, 4.3], -1.9, -0.5, { front: Y.body });
  ctx.fillStyle = Y.glass;
  ctx.beginPath();
  ctx.moveTo(px(bx + 1.2, -1.9), py(2.7, -1.9));
  ctx.lineTo(px(bx + 2.6, -1.9), py(2.7, -1.9));
  ctx.lineTo(px(bx + 2.6, -1.9), py(3.8, -1.9));
  ctx.lineTo(px(bx + 1.5, -1.9), py(4.05, -1.9));
  ctx.lineTo(px(bx + 1.2, -1.9), py(4.05, -1.9));
  ctx.fill();
  beacon(ctx, bx - 2, 4.4, 0, active && Math.sin(time * 9) > 0);
  // Lattice boom: two chords in depth with lacing between.
  const L = Math.hypot(hook.x - foot.x, hook.y - foot.y);
  const ux = (hook.x - foot.x) / L;
  const uy = (hook.y - foot.y) / L;
  const nx = -uy;
  const ny = ux;
  const depth = Math.min(1.4, 0.6 + L * 0.012);
  const half = Math.min(0.75, 0.35 + L * 0.006);
  const chord = (z: number, col: string, w: number): void => {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    for (const s of [-1, 1]) {
      ctx.moveTo(px(foot.x + nx * half * s, z), py(foot.y + ny * half * s, z));
      ctx.lineTo(px(hook.x + nx * 0.15 * s, z), py(hook.y + ny * 0.15 * s, z));
    }
    ctx.stroke();
    ctx.lineWidth = w * 0.45;
    ctx.beginPath();
    const n = Math.max(6, Math.round(L / 2.2));
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      const w0 = half + (0.15 - half) * t0;
      const w1 = half + (0.15 - half) * t1;
      const s = i % 2 ? 1 : -1;
      ctx.moveTo(px(foot.x + ux * L * t0 + nx * w0 * s, z), py(foot.y + uy * L * t0 + ny * w0 * s, z));
      ctx.lineTo(px(foot.x + ux * L * t1 - nx * w1 * s, z), py(foot.y + uy * L * t1 - ny * w1 * s, z));
    }
    ctx.stroke();
  };
  chord(depth, shade(Y.body, 0.62), 0.2);
  chord(-depth * 0.2, Y.body, 0.24);
  // Boom foot pin and the head sheave.
  ctx.fillStyle = Y.dark;
  ctx.beginPath();
  ctx.arc(px(foot.x, 0), py(foot.y, 0), 0.5, 0, Math.PI * 2);
  ctx.arc(px(hook.x, 0), py(hook.y, 0), 0.4, 0, Math.PI * 2);
  ctx.fill();
  // Pendant lines from the house to the boom head.
  ctx.strokeStyle = '#2b2f32';
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.moveTo(px(bx - 4.4, 0), py(4.4, 0));
  ctx.lineTo(px(hook.x, 0), py(hook.y, 0));
  ctx.stroke();
  void BOOM_FOOT_Y;
}

export function drawBall(ctx: Ctx, sim: WreckSim, kit: Kit): void {
  const s = sim.state;
  const hook = craneHook(s.crane);
  const b = s.ball;
  const R = sim.ballR;
  ctx.strokeStyle = '#141618';
  ctx.lineWidth = 0.09;
  ctx.beginPath();
  ctx.moveTo(px(hook.x, 0), py(hook.y, 0));
  ctx.lineTo(px(b.x, 0), py(b.y + R * 0.9, 0));
  ctx.stroke();
  // Shadow on the ground under the ball.
  const g0 = 0;
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(px(b.x + 0.6, 1.2), py(g0, 1.2), R * 1.2, R * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  const cx = px(b.x, 0);
  const cy = py(b.y, 0);
  const grad = ctx.createRadialGradient(cx - R * 0.35, cy + R * 0.4, R * 0.1, cx, cy, R);
  grad.addColorStop(0, '#7d858b');
  grad.addColorStop(0.55, '#3a3f43');
  grad.addColorStop(1, '#16191b');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = Y.dark;
  ctx.fillRect(cx - 0.22, cy + R * 0.82, 0.44, 0.35);
  void kit;
}

// -------------------------------------------------------------- excavator

export function drawExcavator(ctx: Ctx, sim: WreckSim, time: number, active: boolean): void {
  const e = sim.state.exc;
  const f = e.face;
  const x = e.x;
  const y = e.y;
  const shake = e.biting ? Math.sin(time * 60) * 0.04 : 0;
  tracks(ctx, x - 3.2, x + 3.2, y, 1.05, MZ0, MZ1, x * 1.3);
  box(ctx, x - 1.4, y + 1.05, 2.8, 0.35, -3, -0.4, { front: '#3a3f43' });
  // Upper house: counterweight behind, engine, cab beside the boom foot.
  prism(ctx, poly(x, y + 1.4 + shake, f, [-3, 0, 1.6, 0, 1.6, 1.6, -2.6, 1.6, -3, 1.2]), -3.2, -0.3, { front: Y.body });
  prism(ctx, poly(x, y + 1.4, f, [-3.1, 0.1, -2.2, 0.1, -2.2, 1.3, -3.1, 1.1]), -3.25, -0.25, { front: '#3c4145' });
  prism(ctx, poly(x, y + 3.0, f, [-0.3, 0, 1.5, 0, 1.5, 1.6, 0.5, 1.9, -0.3, 1.9]), -3.2, -1.9, { front: Y.body });
  ctx.fillStyle = Y.glass;
  const cab = poly(x, y + 3.0, f, [0.0, 0.5, 1.25, 0.5, 1.25, 1.45, 0.55, 1.65, 0.0, 1.65]);
  ctx.beginPath();
  for (let i = 0; i < cab.length; i += 2) {
    const X = px(cab[i] as number, -3.2);
    const Yv = py(cab[i + 1] as number, -3.2);
    if (i === 0) ctx.moveTo(X, Yv);
    else ctx.lineTo(X, Yv);
  }
  ctx.fill();
  beacon(ctx, x - f * 1.5, y + 3.05, -1.2, active && Math.sin(time * 9) > 0);
  // Boom and stick to the jaws, as thick arms.
  const arm = excavatorArm(e, e.jawX, e.jawY);
  const pivot = excavatorPivot(e);
  const limb = (ax: number, ay: number, bx: number, by: number, w0: number, w1: number, col: string): void => {
    const L = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / L;
    const ny = (bx - ax) / L;
    prism(ctx, [ax + nx * w0, ay + ny * w0, bx + nx * w1, by + ny * w1, bx - nx * w1, by - ny * w1, ax - nx * w0, ay - ny * w0], -2.1, -1.1, { front: col });
  };
  limb(pivot.x, pivot.y, arm.ex, arm.ey, 0.55, 0.42, Y.body);
  limb(arm.ex, arm.ey, e.jawX, e.jawY, 0.36, 0.26, shade(Y.body, 0.92));
  // Hydraulic rams.
  ctx.strokeStyle = '#c9ced1';
  ctx.lineWidth = 0.12;
  ctx.beginPath();
  ctx.moveTo(px(x + f * 1.2, -1.4), py(y + 2.2, -1.4));
  ctx.lineTo(px((pivot.x + arm.ex) / 2, -1.4), py((pivot.y + arm.ey) / 2, -1.4));
  ctx.stroke();
  // Crusher jaws, opening and closing with the bite.
  const open = 0.55 - e.jaw * 0.45;
  const L = Math.hypot(e.jawX - arm.ex, e.jawY - arm.ey) || 1;
  const ux = (e.jawX - arm.ex) / L;
  const uy = (e.jawY - arm.ey) / L;
  ctx.fillStyle = Y.dark;
  for (const s of [-1, 1]) {
    const a = Math.atan2(uy, ux) + s * open;
    const tipx = e.jawX + Math.cos(a) * 1.25;
    const tipy = e.jawY + Math.sin(a) * 1.25;
    prism(ctx, [e.jawX - uy * 0.25 * s, e.jawY + ux * 0.25 * s, tipx, tipy, e.jawX + uy * 0.05 * s, e.jawY - ux * 0.05 * s], -2.2, -1.0, { front: sim.state.kit.shears ? '#aab3b8' : '#2e3337' });
  }
  if (e.stunned > 0) stunMark(ctx, x, y + 5.4, time);
}

// ------------------------------------------------------------------ dozer

export function drawDozer(ctx: Ctx, sim: WreckSim, time: number, active: boolean): void {
  const d = sim.state.dozer;
  const f = d.dir;
  const x = d.x;
  const y = d.y;
  const rumble = Math.abs(d.speed) > 0.2 ? Math.sin(time * 40) * 0.03 : 0;
  tracks(ctx, x - 2.5, x + 2.3, y, 1.0, MZ0, MZ1, x * 1.6);
  prism(ctx, poly(x, y + 1 + rumble, f, [-2.4, 0, 1.6, 0, 1.6, 1.2, -0.4, 1.35, -2.4, 1.35]), -3.2, -0.2, { front: Y.body });
  prism(ctx, poly(x, y + 2.35 + rumble, f, [-2.3, 0, -0.5, 0, -0.5, 1.15, -2.0, 1.2, -2.3, 1.2]), -2.9, -0.6, { front: Y.body });
  ctx.fillStyle = Y.glass;
  const g = poly(x, y + 2.35 + rumble, f, [-2.1, 0.25, -0.75, 0.25, -0.75, 1.0, -2.0, 1.0]);
  ctx.beginPath();
  for (let i = 0; i < g.length; i += 2) {
    const X = px(g[i] as number, -2.9);
    const Yv = py(g[i + 1] as number, -2.9);
    if (i === 0) ctx.moveTo(X, Yv);
    else ctx.lineTo(X, Yv);
  }
  ctx.fill();
  // Exhaust.
  box(ctx, x + f * 0.8 - 0.1, y + 2.35, 0.2, 0.7, -2.2, -1.9, { front: '#2a2e31' });
  // Push arms and the blade (raised when it is only driving).
  const lift = d.bladeDown ? 0 : 0.45;
  const bx = x + f * 2.75;
  // Bigger blades are taller and wider: the upgrade shows on the machine.
  const bh = 1.7 * Math.sqrt(sim.state.kit.bladeCap / 9);
  const bw = Math.min(1.2, (sim.state.kit.bladeCap - 9) * 0.05);
  prism(ctx, poly(x, y + 0.6 + lift, f, [0.6, 0, 2.6, 0, 2.6, 0.35, 0.6, 0.35]), -3.0, -0.4, { front: Y.dark });
  prism(ctx, poly(bx, y + lift, f, [-0.15, 0, 0.55, 0.05, 0.4, bh * 0.53, 0.55, bh, -0.15, bh]), MZ0 - 0.3 - bw, MZ1 + 0.3, { front: sim.state.kit.ram ? '#8d969b' : shade(Y.body, 0.82), top: Y.body, side: shade(Y.body, 0.55) });
  ctx.fillStyle = '#9ea4a8';
  ctx.fillRect(px(bx + f * 0.42 - 0.05, MZ0 - 0.3), py(y + lift, MZ0 - 0.3), 0.14, 0.18);
  beacon(ctx, x - f * 1.4, y + 3.58, -1.6, active && Math.sin(time * 9) > 0);
  if (d.stunned > 0) stunMark(ctx, x, y + 4.6, time);
}

// ----------------------------------------------------------------- loader

export function drawLoader(ctx: Ctx, sim: WreckSim, time: number, active: boolean): void {
  const l = sim.state.loader;
  const f = l.face;
  const x = l.x;
  const y = l.y;
  const spin = -x / 0.75;
  // Rear and front wheels.
  wheel(ctx, x - f * 1.6, y + 0.8, 0.8, -3.2, -2.4, spin);
  wheel(ctx, x + f * 1.4, y + 0.8, 0.8, -3.2, -2.4, spin);
  prism(ctx, poly(x, y + 0.9, f, [-2.5, 0, 1.9, 0, 1.9, 1.0, -2.2, 1.3, -2.5, 1.2]), -3.0, -0.4, { front: Y.body });
  prism(ctx, poly(x, y + 2.2, f, [-1.3, 0, 0.6, 0, 0.6, 1.45, -1.1, 1.5, -1.3, 1.45]), -2.8, -0.7, { front: Y.body });
  ctx.fillStyle = Y.glass;
  const g = poly(x, y + 2.2, f, [-1.1, 0.35, 0.4, 0.35, 0.4, 1.25, -1.0, 1.3]);
  ctx.beginPath();
  for (let i = 0; i < g.length; i += 2) {
    const X = px(g[i] as number, -2.8);
    const Yv = py(g[i + 1] as number, -2.8);
    if (i === 0) ctx.moveTo(X, Yv);
    else ctx.lineTo(X, Yv);
  }
  ctx.fill();
  wheel(ctx, x - f * 1.6, y + 0.8, 0.8, -0.8, -0.1, spin);
  wheel(ctx, x + f * 1.4, y + 0.8, 0.8, -0.8, -0.1, spin);
  // Lift arms and bucket.
  const lift = l.arm * 2.6 + (l.phase === 'scoop' ? 0 : 0.2);
  const bucketX = x + f * LOADER_REACH;
  const by = y + 0.15 + lift;
  ctx.strokeStyle = Y.body;
  ctx.lineWidth = 0.35;
  ctx.beginPath();
  ctx.moveTo(px(x + f * 0.4, -1.3), py(y + 2.1, -1.3));
  ctx.lineTo(px(bucketX - f * 0.6, -1.3), py(by + 0.6, -1.3));
  ctx.stroke();
  const k = Math.sqrt(sim.state.kit.bucket / 7);
  const bucket = poly(bucketX, by, f, [-0.75 * k, 0, 0.6 * k, 0, 0.75 * k, 0.55 * k, 0.2 * k, 1.3 * k, -0.75 * k, 1.25 * k]);
  prism(ctx, bucket, MZ0 + 0.1, MZ1, { front: shade(Y.body, 0.85), side: shade(Y.body, 0.6) });
  if (l.bucket > 0.05) {
    ctx.fillStyle = '#8b8275';
    ctx.beginPath();
    ctx.ellipse(px(bucketX, MZ0 + 1.8), py(by + 1.25, MZ0 + 1.8), 0.9, 0.35 + Math.min(0.5, l.bucket * 0.05), 0, 0, Math.PI);
    ctx.fill();
  }
  if (l.carry) {
    const b = l.carry;
    const c = b.kind === 'vault' ? '#4a5258' : b.kind === 'steel' ? '#6b7880' : '#a39c90';
    box(ctx, bucketX - Math.min(b.w, 1.6) / 2, by + 1.0, Math.min(b.w, 1.6), Math.min(b.h, 1.2), MZ0 + 0.6, MZ1 - 0.4, { front: c });
  }
  beacon(ctx, x - f * 0.4, y + 3.7, -1.7, active && Math.sin(time * 9) > 0);
  if (l.stunned > 0) stunMark(ctx, x, y + 4.8, time);
}

// ------------------------------------------------------------ haul truck

/** The haul truck waiting at the pit; its bed fills as rubble is trucked out. */
export function drawTruck(ctx: Ctx, x: number, z: number, fill: number, dir: number): void {
  wheel(ctx, x - dir * 2.6, 0.75, 0.75, z, z + 0.7, 0);
  wheel(ctx, x + dir * 0.6, 0.75, 0.75, z, z + 0.7, 0);
  wheel(ctx, x + dir * 2.2, 0.75, 0.75, z, z + 0.7, 0);
  prism(ctx, poly(x, 1.1, dir, [-3.9, 0, -2.0, 0, -2.0, 2.5, -3.3, 2.5, -3.9, 1.6]), z, z + 2.6, { front: '#d9542b' });
  prism(ctx, poly(x, 1.3, dir, [-1.8, 0, 3.4, 0, 3.6, 1.9, -1.8, 1.9]), z, z + 2.6, { front: '#e0cf9b' });
  if (fill > 0.02) {
    ctx.fillStyle = '#8f877b';
    const top = 3.2 + Math.min(1, fill) * 0.8;
    ctx.beginPath();
    ctx.moveTo(px(x - dir * 1.6, z + 1.3), py(3.2, z + 1.3));
    ctx.quadraticCurveTo(px(x + dir * 0.8, z + 1.3), py(top + 0.6, z + 1.3), px(x + dir * 3.3, z + 1.3), py(3.2, z + 1.3));
    ctx.fill();
  }
  ctx.fillStyle = Y.glass;
  ctx.fillRect(px(x - dir * 3.2 - (dir > 0 ? 0 : 0.9), z), py(2.6, z), 0.9, 0.8);
}

function stunMark(ctx: Ctx, x: number, y: number, time: number): void {
  ctx.fillStyle = '#ff6b3d';
  for (let i = 0; i < 3; i++) {
    const a = time * 4 + (i * Math.PI * 2) / 3;
    ctx.beginPath();
    ctx.arc(px(x + Math.cos(a) * 0.9, -1.5), py(y + Math.sin(a) * 0.3, -1.5), 0.18, 0, Math.PI * 2);
    ctx.fill();
  }
}
