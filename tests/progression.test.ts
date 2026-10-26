import { describe, expect, it } from 'vitest';
import { CONTRACTS, getContract } from '../src/data/contracts';
import { MACHINES, UPGRADES, kitFor } from '../src/data/fleet';
import { runCrew } from '../src/game/crew';
import { Job } from '../src/game/moves';
import { applyRun, buyMachine, buyUpgrade, canBuyUpgrade, defaultLoadout, isUnlocked, kitOf, nextContract } from '../src/game/progression';
import { SAVE_KEY, SaveStore, defaultSave, normalizeSave, parseSave, serializeSave, type StorageLike } from '../src/game/save';
import { computePayout, objectives } from '../src/game/scoring';
import { siteStatus } from '../src/wreck/job';
import { BASE_KIT } from '../src/wreck/kit';
import { prepare } from '../src/wreck/sim';

class Mem implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

/** Plays the corner store to the end with the crew. */
function playCorner(): Job {
  const c = getContract('corner');
  const job = new Job(c, c.fixed ?? c.recommended, prepare('corner'), kitFor([]));
  runCrew(job);
  return job;
}

describe('upgrades', () => {
  it('a purchase takes the right amount and is refused without the money', () => {
    const save = defaultSave();
    save.money = 4999;
    expect(buyUpgrade(save, 'ball-power-1').ok).toBe(false);
    expect(save.upgrades).toHaveLength(0);
    save.money = 5000;
    expect(buyUpgrade(save, 'ball-power-1').ok).toBe(true);
    expect(save.money).toBe(0);
    expect(save.upgrades).toContain('ball-power-1');
    expect(buyUpgrade(save, 'ball-power-1').ok).toBe(false);
  });

  it('enforces prerequisites, machine ownership and contract unlocks', () => {
    const save = defaultSave();
    save.money = 1e6;
    expect(canBuyUpgrade(save, 'ball-power-2').ok).toBe(false);
    expect(canBuyUpgrade(save, 'excavator-power-1').ok).toBe(false);
    expect(buyMachine(save, 'excavator').ok).toBe(true);
    expect(save.money).toBe(1e6 - MACHINES.excavator.price);
    expect(canBuyUpgrade(save, 'excavator-power-1').ok).toBe(true);
    expect(buyUpgrade(save, 'ball-power-1').ok).toBe(true);
    // Tier 2 also needs three completed contracts.
    const check = canBuyUpgrade(save, 'ball-power-2');
    expect(check.ok).toBe(false);
    for (const id of ['corner', 'garage', 'house']) save.records[id] = { attempts: 1, completions: 1, bestPayout: 1, bestStars: 1, bestMoves: 3, bonuses: [] };
    expect(canBuyUpgrade(save, 'ball-power-2').ok).toBe(true);
  });

  it('every upgrade changes the kit the simulation runs with', () => {
    for (const u of UPGRADES) {
      const before = kitFor(u.requires ? [u.requires] : []);
      const after = kitFor(u.requires ? [u.requires, u.id] : [u.id]);
      expect(after, u.id).not.toEqual(before);
    }
    expect(kitFor([])).toEqual(BASE_KIT);
  });

  it('a heavier ball hits harder in the actual simulation', () => {
    const c = getContract('warehouse');
    const swing = (ups: string[]): number => {
      const job = new Job(c, ['ball'], prepare('warehouse'), kitFor(ups));
      const p = job.sim.def.pieces.find((q) => q.label === 'Column A · floor 1');
      if (!p) throw new Error('piece');
      job.commit(job.plan('ball', p.x + p.w / 2, 1.5));
      job.settle();
      return job.sim.state.roots[1]?.hitEnergy ?? 0;
    };
    expect(swing(['ball-power-1'])).toBeGreaterThan(swing([]) * 1.15);
  });

  it('the boom extension reaches targets the base boom cannot', () => {
    const c = getContract('warehouse');
    const base = new Job(c, ['ball'], prepare('warehouse'), kitFor([]));
    const long = new Job(c, ['ball'], prepare('warehouse'), kitFor(['ball-eff-1']));
    const top = base.sim.def.bounds.maxY - 3;
    const tall = new Job(getContract('halden'), ['ball'], prepare('halden'), kitFor([]));
    const tallLong = new Job(getContract('halden'), ['ball'], prepare('halden'), kitFor(['ball-eff-1']));
    expect(base.plan('ball', 8, top).ok || long.plan('ball', 8, top).ok).toBe(true);
    expect(tall.plan('ball', 22, 40).ok).toBe(false);
    expect(tallLong.plan('ball', 22, 40).ok).toBe(true);
  });

  it('upgrades survive a reload', () => {
    const mem = new Mem();
    const store = new SaveStore(mem);
    store.data.money = 20000;
    buyMachine(store.data, 'loader');
    buyUpgrade(store.data, 'loader-eff-1');
    store.save();
    const again = new SaveStore(mem);
    expect(again.data.fleet).toContain('loader');
    expect(again.data.upgrades).toContain('loader-eff-1');
    expect(kitOf(again.data).bucket).toBe(11);
    expect(again.data.money).toBe(20000 - MACHINES.loader.price - 4000);
  });
});

