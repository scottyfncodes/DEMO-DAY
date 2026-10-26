import { DOWN_AT, jobStatus } from './job';
import { BALL_MASS, PIECE_STANDING, craneHook, heightAt, WreckSim, type Command } from './sim';
import type { PieceDef } from './structure';
import { HEAVY_BLOCK, SITE_LAYOUT, dozerBlade, vaultBlock, type Block, type ChargeKind } from './tools';

/**
 * A crew that plays the whole job: charges, swings, the excavator and the
 * dozer. Automation only: the tests use it to prove a job can be finished
 * end to end, and the smoke test lets it drive the live screen.
 */

/** Searches crane positions and pulls for the hardest hit on the most heavily loaded piece in reach. */
export function planSwing(sim: WreckSim): { hx: number; hy: number; px: number; py: number; piece: number } | undefined {
  let best: { s: number; hx: number; hy: number; px: number; py: number; piece: number } | undefined;
  for (let hx = -8; hx <= 40; hx += 3) {
    for (let hy = 24; hy <= 62; hy += 4) {
      const probe = new WreckSim(structuredClone(sim.state), sim.h);
      probe.setHookTarget(hx, hy);
      probe.settleCrane();
      const hk = craneHook(probe.state.crane);
      for (const L of [10, 16, 22, 28]) {
        for (const ang of [-0.6, -0.9, -1.2]) {
          probe.aim(hk.x + Math.sin(ang) * L, hk.y - Math.cos(ang) * L);
          const pr = probe.predict();
          if (pr.hitPiece < 0) continue;
          const e = 0.5 * BALL_MASS * pr.speed * pr.speed;
          const p = sim.def.pieces[pr.hitPiece] as PieceDef;
          const sc = (p.carriesOthers ? (probe.solution.load[pr.hitPiece] as number) : 1) * Math.min(1, e / 600);
          if (!best || sc > best.s) best = { s: sc, hx, hy, px: probe.state.ball.x - hk.x, py: probe.state.ball.y - hk.y, piece: pr.hitPiece };
        }
      }
    }
  }
  return best;
}

export type Strategy = 'blast' | 'ball' | 'mixed';

const PLANS: Record<Strategy, Array<{ label: string; kind: ChargeKind }>> = {
  // Cut the left of the tower at street level so it drops away from Pellow's.
  blast: [
    { label: 'Column E · floor 1', kind: 'cutter' },
    { label: 'Column F · floor 1', kind: 'cutter' },
    { label: 'Column G · floor 1', kind: 'cutter' },
    { label: 'Core wall · floor 3', kind: 'blast' },
    { label: 'Column H · floor 2', kind: 'blast' },
  ],
  ball: [],
  mixed: [
    { label: 'Column F · floor 4', kind: 'cutter' },
    { label: 'Column G · floor 4', kind: 'cutter' },
    { label: 'Column H · floor 4', kind: 'blast' },
  ],
};

interface Wait {
  until: (sim: WreckSim) => boolean;
  max: number;
}

export class Crew {
  phase: 'charges' | 'ball' | 'excavate' | 'doze' | 'done' = 'charges';
  private wait?: Wait & { started: number };
  private swing?: { hx: number; hy: number; px: number; py: number; at: number };
  private target?: { kind: 'piece' | 'block' | 'body'; id: number; since: number };
  private doze?: { side: -1 | 1; leg: 'back' | 'push'; since: number };
  private fixing?: number;
  private skip = new Set<string>();
  swings = 0;

  constructor(readonly strategy: Strategy = 'mixed') {}

  /** Commands to issue now. Call once per simulation tick or so. */
  tick(sim: WreckSim): Command[] {
    const s = sim.state;
    if (this.wait) {
      const elapsed = s.time - this.wait.started;
      if (!this.wait.until(sim) && elapsed < this.wait.max) return [];
      this.wait = undefined;
    }
    const st = jobStatus(sim);
    if (st.complete || st.overtime) this.phase = 'done';
    switch (this.phase) {
      case 'charges':
        return this.charges(sim);
      case 'ball':
        return this.ball(sim, st.standing);
      case 'excavate':
        return this.excavate(sim);
      case 'doze':
        return this.dozeStep(sim);
      default:
        return [];
    }
  }

  private waitFor(sim: WreckSim, until: (sim: WreckSim) => boolean, max: number): void {
    this.wait = { until, max, started: sim.state.time };
  }

  private quiet = (sim: WreckSim): boolean => sim.state.quietFor > 1.2 && !sim.state.charges.some((c) => c.state === 1);

  private charges(sim: WreckSim): Command[] {
    const plan = PLANS[this.strategy];
    this.phase = 'ball';
    if (!plan.length) return [];
    const out: Command[] = [];
    for (const step of plan) {
      const p = sim.def.pieces.find((q) => q.label === step.label);
      if (p) out.push({ kind: 'charge', piece: p.id, charge: step.kind, y: p.y + p.h * 0.4 });
    }
    out.push({ kind: 'detonate' });
    this.waitFor(sim, (x) => x.state.time > 4 && this.quiet(x), 40);
    return out;
  }

