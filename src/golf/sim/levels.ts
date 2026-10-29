import type { BallId } from './balls';
import { PALETTES, type HouseSpec, type YardSpec, type Zone } from './house';
import { Rng, hashString } from './math';

/**
 * Levels as data. Every campaign level teaches one idea; each has a shot
 * budget, a par (three stars) and objectives the session checks against the
 * simulation. Pars are proven reachable by the recorded solutions in
 * tests/golf-levels.test.ts.
 */

export type PowerUpId = 'drive' | 'ricochet' | 'precision' | 'golfers';
export type Mode = 'campaign' | 'score' | 'precision' | 'sandbox' | 'daily';

export type Objective =
  | { kind: 'bricks'; n: number }
  | { kind: 'seams'; n: number }
  | { kind: 'windows'; n: number }
  | { kind: 'target'; tag: string; label: string }
  | { kind: 'enter' }
  | { kind: 'through' }
  | { kind: 'chain'; n: number }
  | { kind: 'collapse'; what: 'roof' | 'porch' | 'chimney' | 'floor'; n: number }
  | { kind: 'destruction'; pct: number }
  | { kind: 'decor'; n: number }
  | { kind: 'score'; n: number };

export interface LevelDef {
  id: string;
  mode: Mode;
  number: string;
  title: string;
  /** One line: what this level is about. */
  blurb: string;
  house: HouseSpec;
  yard: YardSpec;
  /** Shot budget (Infinity in the sandbox). */
  shots: number;
  /** Shots for three stars. */
  par: number;
  objectives: Objective[];
  /** Special ball ammo (the standard ball only costs shots). */
  balls: Partial<Record<BallId, number>>;
  powerups: Partial<Record<PowerUpId, number>>;
  wind?: { x: number; z: number };
  /** Show the whole flight and the seam-aware landing ring (teaching levels). */
  fullGuide?: boolean;
  /** Ball introduced on this level, shown on the intro card. */
  introduces?: BallId | PowerUpId;
  /** Score Attack medal thresholds: bronze, silver, gold. */
  medals?: [number, number, number];
  /** Short coaching lines shown in order at the start. */
  tips?: string[];
}

export const POWERUPS: Record<PowerUpId, { name: string; blurb: string; hint: string }> = {
  drive: { name: 'Power Drive', blurb: 'Next shot launches faster and hits half again as hard.', hint: 'next shot hits harder' },
  ricochet: { name: 'Ricochet Boost', blurb: 'Next shot keeps more speed on its first eight bounces.', hint: 'next shot keeps its bounce' },
  precision: { name: 'Precision Mode', blurb: 'Three shots with the full flight path and a landing ring that turns white on a seam.', hint: 'full flight path shown' },
  golfers: { name: 'Multi-Golfer', blurb: 'Three golfers tee off together, side by side, with your aim and power.', hint: 'three tees at once' },
};

const yardBasic: YardSpec = {
  trees: [
    { x: -8, z: 7, s: 1 },
    { x: 9.5, z: 3, s: 0.9 },
  ],
  decor: [
    { model: 'gnome', x: -2.9, z: 2.2 },
    { model: 'flamingo', x: 4.4, z: 3.4 },
    { model: 'mailbox', x: 2.2, z: 11 },
    { model: 'birdbath', x: -4.8, z: 5.5 },
  ],
};

const yardParty: YardSpec = {
  trees: [
    { x: -8.5, z: 6, s: 1.05 },
    { x: 9.5, z: 2, s: 0.9 },
  ],
  decor: [
    { model: 'gnome', x: -2.6, z: 2.6 },
    { model: 'gnome', x: -1.6, z: 3.4 },
    { model: 'gnome', x: 2.4, z: 2.8 },
    { model: 'flamingo', x: 3.4, z: 3.8 },
    { model: 'flamingo', x: 4.2, z: 3.2 },
    { model: 'birdbath', x: -4.4, z: 5 },
    { model: 'light', x: -0.4, z: 5 },
    { model: 'light', x: 1.0, z: 5 },
    { model: 'light', x: -0.4, z: 8 },
    { model: 'light', x: 1.0, z: 8 },
    { model: 'bench', x: -5.6, z: 1.8 },
    { model: 'lawnchair', x: 5.6, z: 5.5 },
    { model: 'mailbox', x: 2.4, z: 11 },
  ],
};

const house = (o: Partial<HouseSpec> & { palette: HouseSpec['palette'] }): HouseSpec => ({ storeys: 2, porch: true, chimney: true, furnish: true, ...o });