describe('contracts and rewards', () => {
  it('every contract can be finished with its recommended loadout', { timeout: 120000 }, () => {
    // Later contracts are played with the upgrades a player would have by then.
    const tierKit: Record<string, string[]> = {
      warehouse: ['ball-power-1', 'dozer-power-1', 'excavator-power-1', 'loader-power-1'],
      halden: ['ball-power-1', 'ball-eff-1', 'dozer-power-1', 'dozer-eff-1', 'excavator-power-1', 'charges-power-1', 'loader-power-1'],
    };
    for (const c of CONTRACTS) {
      const job = new Job(c, (c.fixed ?? c.recommended).slice(0, c.slots), prepare(c.building), kitFor(tierKit[c.id] ?? []));
      runCrew(job);
      const p = computePayout(job, { completions: 0, bonuses: [] });
      expect(p.success, `${c.id}: ${JSON.stringify(p.status)}`).toBe(true);
      expect(job.used).toBeLessThanOrEqual(Object.values(job.budgets).reduce((m, b) => m + (b?.max ?? 0), 0));
    }
  });

  it('objectives update as the job goes', () => {
    const c = getContract('corner');
    const job = new Job(c, ['ball', 'dozer'], prepare('corner'), kitFor([]));
    const before = objectives(c, siteStatus(job.sim), 0);
    expect(before.find((o) => o.id === 'down')?.done).toBe(false);
    runCrew(job);
    const after = objectives(c, siteStatus(job.sim), job.used, true);
    expect(after.find((o) => o.id === 'down')?.done).toBe(true);
    expect(after.find((o) => o.id === 'clear')?.done).toBe(true);
  });

  it('pays the fee once, and lines add up to the total', () => {
    const job = playCorner();
    const save = defaultSave();
    const c = getContract('corner');
    const first = computePayout(job, { completions: 0, bonuses: [] });
    expect(first.success).toBe(true);
    expect(first.lines.find((l) => l.key === 'fee')?.amount).toBe(c.fee);
    expect(first.total).toBe(Math.max(0, first.lines.reduce((m, l) => m + l.amount, 0)));
    applyRun(save, c, first);
    expect(save.money).toBe(first.total);
    // The same run again pays no fee and no bonus twice.
    const rec = save.records.corner;
    const replay = computePayout(playCorner(), { completions: rec?.completions ?? 0, bonuses: rec?.bonuses ?? [] });
    expect(replay.lines.find((l) => l.key === 'fee')?.amount).toBe(0);
    for (const b of c.bonuses) expect(replay.newBonuses).not.toContain(rec?.bonuses.includes(b.id) ? b.id : '__none__');
    expect(replay.total).toBeLessThan(first.total);
  });

  it('a failed job pays no fee and unlocks nothing', () => {
    const c = getContract('corner');
    const job = new Job(c, ['ball', 'dozer'], prepare('corner'), kitFor([]));
    const p = computePayout(job, { completions: 0, bonuses: [] });
    expect(p.success).toBe(false);
    expect(p.lines.some((l) => l.key === 'fee')).toBe(false);
    const save = defaultSave();
    const out = applyRun(save, c, p);
    expect(out.unlocked).toHaveLength(0);
    expect(isUnlocked(getContract('garage'), save)).toBe(false);
  });

  it('completing a contract unlocks the next and progression survives reload', () => {
    const mem = new Mem();
    const store = new SaveStore(mem);
    const c = getContract('corner');
    const p = computePayout(playCorner(), { completions: 0, bonuses: [] });
    const out = applyRun(store.data, c, p);
    expect(out.firstCompletion).toBe(true);
    expect(out.unlocked.map((u) => u.id)).toContain('garage');
    store.save();
    const again = new SaveStore(mem);
    expect(isUnlocked(getContract('garage'), again.data)).toBe(true);
    expect(nextContract(again.data).id).toBe('garage');
    expect(again.data.tutorialDone).toBe(true);
    expect(again.data.money).toBe(p.total);
  });

  it('the default loadout only uses owned machines and fits the slots', () => {
    const save = defaultSave();
    for (const c of CONTRACTS) {
      const l = defaultLoadout(c, save);
      expect(l.length).toBeLessThanOrEqual(c.slots);
      if (!c.fixed) for (const m of l) expect(save.fleet).toContain(m);
    }
  });
});

