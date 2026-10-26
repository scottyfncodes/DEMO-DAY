import { BASE_KIT, type Kit } from '../wreck/kit';

/**
 * The fleet: five machines, each with its own job on site, its own move
 * budget and its own upgrade tree. Upgrades are plain data with an `apply`
 * that changes the kit the simulation reads, so every purchase changes what
 * actually happens on the next job.
 */

export type MachineId = 'ball' | 'charges' | 'excavator' | 'dozer' | 'loader';

export const MACHINE_ORDER: MachineId[] = ['ball', 'charges', 'excavator', 'dozer', 'loader'];

export interface MachineDef {
  id: MachineId;
  name: string;
  /** Short name for the machine bar. */
  short: string;
  /** One move, as the player thinks of it. */
  move: string;
  moves: string;
  role: string;
  /** What it is best at, for the loadout screen. */
  strength: string;
  /** Default move budget when a contract does not set one. */
  baseMoves: number;
  /** 0 for the machines you start with. */
  price: number;
}

export const MACHINES: Record<MachineId, MachineDef> = {
  ball: {
    id: 'ball',
    name: 'Crane & wrecking ball',
    short: 'Crane',
    move: 'swing',
    moves: 'swings',
    role: 'Tap a part of the building to swing at it. Where it hits and how hard decides what gives way.',
    strength: 'Heavy hits on the frame. Starts collapses.',
    baseMoves: 6,
    price: 0,
  },
  charges: {
    id: 'charges',
    name: 'Explosive charges',
    short: 'Charges',
    move: 'charge',
    moves: 'charges',
    role: 'Strap charges to columns and walls, then detonate. Firing is free; every charge you set costs one.',
    strength: 'Cuts key supports anywhere, at any height.',
    baseMoves: 4,
    price: 8000,
  },
  excavator: {
    id: 'excavator',
    name: 'High-reach excavator',
    short: 'Excavator',
    move: 'crunch',
    moves: 'crunches',
    role: 'Tap a spot to drive into reach and take three bites. Breaks stubborn sections, core walls and heavy slabs.',
    strength: 'Precision. Picks apart what the ball cannot.',
    baseMoves: 5,
    price: 6000,
  },
  dozer: {
    id: 'dozer',
    name: 'Bulldozer',
    short: 'Dozer',
    move: 'run',
    moves: 'runs',
    role: 'Tap the rubble to push it toward the pit or the pad. One run drives the blade through everything in its path.',
    strength: 'Clears the most rubble per move.',
    baseMoves: 6,
    price: 0,
  },
  loader: {
    id: 'loader',
    name: 'Wheel loader',
    short: 'Loader',
    move: 'scoop',
    moves: 'scoops',
    role: 'Tap a heap or a piece of salvage. It scoops a bucket, or lifts the piece, and drives it to the pad or the pit.',
    strength: 'Recovers salvage and cleans up corners.',
    baseMoves: 5,
    price: 5000,
  },
};

export type UpgradeCategory = 'power' | 'efficiency' | 'capability';

export interface UpgradeDef {
  id: string;
  machine: MachineId;
  category: UpgradeCategory;
  name: string;
  cost: number;
  /** What changes, in numbers, before and after. */
  effect: string;
  detail: string;
  requires?: string;
  /** Contracts that have to be completed before it is offered. */
  minJobs?: number;
  apply: (kit: Kit) => void;
}