const oldPatch = (wall: Zone['wall'], a0: number, a1: number, y0: number, y1: number): Zone => ({ wall, a0, a1, y0, y1, mat: 'oldBrick' });
const reinforced = (wall: Zone['wall'], a0: number, a1: number, y0: number, y1: number): Zone => ({ wall, a0, a1, y0, y1, mat: 'foundation' });

export const CAMPAIGN: LevelDef[] = [
  {
    id: 'c1',
    mode: 'campaign',
    number: '01',
    title: 'First Swing',
    blurb: 'Drag to aim, set the power, swing. Knock three bricks out of the front wall.',
    house: house({ storeys: 1, chimney: false, palette: PALETTES.honey as HouseSpec['palette'], zones: [oldPatch('front', -4.5, 4.5, 0.6, 3.3)] }),
    yard: yardBasic,
    shots: 6,
    par: 2,
    objectives: [{ kind: 'bricks', n: 3 }],
    balls: {},
    powerups: {},
    fullGuide: true,
    tips: ['Drag anywhere on the lawn to aim. Up and down sets the loft.', 'Slide the power bar to set your marker. The yellow dot shows where that shot lands.', 'Hold SWING and let go as the meter reaches your marker. On the marker is a pure strike.', 'This wall is old brick: anything solid knocks one out.'],
  },
  {
    id: 'c2',
    mode: 'campaign',
    number: '02',
    title: 'Mind the Gap',
    blurb: 'Hit the mortar line between two bricks, square on and hard, and both go.',
    house: house({ storeys: 1, chimney: false, palette: PALETTES.honey as HouseSpec['palette'] }),
    yard: yardBasic,
    shots: 5,
    par: 1,
    objectives: [{ kind: 'seams', n: 1 }],
    balls: {},
    powerups: { precision: 1 },
    fullGuide: true,
    tips: ['The landing ring turns white when it sits on a joint between two bricks.', 'Seams need a square hit at strong power. Glancing shots only crack one.'],
  },
  {
    id: 'c3',
    mode: 'campaign',
    number: '03',
    title: 'Window Shopping',
    blurb: 'Glass breaks at any speed, and the ball carries on through. Break four panes.',
    house: house({ storeys: 1, chimney: false, palette: PALETTES.rose as HouseSpec['palette'] }),
    yard: yardBasic,
    shots: 6,
    par: 3,
    objectives: [{ kind: 'windows', n: 4 }],
    balls: {},
    powerups: {},
    tips: ['From here on the guide only shows the start of the flight. The yellow dot is still where the ball lands first.'],
  },
  {
    id: 'c4',
    mode: 'campaign',
    number: '04',
    title: 'House Call',
    blurb: 'Send a ball in through the living room window and break the TV on the far wall.',
    house: house({ storeys: 1, chimney: false, palette: PALETTES.rose as HouseSpec['palette'] }),
    yard: yardBasic,
    shots: 5,
    par: 1,
    objectives: [{ kind: 'target', tag: 'tv', label: 'Break the TV' }],
    balls: {},
    powerups: {},
    tips: ['When a ball goes inside, the front wall turns see-through so you can follow it.'],
  },
  {
    id: 'c5',
    mode: 'campaign',
    number: '05',
    title: 'Porch Light',
    blurb: 'Two columns hold the porch roof. Take one out and the beam goes with it.',
    house: house({ palette: PALETTES.classic as HouseSpec['palette'] }),
    yard: yardBasic,
    shots: 4,
    par: 1,
    objectives: [{ kind: 'collapse', what: 'porch', n: 1 }],
    balls: { power: 2 },
    powerups: {},
    introduces: 'power',
    tips: ['New: the Power ball. Heavier, faster, and it punches through brick. Full power hooks right.'],
  },
  {
    id: 'c6',
    mode: 'campaign',
    number: '06',
    title: 'Bank Shot',
    blurb: 'One ball, ten different things hit. The Superball keeps its bounce.',
    house: house({ palette: PALETTES.slate as HouseSpec['palette'] }),
    yard: yardBasic,
    shots: 4,
    par: 1,
    objectives: [{ kind: 'chain', n: 10 }],
    balls: { super: 3 },
    powerups: { ricochet: 1 },
    introduces: 'super',
    tips: ['New: the Superball. It barely hurts brick, but it rattles round rooms. Get it inside.'],
  },
  {
    id: 'c7',
    mode: 'campaign',
    number: '07',
    title: 'Garden Party',
    blurb: 'Gnomes, flamingos, lights and a bird bath. Clear six of them off the lawn.',
    house: house({ palette: PALETTES.sand as HouseSpec['palette'] }),
    yard: yardParty,
    shots: 4,
    par: 2,
    objectives: [{ kind: 'decor', n: 6 }],
    balls: { multi: 2 },
    powerups: {},
    introduces: 'multi',
    tips: ['New: Multiball. Five balls in a fan, each on its own path. Low shots sweep the lawn.', 'The squirrels and birds always get out of the way.'],
  },
  {
    id: 'c8',
    mode: 'campaign',
    number: '08',
    title: 'Chimney Sweep',
    blurb: 'The chimney stands on its own footing, two bricks wide. Cut both at the bottom.',
    house: house({ palette: PALETTES.classic as HouseSpec['palette'] }),
    yard: { ...yardBasic, trees: [{ x: -8, z: 7, s: 1 }] },
    shots: 4,
    par: 1,
    objectives: [{ kind: 'collapse', what: 'chimney', n: 1 }],
    balls: { heavy: 2 },
    powerups: {},
    introduces: 'heavy',
    tips: ['A seam shot low on the chimney takes out both bricks of a course.', 'New: the Heavy ball. Three times the mass: it shoves supports out, but it is slow and drops fast.'],
  },
  {
    id: 'c9',
    mode: 'campaign',
    number: '09',
    title: 'Raise the Roof',
    blurb: 'The roof rests on the wall tops and a ridge beam on the gables. Bring two roof sections down.',
    house: house({ palette: PALETTES.slate as HouseSpec['palette'], zones: [reinforced('front', -4.5, 4.5, 0.6, 1.2)] }),
    yard: yardBasic,
    shots: 7,
    par: 4,
    objectives: [{ kind: 'collapse', what: 'roof', n: 2 }],
    balls: { power: 2, heavy: 2 },
    powerups: { golfers: 1 },
    introduces: 'golfers',
    tips: ['New: Multi-Golfer. Three golfers fire your shot together from three tees.', 'A roof section drops when the wall top under it goes, or when the ridge loses its gable.'],
  },
  {
    id: 'c10',
    mode: 'campaign',
    number: '10',
    title: 'Demo Day',
    blurb: 'The whole house. Bring 30% of it down, with everything you have.',
    house: house({ palette: PALETTES.honey as HouseSpec['palette'], zones: [reinforced('front', -4.5, 4.5, 0.6, 1.2), oldPatch('left', -5.7, -0.3, 0.6, 6)] }),
    yard: yardParty,
    shots: 9,
    par: 6,
    objectives: [{ kind: 'destruction', pct: 30 }],
    balls: { power: 3, heavy: 2, super: 1, multi: 1, blast: 3 },
    powerups: { drive: 1, golfers: 1, precision: 1 },
    introduces: 'blast',
    wind: { x: 0.4, z: 0 },
    tips: ['New: the Charge ball. It goes off on the first hard contact.', 'A light breeze from the left today: watch the flag.'],
  },
];

