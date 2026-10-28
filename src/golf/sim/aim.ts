import { BALLS } from './balls';
import { DEG } from './math';
import { DT, GRAVITY, NO_MODS, golferSpots, launchVelocity, type Contact, type SeamInfo, type Shot, type ShotMods, type World } from './world';

/**
 * Trajectory prediction for the aim guide, and an aim solver used by tests
 * and level checks. Prediction uses the same forces and step as the
 * simulation and stops at the first solid contact.
 */

export interface Prediction {
  points: Array<{ x: number; y: number; z: number }>;
  contact: Contact | null;
  seam: SeamInfo | null;
  /** Time of the first contact (or the end of the prediction). */
  time: number;
}

export function predict(world: World, shot: Shot, mods: ShotMods = NO_MODS, maxTime = 4, golfer = 0): Prediction {
  const def = BALLS[shot.ball];
  const spot = golferSpots(world.info, mods.golfers)[golfer] ?? { x: world.info.tee.x, z: world.info.tee.z };
  const v = launchVelocity(def, shot, mods);
  let x = spot.x;
  let y = def.radius + 0.04;
  let z = spot.z;
  let { vx, vy, vz } = v;
  const hook = def.hook * Math.max(0, shot.power - 0.8) / 0.2;
  const yaw = shot.yaw * DEG;
  const hx = Math.cos(yaw) * hook;
  const hz = Math.sin(yaw) * hook;
  const points = [{ x, y, z }];
  const r = def.radius;
  let t = 0;
  while (t < maxTime) {
    const sp = Math.hypot(vx, vy, vz);
    const n = Math.max(1, Math.ceil((sp * DT) / (r * 0.45)));
    const h = DT / n;
    for (let i = 0; i < n; i++) {
      const s = Math.hypot(vx, vy, vz);
      const drag = def.drag * s;
      vx += (-drag * vx + world.wind.x + hx) * h;
      vy += (-drag * vy - GRAVITY) * h;
      vz += (-drag * vz + world.wind.z + hz) * h;
      x += vx * h;
      y += vy * h;
      z += vz * h;
      const c = world.contactAt(x, y, z, r);
      if (c || y < r) {
        points.push({ x, y, z });
        const seam = c ? world.seamAt(c) : null;
        return { points, contact: c, seam, time: t };
      }
    }
    t += DT;
    points.push({ x, y, z });
  }
  return { points, contact: null, seam: null, time: t };
}

/**
 * Finds yaw and pitch so a shot at the given power passes through a target
 * point (ignoring what is in the way). Returns null if out of reach.
 */
export function solveAim(world: World, ball: Shot['ball'], target: { x: number; y: number; z: number }, power: number, mods: ShotMods = NO_MODS, lob = false): Shot | null {
  const tee = world.info.tee;
  const def = BALLS[ball];
  let yaw = Math.atan2(target.x - tee.x, tee.z - target.z) / DEG;
  // Height of the free flight where it crosses the target's distance.
  const heightAt = (pitch: number): { y: number; x: number } | null => {
    const v = launchVelocity(def, { ball, yaw, pitch, power }, mods);
    let x = tee.x;
    let y = def.radius + 0.04;
    let z = tee.z;
    let { vx, vy, vz } = v;
    const hook = def.hook * Math.max(0, power - 0.8) / 0.2;
    const hx = Math.cos(yaw * DEG) * hook;
    const hz = Math.sin(yaw * DEG) * hook;
    for (let t = 0; t < 6; t += DT / 4) {
      const h = DT / 4;
      const s = Math.hypot(vx, vy, vz);
      const drag = def.drag * s;
      vx += (-drag * vx + world.wind.x + hx) * h;
      vy += (-drag * vy - GRAVITY) * h;
      vz += (-drag * vz + world.wind.z + hz) * h;
      const pz = z;
      x += vx * h;
      y += vy * h;
      z += vz * h;
      if (z <= target.z && pz > target.z) {
        const f = (pz - target.z) / (pz - z);
        return { y: y - vy * h * (1 - f), x: x - vx * h * (1 - f) };
      }
      if (y < -5) return null;
    }
    return null;
  };
  let best: Shot | null = null;
  for (let pass = 0; pass < 3; pass++) {
    // Scan pitch for a bracket, then bisect.
    const scan: Array<[number, number]> = [];
    for (let p = -5; p <= 75; p += 1) {
      const hgt = heightAt(p);
      if (hgt) scan.push([p, hgt.y - target.y]);
    }
    const brackets: Array<[number, number]> = [];
    for (let i = 1; i < scan.length; i++) {
      const a = scan[i - 1] as [number, number];
      const b = scan[i] as [number, number];
      if (Math.sign(a[1]) !== Math.sign(b[1])) brackets.push([a[0], b[0]]);
    }
    if (!brackets.length) return null;
    let [lo, hi] = (lob ? brackets[brackets.length - 1] : brackets[0]) as [number, number];
    const flo = heightAt(lo);
    const sLo = Math.sign((flo?.y ?? 0) - target.y);
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const f = heightAt(mid);
      if (!f) break;
      if (Math.sign(f.y - target.y) === sLo) lo = mid;
      else hi = mid;
    }
    const pitch = (lo + hi) / 2;
    const at = heightAt(pitch);
    best = { ball, yaw, pitch, power };
    if (!at) break;
    // Correct yaw for wind or hook drift, then solve again.
    const err = target.x - at.x;
    if (Math.abs(err) < 0.002) break;
    yaw += (err / Math.hypot(target.z - tee.z, target.x - tee.x)) / DEG;
  }
  return best;
}
