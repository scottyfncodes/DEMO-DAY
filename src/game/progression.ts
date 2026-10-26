import { CONTRACTS, type ContractDef } from '../data/contracts';
import { MACHINES, getUpgrade, kitFor, type MachineId, type UpgradeDef } from '../data/fleet';
import type { Kit } from '../wreck/kit';
import { emptyRecord, type SaveData } from './save';
import type { Payout } from './scoring';

/** Contract → loadout → demolish → get paid → upgrade → harder contract. */

export function completedCount(save: SaveData): number {
  return CONTRACTS.filter((c) => (save.records[c.id]?.completions ?? 0) > 0).length;
}

export function isCompleted(save: SaveData, id: string): boolean {
  return (save.records[id]?.completions ?? 0) > 0;
}

export function isUnlocked(contract: ContractDef, save: SaveData): boolean {
  return !contract.requires || isCompleted(save, contract.requires);
}

/** The job to point the player at: the first unlocked one not yet done, else the last played. */
export function nextContract(save: SaveData): ContractDef {
  const open = CONTRACTS.find((c) => isUnlocked(c, save) && !isCompleted(save, c.id));
  if (open) return open;
  return CONTRACTS.find((c) => c.id === save.lastContractId) ?? (CONTRACTS[CONTRACTS.length - 1] as ContractDef);
}

export function kitOf(save: SaveData): Kit {
  return kitFor(save.upgrades);
}

/** Machines to bring by default: the last pick for this job, else the recommendation, limited to what is owned. */
export function defaultLoadout(contract: ContractDef, save: SaveData): MachineId[] {
  if (contract.fixed) return [...contract.fixed];
  const owned = (m: MachineId): boolean => save.fleet.includes(m);
  const last = (save.loadouts[contract.id] ?? []).filter(owned);
  if (last.length) return last.slice(0, contract.slots);
  const pick = contract.recommended.filter(owned);
  for (const m of save.fleet) if (pick.length < contract.slots && !pick.includes(m)) pick.push(m);
  return pick.slice(0, contract.slots);
}

export interface RunOutcome {
  firstCompletion: boolean;
  newBest: boolean;
  previousBest: number;
  unlocked: ContractDef[];
}

/**
 * Banks a finished run: money, record and unlocks. Called exactly once per
 * run by the screen (it holds a flag), and the fee and bonuses inside the
 * payout are already zero for anything paid before.
 */
export function applyRun(save: SaveData, contract: ContractDef, payout: Payout): RunOutcome {
  const before = CONTRACTS.filter((c) => isUnlocked(c, save)).map((c) => c.id);
  const rec = save.records[contract.id] ?? emptyRecord();
  const previousBest = rec.bestPayout;
  rec.attempts += 1;
  save.money += payout.total;
  save.totalEarned += payout.total;
  save.lastContractId = contract.id;
  let firstCompletion = false;
  let newBest = false;
  if (payout.success) {
    firstCompletion = rec.completions === 0;
    rec.completions += 1;
    if (payout.total > rec.bestPayout) {
      newBest = rec.bestPayout > 0;
      rec.bestPayout = payout.total;
    }
    rec.bestStars = Math.max(rec.bestStars, payout.stars);
    rec.bestMoves = rec.bestMoves === 0 ? payout.used : Math.min(rec.bestMoves, payout.used);
    for (const b of payout.newBonuses) if (!rec.bonuses.includes(b)) rec.bonuses.push(b);
  }
  save.records[contract.id] = rec;
  if (contract.tutorial && payout.success) save.tutorialDone = true;
  const unlocked = CONTRACTS.filter((c) => isUnlocked(c, save) && !before.includes(c.id));
  return { firstCompletion, newBest, previousBest, unlocked };
}

export type BuyCheck = { ok: true } | { ok: false; reason: string };

export function canBuyMachine(save: SaveData, id: MachineId): BuyCheck {
  if (save.fleet.includes(id)) return { ok: false, reason: 'Already in the fleet.' };
  const price = MACHINES[id].price;
  if (save.money < price) return { ok: false, reason: `Needs $${(price - save.money).toLocaleString('en-US')} more.` };
  return { ok: true };
}

export function buyMachine(save: SaveData, id: MachineId): BuyCheck {
  const check = canBuyMachine(save, id);
  if (!check.ok) return check;
  save.money -= MACHINES[id].price;
  save.fleet.push(id);
  return check;
}

export function upgradeState(save: SaveData, u: UpgradeDef): 'owned' | 'available' | 'locked' {
  if (save.upgrades.includes(u.id)) return 'owned';
  if (!save.fleet.includes(u.machine)) return 'locked';
  if (u.requires && !save.upgrades.includes(u.requires)) return 'locked';
  if (u.minJobs && completedCount(save) < u.minJobs) return 'locked';
  return 'available';
}

export function lockReason(save: SaveData, u: UpgradeDef): string {
  if (!save.fleet.includes(u.machine)) return `Buy the ${MACHINES[u.machine].short.toLowerCase()} first.`;
  if (u.requires && !save.upgrades.includes(u.requires)) return `Needs ${getUpgrade(u.requires)?.name ?? 'the tier before'}.`;
  if (u.minJobs && completedCount(save) < u.minJobs) return `Unlocks after ${u.minJobs} completed contract${u.minJobs === 1 ? '' : 's'}.`;
  return '';
}

export function canBuyUpgrade(save: SaveData, id: string): BuyCheck {
  const u = getUpgrade(id);
  if (!u) return { ok: false, reason: 'Unknown upgrade.' };
  const state = upgradeState(save, u);
  if (state === 'owned') return { ok: false, reason: 'Already fitted.' };
  if (state === 'locked') return { ok: false, reason: lockReason(save, u) };
  if (save.money < u.cost) return { ok: false, reason: `Needs $${(u.cost - save.money).toLocaleString('en-US')} more.` };
  return { ok: true };
}

export function buyUpgrade(save: SaveData, id: string): BuyCheck {
  const check = canBuyUpgrade(save, id);
  if (!check.ok) return check;
  const u = getUpgrade(id) as UpgradeDef;
  save.money -= u.cost;
  save.upgrades.push(u.id);
  return check;
}
