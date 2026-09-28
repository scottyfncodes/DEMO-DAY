import type { ContractDef } from '../core/types';
import type { SimResult } from '../sim/simulation';

export interface Requirement {
  id: 'destruction' | 'collateral' | 'footprint' | 'protected';
  label: string;
  value: string;
  target: string;
  met: boolean;
}

export interface Report {
  removed: number;
  required: number;
  footprint: number;
  targetFootprint: number;
  collateral: number;
  maxCollateral: number;
  chargesUsed: number;
  chargesAvailable: number;
  efficiency: number;
  protectedKept: boolean;
  protectedFailed: string[];
  neighborHits: Record<string, number>;
  requirements: Requirement[];
  success: boolean;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/** Destruction share of the target structure, 0..1. */
export function destructionFraction(result: SimResult): number {
  if (result.targetMass <= 0) return 0;
  return Math.min(1, Math.max(0, result.removedMass / result.targetMass));
}

/** Share of landed debris that ended inside the footprint, 0..1. */
export function footprintFraction(result: SimResult): number {
  const landed = result.landedInside + result.landedOutside;
  if (landed <= 0) return 1;
  return Math.min(1, Math.max(0, result.landedInside / landed));
}

/**
 * Collateral is debris outside the landing zone plus anything that hit a
 * neighbour, relative to the whole structure. Neighbour hits count extra.
 */
export function collateralFraction(result: SimResult): number {
  if (result.totalMass <= 0) return 0;
  let neighbor = 0;
  for (const v of Object.values(result.neighborHits)) neighbor += v;
  const raw = (result.landedOutside + neighbor * 0.5) / result.totalMass;
  return Math.min(1, Math.max(0, raw));
}

/** How much of the destruction gravity did instead of explosives, 0..1. */
export function efficiencyFraction(result: SimResult): number {
  if (result.removedMass <= 0) return 0;
  return Math.min(1, Math.max(0, result.cascadeMass / result.removedMass));
}

export function scoreRun(result: SimResult, contract: ContractDef, chargesUsed: number, chargesAvailable: number): Report {
  const removed = destructionFraction(result);
  const footprint = footprintFraction(result);
  const collateral = collateralFraction(result);
  const efficiency = efficiencyFraction(result);
  const protectedKept = result.protectedFailed.length === 0;

  const requirements: Requirement[] = [
    {
      id: 'destruction',
      label: 'Required Destruction',
      value: pct(removed),
      target: `≥ ${pct(contract.requiredDestruction)}`,
      met: removed + 1e-9 >= contract.requiredDestruction,
    },
    {
      id: 'collateral',
      label: 'Maximum Collateral',
      value: pct(collateral),
      target: `≤ ${pct(contract.maxCollateral)}`,
      met: collateral <= contract.maxCollateral + 1e-9,
    },
  ];
  if (contract.footprintRequired) {
    requirements.push({
      id: 'footprint',
      label: 'Debris In Zone',
      value: pct(footprint),
      target: `≥ ${pct(contract.targetFootprint)}`,
      met: footprint + 1e-9 >= contract.targetFootprint,
    });
  }
  if (contract.type === 'SELECTIVE_DEMOLITION' || result.protectedFailed.length > 0) {
    requirements.push({
      id: 'protected',
      label: 'Protected Structure',
      value: protectedKept ? 'Standing' : `${result.protectedFailed.length} damaged`,
      target: 'Standing',
      met: protectedKept,
    });
  }
  const success = requirements.every((r) => r.met);
  return {
    removed,
    required: contract.requiredDestruction,
    footprint,
    targetFootprint: contract.targetFootprint,
    collateral,
    maxCollateral: contract.maxCollateral,
    chargesUsed,
    chargesAvailable,
    efficiency,
    protectedKept,
    protectedFailed: result.protectedFailed,
    neighborHits: result.neighborHits,
    requirements,
    success,
  };
}
