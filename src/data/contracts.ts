import type { MachineId } from './fleet';

/**
 * The contract book. Each job is a real building on a real lot with its own
 * problem: a neighbour to protect, something worth saving inside, a tower too
 * tall for the boom. Budgets are moves per machine for that job.
 */

export type BonusKind = 'clear' | 'neighbour' | 'prize' | 'steel' | 'moves' | 'relics';

export interface BonusDef {
  id: string;
  kind: BonusKind;
  label: string;
  /** Threshold: clear share, prize condition, steel tonnes or most moves used. */
  value: number;
  reward: number;
}

export interface ContractDef {
  id: string;
  building: string;
  number: string;
  title: string;
  client: string;
  /** Two sentences on the job, in the client's terms. */
  brief: string;
  /** The idea this job is built around, shown as the tip on the job sheet. */
  tip: string;
  /** Machines the site has room for. */
  slots: number;
  /** Moves per machine for this job (machines not listed use their base budget). */
  budgets: Partial<Record<MachineId, number>>;
  recommended: MachineId[];
  /** Fixed loadout (the tutorial). */
  fixed?: MachineId[];
  /** Contract fee, paid on the first completion only. */
  fee: number;
  /** Contract that has to be completed first. */
  requires?: string;
  /** Share of the building that may still stand when it counts as down. */
  downAt: number;
  /** Share of the lot that has to be cleared. */
  clearAt: number;
  /** Debris allowed on the neighbour's side before the job fails (m²). */
  maxCollateral?: number;
  bonuses: BonusDef[];
  /** Moves for the third star. */
  par: number;
  tutorial?: boolean;
}

