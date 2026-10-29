/**
 * The golf ball arsenal. Each ball changes numbers the simulation reads, so
 * picking one changes what a shot does, not only how it looks.
 */

export type BallId = 'standard' | 'power' | 'super' | 'multi' | 'heavy' | 'blast';

export interface BallDef {
  id: BallId;
  name: string;
  /** One line on what it is for. */
  blurb: string;
  /** A few words for the caption under the ball picker. */
  hint: string;
  radius: number;
  /** Mass in ball units (a standard ball is 1). Damage scales with it. */
  mass: number;
  /** Launch speed at 0% and 100% power, m/s. */
  minSpeed: number;
  maxSpeed: number;
  /** Multiplies the material bounce factor. */
  bounce: number;
  /** Multiplies the material grip (tangential loss). */
  grip: number;
  /** Damage multiplier on every impact. */
  damage: number;
  /** Quadratic air drag coefficient. */
  drag: number;
  /** Contacts before the ball is spent (it then just rolls to a stop). */
  maxBounces: number;
  /** Seconds before the ball is retired regardless. */
  lifetime: number;
  /** Balls launched per shot, and their yaw spread in degrees. */
  count: number;
  spread: number;
  /** Radius of an impact explosion (0 = none). */
  blastRadius: number;
  /** Share of each hit's damage passed on to neighbouring parts (heavy knock). */
  knock: number;
  /** Sideways curve at high power, m/s² per unit of power above 0.8. Makes full power harder to place. */
  hook: number;
  /** Share of the flight the aim guide shows (before power-ups). */
  guide: number;
  color: number;
  /** Ring/stripe colour that identifies the ball at a glance. */
  accent: number;
}

export const BALLS: Record<BallId, BallDef> = {
  standard: {
    id: 'standard',
    name: 'Standard',
    blurb: 'Predictable flight. Breaks brick and glass, and the one to use for seam shots.',
    hint: 'steady flight, best for seams',
    radius: 0.11,
    mass: 1,
    minSpeed: 9,
    maxSpeed: 30,
    bounce: 1,
    grip: 1,
    damage: 1,
    drag: 0.0016,
    maxBounces: 14,
    lifetime: 9,
    count: 1,
    spread: 0,
    blastRadius: 0,
    knock: 0,
    hook: 0,
    guide: 0.42,
    color: 0xfbfaf6,
    accent: 0xfbfaf6,
  },
  power: {
    id: 'power',
    name: 'Power',
    blurb: 'Punches through brick and cracks foundations. Hooks right, and the guide shows less.',
    hint: 'punches through brick',
    radius: 0.12,
    mass: 1.3,
    minSpeed: 12,
    maxSpeed: 36,
    bounce: 0.8,
    grip: 1,
    damage: 1.6,
    drag: 0.0014,
    maxBounces: 10,
    lifetime: 8,
    count: 1,
    spread: 0,
    blastRadius: 0,
    knock: 0.15,
    hook: 14,
    guide: 0.3,
    color: 0xf2b705,
    accent: 0x1d1603,
  },
  super: {
    id: 'super',
    name: 'Superball',
    blurb: 'Barely loses speed on a bounce. Weak on brick, made for windows, hallways and bank shots.',
    hint: 'keeps its bounce',
    radius: 0.11,
    mass: 0.8,
    minSpeed: 9,
    maxSpeed: 28,
    bounce: 1.62,
    grip: 0.25,
    damage: 0.7,
    drag: 0.0016,
    maxBounces: 36,
    lifetime: 13,
    count: 1,
    spread: 0,
    blastRadius: 0,
    knock: 0,
    hook: 0,
    guide: 0.42,
    color: 0x2fb8c9,
    accent: 0xff5d7a,
  },
  multi: {
    id: 'multi',
    name: 'Multiball',
    blurb: 'Five balls in a fan. Each one flies and hits on its own.',
    hint: 'five balls in a fan',
    radius: 0.1,
    mass: 0.9,
    minSpeed: 9,
    maxSpeed: 29,
    bounce: 1,
    grip: 1,
    damage: 0.9,
    drag: 0.0016,
    maxBounces: 10,
    lifetime: 8,
    count: 5,
    spread: 4.5,
    blastRadius: 0,
    knock: 0,
    hook: 0,
    guide: 0.42,
    color: 0xfbfaf6,
    accent: 0x3f8f4f,
  },
  heavy: {
    id: 'heavy',
    name: 'Heavy',
    blurb: 'Three times the mass on a slow, dropping flight. Shoves supports out; no good for bank shots or seams.',
    hint: 'triple weight, shoves supports',
    radius: 0.2,
    mass: 3,
    minSpeed: 8,
    maxSpeed: 23,
    bounce: 0.45,
    grip: 1.4,
    damage: 1,
    drag: 0.0008,
    maxBounces: 6,
    lifetime: 8,
    count: 1,
    spread: 0,
    blastRadius: 0,
    knock: 0.45,
    hook: 0,
    guide: 0.42,
    color: 0x3c4146,
    accent: 0x8a949b,
  },
  blast: {
    id: 'blast',
    name: 'Charge',
    blurb: 'A golf ball packed like a demolition charge: it goes off on the first hard contact.',
    hint: 'goes off on the first hard hit',
    radius: 0.12,
    mass: 1,
    minSpeed: 9,
    maxSpeed: 28,
    bounce: 0.6,
    grip: 1,
    damage: 1,
    drag: 0.0016,
    maxBounces: 3,
    lifetime: 8,
    count: 1,
    spread: 0,
    blastRadius: 1.7,
    knock: 0,
    hook: 0,
    guide: 0.42,
    color: 0xd9452b,
    accent: 0xf2b705,
  },
};

export const BALL_ORDER: BallId[] = ['standard', 'power', 'super', 'multi', 'heavy', 'blast'];

export const isBallId = (v: unknown): v is BallId => typeof v === 'string' && v in BALLS;
