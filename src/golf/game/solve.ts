import { predict } from '../sim/aim';
import type { BallId } from '../sim/balls';
import { DEG } from '../sim/math';
import { NO_MODS, type Shot, type ShotMods, type World } from '../sim/world';
import { clampYaw, shotFor } from './controls';

/**
 * Finds the yaw and pull that put the first contact of a pull-back shot on a
 * world point, using the same flight as the aim guide. Used by tests that
 * prove houses can be finished with the real controls, by the title screen's
 * demo golfer, and by the smoke test's aim hook.
 */
export function solvePull(world: World, ball: BallId, target: { x: number; y: number; z: number }, mods: ShotMods = NO_MODS): { shot: Shot; yaw: number; pull: number } | null {
  const tee = world.info.tee;
  let yaw = clampYaw(Math.atan2(target.x - tee.x, tee.z - target.z) / DEG);
  let best: { shot: Shot; yaw: number; pull: number; err: number } | null = null;
  for (let pass = 0; pass < 3; pass++) {
    // Contact height rises with the pull: bisect on it at this yaw.
    let lo = 0;
    let hi = 1;
    const heightErr = (pull: number): { err: number; dx: number; shot: Shot } => {
      const shot = shotFor(ball, yaw, pull);
      const pr = predict(world, shot, mods, 4);
      const c = pr.contact;
      const end = pr.points[pr.points.length - 1] ?? { x: 0, y: 0, z: 0 };
      // Short of the target counts as low; past it (or over) as high.
      const y = c ? c.py + (target.z - c.pz) * 0.5 : end.z > target.z ? -5 : 50;
      return { err: y - target.y, dx: (c ? c.px : end.x) - target.x, shot };
    };
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (heightErr(mid).err < 0) lo = mid;
      else hi = mid;
    }
    const pull = (lo + hi) / 2;
    const r = heightErr(pull);
    const err = Math.hypot(r.err, r.dx);
    if (!best || err < best.err) best = { shot: r.shot, yaw, pull, err };
    if (Math.abs(r.dx) < 0.01) break;
    yaw = clampYaw(yaw - (r.dx / Math.max(1, tee.z - target.z)) / DEG);
  }
  if (!best || best.err > 0.6) return null;
  return { shot: best.shot, yaw: best.yaw, pull: best.pull };
}
