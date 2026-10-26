import { describe, expect, it } from 'vitest';
import { Crew, playJob } from '../src/wreck/autoplay';
import { CLEAR_AT, DOWN_AT, jobStatus, lotWork, scoreJob } from '../src/wreck/job';
import { HEIGHTMAP, PIECE_GONE, PIECE_STANDING, WreckSim, craneHook, halden, type Command } from '../src/wreck/sim';
import type { PieceDef } from '../src/wreck/structure';
import { FLAW_HIDDEN, FLAW_SHOWN, FUSE_TICKS, HEAVY_BLOCK, SITE_LAYOUT, STEP_TICKS, vaultBlock, type Block } from '../src/wreck/tools';

const H = halden();
const byLabel = (label: string): PieceDef => {
  const p = H.def.pieces.find((q) => q.label === label);
  if (!p) throw new Error(`no piece ${label}`);
  return p;
};
const run = (sim: WreckSim, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds * 60); i++) sim.step();
};
const settle = (sim: WreckSim, max = 30): void => {
  run(sim, 2);
  for (let i = 0; i < max * 60 && sim.state.quietFor < 1; i++) sim.step();
};
/** A lot with nothing left standing on it, so the machines can drive anywhere. */
const emptyLot = (sim: WreckSim): void => {
  for (const p of H.def.pieces) sim.state.status[p.id] = PIECE_GONE;
  sim.state.standingMass = 0;
  sim.state.dirty = true;
  sim.step();
};
/** Rubble area between two x positions. */
const rubble = (sim: WreckSim, a: number, b: number): number => {
  let sum = 0;
  for (let x = a; x < b; x += HEIGHTMAP.cell) sum += (sim.state.heightmap[Math.round((x - HEIGHTMAP.minX) / HEIGHTMAP.cell)] as number) * HEIGHTMAP.cell;
  return sum;
};

describe('charges', () => {
  it('only go on structure, come out of a limited stock and can be taken back', () => {
    const sim = new WreckSim();
    expect(sim.command({ kind: 'charge', piece: byLabel('Window bay F–G · floor 2').id, charge: 'cutter', y: 5 })).toMatch(/Cladding/);
    for (const l of ['Column E · floor 2', 'Column F · floor 2', 'Column G · floor 2']) expect(sim.command({ kind: 'charge', piece: byLabel(l).id, charge: 'cutter', y: 6 })).toBeUndefined();
    expect(sim.command({ kind: 'charge', piece: byLabel('Column H · floor 2').id, charge: 'cutter', y: 6 })).toMatch(/No cutters/);
    expect(sim.command({ kind: 'charge', piece: byLabel('Column E · floor 2').id, charge: 'blast', y: 6 })).toMatch(/already/);
    const first = sim.state.charges[0];
    sim.command({ kind: 'uncharge', id: first?.id ?? -1 });
    expect(sim.state.chargesLeft.cutter).toBe(1);
    expect(sim.state.charges).toHaveLength(2);
  });

  it('fire in the order they were set, after the fuse, and cut what they are on', () => {
    const sim = new WreckSim();
    const order = ['Column G · floor 3', 'Column E · floor 3'];
    for (const l of order) sim.command({ kind: 'charge', piece: byLabel(l).id, charge: 'cutter', y: byLabel(l).y + 1 });
    expect(sim.clock).toBe(0);
    sim.command({ kind: 'detonate' });
    const fired: number[] = [];
    for (let i = 0; i < FUSE_TICKS + STEP_TICKS * 3; i++) {
      for (const e of sim.step()) if (e.type === 'blast') fired.push(e.piece);
    }
    expect(fired).toEqual(order.map((l) => byLabel(l).id));
    expect(sim.clock).toBeGreaterThan(0);
    for (const l of order) expect(sim.state.status[byLabel(l).id]).not.toBe(PIECE_STANDING);
    expect(sim.state.roots[1]?.tool).toBe('charge');
    expect(sim.state.roots[1]?.charges).toBe(2);
  });

  it('go off when the ball hits them, and the swing gets the credit', () => {
    const sim = new WreckSim();
    sim.setHookTarget(12, 46);
    sim.settleCrane();
    const hook = craneHook(sim.state.crane);
    sim.aim(hook.x - 14, hook.y - 6);
    const target = sim.predict().hitPiece;
    expect(target).toBeGreaterThanOrEqual(0);
    const p = H.def.pieces[target] as PieceDef;
    const err = sim.command({ kind: 'charge', piece: target, charge: 'blast', y: p.y + p.h / 2 });
    expect(err).toBeUndefined();
    sim.aim(hook.x - 14, hook.y - 6);
    sim.release();
    run(sim, 4);
    expect(sim.state.tally.ballFired).toBe(1);
    expect(sim.state.charges[0]?.root).toBe(sim.state.ballRoot);
  });

  it('are lost with a member that is smashed before they fire', () => {
    const sim = new WreckSim();
    const col = byLabel('Column E · floor 6');
    sim.command({ kind: 'charge', piece: col.id, charge: 'cutter', y: col.y + 1 });
    sim.state.hp[col.id] = 1;
    sim.damageStanding(col.id, 50, 0, 'impact', 0, 0);
    sim.step();
    expect(sim.state.charges[0]?.state).toBe(2);
    expect(sim.state.tally.chargesFired).toBe(0);
  });
});

