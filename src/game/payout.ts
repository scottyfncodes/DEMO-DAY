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
