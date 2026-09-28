import { describe, expect, it } from 'vitest';
import { getContract } from '../src/data/contracts';
import { computePayout, roundMoney } from '../src/game/payout';
import type { Report } from '../src/game/scoring';

function report(overrides: Partial<Report> = {}): Report {
  return {
    removed: 0.95,
    required: 0.85,
    footprint: 0.95,
    targetFootprint: 0.8,
    collateral: 0.0,
    maxCollateral: 0.15,
    chargesUsed: 3,
    chargesAvailable: 3,
    efficiency: 0.5,
    protectedKept: true,
    protectedFailed: [],
    neighborHits: {},
    requirements: [],
    success: true,
    ...overrides,
  };
}

describe('payout calculation', () => {
  const contract = getContract('job01');

  it('rounds money to the nearest $50 and never below zero', () => {
    expect(roundMoney(1234)).toBe(1250);
    expect(roundMoney(1224)).toBe(1200);
    expect(roundMoney(-10)).toBe(0);
  });

  it('pays the full contract value plus bonuses on success', () => {
    const p = computePayout(report(), contract);
    expect(p.success).toBe(true);
    expect(p.base).toBe(contract.value);
    expect(p.total).toBe(p.base + p.bonuses.reduce((a, b) => a + b.amount, 0));
    expect(p.bonuses.map((b) => b.id)).toContain('precision');
    expect(p.bonuses.map((b) => b.id)).toContain('collateral');
    expect(p.bonuses.map((b) => b.id)).toContain('footprint');
    expect(p.bonuses.map((b) => b.id)).not.toContain('unused');
  });

  it('pays a partial fee and no bonuses on failure', () => {
    const p = computePayout(report({ success: false, removed: 0.4 }), contract);
    expect(p.success).toBe(false);
    expect(p.bonuses).toEqual([]);
    expect(p.total).toBe(roundMoney(contract.value * 0.2 * 0.4));
    expect(p.total).toBeLessThan(contract.value);
  });

  it('rewards unused charges, capped at 30% of value', () => {
    const one = computePayout(report({ chargesUsed: 2, chargesAvailable: 3 }), contract);
    const unused = one.bonuses.find((b) => b.id === 'unused');
    expect(unused?.amount).toBe(roundMoney(contract.value * 0.05));
    const many = computePayout(report({ chargesUsed: 1, chargesAvailable: 20 }), contract);
    expect(many.bonuses.find((b) => b.id === 'unused')?.amount).toBe(roundMoney(contract.value * 0.3));
  });

  it('scales the precision bonus with the margin over the requirement', () => {
    const small = computePayout(report({ removed: 0.9 }), contract).bonuses.find((b) => b.id === 'precision');
    const big = computePayout(report({ removed: 1 }), contract).bonuses.find((b) => b.id === 'precision');
    const none = computePayout(report({ removed: 0.87 }), contract).bonuses.find((b) => b.id === 'precision');
    expect(none).toBeUndefined();
    expect(small?.amount ?? 0).toBeGreaterThan(0);
    expect(big?.amount ?? 0).toBeGreaterThan(small?.amount ?? 0);
  });

  it('gives efficiency and clean-sweep bonuses when earned', () => {
    const p = computePayout(report({ removed: 1, efficiency: 0.9 }), contract);
    const ids = p.bonuses.map((b) => b.id);
    expect(ids).toContain('efficiency');
    expect(ids).toContain('sweep');
    const q = computePayout(report({ efficiency: 0.2 }), contract);
    expect(q.bonuses.map((b) => b.id)).not.toContain('efficiency');
  });

  it('tiers the collateral bonus', () => {
    const clean = computePayout(report({ collateral: 0.005 }), contract).bonuses.find((b) => b.id === 'collateral');
    const low = computePayout(report({ collateral: 0.05 }), contract).bonuses.find((b) => b.id === 'collateral');
    const none = computePayout(report({ collateral: 0.12 }), contract).bonuses.find((b) => b.id === 'collateral');
    expect(clean?.amount).toBe(roundMoney(contract.value * 0.12));
    expect(low?.amount).toBe(roundMoney(contract.value * 0.06));
    expect(none).toBeUndefined();
  });
});