describe('weak points', () => {
  it('take double damage, and a blast nearby finds hidden ones', () => {
    const sim = new WreckSim();
    const known = byLabel('Column F · floor 1');
    const plain = byLabel('Column G · floor 1');
    expect(sim.state.flaw[known.id]).toBe(FLAW_SHOWN);
    sim.damageStanding(known.id, 50, 0, 'impact', 0, 0);
    sim.damageStanding(plain.id, 50, 0, 'impact', 0, 0);
    expect(known.hp - (sim.state.hp[known.id] as number)).toBeCloseTo(100);
    expect(plain.hp - (sim.state.hp[plain.id] as number)).toBeCloseTo(50);

    const hidden = byLabel('Column H · floor 6');
    expect(sim.state.flaw[hidden.id]).toBe(FLAW_HIDDEN);
    const near = byLabel('Column J · floor 6');
    sim.command({ kind: 'charge', piece: near.id, charge: 'blast', y: near.y + 1.5 });
    sim.command({ kind: 'detonate' });
    run(sim, (FUSE_TICKS + 2) / 60);
    expect(sim.state.flaw[hidden.id]).toBeGreaterThanOrEqual(FLAW_SHOWN);
  });
});

describe('excavator', () => {
  it('drives into reach and crunches what its jaws are on', () => {
    const sim = new WreckSim();
    const dock = byLabel('Dock column 4');
    sim.command({ kind: 'exc', x: dock.x + dock.w / 2, y: 2 });
    run(sim, 6);
    expect(Math.hypot(sim.state.exc.jawX - (dock.x + dock.w / 2), sim.state.exc.jawY - 2)).toBeLessThan(0.5);
    sim.command({ kind: 'bite', on: true });
    run(sim, 3);
    sim.command({ kind: 'bite', on: false });
    expect(sim.state.status[dock.id]).not.toBe(PIECE_STANDING);
    expect(sim.state.tally.bites).toBeGreaterThan(0);
    expect(sim.state.roots[1]?.tool).toBe('excavator');
  });

  it('breaks a slab too heavy for the dozer into pieces it can push', () => {
    const sim = new WreckSim();
    const slab: Block = { id: 99, kind: 'slab', label: 'Core slab', material: 'concrete', x: 44, y: 0, w: 3, h: 1.4, mass: 28, hp: 520, maxHp: 520, area: 1, seed: 3 };
    sim.state.blocks.push(slab);
    sim.command({ kind: 'exc', x: 44, y: 0.7 });
    run(sim, 6);
    sim.command({ kind: 'bite', on: true });
    run(sim, 2.5);
    expect(sim.state.blocks.some((b) => b.id === 99)).toBe(false);
    const halves = sim.state.blocks.filter((b) => b.kind === 'slab');
    expect(halves.length).toBeGreaterThan(0);
    for (const b of halves) expect(b.mass).toBeLessThanOrEqual(HEAVY_BLOCK);
  });
});

