import { BALL_ORDER, type BallId } from '../sim/balls';

/**
 * The special ball bag. Standard balls are unlimited; specials are found
 * hidden inside bricks (see hiddenBalls in houses.ts) and carried from house
 * to house.
 */

export type SpecialId = Exclude<BallId, 'standard'>;

export const SPECIALS: SpecialId[] = BALL_ORDER.filter((b): b is SpecialId => b !== 'standard');

export const REWARD = {
  /** Most of one special a player can carry. A ball found with a full bag is still found, just not kept. */
  cap: 9,
};

export interface Economy {
  inventory: Partial<Record<SpecialId, number>>;
}

export function emptyEconomy(): Economy {
  return { inventory: {} };
}

/** Adds one found ball to the bag. Returns false if the bag already holds as many as it can. */
export function stash(econ: Economy, ball: SpecialId): boolean {
  const n = econ.inventory[ball] ?? 0;
  if (n >= REWARD.cap) return false;
  econ.inventory[ball] = n + 1;
  return true;
}
