import type { BallId } from '../sim/balls';
import { clamp } from '../sim/math';
import type { Shot } from '../sim/world';

/**
 * Pull-back shooting. Press anywhere, pull back: how far down the thumb goes
 * sets the power, and sideways movement turns the aim (mirrored, like a
 * slingshot). Loft rises with power, so a short pull lands low on the house
 * and a long one reaches the roof. Pure numbers, no DOM, so it is testable.
 */

export const AIM = {
  /** Pull (px) before a shot is armed; letting go inside it cancels. */
  deadPx: 12,
  /** Share of the screen height a full-power pull covers. */
  fullShare: 0.3,
  /** Never ask for less than this many px for full power, or more than this many. */
  fullMinPx: 170,
  fullMaxPx: 300,
  /** Degrees of turn per px of sideways pull, and the finer rate for a slow thumb. */
  yawPerPx: 0.1,
  yawPerPxFine: 0.035,
  /** Thumb speed (px/ms) under which the fine rate applies. */
  fineSpeed: 0.22,
  yawMax: 38,
  /** Simulation power at no pull and at full pull. */
  powerMin: 0.42,
  powerMax: 1,
  /** Loft at no pull, and how much it rises by full pull. */
  pitchMin: 5,
  pitchRise: 22,
};

/** Extra loft at full pull for balls that fly differently (heavy drops, power flies flat). */
const ARC: Partial<Record<BallId, number>> = { heavy: 6, power: -2 };

export function fullPullPx(screenH: number): number {
  return clamp(screenH * AIM.fullShare, AIM.fullMinPx, AIM.fullMaxPx);
}

/** 0..1 pull from the vertical drag in px (positive = down, toward the player). */
export function pullFrom(dy: number, screenH: number): number {
  return clamp((dy - AIM.deadPx) / (fullPullPx(screenH) - AIM.deadPx), 0, 1);
}

/** The pull is short enough that letting go cancels. */
export function isCancel(dy: number): boolean {
  return dy < AIM.deadPx;
}

/** Turn from a sideways step of the thumb: finer while the thumb moves slowly. */
export function yawStep(dxPx: number, dtMs: number): number {
  const speed = Math.abs(dxPx) / Math.max(1, dtMs);
  const rate = speed < AIM.fineSpeed ? AIM.yawPerPxFine : AIM.yawPerPx;
  // Mirrored: pull to the left to send the ball right.
  return -dxPx * rate;
}

export function clampYaw(yaw: number): number {
  return clamp(yaw, -AIM.yawMax, AIM.yawMax);
}

/** The shot for a pull of 0..1 with the given ball and aim. */
export function shotFor(ball: BallId, yaw: number, pull: number): Shot {
  const f = clamp(pull, 0, 1);
  return {
    ball,
    yaw: clampYaw(yaw),
    pitch: AIM.pitchMin + (AIM.pitchRise + (ARC[ball] ?? 0)) * f,
    power: AIM.powerMin + (AIM.powerMax - AIM.powerMin) * f,
  };
}

/** Inverse of shotFor's power, for showing a solved shot as a pull. */
export function pullForPower(power: number): number {
  return clamp((power - AIM.powerMin) / (AIM.powerMax - AIM.powerMin), 0, 1);
}
