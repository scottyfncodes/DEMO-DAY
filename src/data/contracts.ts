import type { ContractDef, ContractType } from '../core/types';

export const CONTRACT_TYPE_LABEL: Record<ContractType, string> = {
  FULL_DEMOLITION: 'Full Demolition',
  CONTROLLED_COLLAPSE: 'Controlled Collapse',
  PRECISION_DEMO: 'Precision Demo',
  SELECTIVE_DEMOLITION: 'Selective Demolition',
  STRUCTURAL_SURGERY: 'Structural Surgery',
  CLEARANCE: 'Clearance',
};

export const CONTRACT_TYPE_BRIEF: Record<ContractType, string> = {
  FULL_DEMOLITION: 'Bring the required share of the structure down.',
  CONTROLLED_COLLAPSE: 'Bring it down and keep the debris inside the landing zone.',
  PRECISION_DEMO: 'High destruction with very little collateral.',
  SELECTIVE_DEMOLITION: 'Remove the target and leave the protected structure standing.',
  STRUCTURAL_SURGERY: 'Trigger a specific collapse pattern.',
  CLEARANCE: 'Demolish the target without touching the neighbours.',
};

export const CONTRACTS: ContractDef[] = [
  {
    id: 'job01',
    jobNumber: 1,
    title: 'Garden Shed',
    buildingId: 'shed',
    type: 'FULL_DEMOLITION',
    brief: 'A client wants their shed gone before the weekend. Three posts, one roof. Figure out what is really holding it up.',
    value: 8500,
    requiredDestruction: 0.85,
    maxCollateral: 0.15,
    targetFootprint: 0.8,
    loadout: { small: 3 },
    difficulty: 1,
    hints: ['Tap a post to see what it carries.', 'The rotten centre post only stands because the outer posts take the weight.'],
  },
  {
    id: 'job02',
    jobNumber: 2,
    title: 'Detached Garage',
    buildingId: 'garage',
    type: 'CLEARANCE',
    brief: 'Brick garage, concrete roof, and a neighbour one metre from the right wall. Anything you throw right lands on their kitchen.',
    value: 14000,
    requiredDestruction: 0.85,
    maxCollateral: 0.05,
    targetFootprint: 0.9,
    loadout: { small: 3, heavy: 1 },
    difficulty: 2,
    requires: 'job01',
    hints: ['A slab that loses one end tips toward that end.', 'A heavy blast weakens everything near it, not just what it breaks.'],
  },
  {
    id: 'job03',
    jobNumber: 3,
    title: 'Grain Silo',
    buildingId: 'silo',
    type: 'CONTROLLED_COLLAPSE',
    brief: 'Twenty metres of concrete on two legs beside Highway 9. Lay it down in the field, not on the traffic.',
    value: 22000,
    requiredDestruction: 0.9,
    maxCollateral: 0.05,
    targetFootprint: 0.85,
    footprintRequired: true,
    loadout: { small: 2, directional: 1 },
    difficulty: 2,
    requires: 'job02',
    hints: ['The survey says it leans toward the highway. A straight drop goes that way.', 'Break the leg on the side you want it to fall, or push it.'],
  },
  {
    id: 'job04',
    jobNumber: 4,
    title: 'Two-Storey House',
    buildingId: 'house',
    type: 'PRECISION_DEMO',
    brief: 'Timber house with a brick chimney. Neighbours on both sides. The whole thing must come down, chimney included.',
    value: 36000,
    requiredDestruction: 0.92,
    maxCollateral: 0.04,
    targetFootprint: 0.9,
    loadout: { small: 4, heavy: 1 },
    difficulty: 3,
    requires: 'job03',
    hints: ['Timber posts break inside a heavy blast radius even when they are not the target.', 'Brick ignores small charges. Spend the big one where the brick is.'],
  },
  {
    id: 'job05',
    jobNumber: 5,
    title: 'Ironworks Smokestack',
    buildingId: 'mill',
    type: 'SELECTIVE_DEMOLITION',
    brief: 'Drop the smokestack. The boiler house next to it stays in service, so it stays standing. It leans the wrong way.',
    value: 52000,
    requiredDestruction: 0.85,
    maxCollateral: 0.08,
    targetFootprint: 0.85,
    footprintRequired: true,
    loadout: { small: 3, heavy: 1, directional: 1 },
    difficulty: 3,
    requires: 'job04',
    hints: ['Big blasts crack the boiler house wall. Choose something focused.', 'A directional charge decides which way the stack goes.'],
  },
  {
    id: 'job06',
    jobNumber: 6,
    title: 'Riverside Warehouse',
    buildingId: 'warehouse',
    type: 'FULL_DEMOLITION',
    brief: 'Three floors of concrete on the riverbank with a stair core through the middle. Take the core and the columns are on their own.',
    value: 84000,
    requiredDestruction: 0.9,
    maxCollateral: 0.05,
    targetFootprint: 0.9,
    loadout: { small: 4, heavy: 3, directional: 1, shaped: 2 },
    difficulty: 4,
    requires: 'job05',
    hints: ['The core holds bays B and C on every floor. Nothing ordinary breaks it.', 'Ground-floor columns are close to their load limit. Falling floors finish them.'],
  },
];

export function getContract(id: string): ContractDef {
  const c = CONTRACTS.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown contract: ${id}`);
  return c;
}

export function nextContract(id: string): ContractDef | undefined {
  const index = CONTRACTS.findIndex((x) => x.id === id);
  return index >= 0 ? CONTRACTS[index + 1] : undefined;
}