describe('saves', () => {
  it('round-trips', () => {
    const s = defaultSave();
    s.money = 1234;
    s.totalEarned = 5000;
    s.upgrades = ['ball-power-1'];
    expect(parseSave(serializeSave(s))).toEqual(s);
  });

  it('survives corrupt data', () => {
    expect(parseSave('{not json')).toBeNull();
    expect(parseSave('null')).toBeNull();
    const store = new SaveStore({ getItem: () => '{"money": "lots"', setItem: () => undefined, removeItem: () => undefined });
    expect(store.data.money).toBe(0);
    const odd = normalizeSave({ version: 2, money: -5, fleet: ['ball', 'jetpack'], upgrades: ['nope', 'dozer-eff-1'], records: { corner: { attempts: 'x', completions: 2, bonuses: [1, 'corner-clean'] }, mystery: {} } });
    expect(odd?.money).toBe(0);
    expect(odd?.fleet).toEqual(['ball', 'dozer']);
    expect(odd?.upgrades).toEqual(['dozer-eff-1']);
    expect(odd?.records.corner?.completions).toBe(2);
    expect(odd?.records.corner?.attempts).toBe(0);
    expect(odd?.records.corner?.bonuses).toEqual(['corner-clean']);
    expect(odd?.records.mystery).toBeUndefined();
  });

  it('carries money, settings and equipment over from the first save format', () => {
    const old = { version: 1, money: 42000, totalEarned: 90000, completed: ['shed', 'garage'], equipment: ['scanner', 'high_yield'], records: {}, settings: { sound: false, reducedMotion: true, haptics: false } };
    const mem = new Mem();
    mem.setItem(SAVE_KEY, JSON.stringify(old));
    const s = new SaveStore(mem).data;
    expect(s.version).toBe(2);
    expect(s.money).toBe(42000);
    expect(s.settings).toEqual({ sound: false, reducedMotion: true, haptics: false });
    expect(s.fleet).toContain('charges');
    expect(s.upgrades).toEqual(expect.arrayContaining(['charges-scan', 'charges-power-1']));
    expect(s.tutorialDone).toBe(true);
  });
});
