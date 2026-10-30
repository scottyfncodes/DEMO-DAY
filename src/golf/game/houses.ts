import type { HouseSpec } from '../sim/house';
import { PALETTES } from '../sim/house';
import { house, oldPatch, reinforced, yardBasic, yardParty, type LevelDef, type Objective } from '../sim/levels';
import type { SpecialId } from './rewards';

/**
 * The PLAY campaign: a street of houses, each a structural puzzle with one
 * clear objective and no shot limit. Damage stays between sessions; finishing
 * a house opens the next one and pays out specials. New balls arrive with the
 * house that needs them first.
 */

export interface HouseDef {
  id: string;
  number: string;
  name: string;
  /** The puzzle in one line: what holds this house up. */
  hint: string;
  spec: HouseSpec;
  yard: LevelDef['yard'];
  objective: Objective;
  /** A ball this house introduces: it opens in the reward meter and a couple come with the house. */
  unlocks?: SpecialId;
  /** Paid out on finishing the house. */
  prize: Partial<Record<SpecialId, number>>;
  wind?: { x: number; z: number };
}

const pal = (k: keyof typeof PALETTES): HouseSpec['palette'] => PALETTES[k] as HouseSpec['palette'];

export const HOUSES: HouseDef[] = [
  {
    id: 'h1',
    number: '01',
    name: 'Starter Cottage',
    hint: 'Pull back to aim, let go to shoot. The front wall is soft old brick.',
    spec: house({ storeys: 1, porch: false, chimney: false, palette: pal('honey'), zones: [oldPatch('front', -4.5, 4.5, 0.6, 3.3)] }),
    yard: yardBasic,
    objective: { kind: 'bricks', n: 15 },
    unlocks: 'power',
    prize: { power: 2 },
  },
  {
    id: 'h2',
    number: '02',
    name: 'The Porch',
    hint: 'Two columns hold up the porch roof. It only needs to lose one.',
    spec: house({ storeys: 1, chimney: false, palette: pal('rose') }),
    yard: yardBasic,
    objective: { kind: 'collapse', what: 'porch', n: 1 },
    unlocks: 'heavy',
    prize: { heavy: 1, power: 1 },
  },
  {
    id: 'h3',
    number: '03',
    name: 'Picture Windows',
    hint: 'Glass breaks at any speed and the ball carries on into the room.',
    spec: house({ storeys: 2, porch: false, chimney: false, palette: pal('sand') }),
    yard: yardBasic,
    objective: { kind: 'windows', n: 6 },
    unlocks: 'super',
    prize: { super: 2 },
  },
  {
    id: 'h4',
    number: '04',
    name: 'Front Wall',
    hint: 'Undercut the bottom courses and the wall above has nothing to stand on.',
    spec: house({ storeys: 2, porch: false, chimney: false, palette: pal('classic'), zones: [oldPatch('front', -4.5, 4.5, 0.6, 2.1)] }),
    yard: yardBasic,
    objective: { kind: 'wall', wall: 'front', pct: 40 },
    unlocks: 'multi',
    prize: { multi: 2, power: 1 },
  },
  {
    id: 'h5',
    number: '05',
    name: 'Upstairs, Downstairs',
    hint: 'The upper floors bear on the front wall just above the ground floor windows.',
    spec: house({ storeys: 2, chimney: false, palette: pal('slate') }),
    yard: yardBasic,
    objective: { kind: 'collapse', what: 'floor', n: 1 },
    prize: { heavy: 2 },
  },
  {
    id: 'h6',
    number: '06',
    name: 'Chimney Stack',
    hint: 'The chimney stands on its own footing, two bricks wide. From this tee you can see its base.',
    spec: house({ storeys: 2, porch: false, palette: pal('honey'), teeX: 3 }),
    yard: { ...yardBasic, trees: [{ x: -8, z: 7, s: 1 }] },
    objective: { kind: 'collapse', what: 'chimney', n: 1 },
    unlocks: 'blast',
    prize: { blast: 2 },
  },
  {
    id: 'h7',
    number: '07',
    name: 'Hard Footing',
    hint: 'The lower courses are reinforced. Break them with weight, or start higher up.',
    spec: house({ storeys: 2, chimney: false, palette: pal('rose'), zones: [reinforced('front', -4.5, 4.5, 0.6, 1.5), reinforced('left', -6, 0, 0.6, 1.5), reinforced('right', -6, 0, 0.6, 1.5)] }),
    yard: yardParty,
    objective: { kind: 'destruction', pct: 20 },
    prize: { power: 2, heavy: 1 },
  },
  {
    id: 'h8',
    number: '08',
    name: 'Raise the Roof',
    hint: 'A roof section needs half the wall top under it, and its ridge beam on the gables.',
    spec: house({ storeys: 1, chimney: true, palette: pal('slate') }),
    yard: yardBasic,
    objective: { kind: 'collapse', what: 'roof', n: 2 },
    prize: { blast: 1, super: 1, heavy: 1 },
  },
  {
    id: 'h9',
    number: '09',
    name: 'Load Bearing',
    hint: 'The corners carry the most. The old brick at the front corners is the weak spot.',
    spec: house({ storeys: 2, palette: pal('sand'), zones: [oldPatch('front', -4.5, -2.7, 0.6, 6), oldPatch('front', 2.7, 4.5, 0.6, 6)] }),
    yard: yardParty,
    objective: { kind: 'wall', wall: 'front', pct: 60 },
    prize: { blast: 2, multi: 1 },
  },
  {
    id: 'h10',
    number: '10',
    name: 'Demo Day',
    hint: 'The whole house: reinforced footing, a breeze from the left, and every trick you have learned.',
    spec: house({ storeys: 2, palette: pal('classic'), zones: [reinforced('front', -4.5, 4.5, 0.6, 1.2), oldPatch('left', -5.7, -0.3, 0.6, 6)] }),
    yard: yardParty,
    objective: { kind: 'destruction', pct: 35 },
    wind: { x: 0.4, z: 0 },
    prize: { power: 2, super: 2, heavy: 2, multi: 2, blast: 2 },
  },
];

export function getHouse(id: string): HouseDef | undefined {
  return HOUSES.find((h) => h.id === id);
}

/** The house as a level the session can run: no shot limit, one objective. */
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
    objectives: [h.objective],
    balls: {},
    powerups: {},
    wind: h.wind,
  };
}

/** Specials open to the reward meter once the player has reached a house. */
export function unlockedAt(index: number): SpecialId[] {
  const out: SpecialId[] = [];
  for (let i = 0; i <= Math.min(index, HOUSES.length - 1); i++) {
    const u = (HOUSES[i] as HouseDef).unlocks;
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}
