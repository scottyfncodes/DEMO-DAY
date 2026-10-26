import { describe, expect, it } from 'vitest';
import { getContract } from '../src/data/contracts';
import { kitFor } from '../src/data/fleet';
import { Job, SHAPED_COST } from '../src/game/moves';
import { PIECE_STANDING, prepare } from '../src/wreck/sim';
import type { PieceDef } from '../src/wreck/structure';

const contract = getContract('garage');

function newJob(upgrades: string[] = []): Job {
  return new Job(contract, ['ball', 'charges', 'dozer'], prepare('garage'), kitFor(upgrades));
}

const piece = (job: Job, label: string): PieceDef => {
  const p = job.sim.def.pieces.find((q) => q.label === label);
  if (!p) throw new Error(label);
  return p;
};

describe('move budgets', () => {
  it('starts every machine on the contract budget', () => {
    const job = newJob();
    expect(job.left('ball')).toBe(contract.budgets.ball);
    expect(job.left('charges')).toBe(contract.budgets.charges);
    expect(job.left('dozer')).toBe(contract.budgets.dozer);
    expect(job.left('excavator')).toBe(0);
    expect(job.used).toBe(0);
  });

  it('planning and previewing never spend anything', () => {
    const job = newJob();
    const col = piece(job, 'Column A · floor 1');
    for (let i = 0; i < 5; i++) {
      job.plan('ball', col.x + col.w / 2, 1.5);
      job.plan('charges', col.x + col.w / 2, 1.5);
      job.plan('dozer', 5, 0);
    }
    expect(job.used).toBe(0);
    expect(job.sim.state.tick).toBe(0);
    expect(job.sim.state.charges).toHaveLength(0);
  });

  it('a swing costs exactly one swing, and only the ball pays', () => {
    const job = newJob();
    const col = piece(job, 'Column A · floor 1');
    const plan = job.plan('ball', col.x + col.w / 2, 1.5);
    expect(plan.ok).toBe(true);
    expect(plan.cost).toBe(1);
    expect(job.commit(plan).ok).toBe(true);
    expect(job.left('ball')).toBe((contract.budgets.ball as number) - 1);
    expect(job.left('charges')).toBe(contract.budgets.charges);
    expect(job.left('dozer')).toBe(contract.budgets.dozer);
  });

  it('a second tap while the move plays out is refused and spends nothing', () => {
    const job = newJob();
    const col = piece(job, 'Column A · floor 1');
    const plan = job.plan('ball', col.x + col.w / 2, 1.5);
    expect(job.commit(plan).ok).toBe(true);
    const again = job.commit(plan);
    expect(again.ok).toBe(false);
    expect(job.left('ball')).toBe((contract.budgets.ball as number) - 1);
    // Still refused a few frames later, while the ball is swinging.
    for (let i = 0; i < 30; i++) job.step();
    expect(job.commit(job.plan('ball', col.x + col.w / 2, 1.5)).ok).toBe(false);
    expect(job.moves).toHaveLength(1);
    job.settle();
    expect(job.ready).toBe(true);
  });

  it('invalid moves cost nothing', () => {
    const job = newJob();
    const sky = job.plan('ball', 10, 60);
    expect(sky.ok).toBe(false);
    expect(job.commit(sky).ok).toBe(false);
    const nothing = job.plan('dozer', 8, 0);
    expect(nothing.ok).toBe(false);
    expect(job.commit(nothing).ok).toBe(false);
    const glass = piece(job, 'Window bay D–E · floor 1');
    const clad = job.plan('charges', glass.x + glass.w / 2, glass.y + 1);
    expect(clad.ok).toBe(false);
    expect(job.used).toBe(0);
  });

  it('an exhausted machine cannot move again and counts never go negative', () => {
    const job = new Job({ ...contract, budgets: { ball: 1, dozer: 1 } }, ['ball', 'dozer'], prepare('garage'), kitFor([]));
    const col = piece(job, 'Column A · floor 1');
    const c = piece(job, 'Column C · floor 1');
    const plan = job.plan('ball', c.x + c.w / 2, 1.5);
    expect(plan.ok).toBe(true);
    expect(job.commit(job.plan('ball', col.x + col.w / 2, 1.5)).ok).toBe(true);
    job.settle();
    const r = job.commit(plan);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/No swings left/);
    expect(job.left('ball')).toBe(0);
  });

  it('charges cost one each, shaped charges cost two, and taking one off refunds it', () => {
    const job = newJob(['charges-cap']);
    const a = piece(job, 'Column A · floor 1');
    const b = piece(job, 'Column B · floor 1');
    const start = job.left('charges');
    expect(job.commit(job.plan('charges', a.x + a.w / 2, 1, { piece: a.id })).ok).toBe(true);
    expect(job.left('charges')).toBe(start - 1);
    const shaped = job.plan('charges', b.x + b.w / 2, 1, { piece: b.id, charge: 'shaped' });
    expect(shaped.cost).toBe(SHAPED_COST);
    expect(job.commit(shaped).ok).toBe(true);
    expect(job.left('charges')).toBe(start - 1 - SHAPED_COST);
    // Placing is instant: the next move can go straight away.
    expect(job.ready).toBe(true);
    const off = job.plan('charges', a.x + a.w / 2, 1, { piece: a.id });
    expect(off.action).toBe('uncharge');
    expect(job.commit(off).ok).toBe(true);
    expect(job.left('charges')).toBe(start - SHAPED_COST);
    expect(job.moves.filter((m) => m.action === 'charge')).toHaveLength(1);
  });

  it('firing is free and the job is not over while charges are set', () => {
    const job = new Job({ ...contract, budgets: { charges: 1 } }, ['charges'], prepare('garage'), kitFor([]));
    const a = piece(job, 'Column A · floor 1');
    job.commit(job.plan('charges', a.x + a.w / 2, 1, { piece: a.id }));
    expect(job.left('charges')).toBe(0);
    expect(job.outOfMoves).toBe(false);
    const fire = job.planDetonate();
    expect(fire.cost).toBe(0);
    expect(job.commit(fire).ok).toBe(true);
    expect(job.phase).toBe('acting');
    job.settle();
    expect(job.sim.state.status[a.id]).not.toBe(PIECE_STANDING);
    expect(job.outOfMoves).toBe(true);
  });

  it('machines left off the job stay off site, so nothing can hit them', () => {
    const job = newJob();
    expect(job.sim.state.offsite).toEqual(['excavator', 'loader']);
  });

  it('a new job always starts on fresh budgets', () => {
    const one = newJob();
    const col = piece(one, 'Column A · floor 1');
    one.commit(one.plan('ball', col.x + col.w / 2, 1.5));
    const two = newJob();
    expect(two.left('ball')).toBe(contract.budgets.ball);
    expect(two.used).toBe(0);
  });

  it('replaying the command log reproduces the job exactly', () => {
    const job = newJob();
    const col = piece(job, 'Column A · floor 1');
    job.commit(job.plan('ball', col.x + col.w / 2, 1.5));
    job.settle();
    const c = piece(job, 'Column C · floor 1');
    job.commit(job.plan('ball', c.x + c.w / 2, 1.5));
    job.settle();
    const end = job.sim.state.tick;
    const replay = newJob();
    let k = 0;
    while (replay.sim.state.tick < end) {
      while (k < job.log.length && (job.log[k] as { tick: number }).tick === replay.sim.state.tick) replay.sim.command((job.log[k++] as (typeof job.log)[number]).cmd);
      replay.sim.step();
    }
    expect([...replay.sim.state.status]).toEqual([...job.sim.state.status]);
    expect(replay.sim.standingFraction).toBeCloseTo(job.sim.standingFraction, 6);
  });
});
