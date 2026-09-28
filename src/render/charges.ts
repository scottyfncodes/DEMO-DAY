import type { ChargeType, Direction } from '../core/types';

/**
 * Stylised charge art, drawn procedurally so the same silhouettes appear on
 * the building and in the loadout tray. Each charge is readable without its
 * label: a dynamite bundle, a hazard-striped heavy block, a blue horn that
 * points where it pushes, and a narrow copper-tipped cutter.
 */
export interface ChargeLook {
  /** Seconds, for blinking and idle motion. */
  time: number;
  /** 0 = planning, 1 = armed and live (fuse burning, lights racing). */
  lit?: number;
  /** 0..1 of the fuse already burnt (countdown progress). */
  burn?: number;
  direction?: Direction;
  /** Small per-charge phase offset so a row of charges does not blink in sync. */
  phase?: number;
}

const OUTLINE = '#120c08';

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
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

function glowDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, core: string, halo: string, strength: number): void {
  if (strength <= 0.01) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
  g.addColorStop(0, core);
  g.addColorStop(0.35, halo);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = Math.min(1, strength);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Blink square wave with a soft edge, 0..1. */
function blink(time: number, hz: number, phase = 0): number {
  const s = Math.sin((time * hz + phase) * Math.PI * 2);
  return s > 0.2 ? 1 : s > -0.2 ? (s + 0.2) / 0.4 : 0;
}

/**
 * Draws a charge centred on (x, y). `size` is roughly the icon's height in
 * pixels; the heavy charge draws larger on purpose.
 */
export function drawCharge(ctx: CanvasRenderingContext2D, type: ChargeType, x: number, y: number, size: number, look: ChargeLook): void {
  ctx.save();
  ctx.translate(x, y);
  const u = size / 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (type) {
    case 'small':
      drawSmall(ctx, u, look);
      break;
    case 'heavy':
      drawHeavy(ctx, u * 1.18, look);
      break;
    case 'directional':
      drawDirectional(ctx, u, look);
      break;
    case 'shaped':
      drawShaped(ctx, u, look);
      break;
  }
  ctx.restore();
}

// --------------------------------------------------------------- small

function drawSmall(ctx: CanvasRenderingContext2D, u: number, look: ChargeLook): void {
  const lit = look.lit ?? 0;
  const lw = Math.max(1, u * 0.1);
  // Fuse first so the sticks sit over its root.
  const burn = Math.min(0.85, look.burn ?? 0);
  const fuse = (t: number): [number, number] => {
    // Quadratic curve from the middle stick top, up and to the right.
    const p0 = [0, -0.62];
    const p1 = [0.05, -1.15];
    const p2 = [0.55, -1.12];
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    return [(a * p0[0]! + b * p1[0]! + c * p2[0]!) * u, (a * p0[1]! + b * p1[1]! + c * p2[1]!) * u];
  };
  const end = 1 - burn;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = lw * 2.2;
  ctx.beginPath();
  for (let i = 0; i <= 10; i++) {
    const [fx, fy] = fuse((i / 10) * end);
    if (i === 0) ctx.moveTo(fx, fy);
    else ctx.lineTo(fx, fy);
  }
  ctx.stroke();
  ctx.strokeStyle = '#c9b089';
  ctx.lineWidth = lw * 1.1;
  ctx.stroke();

  // Three sticks: outer two first, middle in front.
  const stick = (cx: number, top: number, shade: number): void => {
    const w = u * 0.62;
    const h = u * 1.62;
    const x0 = cx * u - w / 2;
    const y0 = top * u;
    roundRectPath(ctx, x0, y0, w, h, w * 0.3);
    ctx.fillStyle = shade > 0 ? '#c9302a' : '#e0402f';
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    // Highlight strip and end caps.
    ctx.fillStyle = 'rgba(255, 190, 160, 0.45)';
    ctx.fillRect(x0 + w * 0.18, y0 + h * 0.08, w * 0.16, h * 0.84);
    ctx.fillStyle = '#f0d9b5';
    roundRectPath(ctx, x0 + w * 0.12, y0 + lw * 0.3, w * 0.76, h * 0.1, w * 0.2);
    ctx.fill();
  };
  stick(-0.6, -0.5, 1);
  stick(0.6, -0.5, 1);
  stick(0, -0.62, 0);
  // Industrial tape band with a buckle.
  ctx.fillStyle = '#23262b';
  ctx.fillRect(-u * 0.95, u * 0.18, u * 1.9, u * 0.34);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = lw;
  ctx.strokeRect(-u * 0.95, u * 0.18, u * 1.9, u * 0.34);
  ctx.fillStyle = '#b8bec6';
  ctx.fillRect(-u * 0.14, u * 0.14, u * 0.28, u * 0.42);

  // Fuse spark: a dim ember while planning, a live sparkler once armed.
  const [tx, ty] = fuse(end);
  const flicker = 0.75 + 0.25 * Math.sin(look.time * 37 + (look.phase ?? 0) * 11);
  if (lit > 0) {
    glowDot(ctx, tx, ty, u * 0.22 * (0.8 + 0.4 * flicker), 'rgba(255,255,220,1)', 'rgba(255,150,40,0.8)', lit);
    ctx.strokeStyle = `rgba(255, 220, 120, ${lit})`;
    ctx.lineWidth = Math.max(1, lw * 0.6);
    for (let i = 0; i < 5; i++) {
      const a = look.time * 9 + i * 1.3 + (look.phase ?? 0);
      const len = u * (0.25 + 0.25 * Math.abs(Math.sin(a * 3.1)));
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + Math.cos(a) * len, ty + Math.sin(a) * len - u * 0.05);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = `rgba(255, 120, 40, ${0.35 + 0.25 * flicker})`;
    ctx.beginPath();
    ctx.arc(tx, ty, u * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
}

// --------------------------------------------------------------- heavy

function drawHeavy(ctx: CanvasRenderingContext2D, u: number, look: ChargeLook): void {
  const lit = look.lit ?? 0;
  const lw = Math.max(1, u * 0.09);
  const w = u * 2;
  const h = u * 1.45;
  const x0 = -w / 2;
  const y0 = -h / 2 + u * 0.15;
  // Detonator box and antenna on top.
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = lw * 1.4;
  ctx.beginPath();
  ctx.moveTo(u * 0.5, y0 - u * 0.2);
  ctx.lineTo(u * 0.72, y0 - u * 0.75);
  ctx.stroke();
  ctx.strokeStyle = '#9aa3ad';
  ctx.lineWidth = lw * 0.7;
  ctx.stroke();
  roundRectPath(ctx, -u * 0.5, y0 - u * 0.36, u * 1.1, u * 0.44, u * 0.08);
  ctx.fillStyle = '#4a5059';
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  // Body.
  roundRectPath(ctx, x0, y0, w, h, u * 0.3);
  const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
  g.addColorStop(0, '#4b525c');
  g.addColorStop(0.5, '#2c3138');
  g.addColorStop(1, '#1b1f25');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = lw * 1.3;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  // Hazard band.
  const by = y0 + h * 0.36;
  const bh = h * 0.34;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0 + lw, by, w - lw * 2, bh);
  ctx.clip();
  ctx.fillStyle = '#ffc21a';
  ctx.fillRect(x0, by, w, bh);
  ctx.fillStyle = '#16181c';
  const stripe = u * 0.34;
  for (let sx = x0 - bh; sx < x0 + w + bh; sx += stripe * 2) {
    ctx.beginPath();
    ctx.moveTo(sx, by + bh);
    ctx.lineTo(sx + stripe, by + bh);
    ctx.lineTo(sx + stripe + bh, by);
    ctx.lineTo(sx + bh, by);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = lw;
  ctx.strokeRect(x0 + lw * 0.5, by, w - lw, bh);
  // Rivets.
  ctx.fillStyle = '#aab2bc';
  for (const rx of [-0.78, 0.78]) {
    ctx.beginPath();
    ctx.arc(rx * u, y0 + h * 0.18, u * 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(rx * u, y0 + h * 0.85, u * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }
  // Top sheen.
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  roundRectPath(ctx, x0 + u * 0.2, y0 + u * 0.08, w - u * 0.4, h * 0.12, u * 0.1);
  ctx.fill();

  // Arming light on the detonator: slow blink idle, racing strobe when live.
  const on = blink(look.time, lit > 0 ? 4 + lit * 5 : 1.1, look.phase ?? 0);
  const lx = -u * 0.15;
  const ly = y0 - u * 0.14;
  ctx.fillStyle = on > 0.5 ? '#ff3b30' : '#5c1410';
  ctx.beginPath();
  ctx.arc(lx, ly, u * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = lw * 0.8;
  ctx.stroke();
  glowDot(ctx, lx, ly, u * 0.14, 'rgba(255,220,210,1)', 'rgba(255,50,40,0.7)', on * (0.5 + lit * 0.7));
  // Second amber light.
  ctx.fillStyle = on < 0.5 && lit > 0 ? '#ffb020' : '#4a3510';
  ctx.beginPath();
  ctx.arc(u * 0.25, ly, u * 0.09, 0, Math.PI * 2);
  ctx.fill();
}

// --------------------------------------------------------- directional

function drawDirectional(ctx: CanvasRenderingContext2D, u: number, look: ChargeLook): void {
  const lit = look.lit ?? 0;
  const lw = Math.max(1, u * 0.09);
  const dir = look.direction === 'left' ? -1 : 1;
  ctx.scale(dir, 1);
  // Back plate / clamp.
  roundRectPath(ctx, -u * 1.05, -u * 0.72, u * 0.5, u * 1.44, u * 0.12);
  ctx.fillStyle = '#23303d';
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // Body.
  roundRectPath(ctx, -u * 0.7, -u * 0.55, u * 0.95, u * 1.1, u * 0.18);
  ctx.fillStyle = '#1f8fd0';
  ctx.fill();
  ctx.lineWidth = lw * 1.2;
  ctx.stroke();
  // Flared nozzle pointing the push direction.
  ctx.beginPath();
  ctx.moveTo(u * 0.2, -u * 0.38);
  ctx.lineTo(u * 1.1, -u * 0.78);
  ctx.lineTo(u * 1.1, u * 0.78);
  ctx.lineTo(u * 0.2, u * 0.38);
  ctx.closePath();
  const g = ctx.createLinearGradient(u * 0.2, 0, u * 1.1, 0);
  g.addColorStop(0, '#2a6f99');
  g.addColorStop(1, '#8fdcff');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = lw * 1.2;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // Nozzle mouth, glowing when live.
  ctx.fillStyle = lit > 0 ? `rgba(255, ${200 - lit * 80}, 80, 1)` : '#0e2433';
  ctx.fillRect(u * 1.02, -u * 0.72, u * 0.14, u * 1.44);
  if (lit > 0) glowDot(ctx, u * 1.12, 0, u * 0.3, 'rgba(255,240,200,0.9)', 'rgba(56,198,255,0.5)', lit * (0.6 + 0.4 * Math.sin(look.time * 20)));
  // Big white chevron on the body.
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(-u * 0.5, -u * 0.34);
  ctx.lineTo(-u * 0.02, 0);
  ctx.lineTo(-u * 0.5, u * 0.34);
  ctx.lineTo(-u * 0.3, 0);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-u * 0.22, -u * 0.34);
  ctx.lineTo(u * 0.26, 0);
  ctx.lineTo(-u * 0.22, u * 0.34);
  ctx.lineTo(-u * 0.02, 0);
  ctx.closePath();
  ctx.fill();
  // Status light on the plate.
  const on = blink(look.time, lit > 0 ? 6 : 1, look.phase ?? 0);
  ctx.fillStyle = on > 0.5 ? '#7ff0ff' : '#123a4a';
  ctx.beginPath();
  ctx.arc(-u * 0.8, -u * 0.45, u * 0.1, 0, Math.PI * 2);
  ctx.fill();
}

// -------------------------------------------------------------- shaped

function drawShaped(ctx: CanvasRenderingContext2D, u: number, look: ChargeLook): void {
  const lit = look.lit ?? 0;
  const lw = Math.max(1, u * 0.09);
  // Narrow graphite cylinder with a copper cone liner pointing into the member.
  const w = u * 0.95;
  const top = -u * 0.95;
  const bodyH = u * 1.2;
  // Standoff legs.
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = lw * 2;
  ctx.beginPath();
  ctx.moveTo(-w * 0.45, top + bodyH - u * 0.05);
  ctx.lineTo(-w * 0.75, u * 0.85);
  ctx.moveTo(w * 0.45, top + bodyH - u * 0.05);
  ctx.lineTo(w * 0.75, u * 0.85);
  ctx.stroke();
  ctx.strokeStyle = '#aab2bc';
  ctx.lineWidth = lw * 0.9;
  ctx.stroke();
  // Copper cone.
  ctx.beginPath();
  ctx.moveTo(-w * 0.5, top + bodyH - u * 0.02);
  ctx.lineTo(0, u * 0.95);
  ctx.lineTo(w * 0.5, top + bodyH - u * 0.02);
  ctx.closePath();
  const cg = ctx.createLinearGradient(-w * 0.5, 0, w * 0.5, 0);
  cg.addColorStop(0, '#8a4a22');
  cg.addColorStop(0.45, '#f0a868');
  cg.addColorStop(1, '#7a3c18');
  ctx.fillStyle = cg;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // Body.
  roundRectPath(ctx, -w / 2, top, w, bodyH, u * 0.14);
  const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  g.addColorStop(0, '#2a2438');
  g.addColorStop(0.4, '#4a3f66');
  g.addColorStop(1, '#1d1828');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = lw * 1.2;
  ctx.stroke();
  // Purple ID bands and a diamond mark.
  ctx.fillStyle = '#b46bff';
  ctx.fillRect(-w / 2 + lw, top + bodyH * 0.14, w - lw * 2, bodyH * 0.1);
  ctx.fillRect(-w / 2 + lw, top + bodyH * 0.76, w - lw * 2, bodyH * 0.1);
  ctx.fillStyle = '#efe4ff';
  ctx.beginPath();
  const dy = top + bodyH * 0.5;
  ctx.moveTo(0, dy - u * 0.22);
  ctx.lineTo(u * 0.17, dy);
  ctx.lineTo(0, dy + u * 0.22);
  ctx.lineTo(-u * 0.17, dy);
  ctx.closePath();
  ctx.fill();
  // Cap with a status diode.
  roundRectPath(ctx, -w * 0.32, top - u * 0.2, w * 0.64, u * 0.24, u * 0.06);
  ctx.fillStyle = '#9aa3ad';
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = lw;
  ctx.stroke();
  const on = blink(look.time, lit > 0 ? 7 : 0.9, look.phase ?? 0);
  ctx.fillStyle = on > 0.5 ? '#e3c2ff' : '#3a2356';
  ctx.beginPath();
  ctx.arc(0, top - u * 0.08, u * 0.08, 0, Math.PI * 2);
  ctx.fill();
  // Targeting line from the cone tip once live.
  if (lit > 0) {
    ctx.strokeStyle = `rgba(214, 170, 255, ${0.5 + 0.5 * on})`;
    ctx.lineWidth = Math.max(1, lw * 0.7);
    ctx.beginPath();
    ctx.moveTo(0, u * 0.95);
    ctx.lineTo(0, u * 1.35);
    ctx.stroke();
    glowDot(ctx, 0, u * 0.95, u * 0.14, 'rgba(255,255,255,1)', 'rgba(180,107,255,0.8)', lit);
  }
}

/** Renders a static tray icon into a small canvas element. */
export function paintChargeIcon(canvas: HTMLCanvasElement, type: ChargeType, cssSize: number): void {
  const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  canvas.width = Math.round(cssSize * dpr * 1.3);
  canvas.height = Math.round(cssSize * dpr);
  canvas.style.width = `${Math.round(cssSize * 1.3)}px`;
  canvas.style.height = `${cssSize}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssSize * 1.3, cssSize);
  const size = type === 'heavy' ? cssSize * 0.62 : cssSize * 0.66;
  const cy = type === 'small' ? cssSize * 0.56 : cssSize * 0.52;
  drawCharge(ctx, type, (cssSize * 1.3) / 2, cy, size, { time: 0.1, direction: 'right' });
}
