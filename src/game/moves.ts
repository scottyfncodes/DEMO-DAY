import { MACHINES, type MachineId } from '../data/fleet';
import type { ContractDef } from '../data/contracts';
import type { Kit } from '../wreck/kit';
import {
  BOOM_FOOT_Y,
  CABLE_MAX,
  CABLE_MIN,
  DT,
  PIECE_STANDING,
  THETA_MAX,
  THETA_MIN,
  WreckSim,
  heightAt,
  type Command,
  type Halden,
  type WreckEvent,
} from '../wreck/sim';
import type { PieceDef } from '../wreck/structure';
import {
  BLADE,
  BLADE_H,
  CHARGE_KINDS,
  CHARGE_SPEC,
  DOZER_HALF,
  FLAW_SHOWN,
  LOADER_REACH,
  distToRect,
  dozerRange,
  dozerStart,
  excavatorReach,
  loaderDump,
  scoopAt,
  travelLimits,
  type ChargeKind,
} from '../wreck/tools';

/**
 * The move layer: every machine has a budget for the job, one token is one
 * move, and a move is planned (previewed, free), then committed (spent once,
 * never twice), then played out by the simulation until the site settles.
 */

export const BITES_PER_MOVE = 3;
/** How far one dozer run drives the blade (m). */
export const PUSH_RUN = 34;
/** Cost of a shaped charge in charge tokens. */
export const SHAPED_COST = 2;

export type ActionKind = 'swing' | 'drop' | 'charge' | 'uncharge' | 'detonate' | 'excavate' | 'push' | 'scoop';

export type Verdict = 'breaks' | 'heavy' | 'cracks' | 'none';

export interface MovePlan {
  machine: MachineId;
  action: ActionKind;
  ok: boolean;
  /** Why it cannot be done, when it cannot. */
  reason?: string;
  /** Tokens it costs (negative refunds). */
  cost: number;
  title: string;
  detail: string;
  verdict: Verdict;
  commands: Command[];
  /** Preview geometry, in world metres. */
  piece?: number;
  path?: number[];
  hitX?: number;
  hitY?: number;
  /** Members a charge's shock reaches. */
  affected?: number[];
  radius?: number;
  arrow?: { from: number; to: number; stop: number; y: number };
  jaw?: { x: number; y: number; standX: number };
  scoop?: { x: number; half: number; dumpX: number; dumpTo: 'pad' | 'pit' };
  /** Ball release point and hook for the swing preview. */
  release?: { bx: number; by: number; hx: number; hy: number };
}

export interface Budget {
  max: number;
  left: number;
}

export interface MoveRecord {
  n: number;
  machine: MachineId;
  action: ActionKind;
  tick: number;
  title: string;
  cost: number;
  /** Action number in the simulation (for chain credit), when it started one. */
  root: number;
  piece?: number;
}

export type JobPhase = 'ready' | 'acting' | 'settling';

/** Seconds the site has to be still before the next move. */
const QUIET = 0.5;
/** Longest wait for the site to settle before the next move is allowed anyway. */
const SETTLE_MAX = 5;

export interface PlanOptions {
  charge?: ChargeKind;
  dir?: 1 | -1;
  drop?: boolean;
  piece?: number;
}

export class Job {
  readonly sim: WreckSim;
  readonly contract: ContractDef;
  readonly loadout: MachineId[];
  readonly budgets: Partial<Record<MachineId, Budget>> = {};
  /** Every command with the tick it was given: replaying it reproduces the job exactly. */
  readonly log: Array<{ tick: number; cmd: Command }> = [];
  readonly moves: MoveRecord[] = [];
  phase: JobPhase = 'ready';
  private settleFrom = -1;

  constructor(contract: ContractDef, loadout: MachineId[], h: Halden, kit: Kit) {
    this.contract = contract;
    this.loadout = [...new Set(loadout)];
    this.sim = new WreckSim(undefined, h, kit);
    for (const m of this.loadout) {
      const max = contract.budgets[m] ?? MACHINES[m].baseMoves;
      this.budgets[m] = { max, left: max };
    }
  }

  /** Tokens spent so far (refunds taken back). */
  get used(): number {
    let n = 0;
    for (const b of Object.values(this.budgets)) if (b) n += b.max - b.left;
    return n;
  }

  get ready(): boolean {
    return this.phase === 'ready';
  }

  left(m: MachineId): number {
    return this.budgets[m]?.left ?? 0;
  }

