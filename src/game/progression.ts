import type { ContractDef, ContractRecord, SaveData } from '../core/types';
import { CONTRACTS } from '../data/contracts';
import { getEquipment } from '../data/equipment';
import type { Payout } from './payout';
import { emptyRecord } from './save';
import type { Report } from './scoring';

export function isUnlocked(contract: ContractDef, save: SaveData): boolean {
  if (!contract.requires) return true;
  return save.completed.includes(contract.requires);
}

export function unlockedContracts(save: SaveData): ContractDef[] {
  return CONTRACTS.filter((c) => isUnlocked(c, save));
}

/** The contract the player should be pointed at next: first unlocked, uncompleted one. */
export function recommendedContract(save: SaveData): ContractDef {
  const next = CONTRACTS.find((c) => isUnlocked(c, save) && !save.completed.includes(c.id));
  return next ?? (CONTRACTS[CONTRACTS.length - 1] as ContractDef);
}

export interface RunOutcome {
  newRecords: Array<'payout' | 'removed' | 'collateral' | 'charges' | 'efficiency'>;
  firstCompletion: boolean;
  unlocked: ContractDef[];
}

/** Applies a finished run to the save: money, completion, records, unlocks. */
export function applyRun(save: SaveData, contract: ContractDef, report: Report, payout: Payout): RunOutcome {
  const record: ContractRecord = save.records[contract.id] ?? emptyRecord();
  const before = unlockedContracts(save).map((c) => c.id);
  const newRecords: RunOutcome['newRecords'] = [];
  record.attempts += 1;
  save.money += payout.total;
  save.totalEarned += payout.total;
  save.lastContractId = contract.id;

  let firstCompletion = false;
  if (payout.success) {
    record.completions += 1;
    if (!save.completed.includes(contract.id)) {
      save.completed.push(contract.id);
      firstCompletion = true;
    }
    if (payout.total > record.bestPayout) {
      if (record.bestPayout > 0) newRecords.push('payout');
      record.bestPayout = payout.total;
    }
    if (report.removed > record.bestRemoved) {
      if (record.bestRemoved > 0) newRecords.push('removed');
      record.bestRemoved = report.removed;
    }
    if (report.collateral < record.bestCollateral) {
      if (Number.isFinite(record.bestCollateral)) newRecords.push('collateral');
      record.bestCollateral = report.collateral;
    }
    if (report.chargesUsed < record.fewestCharges) {
      if (Number.isFinite(record.fewestCharges)) newRecords.push('charges');
      record.fewestCharges = report.chargesUsed;
    }
    if (report.efficiency > record.bestEfficiency) {
      if (record.bestEfficiency > 0) newRecords.push('efficiency');
      record.bestEfficiency = report.efficiency;
    }
  } else if (report.removed > record.bestRemoved && record.completions === 0) {
    record.bestRemoved = report.removed;
  }
  save.records[contract.id] = record;
  const after = unlockedContracts(save).filter((c) => !before.includes(c.id));
  return { newRecords, firstCompletion, unlocked: after };
}

export function canAfford(save: SaveData, equipmentId: string): boolean {
  const e = getEquipment(equipmentId);
  return !save.equipment.includes(e.id) && save.money >= e.cost;
}

/** Buys equipment. Returns false when already owned or unaffordable. */
export function purchase(save: SaveData, equipmentId: string): boolean {
  if (!canAfford(save, equipmentId)) return false;
  const e = getEquipment(equipmentId);
  save.money -= e.cost;
  save.equipment.push(e.id);
  return true;
}
