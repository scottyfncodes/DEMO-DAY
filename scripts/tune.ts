/* Headless strategy harness: runs a set of placements per building and prints
 * the report so numbers can be tuned. Run with: npx vitest run scripts/tune.ts
 * (it is written as a test file so Vite handles TypeScript). */
import { describe, it } from 'vitest';
import type { PlacedCharge } from '../src/core/types';
import { BUILDINGS } from '../src/data/buildings';
import { CONTRACTS } from '../src/data/contracts';
import { computePayout } from '../src/game/payout';
import { scoreRun } from '../src/game/scoring';
import { Simulation } from '../src/sim/simulation';
import { buildBuilding } from '../src/structure/building';

type Strategy = { name: string; contract: string; charges: Array<Omit<PlacedCharge, 'id'>> };

const STRATEGIES: Strategy[] = [
  { name: 'shed: all three posts', contract: 'job01', charges: [
    { type: 'small', memberId: 'post_l' }, { type: 'small', memberId: 'post_c' }, { type: 'small', memberId: 'post_r' } ] },
  { name: 'shed: outer posts only', contract: 'job01', charges: [
    { type: 'small', memberId: 'post_l' }, { type: 'small', memberId: 'post_r' } ] },
  { name: 'shed: centre only', contract: 'job01', charges: [{ type: 'small', memberId: 'post_c' }] },
  { name: 'shed: left only', contract: 'job01', charges: [{ type: 'small', memberId: 'post_l' }] },
  { name: 'shed: roof', contract: 'job01', charges: [{ type: 'small', memberId: 'roof' }, { type: 'small', memberId: 'roof' }] },
  { name: 'garage: heavy on left wall', contract: 'job02', charges: [{ type: 'heavy', memberId: 'wall_l' }] },
  { name: 'garage: heavy on pier', contract: 'job02', charges: [{ type: 'heavy', memberId: 'pier' }] },
  { name: 'garage: heavy left + small pier + small wall_r', contract: 'job02', charges: [
    { type: 'heavy', memberId: 'wall_l' }, { type: 'small', memberId: 'pier' }, { type: 'small', memberId: 'wall_r' } ] },
  { name: 'garage: small right wall', contract: 'job02', charges: [{ type: 'small', memberId: 'wall_r' }] },
  { name: 'silo: directional left on left leg', contract: 'job03', charges: [{ type: 'directional', memberId: 'leg_l', direction: 'left' }] },
  { name: 'silo: two smalls left leg', contract: 'job03', charges: [{ type: 'small', memberId: 'leg_l' }, { type: 'small', memberId: 'leg_l' }] },
  { name: 'silo: small+directional right leg', contract: 'job03', charges: [{ type: 'small', memberId: 'leg_r' }, { type: 'directional', memberId: 'leg_r', direction: 'left' }] },
  { name: 'silo: both legs', contract: 'job03', charges: [
    { type: 'directional', memberId: 'leg_l', direction: 'right' }, { type: 'small', memberId: 'leg_r' }, { type: 'small', memberId: 'leg_r' } ] },
  { name: 'house: heavy on chimney + smalls p1 p2', contract: 'job04', charges: [
    { type: 'heavy', memberId: 'chimney' }, { type: 'small', memberId: 'p1' }, { type: 'small', memberId: 'p2' } ] },
  { name: 'house: heavy on p2 + smalls p4 chimney chimney', contract: 'job04', charges: [
    { type: 'heavy', memberId: 'p2' }, { type: 'small', memberId: 'p4' }, { type: 'small', memberId: 'chimney' }, { type: 'small', memberId: 'chimney' } ] },
  { name: 'house: heavy on p3 only', contract: 'job04', charges: [{ type: 'heavy', memberId: 'p3' }] },
  { name: 'mill: directional left on s1', contract: 'job05', charges: [{ type: 'directional', memberId: 's1', direction: 'left' }] },
  { name: 'mill: two smalls on s1', contract: 'job05', charges: [{ type: 'small', memberId: 's1' }, { type: 'small', memberId: 's1' }] },
  { name: 'mill: heavy on s1', contract: 'job05', charges: [{ type: 'heavy', memberId: 's1' }] },
  { name: 'mill: directional on s2', contract: 'job05', charges: [{ type: 'directional', memberId: 's2', direction: 'left' }] },
  { name: 'warehouse: heavy c1_2 c1_3 + shaped core', contract: 'job06', charges: [
    { type: 'heavy', memberId: 'c1_2' }, { type: 'heavy', memberId: 'c1_3' }, { type: 'shaped', memberId: 'core' } ] },
  { name: 'warehouse: heavy c1_2 c1_3 only', contract: 'job06', charges: [
    { type: 'heavy', memberId: 'c1_2' }, { type: 'heavy', memberId: 'c1_3' } ] },
  { name: 'warehouse: shaped core only', contract: 'job06', charges: [{ type: 'shaped', memberId: 'core' }] },
  { name: 'warehouse: everything', contract: 'job06', charges: [
    { type: 'heavy', memberId: 'c1_1' }, { type: 'heavy', memberId: 'c1_2' }, { type: 'heavy', memberId: 'c1_3' }, { type: 'shaped', memberId: 'c1_4' }, { type: 'shaped', memberId: 'core' } ] },
];

describe('tuning harness', () => {
  it('prints strategy outcomes', () => {
    const lines: string[] = [];
    for (const s of STRATEGIES) {
      const contract = CONTRACTS.find((c) => c.id === s.contract)!;
      const building = buildBuilding(BUILDINGS[contract.buildingId]!);
      const charges: PlacedCharge[] = s.charges.map((c, i) => ({ ...c, id: `c${i}` }));
      const sim = new Simulation(building, charges);
      const result = sim.runToEnd();
      const available = Object.values(contract.loadout).reduce((a, b) => a + (b ?? 0), 0);
      const report = scoreRun(result, contract, charges.length, available);
      const payout = computePayout(report, contract);
      const standing = Object.entries(result.memberOutcome).filter(([, o]) => o === 'standing' || o === 'resting').map(([id, o]) => `${id}${o === 'resting' ? '(r)' : ''}`);
      lines.push(
        `${s.name.padEnd(48)} ${report.success ? 'OK  ' : 'FAIL'} removed=${(report.removed * 100).toFixed(1)}% coll=${(report.collateral * 100).toFixed(1)}% fp=${(report.footprint * 100).toFixed(0)}% eff=${(report.efficiency * 100).toFixed(0)}% t=${result.duration.toFixed(1)}s pay=$${payout.total} nb=${JSON.stringify(Object.fromEntries(Object.entries(result.neighborHits).map(([k, v]) => [k, +v.toFixed(1)])))} standing=[${standing.join(',')}]`,
      );
    }
    console.log('\n' + lines.join('\n') + '\n');
  });
});
