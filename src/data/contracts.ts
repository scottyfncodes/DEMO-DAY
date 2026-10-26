import type { MachineId } from './fleet';

/**
 * The contract book. Each job is a real building on a real lot with its own
 * problem: a neighbour to protect, something worth saving inside, a tower too
 * tall for the boom. Budgets are moves per machine for that job.
 */

export type BonusKind = 'clear' | 'neighbour' | 'prize' | 'steel' | 'moves';

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
    client: 'Eastgate Council',
    brief: 'The old store on Bell Street is coming down for a bus shelter. Two storeys of brick on timber floors: knock it down and clear the lot.',
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
    ],
    par: 4,
    tutorial: true,
  },
  {
    id: 'garage',
    building: 'garage',
    number: '02',
    title: 'Halsey Auto',
    client: 'Halsey family',
    brief: 'A steel portal workshop with a truss roof. The steel is worth money on the salvage pad if it comes down in one piece.',
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
    brief: 'A timber house with a brick chimney, close to No. 14. The owner’s grandfather left a floor safe in the front room. They want it back.',
    tip: 'Timber goes easily; the chimney does not. The safe sits behind the middle bay: bring the house down around it, then lift it out.',
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
    client: 'Holloway Farms',
    brief: 'A 27 m concrete silo with the farmhouse 10 m to the right. It has to fall left, into the yard, and nowhere else.',
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
    brief: 'A 36 m brick chimney and its boiler house. The pump house next door still runs the whole yard: it must not be touched.',
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
    brief: 'Four floors of brick on a concrete frame, with a steel roof and a stair core. The harbour museum wants the ship’s bell from the core.',
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
    client: 'City of Calder',
    brief: 'Five decks of heavy concrete with a stair core at the west end. The slabs come down in pieces too big to push.',
    tip: 'Open decks pancake once the columns go. The heavy slabs are the real job: break them, then clear.',
    slots: 4,
    budgets: { ball: 6, charges: 4, excavator: 6, dozer: 7, loader: 5 },
    recommended: ['charges', 'ball', 'excavator', 'dozer'],
    fee: 40000,
    requires: 'warehouse',
    downAt: 0.12,
    clearAt: 0.7,
    bonuses: [
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
    client: 'Halden Holdings',
    brief: 'Fifteen storeys, a concrete core and a wing hung off a steel truss, on a tight lot next to Pellow’s Bakery. The vault is still in the core.',
    tip: 'Bring the tower down away from Pellow’s. The vault is safe behind the core’s base wall until that wall goes.',
    slots: 5,
    budgets: { ball: 8, charges: 5, excavator: 6, dozer: 10, loader: 6 },
    recommended: ['ball', 'charges', 'excavator', 'dozer', 'loader'],
    fee: 75000,
    requires: 'parkade',
    downAt: 0.12,
    clearAt: 0.75,
    bonuses: [
      { id: 'halden-vault', kind: 'prize', label: 'Recover the vault 90% intact', value: 0.9, reward: 8000 },
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
