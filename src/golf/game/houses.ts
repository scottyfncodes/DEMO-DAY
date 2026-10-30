import { PALETTES, tankSpots, type HouseSpec } from '../sim/house';
import { house, oldPatch, reinforced, yardBasic, yardParty, type LevelDef, type Objective } from '../sim/levels';
import { Rng, hashString } from '../sim/math';
import type { Part } from '../sim/parts';
import type { SpecialId } from './rewards';

/**
 * The PLAY campaign: a street of houses, each bigger than the last. Every
 * house has a destruction goal that opens the next one, and no shot limit:
 * the record to beat is how few shots it took. Damage stays between visits.
 * Special balls are hidden inside bricks, found by breaking them.
 */

export interface HouseDef {
  id: string;
  number: string;
  name: string;
  /** What this house is about, in one line. */
  hint: string;
  spec: HouseSpec;
  yard: LevelDef['yard'];
  /** Share of the house (percent) to bring down to open the next one. */
  goal: number;
  /** Special balls hidden in its bricks, and the kinds they can be. */
  hidden: number;
  pool: SpecialId[];
  wind?: { x: number; z: number };
}

const pal = (k: keyof typeof PALETTES): HouseSpec['palette'] => PALETTES[k] as HouseSpec['palette'];

/** How hard falling pieces hit in the campaign: collapses spread from piece to piece. */
export const CAMPAIGN_CASCADE = 2.2;

/** A campaign house: the cascade on, and this many gas bottles in the spots tankSpots picks. */
const rigged = (spec: HouseSpec, bottles: number): HouseSpec => ({ ...spec, cascade: CAMPAIGN_CASCADE, tanks: tankSpots(spec.width ?? 9, spec.storeys, bottles) });

export const HOUSES: HouseDef[] = [
  {
    id: 'h1',
    number: '01',
    name: 'Starter Cottage',
    hint: 'Touch where to hit, pull back for power, let go. The front wall is soft old brick.',
    spec: rigged(house({ storeys: 1, porch: false, chimney: false, palette: pal('honey'), zones: [oldPatch('front', -4.5, 4.5, 0.6, 3.3)] }), 2),
    yard: yardBasic,
    goal: 15,
    hidden: 3,
    pool: ['power'],
  },
  {
    id: 'h2',
    number: '02',
    name: 'Porch House',
    hint: 'Two columns hold up the porch roof. It only needs to lose one.',
    spec: rigged(house({ storeys: 1, chimney: false, palette: pal('rose') }), 3),
    yard: yardBasic,
    goal: 20,
    hidden: 3,
    pool: ['power', 'heavy'],
  },
  {
    id: 'h3',
    number: '03',
    name: 'Two Up',
    hint: 'A second storey. The upper floors bear on the front wall just above the ground floor windows.',
    spec: rigged(house({ storeys: 2, porch: false, chimney: false, palette: pal('sand') }), 4),
    yard: yardBasic,
    goal: 20,
    hidden: 4,
    pool: ['power', 'heavy', 'super'],
  },
  {
    id: 'h4',
    number: '04',
    name: 'Chimney Corner',
    hint: 'The chimney stands on its own footing. From this tee you can see its base.',
    spec: rigged(house({ storeys: 2, palette: pal('honey'), teeX: 3 }), 4),
    yard: { ...yardBasic, trees: [{ x: -8, z: 7, s: 1 }] },
    goal: 26,
    hidden: 4,
    pool: ['power', 'heavy', 'super'],
  },
  {
    id: 'h5',
    number: '05',
    name: 'Wide Load',
    hint: 'A wider front. Undercut the bottom courses and the wall above has nothing to stand on.',
    spec: rigged(house({ storeys: 2, chimney: false, width: 10.8, palette: pal('classic'), zones: [oldPatch('front', -5.4, 5.4, 0.6, 2.1)] }), 5),
    yard: yardBasic,
    goal: 32,
    hidden: 5,
    pool: ['power', 'heavy', 'super', 'multi'],
  },
  {
    id: 'h6',
    number: '06',
    name: 'Deep End',
    hint: 'Deeper rooms, more inside to break. Send a Superball through a window.',
    spec: rigged(house({ storeys: 2, width: 10.8, depth: 7.2, palette: pal('slate') }), 6),
    yard: yardParty,
    goal: 32,
    hidden: 5,
    pool: ['power', 'heavy', 'super', 'multi'],
  },
  {
    id: 'h7',
    number: '07',
    name: 'Three Up',
    hint: 'Three storeys. Bring the bottom down and the top follows.',
    spec: rigged(house({ storeys: 3, porch: false, chimney: false, width: 10.8, depth: 7.2, palette: pal('rose') }), 7),
    yard: yardBasic,
    goal: 40,
    hidden: 6,
    pool: ['power', 'heavy', 'super', 'multi', 'blast'],
  },
  {
    id: 'h8',
    number: '08',
    name: 'Town House',
    hint: 'The lower courses are reinforced. Break them with weight, or start higher up.',
    spec: rigged(house({ storeys: 3, chimney: false, width: 12.6, depth: 7.2, palette: pal('sand'), zones: [reinforced('front', -6.3, 6.3, 0.6, 1.5)] }), 7),
    yard: yardParty,
    goal: 40,
    hidden: 6,
    pool: ['power', 'heavy', 'super', 'multi', 'blast'],
  },
  {
    id: 'h9',
    number: '09',
    name: 'The Manor',
    hint: 'The corners carry the most, and the old brick at the front corners is the weak spot.',
    spec: rigged(house({ storeys: 3, width: 12.6, depth: 7.2, palette: pal('classic'), zones: [oldPatch('front', -6.3, -4.2, 0.6, 9), oldPatch('front', 4.2, 6.3, 0.6, 9)] }), 8),
    yard: yardParty,
    goal: 45,
    hidden: 7,
    pool: ['power', 'heavy', 'super', 'multi', 'blast'],
  },
  {
    id: 'h10',
    number: '10',
    name: 'Demo Day',
    hint: 'The biggest house on the street, a breeze from the left, and every trick you have learned.',
    spec: rigged(house({ storeys: 3, width: 14.4, depth: 8.4, palette: pal('honey'), zones: [reinforced('front', -7.2, 7.2, 0.6, 1.2), oldPatch('left', -8.1, -0.3, 0.6, 9)] }), 9),
    yard: yardParty,
    goal: 50,
    hidden: 8,
    pool: ['power', 'heavy', 'super', 'multi', 'blast'],
    wind: { x: 0.4, z: 0 },
  },
];

