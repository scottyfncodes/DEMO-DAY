import type { MachineId } from '../data/fleet';
import { Camera, type Bounds } from '../render/camera';
import { drawBall, drawCrane, drawDozer, drawExcavator, drawLoader } from '../render/machines';
import { KX, KY, box, px, py } from '../render/paint';
import type { Kit } from '../wreck/kit';
import { SceneRenderer } from '../render/scene';
import { WreckFx } from '../wreck/fx';
import { WreckSim, prepare, type Halden } from '../wreck/sim';
import { h } from './dom';

/** World bounds that frame a building and its depth, with room for the ground in front. */
export function buildingBounds(hd: Halden, pad = 4): Bounds {
  const b = hd.def.bounds;
  const D = hd.building.depth;
  return { minX: b.minX - pad, maxX: b.maxX + D * KX + pad, minY: -7 * KY - 0.5, maxY: b.maxY + D * KY + pad * 0.5 };
}

/** A still picture of a building on its lot, for cards and the job sheet. */
export function thumbnail(buildingId: string, width: number, height: number, className = 'thumb'): HTMLCanvasElement {
  const canvas = h('canvas', { class: className });
  const draw = (): void => {
    const hd = prepare(buildingId);
    const sim = new WreckSim(undefined, hd);
    const r = new SceneRenderer(canvas);
    r.resize(width, height);
    const cam = new Camera();
    cam.minScale = 0.5;
    cam.setViewport(width, height);
    cam.fit(buildingBounds(hd, 6), 0);
    r.draw(sim, cam, new WreckFx(), { time: 0, now: 0, machines: [], site: true });
  };
  // Draw after layout so the page paints first.
  requestAnimationFrame(draw);
  return canvas;
}

/** A machine on a patch of ground, drawn with the kit it would take to site. */
export function machinePreview(id: MachineId, kit: Kit, width = 300, height = 170): HTMLCanvasElement {
  const canvas = h('canvas', { class: 'machine-preview' });
  requestAnimationFrame(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const sim = new WreckSim(undefined, prepare('corner'), kit);
    const s = sim.state;
    // World window to show, per machine.
    const view: Record<MachineId, Bounds> = {
      ball: { minX: -26, maxX: 2, minY: -3, maxY: 22 },
      charges: { minX: -3, maxX: 3.5, minY: -1.5, maxY: 3.2 },
      excavator: { minX: -5, maxX: 14, minY: -2, maxY: 10 },
      dozer: { minX: -4.5, maxX: 5, minY: -2, maxY: 4.5 },
      loader: { minX: -4.5, maxX: 6, minY: -2, maxY: 5 },
    };
    const v = view[id];
    const scale = Math.min(width / (v.maxX - v.minX), height / (v.maxY - v.minY));
    const ox = (width - (v.maxX - v.minX) * scale) / 2 - v.minX * scale;
    const oy = height - ((height - (v.maxY - v.minY) * scale) / 2 - v.minY * scale);
    ctx.setTransform(scale * dpr, 0, 0, -scale * dpr, ox * dpr, oy * dpr);
    ctx.fillStyle = '#8b7d69';
    ctx.beginPath();
    ctx.moveTo(px(v.minX - 10, -4), py(0, -4));
    ctx.lineTo(px(v.maxX + 10, -4), py(0, -4));
    ctx.lineTo(px(v.maxX + 10, 6), py(0, 6));
    ctx.lineTo(px(v.minX - 10, 6), py(0, 6));
    ctx.fill();
    ctx.fillStyle = '#5d4433';
    ctx.fillRect(v.minX - 12, py(0, -4) - 6, v.maxX - v.minX + 30, 6);
    if (id === 'ball') {
      s.crane.baseX = -18;
      s.crane.theta = 0.95;
      const hook = { x: s.crane.baseX + s.crane.boom * Math.cos(0.95), y: 3.2 + s.crane.boom * Math.sin(0.95) };
      s.ball.x = hook.x;
      s.ball.y = hook.y - 9;
      drawCrane(ctx, sim, 0, false);
      drawBall(ctx, sim, kit);
    } else if (id === 'excavator') {
      s.exc.x = 0;
      s.exc.face = 1;
      s.exc.jawX = 8;
      s.exc.jawY = 5;
      drawExcavator(ctx, sim, 0, false);
    } else if (id === 'dozer') {
      s.dozer.x = 0;
      s.dozer.dir = 1;
      s.dozer.bladeDown = true;
      drawDozer(ctx, sim, 0, false);
    } else if (id === 'loader') {
      s.loader.x = 0;
      s.loader.face = 1;
      s.loader.arm = 0.35;
      drawLoader(ctx, sim, 0, false);
    } else {
      // A crate of charges and the firing box.
      box(ctx, -2.2, 0, 2.6, 1.3, -1.2, 0.8, { front: '#7a5a3a' });
      for (let i = 0; i < 3; i++) box(ctx, -1.9 + i * 0.75, 1.3, 0.5, 1.1, -0.6, 0, { front: kit.shaped && i === 2 ? '#c43b2f' : '#e0b130' });
      box(ctx, 1, 0, 1.6, 0.9, -1, 0.2, { front: '#2c3236' });
      ctx.fillStyle = '#ff3b1f';
      ctx.fillRect(px(1.5, -1), py(0.5, -1), 0.3, 0.2);
      ctx.strokeStyle = '#c43b2f';
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.moveTo(px(-1.6, -0.6), py(2.4, -0.6));
      ctx.quadraticCurveTo(0.5, 3.4, px(1.8, -1), py(0.9, -1));
      ctx.stroke();
    }
  });
  return canvas;
}
