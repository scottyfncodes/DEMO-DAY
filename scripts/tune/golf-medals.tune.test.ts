import { it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { SCORE_ATTACK, type PowerUpId } from '../../src/golf/sim/levels';
import { Session, playScript } from '../../src/golf/sim/session';
import { solveAim } from '../../src/golf/sim/aim';
import { PartState } from '../../src/golf/sim/parts';
import type { BallId } from '../../src/golf/sim/balls';
import type { Shot } from '../../src/golf/sim/world';

type S = Shot & { powerups?: PowerUpId[] };
it('score attack bot', () => {
  const plan: S[] = [];
  const L = SCORE_ATTACK;
  for (let k = 0; k < L.shots; k++) {
    const base = playScript(L, plan);
    const P = base.world.parts.filter((p) => p.state === PartState.Intact && p.house && (p.wall === 'front' || p.kind === 'column' || p.tags.includes('chimney') || p.kind === 'tile'));
    const cands = P.filter((_, i) => i % Math.max(1, Math.floor(P.length / 40)) === k % 3);
    let best: { s: S; v: number } | null = null;
    for (const p of cands) {
      for (const ball of ['standard', ...Object.keys(L.balls)] as BallId[]) {
        if (!base.canUse(ball)) continue;
        for (const pu of [[], ...(['drive', 'ricochet', 'golfers'] as PowerUpId[]).filter((q) => (base.powerups[q] ?? 0) > 0).map((q) => [q])]) {
          const sh = solveAim(base.world, ball, { x: p.x, y: p.y, z: p.z + p.hz }, 0.9);
          if (!sh) continue;
          const c: S = { ...sh, powerups: pu.length ? pu : undefined };
          const s = playScript(L, [...plan, c]);
          if (!best || s.score > best.v) best = { s: c, v: s.score };
        }
      }
    }
    if (!best) break;
    plan.push(best.s);
    console.log('shot', k + 1, best.s.ball, best.s.powerups?.join(',') ?? '', 'score', best.v);
  }
  const s = playScript(L, plan);
  console.log('BOT SCORE', s.score, 'destruction', s.world.destruction().toFixed(2));
  const round = (x: S) => ({ ...x, yaw: Math.round(x.yaw * 1e4) / 1e4, pitch: Math.round(x.pitch * 1e4) / 1e4 });
  const r = plan.map(round);
  console.log('ROUNDED SCORE', playScript(L, r).score);
  mkdirSync('smoke-output', { recursive: true });
  writeFileSync(process.env.OUT ?? 'smoke-output/golf-medals.json', JSON.stringify(r, null, 1));
  void Session;
});