  /** Charges strapped on but not yet fired. */
  get placedCharges(): number {
    return this.sim.state.charges.filter((c) => c.state === 0).length;
  }

  /** Nothing left to spend and nothing waiting to go off. */
  get outOfMoves(): boolean {
    if (this.placedCharges > 0) return false;
    return this.loadout.every((m) => this.left(m) <= 0);
  }

  // ------------------------------------------------------------- planning

  plan(machine: MachineId, x: number, y: number, opt: PlanOptions = {}): MovePlan {
    if (!this.budgets[machine]) return fail(machine, 'swing', `The ${MACHINES[machine].short.toLowerCase()} is not on this job.`);
    switch (machine) {
      case 'ball':
        return opt.drop ? this.planDrop(x, y) : this.planSwing(x, y);
      case 'charges':
        return this.planCharge(x, y, opt.charge ?? 'cutter', opt.piece);
      case 'excavator':
        return this.planExcavate(x, y);
      case 'dozer':
        return this.planPush(x, opt.dir);
      case 'loader':
        return this.planScoop(x);
    }
  }

  planDetonate(): MovePlan {
    const n = this.placedCharges;
    if (!n) return fail('charges', 'detonate', 'No charges set.');
    return { machine: 'charges', action: 'detonate', ok: true, cost: 0, title: `Fire ${n} charge${n === 1 ? '' : 's'}`, detail: 'They go off in the order you set them. Firing costs nothing.', verdict: 'none', commands: [{ kind: 'detonate' }] };
  }

  /** The standing piece under (x, y) on the building's face, if any. */
  pieceAt(x: number, y: number, filter?: (p: PieceDef) => boolean): number {
    const s = this.sim.state;
    let best = -1;
    let bestD = 0.6;
    for (const id of this.sim.query(x - 0.6, y - 0.6, x + 0.6, y + 0.6)) {
      if (s.status[id] !== PIECE_STANDING) continue;
      const p = this.sim.def.pieces[id] as PieceDef;
      if (filter && !filter(p)) continue;
      const d = distToRect(x, y, p.x, p.y, p.w, p.h);
      // Inside beats near; structure beats cladding when both are under the finger.
      const score = d - (p.carriesOthers ? 0.05 : 0);
      if (score < bestD) {
        bestD = score;
        best = id;
      }
    }
    return best;
  }

  private verdictFor(piece: number, energy: number): { verdict: Verdict; text: string } {
    const s = this.sim.state;
    const p = this.sim.def.pieces[piece] as PieceDef;
    const hp = Math.max(1, s.hp[piece] as number);
    const e = energy * (s.flaw[piece] === FLAW_SHOWN ? 2 : 1);
    if (e >= hp) return { verdict: 'breaks', text: `Breaks the ${shortName(p)}` };
    if (e >= hp * 0.45) return { verdict: 'heavy', text: `Heavy damage to the ${shortName(p)}` };
    return { verdict: 'cracks', text: `Cracks the ${shortName(p)}` };
  }

  private machineDown(machine: MachineId): string | undefined {
    const s = this.sim.state;
    const t = machine === 'excavator' ? s.exc.stunned : machine === 'dozer' ? s.dozer.stunned : machine === 'loader' ? s.loader.stunned : 0;
    return t > 0 ? `The ${MACHINES[machine].short.toLowerCase()} was hit by debris. Back in ${Math.ceil(t)} s.` : undefined;
  }

