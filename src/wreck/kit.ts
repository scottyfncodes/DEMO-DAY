/**
 * What the fleet can do on this job: the numbers upgrades change. It lives in
 * the simulation state, so a recorded job replays with the equipment it was
 * played with.
 */
export interface Kit {
  /** Wrecking ball mass (t). */
  ballMass: number;
  /** Highest point the ball can be swung at (m above grade). */
  ballReach: number;
  /** Ball can be dropped from above onto roofs and slabs. */
  drop: boolean;
  /** Excavator energy per bite (kJ). */
  bite: number;
  /** Excavator arm length multiplier. */
  excReach: number;
  /** Demolition shears: cuts steel and cores far faster. */
  shears: boolean;
  /** Rubble the dozer blade carries before it spills (m²). */
  bladeCap: number;
  /** Heaviest block the dozer can shove (t). */
  heavyPush: number;
  /** Ram plate: the dozer knocks out ground-floor walls and columns it drives into. */
  ram: boolean;
  /** Charge damage multiplier. */
  chargePower: number;
  /** Charge shock radius multiplier. */
  chargeRadius: number;
  /** Shaped charges available. */
  shaped: boolean;
  /** Scanner: every weak point is shown from the start. */
  scanner: boolean;
  /** Loader bucket (m² of rubble per scoop). */
  bucket: number;
  /** Heaviest block the loader can lift (t). */
  lift: number;
  /** Scrap sorter: rubble the loader brings back is sold as recycled aggregate. */
  sorter: boolean;
}

export const BASE_KIT: Kit = {
  ballMass: 4.5,
  ballReach: 30,
  drop: false,
  bite: 330,
  excReach: 1,
  shears: false,
  bladeCap: 9,
  heavyPush: 20,
  ram: false,
  chargePower: 1,
  chargeRadius: 1,
  shaped: false,
  scanner: false,
  bucket: 7,
  lift: 6,
  sorter: false,
};

/** Ball radius grows with its mass (same density). */
export function ballRadius(kit: Kit): number {
  return 1.05 * Math.cbrt(kit.ballMass / 4.5);
}