export const UPGRADES: UpgradeDef[] = [
  // Crane and ball.
  { id: 'ball-power-1', machine: 'ball', category: 'power', name: 'Heavy ball', cost: 5000, effect: 'Ball 4.5 t → 6.5 t', detail: 'About 45% more energy in every swing. Columns that cracked now go.', apply: (k) => void (k.ballMass = 6.5) },
  { id: 'ball-power-2', machine: 'ball', category: 'power', name: 'Forged ball', cost: 14000, effect: 'Ball 6.5 t → 9 t', detail: 'Twice the base ball. Punches through core walls and floors.', requires: 'ball-power-1', minJobs: 3, apply: (k) => void (k.ballMass = 9) },
  { id: 'ball-eff-1', machine: 'ball', category: 'efficiency', name: 'Boom extension', cost: 6000, effect: 'Reach 30 m → 45 m', detail: 'Swing at upper floors instead of only the bottom ten storeys.', apply: (k) => void (k.ballReach = 45) },
  { id: 'ball-eff-2', machine: 'ball', category: 'efficiency', name: 'Lattice boom', cost: 16000, effect: 'Reach 45 m → 70 m', detail: 'Reaches the top of anything on the books.', requires: 'ball-eff-1', minJobs: 4, apply: (k) => void (k.ballReach = 70) },
  { id: 'ball-cap', machine: 'ball', category: 'capability', name: 'Drop strike', cost: 11000, effect: 'New move: drop the ball from above', detail: 'Drive floors down from the top: drops land on roofs and slabs the swing cannot reach.', minJobs: 2, apply: (k) => void (k.drop = true) },
  // Charges.
  { id: 'charges-power-1', machine: 'charges', category: 'power', name: 'High-yield blend', cost: 6000, effect: 'Charge damage +30%', detail: 'Cutters finish heavier columns; blasts strip more around them.', apply: (k) => void (k.chargePower = 1.3) },
  { id: 'charges-power-2', machine: 'charges', category: 'power', name: 'Industrial blend', cost: 15000, effect: 'Charge damage +60%', detail: 'One cutter takes a core column. Two take a core wall.', requires: 'charges-power-1', minJobs: 4, apply: (k) => void (k.chargePower = 1.6) },
  { id: 'charges-eff-1', machine: 'charges', category: 'efficiency', name: 'Det cord ring', cost: 5000, effect: 'Shock radius +35%', detail: 'Each charge weakens more of its neighbours and finds more weak points.', apply: (k) => void (k.chargeRadius = 1.35) },
  { id: 'charges-cap', machine: 'charges', category: 'capability', name: 'Shaped charges', cost: 12000, effect: 'New charge: shaped (costs 2)', detail: 'A focused jet that goes straight through cores, chimneys and trusses.', minJobs: 3, apply: (k) => void (k.shaped = true) },
  { id: 'charges-scan', machine: 'charges', category: 'capability', name: 'Structural scanner', cost: 7000, effect: 'Every weak point shown at the start', detail: 'Hidden defects show up before the first move, so you can plan around them.', minJobs: 1, apply: (k) => void (k.scanner = true) },
  // Excavator.
  { id: 'excavator-power-1', machine: 'excavator', category: 'power', name: 'Hydraulic breaker', cost: 5500, effect: 'Bite 330 → 470 kJ', detail: 'Three bites finish a ground-floor column.', apply: (k) => void (k.bite = 470) },
  { id: 'excavator-power-2', machine: 'excavator', category: 'power', name: 'Twin-ram breaker', cost: 14000, effect: 'Bite 470 → 640 kJ', detail: 'Chews through core walls and heavy slabs.', requires: 'excavator-power-1', minJobs: 4, apply: (k) => void (k.bite = 640) },
  { id: 'excavator-eff-1', machine: 'excavator', category: 'efficiency', name: 'Long-reach boom', cost: 6500, effect: 'Reach about 24 m → 30 m', detail: 'Work two storeys higher from the same spot.', apply: (k) => void (k.excReach = 1.25) },
  { id: 'excavator-cap', machine: 'excavator', category: 'capability', name: 'Demolition shears', cost: 10000, effect: 'Steel ×3.5, cores and stacks ×1.4', detail: 'Cuts trusses and steel frames cleanly, and splits heavy slabs for the dozer.', minJobs: 2, apply: (k) => void (k.shears = true) },
  // Dozer.
  { id: 'dozer-power-1', machine: 'dozer', category: 'power', name: 'Push frame', cost: 4500, effect: 'Pushes blocks up to 20 t → 36 t', detail: 'Shoves broken slabs without the excavator breaking them first.', apply: (k) => void (k.heavyPush = 36) },
  { id: 'dozer-power-2', machine: 'dozer', category: 'power', name: 'Heavy push frame', cost: 12000, effect: 'Pushes blocks up to 36 t → 60 t', detail: 'Core slabs move like gravel.', requires: 'dozer-power-1', minJobs: 4, apply: (k) => void (k.heavyPush = 60) },
  { id: 'dozer-eff-1', machine: 'dozer', category: 'efficiency', name: 'Wide blade', cost: 4000, effect: 'Blade load 9 → 14 m²', detail: 'Each run carries half as much again before it spills.', apply: (k) => void (k.bladeCap = 14) },
  { id: 'dozer-eff-2', machine: 'dozer', category: 'efficiency', name: 'U-blade', cost: 10000, effect: 'Blade load 14 → 20 m²', detail: 'Clears a big heap in one run.', requires: 'dozer-eff-1', minJobs: 3, apply: (k) => void (k.bladeCap = 20) },
  { id: 'dozer-cap', machine: 'dozer', category: 'capability', name: 'Ram plate', cost: 9000, effect: 'Ramming does 5× damage', detail: 'The dozer knocks out ground-floor walls and columns it drives into.', minJobs: 2, apply: (k) => void (k.ram = true) },
  // Loader.
  { id: 'loader-power-1', machine: 'loader', category: 'power', name: 'Heavy-lift arms', cost: 4000, effect: 'Lifts up to 6 t → 16 t', detail: 'Picks up vaults, truss steel and broken slabs.', apply: (k) => void (k.lift = 16) },
  { id: 'loader-power-2', machine: 'loader', category: 'power', name: 'Grapple arms', cost: 9000, effect: 'Lifts up to 16 t → 30 t', detail: 'Carries core slabs off site in one trip.', requires: 'loader-power-1', minJobs: 4, apply: (k) => void (k.lift = 30) },
  { id: 'loader-eff-1', machine: 'loader', category: 'efficiency', name: 'Big bucket', cost: 4000, effect: 'Bucket 7 → 11 m²', detail: 'More rubble per trip, and a wider scoop.', apply: (k) => void (k.bucket = 11) },
  { id: 'loader-eff-2', machine: 'loader', category: 'efficiency', name: 'Rock bucket', cost: 9000, effect: 'Bucket 11 → 16 m²', detail: 'Clears a heap the size of a car each trip.', requires: 'loader-eff-1', minJobs: 3, apply: (k) => void (k.bucket = 16) },
  { id: 'loader-cap', machine: 'loader', category: 'capability', name: 'Scrap sorter', cost: 8000, effect: 'Rubble on the pad sells for $90/m²', detail: 'Everything the loader brings to the pad is sorted and sold as recycled aggregate.', minJobs: 2, apply: (k) => void (k.sorter = true) },
];

export function getUpgrade(id: string): UpgradeDef | undefined {
  return UPGRADES.find((u) => u.id === id);
}

export function upgradesFor(machine: MachineId): UpgradeDef[] {
  return UPGRADES.filter((u) => u.machine === machine);
}

/** The kit the simulation runs with, given what has been bought. */
export function kitFor(upgrades: readonly string[]): Kit {
  const kit: Kit = { ...BASE_KIT };
  // Apply in catalogue order so tier 2 always lands after tier 1.
  for (const u of UPGRADES) if (upgrades.includes(u.id)) u.apply(kit);
  return kit;
}

export function isMachineId(v: unknown): v is MachineId {
  return typeof v === 'string' && (MACHINE_ORDER as string[]).includes(v);
}