  private planSwing(x: number, y: number): MovePlan {
    const kit = this.sim.state.kit;
    if (y > kit.ballReach) return fail('ball', 'swing', `The boom reaches ${kit.ballReach} m. That is ${Math.round(y)} m up.`);
    const target = this.pieceAt(x, y);
    const probe = this.sim.probe();
    const s = probe.state;
    const R = probe.ballR;
    const boom = s.crane.boom;
    const minHook = BOOM_FOOT_Y + boom * Math.sin(THETA_MIN);
    const maxHook = BOOM_FOOT_Y + boom * Math.sin(THETA_MAX);
    type Cand = { score: number; hx: number; hy: number; bx: number; by: number; L: number; hit: number; hitX: number; hitY: number; speed: number; path: number[] };
    let best: Cand | undefined;
    const ty = Math.max(R + heightAt(s.heightmap, x) + 0.05, y);
    for (const L of [10, 13, 16, 19, 22, 26, 30]) {
      if (L < CABLE_MIN || L > CABLE_MAX) continue;
      const hy = ty + L;
      if (hy < minHook || hy > maxHook) continue;
      const hx = x - R * 0.4;
      const pose = probe.craneFor(hx, hy);
      if (typeof pose === 'string') continue;
      for (const ang of [1.3, 1.1, 0.9]) {
        const bx = hx - L * Math.sin(ang);
        const by = hy - L * Math.cos(ang);
        if (by - R < heightAt(s.heightmap, bx) + 0.2) continue;
        if (probe.pushOutOfStructure(bx, by, R)) continue;
        probe.setCraneExact(pose.baseX, pose.theta);
        s.ball.x = bx;
        s.ball.y = by;
        s.ball.vx = 0;
        s.ball.vy = 0;
        s.ball.cable = L;
        s.ball.aiming = true;
        const pr = probe.predict();
        if (pr.hitPiece < 0) continue;
        const d = Math.hypot(pr.hitX - x, pr.hitY - y);
        const score = -d * 2 + pr.speed * 0.25 + (pr.hitPiece === target ? 4 : 0);
        if (!best || score > best.score) best = { score, hx, hy, bx, by, L, hit: pr.hitPiece, hitX: pr.hitX, hitY: pr.hitY, speed: pr.speed, path: pr.path };
      }
    }
    if (!best) return fail('ball', 'swing', target >= 0 ? 'The crane cannot get a clean swing at that. Try lower, or from the open side.' : 'Nothing to hit there.');
    const energy = 0.5 * kit.ballMass * best.speed * best.speed;
    const v = this.verdictFor(best.hit, energy * 0.9);
    const p = this.sim.def.pieces[best.hit] as PieceDef;
    const other = target >= 0 && best.hit !== target ? ` (it meets the ${shortName(p)} first)` : '';
    return {
      machine: 'ball',
      action: 'swing',
      ok: true,
      cost: 1,
      title: `Swing at ${p.label}`,
      detail: `${v.text}${other}. ${Math.round(best.speed)} m/s, ${Math.round(energy)} kJ.`,
      verdict: v.verdict,
      piece: best.hit,
      path: best.path,
      hitX: best.hitX,
      hitY: best.hitY,
      release: { bx: best.bx, by: best.by, hx: best.hx, hy: best.hy },
      commands: [{ kind: 'swing', hx: best.hx, hy: best.hy, bx: best.bx, by: best.by, cable: best.L }],
    };
  }

  private planDrop(x: number, y: number): MovePlan {
    const kit = this.sim.state.kit;
    if (!kit.drop) return fail('ball', 'drop', 'Drop strikes need the Drop strike upgrade.');
    const target = this.pieceAt(x, y);
    if (target < 0) return fail('ball', 'drop', 'Drop on a roof or a floor slab.');
    const tp = this.sim.def.pieces[target] as PieceDef;
    const top = tp.y + tp.h;
    if (top > kit.ballReach) return fail('ball', 'drop', `The boom reaches ${kit.ballReach} m. That roof is ${Math.round(top)} m up.`);
    const probe = this.sim.probe();
    const s = probe.state;
    const R = probe.ballR;
    const boom = s.crane.boom;
    const maxHook = BOOM_FOOT_Y + boom * Math.sin(THETA_MAX);
    for (const fall of [12, 9, 6]) {
      const by = top + R + fall;
      const hy = by + 1.5;
      if (hy > maxHook) continue;
      const pose = probe.craneFor(x, hy);
      if (typeof pose === 'string') continue;
      if (probe.pushOutOfStructure(x, by, R)) continue;
      probe.setCraneExact(pose.baseX, pose.theta);
      const L = Math.min(CABLE_MAX, hy - top + 2.5);
      s.ball.x = x;
      s.ball.y = by;
      s.ball.cable = L;
      s.ball.aiming = true;
      const pr = probe.predict();
      if (pr.hitPiece < 0) continue;
      const energy = 0.5 * kit.ballMass * pr.speed * pr.speed;
      const p = this.sim.def.pieces[pr.hitPiece] as PieceDef;
      const v = this.verdictFor(pr.hitPiece, energy * 0.9);
      return {
        machine: 'ball',
        action: 'drop',
        ok: true,
        cost: 1,
        title: `Drop on ${p.label}`,
        detail: `${v.text}. Falls ${fall} m, ${Math.round(energy)} kJ.`,
        verdict: v.verdict,
        piece: pr.hitPiece,
        path: pr.path,
        hitX: pr.hitX,
        hitY: pr.hitY,
        release: { bx: x, by, hx: x, hy },
        commands: [{ kind: 'swing', hx: x, hy, bx: x, by, cable: L }],
      };
    }
    return fail('ball', 'drop', 'The crane cannot get above that.');
  }