describe('dozer', () => {
  it('pushes rubble into the haul pit, and the lot gets clearer', () => {
    const sim = new WreckSim();
    emptyLot(sim);
    sim.depositMound(40, 3, 6);
    for (let i = 0; i < 30; i++) sim.step();
    const before = rubble(sim, 30, 52);
    const work = lotWork(sim);
    // Back up behind the heap (reversing rides over), then push into the pit.
    sim.command({ kind: 'dozer', x: 30 });
    run(sim, 14);
    sim.command({ kind: 'dozer', x: SITE_LAYOUT.pitMin - 1 });
    run(sim, 14);
    expect(rubble(sim, 30, 52)).toBeLessThan(before * 0.25);
    expect(sim.state.tally.hauled).toBeGreaterThan(before * 0.5);
    expect(lotWork(sim)).toBeLessThan(work);
  });

  it('stalls against a heavy slab until it is broken', () => {
    const sim = new WreckSim();
    emptyLot(sim);
    sim.state.blocks.push({ id: 99, kind: 'slab', label: 'Core slab', material: 'concrete', x: 4, y: 0, w: 3, h: 1.4, mass: 28, hp: 520, maxHp: 520, area: 1, seed: 3 });
    sim.command({ kind: 'dozer', x: 20 });
    run(sim, 8);
    expect(sim.state.dozer.stall).toBe('heavy');
    expect(sim.state.dozer.x).toBeLessThan(0);
  });

  it('turns to push the other way, and steel on the pad is salvage', () => {
    const sim = new WreckSim();
    emptyLot(sim);
    sim.state.blocks.push({ id: 98, kind: 'steel', label: 'Truss steel', material: 'steel', x: 4, y: 0, w: 3, h: 0.8, mass: 17, hp: 420, maxHp: 420, area: 1, seed: 3 });
    // Turn, ride past it in reverse, then push it back onto the pad.
    sim.command({ kind: 'turn' });
    expect(sim.state.dozer.dir).toBe(-1);
    sim.command({ kind: 'dozer', x: 12 });
    run(sim, 10);
    expect(sim.state.blocks.find((b) => b.id === 98)?.x).toBe(4);
    sim.command({ kind: 'dozer', x: SITE_LAYOUT.padMax + 1 });
    run(sim, 12);
    expect(sim.state.tally.steelSalvaged).toBeCloseTo(17);
  });
});

describe('the vault', () => {
  it('stays safe inside the core until its wall is gone, and pays out on the pad', () => {
    const sim = new WreckSim();
    expect(jobStatus(sim).vault).toBe('inside');
    emptyLot(sim);
    expect(jobStatus(sim).vault).toBe('exposed');
    const v = vaultBlock(sim) as Block;
    sim.command({ kind: 'turn' });
    sim.command({ kind: 'dozer', x: v.x + 5 });
    run(sim, 14);
    sim.command({ kind: 'dozer', x: SITE_LAYOUT.padMax + 1 });
    run(sim, 14);
    expect(jobStatus(sim).vault).toBe('saved');
    expect(sim.state.tally.vaultSaved).toBeGreaterThan(0.9);
    expect(scoreJob(sim).lines.some((l) => l.key === 'vault')).toBe(true);
  });
});

describe('the whole job', () => {
  it.each(['blast', 'mixed', 'ball'] as const)('can be finished with the %s approach', (strategy) => {
    const sim = playJob(strategy, 650);
    const st = jobStatus(sim);
    expect(st.standing).toBeLessThanOrEqual(DOWN_AT);
    expect(st.clear).toBeGreaterThanOrEqual(CLEAR_AT);
    expect(st.complete).toBe(true);
    const score = scoreJob(sim);
    expect(score.total).toBeGreaterThan(5000);
    expect(score.lines.find((l) => l.key === 'clear')?.points).toBeGreaterThan(0);
  }, 120000);

  it('replays exactly from its command log', () => {
    const live = new WreckSim();
    const crew = new Crew('mixed');
    const log: Array<{ tick: number; cmd: Command }> = [];
    for (let t = 0; t < 60 * 70; t++) {
      for (const c of crew.tick(live)) {
        log.push({ tick: live.state.tick, cmd: c });
        live.command(c);
      }
      live.step();
    }
    const again = new WreckSim();
    let cursor = 0;
    while (again.state.tick < live.state.tick) {
      while (cursor < log.length && (log[cursor] as { tick: number }).tick <= again.state.tick) again.command((log[cursor++] as { cmd: Command }).cmd);
      again.step();
    }
    expect(again.state.standingMass).toBe(live.state.standingMass);
    expect([...again.state.heightmap]).toEqual([...live.state.heightmap]);
    expect(again.state.exc.x).toBe(live.state.exc.x);
  }, 120000);

  it('does not let a machine steal the credit for a collapse a volley started', () => {
    const sim = new WreckSim();
    for (const l of ['Column E · floor 1', 'Column F · floor 1', 'Column G · floor 1']) sim.command({ kind: 'charge', piece: byLabel(l).id, charge: 'cutter', y: 1 });
    sim.command({ kind: 'detonate' });
    run(sim, 2);
    sim.command({ kind: 'exc', x: 48, y: 3 });
    sim.command({ kind: 'bite', on: true });
    settle(sim);
    const volley = sim.state.roots[1];
    const crunch = sim.state.roots.find((r) => r?.tool === 'excavator');
    expect(volley?.mass).toBeGreaterThan((crunch?.mass ?? 0) * 4);
  }, 60000);
});
