import { it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { CAMPAIGN, PRECISION, SCORE_ATTACK, dailyLevel, type LevelDef, type PowerUpId } from '../../src/golf/sim/levels';
import { Session, playScript } from '../../src/golf/sim/session';
import { solveAim } from '../../src/golf/sim/aim';
import { PartState, type Part } from '../../src/golf/sim/parts';
import type { BallId } from '../../src/golf/sim/balls';
import type { Shot } from '../../src/golf/sim/world';

type S = Shot & { powerups?: PowerUpId[] };

/** Candidate aim points for a level from the current state. */
function targets(s: Session): Array<{ x: number; y: number; z: number }> {
  const out: Array<{ x: number; y: number; z: number }> = [];
  const P = s.world.parts;
  const up = (p: Part) => p.state === PartState.Intact;
  for (const p of P) {
    if (!up(p)) continue;
    if (p.kind === 'glass' && p.wall === 'front') out.push({ x: p.x, y: p.y, z: p.z + 0.02 }, { x: p.x, y: p.y + 0.3, z: p.z }, { x: p.x, y: p.y - 0.3, z: p.z });
    if (p.kind === 'door') out.push({ x: p.x, y: p.y, z: p.z }, { x: p.x, y: p.y + 0.5, z: p.z });
    if (p.kind === 'column') out.push({ x: p.x, y: p.y, z: p.z + 0.12 }, { x: p.x, y: p.y - 0.4, z: p.z + 0.12 });
    if (p.tags.includes('chimney') && p.kind === 'brick' && p.y < 1.6 && p.x < 5.5) out.push({ x: p.x + p.hx, y: p.y, z: p.z + p.hz }, { x: p.x + p.hx, y: p.y + p.hy, z: p.z + p.hz });
    if (p.kind === 'decor') out.push({ x: p.x, y: p.y, z: p.z + p.hz });
    if (p.kind === 'tile' && Math.abs(p.x) < 4 && p.tags.includes('roof-front')) out.push({ x: p.x, y: p.y, z: p.z });
    if (p.kind === 'brick' && p.wall === 'front' && p.y > s.world.info.wallTop - 0.65) out.push({ x: p.x, y: p.y, z: 0 });
  }
  // A grid over the front wall, including joints.
  for (let x = -4.2; x <= 4.21; x += 0.3) for (let y = 0.75; y <= s.world.info.wallTop; y += 0.3) out.push({ x, y, z: 0.0 });
  for (let x = -4.2; x <= 4.21; x += 0.6) for (let y = 0.9; y <= s.world.info.wallTop; y += 0.3) out.push({ x, y: y, z: 0.0 });
  return out;
}

function value(s: Session): number {
  let v = 0;
  for (const o of s.level.objectives) {
    const [a, b] = s.progress(o);
    v += Math.min(1, a / b) * 1000;
  }
  return v + s.score * 0.01;
}

function search(level: LevelDef, maxShots: number, rngSeed: number): S[] | null {
  const plan: S[] = [];
  const balls = (['standard', ...Object.keys(level.balls)] as BallId[]).filter((b) => b !== 'blast' || true);
  for (let k = 0; k < maxShots; k++) {
    const base = playScript(level, plan);
    if (base.result?.complete) return plan;
    const cands = targets(base);
    let best: { shot: S; v: number } | null = null;
    const baseV = value(base);
    let tried = 0;
    // Deterministic subsample.
    const step = Math.max(1, Math.floor(cands.length / Number(process.env.CANDS ?? 90)));
    for (let i = (rngSeed + k) % step; i < cands.length; i += step) {
      const t = cands[i]!;
      for (const ball of balls) {
        if (!base.canUse(ball)) continue;
        for (const power of (process.env.POWERS ?? '0.72,0.86,1').split(',').map(Number)) {
          const pus: PowerUpId[][] = [[]];
          for (const p of Object.keys(level.powerups) as PowerUpId[]) if ((base.powerups[p] ?? 0) > 0 && p !== 'precision') pus.push([p]);
          for (const pu of pus) {
            const shot = solveAim(base.world, ball, t, power, base.mods());
            if (!shot) continue;
            const cand: S = { ...shot, powerups: pu.length ? pu : undefined };
            const s = playScript(level, [...plan, cand]);
            tried++;
            const v = value(s) + (s.result?.complete ? 100000 : 0);
            if (!best || v > best.v) best = { shot: cand, v };
          }
        }
      }
    }
    if (!best || best.v <= baseV) return null;
    plan.push(best.shot);
    console.log(level.id, 'shot', k + 1, 'value', best.v.toFixed(0), 'tried', tried);
    if (best.v >= 100000) return plan;
  }
  const end = playScript(level, plan);
  return end.result?.complete ? plan : null;
}

it('search solutions', () => {
  const only = process.env.LEVELS?.split(',');
  // DAILY=2026-10-28,2026-10-29 checks generated daily challenges instead (within their shot budget).
  const daily = process.env.DAILY?.split(',').map((d) => dailyLevel(d));
  const levels = daily ?? [...CAMPAIGN, ...PRECISION].filter((l) => !only || only.includes(l.id));
  const out: Record<string, S[]> = {};
  for (const l of levels) {
    const t0 = performance.now();
    const sol = search(l, daily ? l.shots : l.par + 2, 1);
    const round = (s: S) => ({ ...s, yaw: Math.round(s.yaw * 1e4) / 1e4, pitch: Math.round(s.pitch * 1e4) / 1e4 });
    if (sol) {
      const r = sol.map(round);
      const check = playScript(l, r);
      console.log(l.id, 'SOLVED in', sol.length, 'par', l.par, 'complete', check.result?.complete, ((performance.now() - t0) / 1000).toFixed(1) + 's');
      out[l.id] = r;
    } else console.log(l.id, 'NOT SOLVED', ((performance.now() - t0) / 1000).toFixed(1) + 's');
  }
  mkdirSync('smoke-output', { recursive: true });
  writeFileSync(process.env.OUT ?? 'smoke-output/golf-solutions.json', JSON.stringify(out, null, 1));
  void SCORE_ATTACK;
});