  private planCharge(x: number, y: number, kind: ChargeKind, pieceHint?: number): MovePlan {
    const s = this.sim.state;
    const piece = pieceHint ?? this.pieceAt(x, y, (p) => CHARGE_KINDS.has(p.kind));
    const set = piece >= 0 ? s.charges.find((c) => c.state === 0 && c.piece === piece) : undefined;
    if (piece >= 0 && set) {
      const p = this.sim.def.pieces[piece] as PieceDef;
      const refund = set.kind === 'shaped' ? SHAPED_COST : 1;
      return { machine: 'charges', action: 'uncharge', ok: true, cost: -refund, title: `Take the charge off ${p.label}`, detail: `Gives back ${refund} charge${refund === 1 ? '' : 's'}.`, verdict: 'none', piece, commands: [{ kind: 'uncharge', id: set.id }] };
    }
    if (piece < 0) {
      const any = this.pieceAt(x, y);
      return fail('charges', 'charge', any >= 0 ? 'Cladding carries nothing. Charge the frame: columns, walls, slabs.' : 'Tap a column or wall to set a charge.');
    }
    if (kind === 'shaped' && !s.kit.shaped) return fail('charges', 'charge', 'Shaped charges need the licence.');
    const cost = kind === 'shaped' ? SHAPED_COST : 1;
    const p = this.sim.def.pieces[piece] as PieceDef;
    const spec = CHARGE_SPEC[kind];
    const radius = spec.radius * s.kit.chargeRadius;
    const cy = Math.max(p.y + 0.3, Math.min(p.y + p.h - 0.3, y));
    const cx = p.x + p.w / 2;
    const affected: number[] = [];
    for (const id of this.sim.query(cx - radius, cy - radius, cx + radius, cy + radius)) {
      if (id === piece || s.status[id] !== PIECE_STANDING) continue;
      const q = this.sim.def.pieces[id] as PieceDef;
      if (distToRect(cx, cy, q.x, q.y, q.w, q.h) <= radius) affected.push(id);
    }
    const v = this.verdictFor(piece, spec.main * s.kit.chargePower);
    const name = kind === 'cutter' ? 'Cutter' : kind === 'blast' ? 'Blast charge' : 'Shaped charge';
    return {
      machine: 'charges',
      action: 'charge',
      ok: true,
      cost,
      title: `${name} on ${p.label}`,
      detail: `${v.text} when fired. Shock reaches ${affected.length} part${affected.length === 1 ? '' : 's'} around it.`,
      verdict: v.verdict,
      piece,
      hitX: cx,
      hitY: cy,
      radius,
      affected,
      commands: [{ kind: 'charge', piece, charge: kind, y: cy }],
    };
  }

