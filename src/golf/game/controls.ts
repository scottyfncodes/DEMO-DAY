import { clamp } from '../sim/math';

/**
 * Touch-and-pull shooting. Where the thumb goes down is what the ball is aimed
 * at; pulling back from there sets the power. Aim and power are separate, so a
 * full pull at a low brick is a hard, flat drive and a soft pull at the same
 * brick lobs onto it. Pure numbers, no DOM, so it is testable.
 */

export const AIM = {
  /** Pull (px) before a shot is armed; letting go inside it only moves the aim. */
  deadPx: 14,
  /** Share of the screen height a full-power pull covers. */
  fullShare: 0.26,
  /** Never ask for less than this many px for full power, or more than this many. */
  fullMinPx: 150,
  fullMaxPx: 260,
  /** Simulation power at the lightest and the fullest pull. */
  powerMin: 0.15,
  powerMax: 1,
};

export function fullPullPx(screenH: number): number {
  return clamp(screenH * AIM.fullShare, AIM.fullMinPx, AIM.fullMaxPx);
}

/** 0..1 pull from how far the thumb has moved back (px). */
export function pullFrom(dist: number, screenH: number): number {
  return clamp((dist - AIM.deadPx) / (fullPullPx(screenH) - AIM.deadPx), 0, 1);
}

/** The pull is short enough that letting go only re-aims. */
export function isCancel(dist: number): boolean {
  return dist < AIM.deadPx;
}

/** Simulation power for a pull of 0..1. */
export function powerFor(pull: number): number {
  return AIM.powerMin + (AIM.powerMax - AIM.powerMin) * clamp(pull, 0, 1);
}
