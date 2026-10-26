import type { BonusDef, ContractDef } from '../data/contracts';
import { siteStatus, type SiteStatus } from '../wreck/job';
import type { Job } from './moves';

/**
 * Objectives and payout. Every line on the payout sheet comes from something
 * the player can see on site, and the contract fee and each bonus are paid
 * once: replaying a job pays for the work done (salvage, moves saved), never
 * for the same completion twice.
 */

export const RATES = {
  /** Per tonne of steel on the salvage pad. */
  steel: 140,
  /** Per square metre of sorted rubble on the pad (scrap sorter). */
  recycled: 90,
  /** Per unused move on a completed job. */
  unusedMove: 350,
  /** Per square metre of debris on the neighbour's side. */
  collateral: 450,
  /** Repair bill per machine caught by falling debris. */
  machineHit: 900,
} as const;

export interface Objective {
  id: string;
  label: string;
  primary: boolean;
  done: boolean;
  /** Short progress text, e.g. "64%". */
  progress: string;
  /** 0..1 for a progress bar. */
  fraction: number;
  /** Failed for good (debris already on the neighbour). */
  failed?: boolean;
  reward?: number;
}

export function bonusDone(b: BonusDef, st: SiteStatus, used: number): boolean {
  switch (b.kind) {
    case 'clear':
      return st.clear >= b.value;
    case 'neighbour':
      return st.collateral < b.value;
    case 'prize':
      return st.vault === 'saved' && st.vaultCondition >= b.value;
    case 'steel':
      return st.steelSalvaged >= b.value;
    case 'moves':
      return used <= b.value;
    case 'relics':
      return st.relicsSaved >= b.value;
  }
}

/** The live objective list for the HUD and the results sheet. */
export function objectives(contract: ContractDef, st: SiteStatus, used: number, finished = false): Objective[] {
  const down = 1 - st.standing;
  const needDown = 1 - contract.downAt;
  const out: Objective[] = [
    { id: 'down', label: 'Bring it down', primary: true, done: st.standing <= contract.downAt, progress: `${Math.round(down * 100)}%`, fraction: Math.min(1, down / needDown) },
    { id: 'clear', label: `Clear ${Math.round(contract.clearAt * 100)}% of the lot`, primary: true, done: st.clear >= contract.clearAt, progress: `${Math.round(st.clear * 100)}%`, fraction: Math.min(1, st.clear / contract.clearAt) },
  ];
  if (contract.maxCollateral !== undefined) {
    const over = st.collateral > contract.maxCollateral;
    out.push({ id: 'protect', label: 'Keep debris off the neighbour', primary: true, done: !over, failed: over, progress: `${st.collateral.toFixed(1)} m²`, fraction: over ? 0 : 1 });
  }
  for (const b of contract.bonuses) {
    const done = bonusDone(b, st, used);
    let progress = '';
    let fraction = done ? 1 : 0;
    let failed = false;
    if (b.kind === 'clear') {
      progress = `${Math.round(st.clear * 100)}%`;
      fraction = Math.min(1, st.clear / b.value);
    } else if (b.kind === 'neighbour') {
      progress = done ? 'clean' : `${st.collateral.toFixed(1)} m²`;
      failed = !done;
    } else if (b.kind === 'prize') {
      progress = st.vault === 'saved' ? `${Math.round(st.vaultCondition * 100)}%` : st.vault === 'inside' ? 'inside' : st.vault === 'scrapped' ? 'lost' : st.vault;
      failed = st.vault === 'scrapped' || st.vaultCondition < b.value;
    } else if (b.kind === 'steel') {
      progress = `${st.steelSalvaged.toFixed(1)} / ${b.value} t`;
      fraction = Math.min(1, st.steelSalvaged / b.value);
    } else if (b.kind === 'relics') {
      progress = `${st.relicsSaved} / ${b.value}`;
      fraction = Math.min(1, st.relicsSaved / b.value);
    } else if (b.kind === 'moves') {
      progress = `${used} used`;
      fraction = done ? 1 : 0;
      failed = !done;
      if (!finished) fraction = Math.max(0, 1 - used / (b.value + 1));
    }
    out.push({ id: b.id, label: b.label, primary: false, done, progress, fraction, failed: failed && !done, reward: b.reward });
  }
  return out;
}

