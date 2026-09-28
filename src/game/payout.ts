import type { ContractDef } from '../core/types';
import type { Report } from './scoring';

export interface BonusLine {
  id: string;
  label: string;
  amount: number;
  detail: string;
}

export interface Payout {
  contractValue: number;
  /** Money paid for the contract itself (full value or a partial fee). */
  base: number;
  bonuses: BonusLine[];
  total: number;
  success: boolean;
}

export function roundMoney(value: number): number {
  return Math.max(0, Math.round(value / 50) * 50);
}

/**
 * Turns a report into money. A failed contract pays a small partial fee and
 * no bonuses. A successful one pays full value plus bonuses for doing it
 * cleanly, cheaply and precisely.
 */
export function computePayout(report: Report, contract: ContractDef): Payout {
  const value = contract.value;
  if (!report.success) {
    const base = roundMoney(value * 0.2 * report.removed);
    return { contractValue: value, base, bonuses: [], total: base, success: false };
  }
  const bonuses: BonusLine[] = [];

  const margin = report.removed - report.required;
  if (margin >= 0.05) {
    const t = Math.min(1, (margin - 0.05) / 0.1);
    const amount = roundMoney(value * (0.08 + 0.1 * t));
    bonuses.push({ id: 'precision', label: 'Precision Bonus', amount, detail: `${(report.removed * 100).toFixed(1)}% removed` });
  }

  if (report.collateral <= 0.01) {
    bonuses.push({ id: 'collateral', label: 'Minimal Collateral', amount: roundMoney(value * 0.12), detail: 'Under 1% collateral' });
  } else if (report.collateral <= report.maxCollateral * 0.5) {
    bonuses.push({ id: 'collateral', label: 'Low Collateral', amount: roundMoney(value * 0.06), detail: 'Under half the limit' });
  }

  if (report.footprint >= report.targetFootprint) {
    bonuses.push({ id: 'footprint', label: 'Clean Footprint', amount: roundMoney(value * 0.08), detail: `${(report.footprint * 100).toFixed(0)}% inside the zone` });
  }

  const unused = Math.max(0, report.chargesAvailable - report.chargesUsed);
  if (unused > 0) {
    const amount = roundMoney(Math.min(value * 0.3, unused * value * 0.05));
    bonuses.push({ id: 'unused', label: 'Unused Charge Bonus', amount, detail: `${unused} charge${unused === 1 ? '' : 's'} returned` });
  }

  if (report.efficiency >= 0.6) {
    const amount = roundMoney(value * 0.1 * report.efficiency);
    bonuses.push({ id: 'efficiency', label: 'Structural Efficiency', amount, detail: `${(report.efficiency * 100).toFixed(0)}% brought down by gravity` });
  }

  if (report.removed >= 0.995) {
    bonuses.push({ id: 'sweep', label: 'Clean Sweep', amount: roundMoney(value * 0.1), detail: 'Nothing left standing' });
  }

  const total = value + bonuses.reduce((acc, b) => acc + b.amount, 0);
  return { contractValue: value, base: value, bonuses, total, success: true };
}

/** Money on the table: a bonus this run did not (fully) earn, and how to get it. */
export interface MissedBonus {
  id: string;
  label: string;
  /** Extra money available with a better run, rounded like every payout. */
  potential: number;
  tip: string;
}

/**
 * Works out which bonuses a successful run left behind, using the same
 * formulas as computePayout, so the replay hint never promises money the
 * scoring would not pay. Sorted biggest first. Empty for failed runs: the
 * requirements come first.
 */
export function missedBonuses(report: Report, contract: ContractDef, payout: Payout): MissedBonus[] {
  if (!payout.success) return [];
  const value = contract.value;
  const earned = (id: string): number => payout.bonuses.find((b) => b.id === id)?.amount ?? 0;
  const out: MissedBonus[] = [];
  const add = (id: string, label: string, best: number, tip: string): void => {
    const potential = roundMoney(best - earned(id));
    if (potential > 0) out.push({ id, label, potential, tip });
  };

  if (report.chargesUsed > 1) {
    const unusedNow = Math.max(0, report.chargesAvailable - report.chargesUsed);
    const withOneFewer = roundMoney(Math.min(value * 0.3, (unusedNow + 1) * value * 0.05));
    add('unused', 'Charge Saver', withOneFewer, 'Do it with one fewer charge');
  }
  add('collateral', 'No-Collateral Bonus', roundMoney(value * 0.12), 'Keep collateral under 1%');
  add('footprint', 'Clean Footprint', roundMoney(value * 0.08), `Land ${Math.round(report.targetFootprint * 100)}% of the debris in the zone`);
  add('sweep', 'Clean Sweep', roundMoney(value * 0.1), 'Leave nothing standing');
  add('efficiency', 'Structural Efficiency', roundMoney(value * 0.1), 'Blast less, let gravity do the work');
  add('precision', 'Precision Bonus', roundMoney(value * 0.18), 'Bring down more than the minimum');
  out.sort((a, b) => b.potential - a.potential);
  return out;
}