  private planExcavate(x: number, y: number): MovePlan {
    const down = this.machineDown('excavator');
    if (down) return fail('excavator', 'excavate', down);
    const s = this.sim.state;
    const r = excavatorReach(this.sim, x, y);
    const jaw = { x: r.jawX, y: r.jawY, standX: r.standX };
    const bite = s.kit.bite * BITES_PER_MOVE;
    const near = this.pieceAt(r.jawX, r.jawY);
    const reach = Math.round(3.4 + s.exc.l1 + s.exc.l2 - 2.5);
    const shortNote = r.short ? ` The arm only reaches about ${reach} m from there.` : '';
    if (near >= 0) {
      const p = this.sim.def.pieces[near] as PieceDef;
      const mult = p.material === 'steel' ? (s.kit.shears ? 2.2 : 0.6) : p.material === 'brick' ? 1.3 : p.material === 'wood' ? 1.4 : 1;
      const v = this.verdictFor(near, bite * mult * (p.kind === 'core' || p.kind === 'stack' ? (s.kit.shears ? 1.7 : 1.25) : 1));
      return { machine: 'excavator', action: 'excavate', ok: true, cost: 1, title: `Crunch ${p.label}`, detail: `${v.text} in three bites.${shortNote}`, verdict: v.verdict, piece: near, jaw, commands: [{ kind: 'excavate', x, y, bites: BITES_PER_MOVE }] };
    }
    const blk = s.blocks
      .filter((b) => Math.abs(b.x - r.jawX) < b.w / 2 + 0.9 && r.jawY < Math.max(b.y + b.h, heightAt(s.heightmap, r.jawX) + 0.6) + 0.9)
      .sort((p, q) => Math.abs(p.x - r.jawX) - Math.abs(q.x - r.jawX))[0];
    if (blk && blk.kind !== 'vault') {
      const dmg = s.kit.bite * BITES_PER_MOVE * (blk.material === 'steel' ? (s.kit.shears ? 3.5 : 0.6) : 1);
      return { machine: 'excavator', action: 'excavate', ok: true, cost: 1, title: `Break the ${blk.label.toLowerCase()}`, detail: dmg >= blk.hp ? `Splits it into pieces the dozer can push.${shortNote}` : `Weakens it; another crunch will split it.${shortNote}`, verdict: dmg >= blk.hp ? 'breaks' : 'heavy', jaw, commands: [{ kind: 'excavate', x, y, bites: BITES_PER_MOVE }] };
    }
    const section = s.bodies.find((b) => b.state !== 'rubble' && Math.hypot(b.x - r.jawX, b.y - r.jawY) < b.radius + 0.9);
    if (section) return { machine: 'excavator', action: 'excavate', ok: true, cost: 1, title: 'Pull at the hung-up section', detail: `Bites into it and drags it loose.${shortNote}`, verdict: 'heavy', jaw, commands: [{ kind: 'excavate', x, y, bites: BITES_PER_MOVE }] };
    if (blk?.kind === 'vault') return fail('excavator', 'excavate', `The jaws would crush the ${blk.label.toLowerCase()}. Lift it with the loader or push it to the pad.`);
    return fail('excavator', 'excavate', r.short ? `Out of reach. The arm reaches about ${reach} m.` : 'Nothing for the jaws to bite there.');
  }

