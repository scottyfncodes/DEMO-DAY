/**
 * The timed swing: hold to wind up, let go at your power marker. The meter
 * climbs to full and back down while held, so holding on never just maxes out.
 * Letting go inside the window around the marker is a pure strike and hits at
 * exactly the planned power; outside it the shot takes the power you let go at.
 */

/** Seconds for the meter to go from empty to full. */
export const SWING_TIME = 1.1;
/** Half-width of the pure-strike window, as a share of full power. */
export const PURE_WINDOW = 0.05;
/** Let go below this and the swing is called off instead of dribbling a shot. */
export const MIN_SWING = 0.06;

export type StrikeQuality = 'pure' | 'strong' | 'soft';

export interface Strike {
  power: number;
  quality: StrikeQuality;
  /** Released charge minus the planned power. */
  miss: number;
}

/** Meter level after holding for `held` seconds: 0 to 1 and back, repeating. */
export function swingCharge(held: number): number {
  const u = (Math.max(0, held) / SWING_TIME) % 2;
  return u <= 1 ? u : 2 - u;
}

export function strike(charge: number, target: number): Strike {
  const miss = charge - target;
  if (Math.abs(miss) <= PURE_WINDOW) return { power: target, quality: 'pure', miss };
  return { power: Math.max(0, Math.min(1, Math.round(charge * 100) / 100)), quality: miss > 0 ? 'strong' : 'soft', miss };
}