export function jobSuccess(contract: ContractDef, st: SiteStatus): boolean {
  if (st.standing > contract.downAt) return false;
  if (st.clear < contract.clearAt) return false;
  if (contract.maxCollateral !== undefined && st.collateral > contract.maxCollateral) return false;
  return true;
}

export interface PayLine {
  key: string;
  label: string;
  detail: string;
  amount: number;
  /** Earned before: shown, but not paid again. */
  repeat?: boolean;
}

export interface Payout {
  success: boolean;
  lines: PayLine[];
  total: number;
  /** Bonus ids met this run (paid or not). */
  bonuses: string[];
  /** Bonus ids paid for the first time this run. */
  newBonuses: string[];
  stars: number;
  used: number;
  status: SiteStatus;
}

export interface PriorRecord {
  completions: number;
  bonuses: readonly string[];
}

export function computePayout(job: Job, prior: PriorRecord): Payout {
  const contract = job.contract;
  const st = siteStatus(job.sim);
  const t = job.sim.state.tally;
  const used = job.used;
  const success = jobSuccess(contract, st);
  const lines: PayLine[] = [];
  const first = prior.completions === 0;
  if (success) {
    lines.push(first ? { key: 'fee', label: 'Contract fee', detail: `${contract.client}`, amount: contract.fee } : { key: 'fee', label: 'Contract fee', detail: 'Paid on your first completion', amount: 0, repeat: true });
  }
  const met: string[] = [];
  const fresh: string[] = [];
  for (const b of contract.bonuses) {
    if (!bonusDone(b, st, used)) continue;
    // Bonuses count only on a finished job: a clean neighbour is easy if nothing came down.
    if (!success) continue;
    met.push(b.id);
    if (prior.bonuses.includes(b.id)) lines.push({ key: b.id, label: b.label, detail: 'Already paid', amount: 0, repeat: true });
    else {
      fresh.push(b.id);
      lines.push({ key: b.id, label: b.label, detail: 'Bonus', amount: b.reward });
    }
  }
  if (t.steelSalvaged > 0.05) lines.push({ key: 'steel', label: 'Steel salvage', detail: `${t.steelSalvaged.toFixed(1)} t at $${RATES.steel}/t`, amount: Math.round(t.steelSalvaged * RATES.steel) });
  const prize = job.sim.h.building.prize;
  if (prize && t.vaultSaved >= 0) lines.push({ key: 'prize', label: prize.label, detail: `${Math.round(t.vaultSaved * 100)}% intact`, amount: Math.round(prize.value * t.vaultSaved) });
  if (t.relicValue > 0) lines.push({ key: 'relics', label: 'Hero salvage', detail: `${t.relicsSaved} relic${t.relicsSaved === 1 ? '' : 's'} sold to the Bureau`, amount: Math.round(t.relicValue) });
  if (t.relicsLost > 0) lines.push({ key: 'relics-lost', label: 'Relics lost in the pit', detail: `${t.relicsLost} gone to landfill`, amount: 0 });
  if (t.recycled > 0.05) lines.push({ key: 'recycled', label: 'Recycled aggregate', detail: `${t.recycled.toFixed(1)} m² at $${RATES.recycled}/m²`, amount: Math.round(t.recycled * RATES.recycled) });
  if (success) {
    let unused = 0;
    for (const m of job.loadout) unused += job.left(m);
    if (unused > 0) lines.push({ key: 'unused', label: 'Moves to spare', detail: `${unused} × $${RATES.unusedMove}`, amount: unused * RATES.unusedMove });
  }
  if (st.collateral >= 0.05) lines.push({ key: 'collateral', label: 'Damage next door', detail: `${st.collateral.toFixed(1)} m² of debris`, amount: -Math.round(st.collateral * RATES.collateral) });
  if (t.machineHits > 0) lines.push({ key: 'machines', label: 'Machine repairs', detail: `${t.machineHits} hit${t.machineHits === 1 ? '' : 's'} by debris`, amount: -t.machineHits * RATES.machineHit });
  const total = Math.max(0, lines.reduce((m, l) => m + l.amount, 0));
  const stars = success ? 1 + (met.length === contract.bonuses.length ? 1 : 0) + (used <= contract.par ? 1 : 0) : 0;
  return { success, lines, total, bonuses: met, newBonuses: fresh, stars, used, status: st };
}