  private planPush(x: number, dirOpt?: 1 | -1): MovePlan {
    const down = this.machineDown('dozer');
    if (down) return fail('dozer', 'push', down);
    const sim = this.sim;
    const s = sim.state;
    const L = sim.h.site;
    const padC = (L.padMin + L.padMax) / 2;
    const pitC = (L.pitMin + L.pitMax) / 2;
    // By default the blade drives through the bulk of the heap; on a tie, toward the nearer drop zone.
    let ahead = 0;
    let behind = 0;
    for (let u = 0.25; u < PUSH_RUN; u += 0.5) {
      ahead += heightAt(s.heightmap, x + u);
      behind += heightAt(s.heightmap, x - u);
    }
    for (const b of s.blocks) if (b.mass <= s.kit.heavyPush && Math.abs(b.x - x) < PUSH_RUN) (b.x > x ? (ahead += b.area * 2) : (behind += b.area * 2));
    const nearer: 1 | -1 = Math.abs(x - pitC) <= Math.abs(x - padC) ? (pitC >= x ? 1 : -1) : padC >= x ? 1 : -1;
    const dir: 1 | -1 = dirOpt ?? (Math.abs(ahead - behind) < 0.5 ? nearer : ahead > behind ? 1 : -1);
    const range = dozerRange(sim);
    const reach = DOZER_HALF + BLADE;
    const from = Math.max(range.minX + reach, Math.min(range.maxX + reach, x));
    let to = from + dir * PUSH_RUN;
    to = Math.max(range.minX - reach + 2 * reach, Math.min(range.maxX + reach, to));
    if (dir < 0) to = Math.max(range.minX - 0.5, to);
    // Can the dozer get behind it?
    const start = dozerStart(from, dir);
    const lim = travelLimits(sim, s.dozer.x, DOZER_HALF, BLADE_H);
    const blockedStart = start < lim.min - 0.2 || start > lim.max + 0.2;
    const pushFrom = blockedStart ? (dir > 0 ? Math.max(lim.min, Math.min(lim.max, start)) + reach + 0.4 : Math.max(lim.min, Math.min(lim.max, start)) - reach - 0.4) : from;
    // What stops the blade along the way.
    let stop = to;
    let stopWhy = '';
    let ram = -1;
    for (const id of sim.h.lowPieces) {
      if (s.status[id] !== PIECE_STANDING) continue;
      const p = sim.def.pieces[id] as PieceDef;
      if (p.y > BLADE_H) continue;
      const near = dir > 0 ? p.x : p.x + p.w;
      if (dir > 0 ? near < pushFrom - 0.05 || near > stop : near > pushFrom + 0.05 || near < stop) continue;
      stop = near;
      stopWhy = s.kit.ram ? `Rams ${p.label}` : `Stops at ${p.label}`;
      ram = id;
    }
    for (const b of s.blocks) {
      if (b.mass <= s.kit.heavyPush) continue;
      const edge = b.x - (dir * b.w) / 2;
      if (dir > 0 ? edge < pushFrom || edge > stop : edge > pushFrom || edge < stop) continue;
      stop = edge;
      stopWhy = `Stops at a ${Math.round(b.mass)} t ${b.label.toLowerCase()} (blade pushes up to ${s.kit.heavyPush} t)`;
      ram = -1;
    }
    let area = 0;
    const lo = Math.min(pushFrom, stop);
    const hi = Math.max(pushFrom, stop);
    for (let xx = lo; xx < hi; xx += 0.5) area += heightAt(s.heightmap, xx) * 0.5;
    for (const b of s.blocks) if (b.x > lo && b.x < hi && b.mass <= s.kit.heavyPush) area += b.area;
    if (area < 0.25 && !(ram >= 0 && s.kit.ram)) {
      return fail('dozer', 'push', blockedStart ? 'The building is in the way. The dozer cannot get there yet.' : stopWhy ? `${stopWhy}. Nothing to push before it.` : 'Nothing to push here.');
    }
    const ends = stop > L.pitMin - 1 && stop < L.pitMax + 3 ? 'into the pit' : stop > L.padMin - 3 && stop < L.padMax + 1 ? 'onto the pad' : 'across the lot';
    const cap = s.kit.bladeCap;
    const spill = area > cap ? ` The blade holds about ${Math.round(cap)} m²; the rest spills behind it.` : '';
    return {
      machine: 'dozer',
      action: 'push',
      ok: true,
      cost: 1,
      title: `Push ${dir > 0 ? 'right' : 'left'} ${ends}`,
      detail: `${Math.round(area)} m² of rubble in the way.${spill}${stopWhy ? ` ${stopWhy}.` : ''}${blockedStart ? ' Starts where it can get to.' : ''}`,
      verdict: area > 2 ? 'heavy' : 'cracks',
      piece: ram >= 0 ? ram : undefined,
      arrow: { from: pushFrom, to, stop, y: 0 },
      commands: [{ kind: 'push', from: pushFrom, to: stop === to ? to : stop + dir * 0.5 }],
    };
  }

  private planScoop(x: number): MovePlan {
    const down = this.machineDown('loader');
    if (down) return fail('loader', 'scoop', down);
    const sim = this.sim;
    const s = sim.state;
    const l = s.loader;
    const face: 1 | -1 = x >= l.x ? 1 : -1;
    const stand = x - face * LOADER_REACH;
    const lim = travelLimits(sim, l.x, 2.4, 2);
    if (stand < lim.min - 0.3 || stand > lim.max + 0.3) return fail('loader', 'scoop', 'The building is in the way. The loader cannot get there yet.');
    const take = scoopAt(sim, x);
    if (!take.block && take.area < 0.15) {
      return fail('loader', 'scoop', take.heavy ? `The ${take.heavy.label.toLowerCase()} is ${Math.round(take.heavy.mass)} t. The loader lifts up to ${s.kit.lift} t.` : 'Nothing to scoop here.');
    }
    const valuable = !!take.block && take.block.kind !== 'slab';
    const dump = loaderDump(sim, stand, valuable);
    if (!dump) return fail('loader', 'scoop', 'No way through to the pad or the pit from there.');
    const what = take.block ? `Lifts the ${take.block.label.toLowerCase()}${take.area > 0.2 ? ` and ${take.area.toFixed(1)} m² of rubble` : ''}` : `Scoops ${take.area.toFixed(1)} m² of rubble`;
    const pays = dump.to === 'pad' && (valuable || s.kit.sorter) ? ' Pays on the pad.' : take.block?.kind === 'steel' || take.block?.kind === 'vault' ? ' Lost to the pit: no way to the pad.' : '';
    return {
      machine: 'loader',
      action: 'scoop',
      ok: true,
      cost: 1,
      title: take.block ? `Recover the ${take.block.label.toLowerCase()}` : 'Scoop and haul',
      detail: `${what}, to the ${dump.to}.${pays}`,
      verdict: 'heavy',
      scoop: { x, half: 1.2 + s.kit.bucket * 0.045, dumpX: dump.x, dumpTo: dump.to },
      commands: [{ kind: 'scoop', x }],
    };
  }