export const SCORE_ATTACK: LevelDef = {
  id: 'score',
  mode: 'score',
  number: 'SA',
  title: 'Open House',
  blurb: 'Eight shots. Every brick, pane, gnome and collapse scores. Streaks multiply.',
  house: house({ palette: PALETTES.rose as HouseSpec['palette'] }),
  yard: yardParty,
  shots: 8,
  par: 8,
  objectives: [],
  balls: { power: 2, super: 2, multi: 1, heavy: 1, blast: 2 },
  powerups: { drive: 1, ricochet: 1, golfers: 1 },
  // Proven reachable: tests/golf-levels.test.ts replays an 8-shot run that clears gold.
  medals: [5000, 10000, 16000],
};

export const PRECISION: LevelDef[] = [
  {
    id: 'p1',
    mode: 'precision',
    number: 'P1',
    title: 'Through and Through',
    blurb: 'Standard balls only. In through a front window and out through the back of the house.',
    house: house({ palette: PALETTES.sand as HouseSpec['palette'] }),
    yard: yardBasic,
    shots: 5,
    par: 1,
    objectives: [{ kind: 'through' }],
    balls: {},
    powerups: {},
  },
  {
    id: 'p2',
    mode: 'precision',
    number: 'P2',
    title: 'Trophy Room',
    blurb: 'A bowling trophy on the landing, upstairs behind the middle window. Knock it off.',
    house: house({ palette: PALETTES.classic as HouseSpec['palette'] }),
    yard: yardBasic,
    shots: 5,
    par: 1,
    objectives: [{ kind: 'target', tag: 'trophy', label: 'Knock off the trophy' }],
    balls: { power: 1 },
    powerups: {},
  },
  {
    id: 'p3',
    mode: 'precision',
    number: 'P3',
    title: 'Clockwork',
    blurb: 'Grandfather clock in the hall, past the front door. Through the door, or the door first?',
    house: house({ palette: PALETTES.slate as HouseSpec['palette'] }),
    yard: yardBasic,
    shots: 5,
    par: 2,
    objectives: [{ kind: 'target', tag: 'clock', label: 'Topple the clock' }],
    balls: { power: 1 },
    powerups: {},
  },
];

