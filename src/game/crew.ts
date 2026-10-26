import type { MachineId } from '../data/fleet';
import { HEIGHTMAP, PIECE_STANDING } from '../wreck/sim';
import { CHARGE_KINDS } from '../wreck/tools';
import type { Job, MovePlan } from './moves';

/**
 * A crew that plays a job through the same move API as the player: plan,
 * check, commit. The tests use it to prove each contract can be finished
 * with its recommended loadout, and the smoke run uses it to drive the
 * live screen.
 */

const RANK: Record<MovePlan['verdict'], number> = { breaks: 3, heavy: 2, cracks: 1, none: 0 };

export function crewMove(job: Job): MovePlan | undefined {
  if (!job.ready) return undefined;
  const sim = job.sim;
  const s = sim.state;
  const c = job.contract;
  const has = (m: MachineId): boolean => job.left(m) > 0;
  if (job.placedCharges > 0 && (!has('charges') || job.placedCharges >= 3)) return job.planDetonate();
  if (sim.standingFraction > c.downAt) {
    const site = sim.h.site;
    // Low, load-bearing members, the side away from the neighbour first.
    const low = sim.def.pieces
      .filter((p) => s.status[p.id] === PIECE_STANDING && p.carriesOthers && p.y < 6 && p.kind !== 'beam' && p.kind !== 'roof')
      .sort((a, b) => a.y - b.y || a.x - b.x);
    if (has('charges')) {
      for (const p of low) {
        if (!CHARGE_KINDS.has(p.kind) || s.charges.some((ch) => ch.piece === p.id)) continue;
        const kind = s.kit.shaped && job.left('charges') >= 2 && (p.kind === 'core' || p.kind === 'stack') ? 'shaped' : 'cutter';
        const plan = job.plan('charges', p.x + p.w / 2, p.y + p.h * 0.3, { charge: kind, piece: p.id });
        if (plan.ok) return plan;
      }
    }
    if (job.placedCharges > 0) return job.planDetonate();
    let best: MovePlan | undefined;
    if (has('ball')) {
      const tried = new Set<number>();
      for (const p of low.slice(0, 10)) {
        if (tried.has(p.id)) continue;
        tried.add(p.id);
        const plan = job.plan('ball', p.x + p.w / 2, p.y + Math.min(p.h * 0.5, 1.8));
        if (plan.ok && (!best || RANK[plan.verdict] > RANK[best.verdict])) best = plan;
        if (best?.verdict === 'breaks') break;
      }
      if (best) return best;
    }
    if (has('excavator')) {
      const near = [...low].sort((a, b) => Math.abs(a.x - s.exc.x) - Math.abs(b.x - s.exc.x));
      for (const p of near.slice(0, 6)) {
        const plan = job.plan('excavator', p.x + p.w / 2, p.y + Math.min(p.h * 0.5, 2));
        if (plan.ok) return plan;
      }
    }
    if (has('dozer') && s.kit.ram) {
      const p = low[0];
      if (p) {
        const plan = job.plan('dozer', p.x - 1, 0, { dir: 1 });
        if (plan.ok) return plan;
      }
    }
    // Upper floors left standing: anything the ball can reach.
    if (has('ball')) {
      const any = sim.def.pieces.filter((p) => s.status[p.id] === PIECE_STANDING && p.carriesOthers).sort((a, b) => a.y - b.y);
      for (const p of any.slice(0, 12)) {
        const plan = job.plan('ball', p.x + p.w / 2, p.y + p.h / 2);
        if (plan.ok) return plan;
      }
    }
  }
  return clearMove(job);
}

function clearMove(job: Job): MovePlan | undefined {
  const sim = job.sim;
  const s = sim.state;
  const L = sim.h.site;
  // Salvage first: the loader lifts what is worth money.
  if (job.left('loader') > 0) {
    for (const b of s.blocks) {
      if (b.kind === 'slab' || b.mass > s.kit.lift || b.x < L.lotMin - 2 || b.x > L.lotMax + 2) continue;
      const plan = job.plan('loader', b.x, 0);
      if (plan.ok) return plan;
    }
  }
  // Stumps still standing on the lot stop the dozer: knock them out.
  const stumps = sim.def.pieces.filter((p) => s.status[p.id] === PIECE_STANDING && p.y < 2 && p.x > L.lotMin && p.x < L.lotMax);
  for (const p of stumps) {
    for (const m of ['ball', 'excavator'] as const) {
      if (job.left(m) <= 0) continue;
      const plan = job.plan(m, p.x + p.w / 2, p.y + Math.min(1.2, p.h / 2));
      if (plan.ok && plan.piece === p.id) return plan;
    }
  }
  // Heavy slabs in the way: break them.
  if (job.left('excavator') > 0) {
    for (const b of s.blocks) {
      if (b.kind === 'vault' || b.mass <= s.kit.heavyPush || b.x < L.lotMin || b.x > L.lotMax) continue;
      const plan = job.plan('excavator', b.x, b.y + b.h / 2);
      if (plan.ok) return plan;
    }
  }
  // The dozer takes the biggest run it can find.
  if (job.left('dozer') > 0) {
    let best: MovePlan | undefined;
    let bestArea = 0;
    const hm = s.heightmap;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < hm.length; i++) {
      const x = HEIGHTMAP.minX + i * HEIGHTMAP.cell;
      if (x < L.lotMin || x > L.lotMax || (hm[i] as number) < 0.05) continue;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    for (const b of s.blocks) {
      if (b.kind === 'vault' || b.x < L.lotMin || b.x > L.lotMax) continue;
      lo = Math.min(lo, b.x - b.w / 2);
      hi = Math.max(hi, b.x + b.w / 2);
    }
    if (Number.isFinite(lo)) {
      const pitRight = L.pitMin > L.lotMin;
      const towardPit: 1 | -1 = pitRight ? 1 : -1;
      const tries: Array<[number, 1 | -1]> = [
        [lo - 0.3, 1],
        [hi + 0.3, -1],
        [(lo + hi) / 2, towardPit],
      ];
      for (const [x, dir] of tries) {
        const plan = job.plan('dozer', x, 0, { dir });
        const area = plan.ok ? Number(/^(\d+)/.exec(plan.detail)?.[1] ?? 0) : 0;
        const ends = plan.title.includes('pit') || plan.title.includes('pad') ? 1.5 : 1;
        if (plan.ok && area * ends > bestArea) {
          bestArea = area * ends;
          best = plan;
        }
      }
    }
    if (best && bestArea >= 1) return best;
  }
  if (job.left('loader') > 0) {
    const hm = s.heightmap;
    let bx = 0;
    let bh = 0;
    for (let i = 0; i < hm.length; i++) {
      const x = HEIGHTMAP.minX + i * HEIGHTMAP.cell;
      if (x < L.lotMin || x > L.lotMax) continue;
      if ((hm[i] as number) > bh) {
        bh = hm[i] as number;
        bx = x;
      }
    }
    if (bh > 0.1) {
      const plan = job.plan('loader', bx, 0);
      if (plan.ok) return plan;
    }
  }
  return undefined;
}

/** Plays a job to the end with the crew. Returns how many moves it made. */
export function runCrew(job: Job, maxMoves = 60): number {
  let made = 0;
  for (let guard = 0; guard < maxMoves; guard++) {
    job.settle();
    const plan = crewMove(job);
    if (!plan) break;
    const r = job.commit(plan);
    if (!r.ok) break;
    made++;
  }
  job.settle();
  return made;
}

