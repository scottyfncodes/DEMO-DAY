import { solveAim } from '../sim/aim';
import type { BallId } from '../sim/balls';
import { DEG } from '../sim/math';
import { NO_MODS, type Shot, type ShotMods, type World } from '../sim/world';
import { powerFor } from './controls';

export interface AimedShot {
  shot: Shot;
  /** The ball reaches the target at this power. When false it falls short, flying its furthest. */
  reach: boolean;
}

/**
 * The shot that sends the ball through a target point at the power a pull
 * gives: the flattest flight that gets there. Too soft to get there, it flies
 * at its furthest angle so the guide shows it dropping short.
 */
export function shotAt(world: World, ball: BallId, target: { x: number; y: number; z: number }, pull: number, mods: ShotMods = NO_MODS): AimedShot {
  const power = powerFor(pull);
  const s = solveAim(world, ball, target, power, mods);
  if (s && s.pitch <= 60) return { shot: s, reach: true };
  const tee = world.info.tee;
  const yaw = Math.atan2(target.x - tee.x, tee.z - target.z) / DEG;
  return { shot: { ball, yaw, pitch: 38, power }, reach: false };
}