export const CONTRACTS: ContractDef[] = [
  {
    id: 'corner',
    building: 'corner',
    number: '01',
    title: 'Corner Store',
    client: 'Metro Hero Liability',
    brief: 'The insurer wants what is left of the store down and the lot cleared. Volt wants his shield back; it is lying by the curb, and it pays on the salvage pad.',
    tip: 'Brick piers carry everything. Take out a ground-floor pier and the floors above have nothing to stand on.',
    slots: 2,
    budgets: { ball: 3, dozer: 4 },
    recommended: ['ball', 'dozer'],
    fixed: ['ball', 'dozer'],
    fee: 7000,
    downAt: 0.15,
    clearAt: 0.6,
    bonuses: [
      { id: 'corner-clean', kind: 'clear', label: 'Clear 90% of the lot', value: 0.9, reward: 1500 },
      { id: 'corner-neighbour', kind: 'neighbour', label: 'Nothing on the laundromat', value: 0.5, reward: 1000 },
      { id: 'corner-relics', kind: 'relics', label: 'Return Volt’s shield', value: 1, reward: 1500 },
    ],
    par: 4,
    tutorial: true,
  },
  {
    id: 'garage',
    building: 'garage',
    number: '02',
    title: 'Halsey Auto',
    client: 'Bureau of Mech Recovery',
    brief: 'TITAN-9 tore its own arm off punching a villain through this workshop. The Bureau pays well for every bolt of it that reaches the salvage pad.',
    tip: 'Steel columns bend before they break. Hit the same bay twice, or let the excavator finish what the ball started.',
    slots: 3,
    budgets: { ball: 4, dozer: 4, excavator: 3, loader: 3, charges: 3 },
    recommended: ['ball', 'excavator', 'dozer'],
    fee: 10000,
    requires: 'corner',
    downAt: 0.12,
    clearAt: 0.7,
    bonuses: [
      { id: 'garage-steel', kind: 'steel', label: 'Salvage 3 t of steel', value: 3, reward: 2500 },
      { id: 'garage-relics', kind: 'relics', label: 'Bank every piece of TITAN-9', value: 2, reward: 2000 },
      { id: 'garage-moves', kind: 'moves', label: 'Finish in 7 moves or fewer', value: 7, reward: 1500 },
    ],
    par: 6,
  },
  {
    id: 'house',
    building: 'house',
    number: '03',
    title: 'No. 12 Maple Street',
    client: 'Okafor & Daughters',
    brief: 'Frostbyte froze the whole street, then dropped his freeze ray. The timber is brittle as glass now. Grandpa’s floor safe is still in the front room, and No. 14 is very close.',
    tip: 'Frozen timber shatters at a touch; the brick chimney does not. The safe sits behind the middle bay: bring the house down around it, then lift it out.',
    slots: 3,
    budgets: { ball: 3, dozer: 4, excavator: 4, loader: 3, charges: 2 },
    recommended: ['excavator', 'loader', 'dozer'],
    fee: 12000,
    requires: 'garage',
    downAt: 0.12,
    clearAt: 0.75,
    bonuses: [
      { id: 'house-safe', kind: 'prize', label: 'Recover the safe 70% intact', value: 0.7, reward: 3000 },
      { id: 'house-neighbour', kind: 'neighbour', label: 'Nothing on No. 14', value: 0.5, reward: 1500 },
    ],
    par: 6,
  },
  {
    id: 'silo',
    building: 'silo',
    number: '04',
    title: 'Holloway Silo',
    client: 'Department of Kaiju Aftermath',
    brief: 'Gorrath hugged this silo until the heroes cut it loose. One tentacle is still wrapped round it and two more pieces are in the yard. The farmhouse is 10 m away: it falls left, or it falls on the farmhouse.',
    tip: 'Tall things topple toward the side that loses its footing. Cut the left side at the base and leave the right standing.',
    slots: 3,
    budgets: { ball: 3, charges: 3, excavator: 3, dozer: 5, loader: 3 },
    recommended: ['charges', 'ball', 'dozer'],
    fee: 18000,
    requires: 'house',
    downAt: 0.12,
    clearAt: 0.55,
    maxCollateral: 4,
    bonuses: [
      { id: 'silo-relics', kind: 'relics', label: 'Bank both bits of tentacle', value: 2, reward: 3000 },
      { id: 'silo-neighbour', kind: 'neighbour', label: 'Nothing on the farmhouse', value: 0.5, reward: 2500 },
      { id: 'silo-moves', kind: 'moves', label: 'Finish in 8 moves or fewer', value: 8, reward: 3000 },
    ],
    par: 8,
  },
  {
    id: 'stack',
    building: 'stack',
    number: '05',
    title: 'Ironworks Stack',
    client: 'Calder Ironworks',
    brief: 'Gorrath picked its teeth with the chimney and left one behind. The stack is 36 m of cracked brick and the boiler house is on fire. The pump house next door runs the whole yard: do not touch it.',
    tip: 'The boom only reaches the bottom of the stack. Topple it left across the boiler house and let the fall do the work.',
    slots: 3,
    budgets: { ball: 4, charges: 3, excavator: 4, dozer: 6, loader: 4 },
    recommended: ['charges', 'excavator', 'dozer'],
    fee: 22000,
    requires: 'silo',
    downAt: 0.12,
    clearAt: 0.55,
    maxCollateral: 3,
    bonuses: [
      { id: 'stack-clean', kind: 'clear', label: 'Clear 80% of the yard', value: 0.8, reward: 2500 },
      { id: 'stack-moves', kind: 'moves', label: 'Finish in 9 moves or fewer', value: 9, reward: 4000 },
    ],
    par: 9,
  },
  {
    id: 'warehouse',
    building: 'warehouse',
    number: '06',
    title: 'Riverside Stores',
    client: 'Port of Calder',
    brief: 'Captain Volt threw the Scrapper through two floors, and the Scrapper’s helmet is still smoking by the quay. The harbour museum wants the ship’s bell out of the stair core.',
    tip: 'The core holds the middle up long after the frame has gone. Break its base and the bell comes out with it.',
    slots: 4,
    budgets: { ball: 6, charges: 4, excavator: 5, dozer: 7, loader: 5 },
    recommended: ['ball', 'charges', 'excavator', 'dozer'],
    fee: 30000,
    requires: 'stack',
    downAt: 0.12,
    clearAt: 0.7,
    bonuses: [
      { id: 'warehouse-bell', kind: 'prize', label: 'Recover the bell 70% intact', value: 0.7, reward: 4000 },
      { id: 'warehouse-steel', kind: 'steel', label: 'Salvage 8 t of steel', value: 8, reward: 3000 },
      { id: 'warehouse-neighbour', kind: 'neighbour', label: 'Nothing on the chandlery', value: 0.5, reward: 2500 },
    ],
    par: 16,
  },
  {
    id: 'parkade',
    building: 'parkade',
    number: '07',
    title: 'Market Street Parkade',
    client: 'Department of Kaiju Aftermath',
    brief: 'Gorrath sat on the top deck for an hour and left a scale and a claw behind. Five decks of heavy concrete come down in slabs too big to push.',
    tip: 'Open decks pancake once the columns go. The heavy slabs are the real job: break them, then clear.',
    slots: 4,
    budgets: { ball: 6, charges: 4, excavator: 6, dozer: 9, loader: 5 },
    recommended: ['charges', 'ball', 'excavator', 'dozer'],
    fee: 40000,
    requires: 'warehouse',
    downAt: 0.12,
    clearAt: 0.7,
    bonuses: [
      { id: 'parkade-relics', kind: 'relics', label: 'Bank the scale and the claw', value: 2, reward: 4000 },
      { id: 'parkade-neighbour', kind: 'neighbour', label: 'Nothing on the office block', value: 0.5, reward: 3000 },
      { id: 'parkade-moves', kind: 'moves', label: 'Finish in 16 moves or fewer', value: 16, reward: 5000 },
    ],
    par: 16,
  },
  {
    id: 'halden',
    building: 'halden',
    number: '08',
    title: 'The Halden Exchange',
    client: 'The City, the Bureau and three insurers',
    brief: 'The final battle ended on the fifteenth floor. The mech’s reactor core is on the lot, the upper floors are burning, and the thing in the vault is a kaiju egg. Pellow’s Bakery is open as usual.',
    tip: 'Bring the tower down away from Pellow’s. The egg is safe behind the core’s base wall until that wall goes. Do not drop anything on it.',
    slots: 5,
    budgets: { ball: 8, charges: 5, excavator: 6, dozer: 10, loader: 6 },
    recommended: ['ball', 'charges', 'excavator', 'dozer', 'loader'],
    fee: 75000,
    requires: 'parkade',
    downAt: 0.12,
    clearAt: 0.75,
    bonuses: [
      { id: 'halden-vault', kind: 'prize', label: 'Recover the egg 90% intact', value: 0.9, reward: 8000 },
      { id: 'halden-neighbour', kind: 'neighbour', label: 'Nothing on Pellow’s', value: 0.5, reward: 5000 },
      { id: 'halden-steel', kind: 'steel', label: 'Salvage 20 t of steel', value: 20, reward: 4000 },
    ],
    par: 28,
  },
];

export function getContract(id: string): ContractDef {
  const c = CONTRACTS.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown contract: ${id}`);
  return c;
}
