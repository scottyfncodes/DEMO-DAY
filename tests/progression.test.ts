import { describe, expect, it } from 'vitest';
import { CONTRACTS, getContract } from '../src/data/contracts';
import { EQUIPMENT } from '../src/data/equipment';
import type { Payout } from '../src/game/payout';
import { applyRun, canAfford, isUnlocked, purchase, recommendedContract, unlockedContracts } from '../src/game/progression';
import { defaultSave } from '../src/game/save';
import type { Report } from '../src/game/scoring';

function report(success: boolean, extra: Partial<Report> = {}): Report {
  return {
    removed: success ? 0.95 : 0.4,
    required: 0.85,
    footprint: 1,
    targetFootprint: 0.8,
    collateral: 0.01,
    maxCollateral: 0.15,
    chargesUsed: 2,
    chargesAvailable: 3,
    efficiency: 0.7,
    protectedKept: true,
    protectedFailed: [],
    neighborHits: {},
    requirements: [],
    success,
    ...extra,
  };
}

function payout(success: boolean, total: number): Payout {
  return { contractValue: 8500, base: success ? 8500 : total, bonuses: [], total, success };
}

describe('contract unlocks', () => {
  it('starts with only the first job open', () => {
    const save = defaultSave();
    expect(unlockedContracts(save).map((c) => c.id)).toEqual(['job01']);
    expect(recommendedContract(save).id).toBe('job01');
  });

  it('unlocks the next job after a successful completion, not a failed one', () => {
    const save = defaultSave();
    const job01 = getContract('job01');
    applyRun(save, job01, report(false), payout(false, 500));
    expect(isUnlocked(getContract('job02'), save)).toBe(false);
    expect(save.money).toBe(500);
    const outcome = applyRun(save, job01, report(true), payout(true, 12000));
    expect(outcome.firstCompletion).toBe(true);
    expect(outcome.unlocked.map((c) => c.id)).toEqual(['job02']);
    expect(isUnlocked(getContract('job02'), save)).toBe(true);
    expect(save.money).toBe(12500);
    expect(save.totalEarned).toBe(12500);
    expect(recommendedContract(save).id).toBe('job02');
  });

  it('keeps the last contract recommended once everything is done', () => {
    const save = defaultSave();
    for (const c of CONTRACTS) applyRun(save, c, report(true), payout(true, 1000));
    expect(recommendedContract(save).id).toBe(CONTRACTS[CONTRACTS.length - 1]!.id);
  });
});

describe('records', () => {
  it('tracks bests and attempts per contract', () => {
    const save = defaultSave();
    const job = getContract('job01');
    applyRun(save, job, report(true, { collateral: 0.05, chargesUsed: 3 }), payout(true, 10000));
    let r = save.records.job01!;
    expect(r.attempts).toBe(1);
    expect(r.completions).toBe(1);
    expect(r.bestPayout).toBe(10000);
    expect(r.bestCollateral).toBeCloseTo(0.05);
    expect(r.fewestCharges).toBe(3);

    const outcome = applyRun(save, job, report(true, { collateral: 0.01, chargesUsed: 2, removed: 1 }), payout(true, 13000));
    r = save.records.job01!;
    expect(r.attempts).toBe(2);
    expect(r.bestPayout).toBe(13000);
    expect(r.fewestCharges).toBe(2);
    expect(r.bestRemoved).toBe(1);
    expect(outcome.newRecords).toEqual(expect.arrayContaining(['payout', 'collateral', 'charges', 'removed']));

    // A worse run does not overwrite the bests.
    applyRun(save, job, report(true, { collateral: 0.1, chargesUsed: 3, removed: 0.9 }), payout(true, 9000));
    r = save.records.job01!;
    expect(r.bestPayout).toBe(13000);
    expect(r.fewestCharges).toBe(2);
    expect(r.attempts).toBe(3);
  });
});

describe('equipment purchases', () => {
  it('requires enough money and prevents double purchase', () => {
    const save = defaultSave();
    const scanner = EQUIPMENT[0]!;
    expect(canAfford(save, scanner.id)).toBe(false);
    expect(purchase(save, scanner.id)).toBe(false);
    save.money = scanner.cost;
    expect(purchase(save, scanner.id)).toBe(true);
    expect(save.money).toBe(0);
    expect(save.equipment).toEqual([scanner.id]);
    save.money = scanner.cost * 2;
    expect(purchase(save, scanner.id)).toBe(false);
    expect(save.money).toBe(scanner.cost * 2);
  });
});
