import type { ChargeType, Direction, PlacedCharge } from '../core/types';

type ShowcaseCharge = { type: ChargeType; memberId: string; direction?: Direction };

/**
 * One known-good plan per building, used by the title screen to run a
 * demolition on loop before the player has placed anything. These are the
 * show, not a hint: they are never surfaced in the job itself.
 */
export const SHOWCASE_PLANS: Record<string, ShowcaseCharge[]> = {
  shed: [
    { type: 'small', memberId: 'post_l' },
    { type: 'small', memberId: 'post_r' },
  ],
  garage: [
    { type: 'heavy', memberId: 'wall_l' },
    { type: 'small', memberId: 'pier' },
    { type: 'small', memberId: 'wall_r' },
  ],
  silo: [{ type: 'directional', memberId: 'leg_l', direction: 'left' }],
  house: [
    { type: 'heavy', memberId: 'chimney' },
    { type: 'small', memberId: 'p1' },
    { type: 'small', memberId: 'p2' },
  ],
  mill: [{ type: 'directional', memberId: 's1', direction: 'left' }],
  warehouse: [
    { type: 'heavy', memberId: 'c1_1' },
    { type: 'heavy', memberId: 'c1_2' },
    { type: 'heavy', memberId: 'c1_3' },
    { type: 'shaped', memberId: 'c1_4' },
    { type: 'shaped', memberId: 'core' },
  ],
};

/** The showcase plan for a building as placed charges, or the shed's when none is defined. */
export function showcasePlan(buildingId: string): PlacedCharge[] {
  const plan = SHOWCASE_PLANS[buildingId] ?? (SHOWCASE_PLANS.shed as ShowcaseCharge[]);
  return plan.map((c, i) => ({ ...c, id: `show${i}` }));
}