  private ball(sim: WreckSim, standing: number): Command[] {
    if (standing <= DOWN_AT || this.swings >= 16) {
      this.phase = 'excavate';
      return [];
    }
    if (!this.swing) {
      const plan = planSwing(sim);
      if (!plan) {
        this.phase = 'excavate';
        return [];
      }
      this.swing = { ...plan, at: sim.state.time };
      const [hx, hy] = [plan.hx, plan.hy];
      this.waitFor(sim, (x) => Math.hypot(craneHook(x.state.crane).x - hx, craneHook(x.state.crane).y - hy) < 0.3, 12);
      return [{ kind: 'hook', x: hx, y: hy }];
    }
    const sw = this.swing;
    this.swing = undefined;
    this.swings++;
    const hk = craneHook(sim.state.crane);
    sim.aim(hk.x + sw.px, hk.y + sw.py);
    const b = sim.state.ball;
    const at = sim.state.time;
    // Let the swing land and whatever it starts settle before the next one.
    this.waitFor(sim, (x) => x.state.time > at + 2.5 && Math.hypot(x.state.ball.vx, x.state.ball.vy) < 2.5 && this.quiet(x), 25);
    return [{ kind: 'release', x: b.x, y: b.y, cable: b.cable }];
  }

  /** The next stump, hung-up section or heavy block for the excavator, nearest first. */
  private nextTarget(sim: WreckSim): Crew['target'] {
    const s = sim.state;
    const ex = s.exc.x;
    let best: { kind: 'piece' | 'block' | 'body'; id: number; d: number } | undefined;
    for (const p of sim.def.pieces) {
      if (s.status[p.id] !== PIECE_STANDING || p.x < SITE_LAYOUT.lotMin || p.x > SITE_LAYOUT.lotMax) continue;
      if (p.y > 20 || this.skip.has(`piece${p.id}`)) continue;
      // Nearest first: whatever is closest is also what blocks the way to the rest.
      const d = Math.abs(p.x + p.w / 2 - ex) + p.y * 0.3;
      if (!best || d < best.d) best = { kind: 'piece', id: p.id, d };
    }
    for (const b of s.bodies) {
      if (b.state !== 'perched' || b.y > 20 || this.skip.has(`body${b.id}`)) continue;
      const d = Math.abs(b.x - ex) - 40;
      if (!best || d < best.d) best = { kind: 'body', id: b.id, d };
    }
    if (!best) {
      for (const b of s.blocks) {
        if (b.kind !== 'slab' || b.mass <= HEAVY_BLOCK || this.skip.has(`block${b.id}`)) continue;
        const d = Math.abs(b.x - ex);
        if (!best || d < best.d) best = { kind: 'block', id: b.id, d };
      }
    }
    return best ? { kind: best.kind, id: best.id, since: s.time } : undefined;
  }

  private targetPoint(sim: WreckSim, t: NonNullable<Crew['target']>): { x: number; y: number } | undefined {
    const s = sim.state;
    if (t.kind === 'piece') {
      if (s.status[t.id] !== PIECE_STANDING) return undefined;
      const p = sim.def.pieces[t.id] as PieceDef;
      const x = p.x + p.w / 2;
      // Above the rubble it may be half buried in.
      return { x, y: Math.min(p.y + p.h - 0.3, Math.max(p.y + Math.min(p.h * 0.5, 2.5), heightAt(s.heightmap, x) + 0.6)) };
    }
    if (t.kind === 'body') {
      const b = s.bodies.find((q) => q.id === t.id);
      if (!b || b.state === 'rubble') return undefined;
      return { x: b.x, y: b.y };
    }
    const b = s.blocks.find((q) => q.id === t.id);
    return b ? { x: b.x, y: b.y + b.h / 2 } : undefined;
  }

  private excavate(sim: WreckSim): Command[] {
    const s = sim.state;
    if (s.exc.stunned > 0) return [];
    let pt = this.target ? this.targetPoint(sim, this.target) : undefined;
    if (!pt || (this.target && s.time - this.target.since > 9)) {
      if (pt && this.target) this.skip.add(`${this.target.kind}${this.target.id}`);
      this.target = this.nextTarget(sim);
      pt = this.target ? this.targetPoint(sim, this.target) : undefined;
      if (!pt) {
        this.phase = 'doze';
        return s.exc.biting ? [{ kind: 'bite', on: false }, { kind: 'exc', x: 60, y: 6 }] : [{ kind: 'exc', x: 60, y: 6 }];
      }
      return [{ kind: 'bite', on: false }, { kind: 'exc', x: pt.x, y: pt.y }];
    }
    const close = Math.hypot(s.exc.jawX - pt.x, s.exc.jawY - pt.y) < 1.2;
    const out: Command[] = [{ kind: 'exc', x: pt.x, y: pt.y }];
    if (close && !s.exc.biting) out.push({ kind: 'bite', on: true });
    return out;
  }