export function getHouse(id: string): HouseDef | undefined {
  return HOUSES.find((h) => h.id === id);
}

export function houseObjective(h: HouseDef): Objective {
  return { kind: 'destruction', pct: h.goal };
}

/** The house as a level the session can run: no shot limit, one goal. */
export function houseLevel(h: HouseDef): LevelDef {
  return {
    id: h.id,
    mode: 'house',
    number: h.number,
    title: h.name,
    blurb: h.hint,
    house: h.spec,
    yard: h.yard,
    shots: Infinity,
    par: Infinity,
    objectives: [houseObjective(h)],
    balls: {},
    powerups: {},
    wind: h.wind,
  };
}

/**
 * Which bricks hide a special ball, and which ball. Fixed per house (seeded
 * by its id), so a ball stays in the same brick across visits and rebuilds.
 * Mostly in the walls the player can see; never in the concrete footing.
 */
export function hiddenBalls(h: HouseDef, parts: readonly Part[]): Map<number, SpecialId> {
  const rng = new Rng(hashString(`hidden:${h.id}`));
  const front = parts.filter((p) => p.kind === 'brick' && p.wall === 'front' && p.mat !== 'foundation');
  const sides = parts.filter((p) => p.kind === 'brick' && (p.wall === 'left' || p.wall === 'right') && p.mat !== 'foundation');
  const out = new Map<number, SpecialId>();
  let guard = 0;
  while (out.size < h.hidden && guard++ < 500) {
    const list = rng.next() < 0.75 || !sides.length ? front : sides;
    const p = list[Math.floor(rng.next() * list.length)];
    const ball = h.pool[Math.floor(rng.next() * h.pool.length)];
    if (p && ball && !out.has(p.id)) out.set(p.id, ball);
  }
  return out;
}