  // ------------------------------------------------------------ committing

  /**
   * Spends the move and starts it. Refuses while the last move is still
   * playing out, when the plan is not valid, or when the budget is short.
   * The phase changes before anything else happens, so a second tap in the
   * same frame cannot spend twice.
   */
  commit(plan: MovePlan): { ok: boolean; reason?: string } {
    if (!plan.ok) return { ok: false, reason: plan.reason ?? 'That will not work.' };
    if (this.phase !== 'ready') return { ok: false, reason: 'Wait for the site to settle.' };
    const b = this.budgets[plan.machine];
    if (!b) return { ok: false, reason: 'That machine is not on this job.' };
    if (plan.cost > 0 && b.left < plan.cost) return { ok: false, reason: `No ${MACHINES[plan.machine].moves} left.` };
    if (plan.cost < 0 && b.left - plan.cost > b.max) return { ok: false, reason: 'Nothing to refund.' };
    const instant = plan.action === 'charge' || plan.action === 'uncharge';
    // Re-validate charge placement against the live state (the plan may be stale).
    if (plan.action === 'charge') {
      const c = plan.commands[0];
      if (c && c.kind === 'charge' && this.sim.state.charges.some((x) => x.piece === c.piece && x.state < 2)) return { ok: false, reason: 'That part already has a charge.' };
    }
    if (!instant) this.phase = 'acting';
    const actionsBefore = this.sim.state.actions;
    for (const cmd of plan.commands) {
      const err = this.issue(cmd);
      if (err) {
        this.phase = 'ready';
        return { ok: false, reason: err };
      }
    }
    b.left = Math.max(0, Math.min(b.max, b.left - plan.cost));
    if (plan.cost > 0 || plan.action === 'detonate') {
      this.moves.push({ n: this.moves.length + 1, machine: plan.machine, action: plan.action, tick: this.sim.state.tick, title: plan.title, cost: plan.cost, root: this.sim.state.actions > actionsBefore ? this.sim.state.actions : 0, piece: plan.piece });
    } else if (plan.action === 'uncharge') {
      // A refunded charge is no longer a move.
      for (let i = this.moves.length - 1; i >= 0; i--) {
        const m = this.moves[i];
        if (m && m.action === 'charge' && m.piece === plan.piece) {
          this.moves.splice(i, 1);
          break;
        }
      }
      this.moves.forEach((m, i) => (m.n = i + 1));
    }
    this.settleFrom = -1;
    return { ok: true };
  }

  private issue(cmd: Command): string | undefined {
    const err = this.sim.command(cmd);
    if (!err) this.log.push({ tick: this.sim.state.tick, cmd });
    return err;
  }

  // -------------------------------------------------------------- stepping

  /** Advances the simulation one tick and keeps the phase honest. */
  step(): WreckEvent[] {
    const events = this.sim.step();
    const s = this.sim.state;
    if (this.phase === 'acting') {
      const burning = s.charges.some((c) => c.state === 1);
      if (!this.sim.machinesBusy && !burning) {
        this.phase = 'settling';
        this.settleFrom = s.tick;
      }
    } else if (this.phase === 'settling') {
      const waited = (s.tick - this.settleFrom) * DT;
      if (s.quietFor >= QUIET || waited >= SETTLE_MAX) this.phase = 'ready';
    }
    return events;
  }

  /** Steps until the next move can be made (tests and skipping). */
  settle(maxSeconds = 30): void {
    const end = this.sim.state.tick + maxSeconds / DT;
    while (this.phase !== 'ready' && this.sim.state.tick < end) this.step();
  }
}

function fail(machine: MachineId, action: ActionKind, reason: string): MovePlan {
  return { machine, action, ok: false, reason, cost: 0, title: '', detail: reason, verdict: 'none', commands: [] };
}

/** "Column B · floor 1" → "column", "Core wall · floor 2" → "core wall". */
export function shortName(p: PieceDef): string {
  const base = p.label.split(' · ')[0] ?? p.label;
  const words = base.replace(/ [A-P](–[A-P])?$/, '').replace(/ [A-P]$/, '');
  return words.toLowerCase();
}