export const SANDBOX: LevelDef = {
  id: 'sandbox',
  mode: 'sandbox',
  number: 'SB',
  title: 'Sandbox',
  blurb: 'No par, no budget. Every ball and power-up, as much as you like.',
  house: house({ palette: PALETTES.classic as HouseSpec['palette'] }),
  yard: yardParty,
  shots: Infinity,
  par: Infinity,
  objectives: [],
  balls: { power: Infinity, super: Infinity, multi: Infinity, heavy: Infinity, blast: Infinity },
  powerups: { drive: Infinity, ricochet: Infinity, precision: Infinity, golfers: Infinity },
};

/** A fixed layout per calendar day, built from the date alone. Same day, same challenge, on every device. */
export function dailyLevel(date: string): LevelDef {
  const rng = new Rng(hashString(`demo-day:${date}`));
  const palettes = Object.values(PALETTES);
  const palette = palettes[Math.floor(rng.next() * palettes.length)] as HouseSpec['palette'];
  const storeys: 1 | 2 = rng.next() < 0.3 ? 1 : 2;
  const pick = rng.next();
  const objectives: Objective[] =
    pick < 0.25
      ? [{ kind: 'destruction', pct: storeys === 1 ? 16 : 12 }]
      : pick < 0.5
        ? [{ kind: 'windows', n: 5 }]
        : pick < 0.75
          ? [{ kind: 'bricks', n: 20 }]
          : [{ kind: 'score', n: 3000 }];
  const windX = Math.round((rng.next() - 0.5) * 8) / 10;
  return {
    id: `daily-${date}`,
    mode: 'daily',
    number: 'DC',
    title: 'Daily Challenge',
    blurb: `${date}. One layout for everyone today, scored on this device.`,
    house: house({ storeys, palette, chimney: rng.next() < 0.7, porch: rng.next() < 0.8 }),
    yard: rng.next() < 0.5 ? yardBasic : yardParty,
    shots: 6,
    par: 4,
    objectives,
    balls: { power: 1 + Math.floor(rng.next() * 2), super: 1, heavy: rng.next() < 0.5 ? 1 : 0, blast: rng.next() < 0.4 ? 1 : 0, multi: 1 },
    powerups: { drive: 1 },
    wind: { x: windX, z: 0 },
  };
}

export const ALL_LEVELS: LevelDef[] = [...CAMPAIGN, SCORE_ATTACK, ...PRECISION, SANDBOX];

export function getLevel(id: string): LevelDef {
  if (id.startsWith('daily-')) return dailyLevel(id.slice(6));
  const l = ALL_LEVELS.find((x) => x.id === id);
  if (!l) throw new Error(`Unknown level ${id}`);
  return l;
}

export function objectiveText(o: Objective): string {
  switch (o.kind) {
    case 'bricks':
      return `Break ${o.n} bricks`;
    case 'seams':
      return o.n === 1 ? 'Land a seam shot' : `Land ${o.n} seam shots`;
    case 'windows':
      return `Break ${o.n} window panes`;
    case 'target':
      return o.label;
    case 'enter':
      return 'Get a ball inside the house';
    case 'through':
      return 'In one side, out the other';
    case 'chain':
      return `Hit ${o.n} things with one ball`;
    case 'collapse':
      return o.what === 'roof' ? `Drop ${o.n} roof sections` : o.what === 'porch' ? 'Drop the porch roof' : o.what === 'chimney' ? 'Bring down the chimney' : 'Collapse a floor';
    case 'destruction':
      return `Demolish ${o.pct}% of the house`;
    case 'decor':
      return `Clear ${o.n} garden pieces`;
    case 'score':
      return `Score ${o.n.toLocaleString('en-US')}`;
  }
}