  /** Breaks whatever heavy block stalled the dozer, then lets it carry on. */
  private fixStall(sim: WreckSim): Command[] | undefined {
    const s = sim.state;
    const d = s.dozer;
    if (this.fixing !== undefined) {
      const b = s.blocks.find((q) => q.id === this.fixing);
      if (!b || s.exc.stunned > 0) {
        this.fixing = undefined;
        return [{ kind: 'bite', on: false }, { kind: 'exc', x: 60, y: 6 }];
      }
      const close = Math.hypot(s.exc.jawX - b.x, s.exc.jawY - (b.y + b.h / 2)) < 1.4;
      const out: Command[] = [{ kind: 'exc', x: b.x, y: b.y + b.h / 2 }];
      if (close && !s.exc.biting) out.push({ kind: 'bite', on: true });
      return out;
    }
    if (d.stall !== 'heavy') return undefined;
    const f = dozerBlade(d);
    const ahead = s.blocks
      .filter((b) => b.kind !== 'vault' && d.dir * (b.x - f) > -0.5 && Math.abs(b.x - f) < 12)
      .sort((a, b) => b.mass - a.mass)[0] as Block | undefined;
    if (!ahead) return undefined;
    this.fixing = ahead.id;
    return [{ kind: 'dozer', x: d.x - d.dir * 4 }];
  }

  private dozeStep(sim: WreckSim): Command[] {
    const s = sim.state;
    const d = s.dozer;
    const L = SITE_LAYOUT;
    if (d.stunned > 0) return [];
    const fix = this.fixStall(sim);
    if (fix) return fix;
    const vault = vaultBlock(sim);
    const split = vault ? vault.x : 30;
    const hm = s.heightmap;
    // Material left on each side of the split.
    const sideLeft = (x: number): boolean => x < split + (vault ? 2 : 0);
    let leftWork = 0;
    let rightWork = 0;
    for (let x = L.lotMin; x <= L.lotMax; x += 0.5) {
      const i = Math.round((x + 90) / 0.5);
      const a = (hm[i] as number) * 0.5;
      if (sideLeft(x)) leftWork += a;
      else rightWork += a;
    }
    for (const b of s.blocks) {
      if (b.x < L.lotMin || b.x > L.lotMax) continue;
      if (sideLeft(b.x) || b.kind !== 'slab') leftWork += b.area + (b.kind === 'vault' ? 10 : 0);
      else rightWork += b.area;
    }
    const side: -1 | 1 = leftWork > 0.6 ? -1 : 1;
    if (side === 1 && rightWork < 0.6 && leftWork < 0.6) {
      this.phase = 'done';
      return [];
    }
    const out: Command[] = [];
    if (d.dir !== side) {
      out.push({ kind: 'turn' });
      this.doze = undefined;
      return out;
    }
    // Push from the far end of the material toward the exit on this side.
    if (!this.doze || this.doze.side !== side) this.doze = { side, leg: 'back', since: s.time };
    const exit = side < 0 ? L.padMax - 1.5 : L.pitMin + 1.5;
    let far: number = side < 0 ? L.padMax : L.pitMin;
    for (let x = L.lotMin; x <= L.lotMax; x += 0.5) {
      const i = Math.round((x + 90) / 0.5);
      if ((hm[i] as number) < 0.04) continue;
      if (side < 0 && sideLeft(x)) far = Math.max(far, x);
      if (side > 0 && !sideLeft(x)) far = Math.min(far, x);
    }
    for (const b of s.blocks) {
      if (b.x < L.lotMin || b.x > L.lotMax) continue;
      if (side < 0 && (sideLeft(b.x) || b.kind !== 'slab')) far = Math.max(far, b.x + b.w / 2);
      if (side > 0 && !sideLeft(b.x) && b.kind === 'slab') far = Math.min(far, b.x - b.w / 2);
    }
    const bladeOff = 3.25;
    if (this.doze.leg === 'back') {
      // Reverse past the material (the dozer rides over it), then turn to push.
      const startX = far - side * (bladeOff + 0.6);
      if (Math.abs(d.x - startX) < 0.3 || s.time - this.doze.since > 14) this.doze = { side, leg: 'push', since: s.time };
      return [{ kind: 'dozer', x: startX }];
    }
    const endX = exit - side * bladeOff;
    if (Math.abs(d.x - endX) < 0.4 || s.time - this.doze.since > 22 || (d.speed === 0 && s.time - this.doze.since > 3)) this.doze = { side, leg: 'back', since: s.time };
    return [{ kind: 'dozer', x: endX }];
  }
}

/** Plays a whole job headlessly. Returns the finished simulation. */
export function playJob(strategy: Strategy, maxSeconds = 600): WreckSim {
  const sim = new WreckSim();
  const crew = new Crew(strategy);
  const limit = Math.round(maxSeconds * 60);
  for (let t = 0; t < limit && crew.phase !== 'done'; t++) {
    for (const c of crew.tick(sim)) sim.command(c);
    sim.step();
  }
  return sim;
}
