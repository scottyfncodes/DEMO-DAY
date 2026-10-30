import { PartState, type Part } from '../sim/parts';
import type { Ball, SimEvent } from '../sim/world';

/**
 * Shot quality, read from one shot's simulation events. A shot can earn
 * several tags; the headline is the most impressive one, and it is the only
 * one shown big. Pure: same events in, same tags out.
 */

export type ShotTag = 'clean' | 'aim' | 'window' | 'multi' | 'seam' | 'bank' | 'chain' | 'support' | 'house';

/** Most impressive first. */
export const TAG_ORDER: ShotTag[] = ['house', 'support', 'chain', 'bank', 'seam', 'multi', 'window', 'aim', 'clean'];

export const TAG_LABEL: Record<ShotTag, string> = {
  clean: 'CLEAN HIT',
  aim: 'PERFECT AIM',
  window: 'WINDOW ENTRY',
  multi: 'MULTI HIT',
  seam: 'SEAM SHOT',
  bank: 'BANK SHOT',
  chain: 'CHAIN REACTION',
  support: 'SUPPORT DOWN',
  house: 'HOUSE DOWN',
};

/** Why each tag was earned, in a few words, for the reward line. */
export const TAG_REASON: Record<ShotTag, string> = {
  clean: 'a square first hit',
  aim: 'hitting a marked weak point',
  window: 'going in through the glass',
  multi: 'one ball hitting five things',
  seam: 'splitting a mortar joint',
  bank: 'a carom into the target',
  chain: 'a run of falling pieces',
  support: 'knocking out what held something up',
  house: 'bringing a big part of the house down',
};

/** How big a shot was, for scaling the response: 0 nothing, 1 small, 2 good, 3 critical, 4 major. */
export type Tier = 0 | 1 | 2 | 3 | 4;

export const QUALITY = {
  /** Distinct things one ball must hit for a multi hit (explosions do not count). */
  multiFrom: 5,
  /** Pieces that must fall after a support goes for it to count as support down. */
  supportFall: 2,
  /** Falling pieces, or pieces broken by other pieces, for a chain reaction. */
  chainReleased: 12,
  chainSecondary: 6,
  /** A major collapse: pieces in collapses, roof sections, or share of the house in one shot. */
  houseCollapse: 60,
  houseRoofs: 2,
  houseShare: 0.1,
};

export interface QualityContext {
  parts: readonly Part[];
  balls: readonly Pick<Ball, 'id' | 'touched' | 'def'>[];
  /** Parts the player was pointed at: objective pins and weak points. */
  focus: ReadonlySet<number>;
  destructionBefore: number;
  destructionAfter: number;
}

export interface ShotQuality {
  tags: ShotTag[];
  headline: ShotTag | null;
  tier: Tier;
  /** Distinct house, furniture and garden pieces broken, knocked or brought down. */
  pieces: number;
  released: number;
}

const isSupport = (p: Part): boolean => p.tags.includes('support') || p.kind === 'column' || p.kind === 'lintel';

export function evaluateShot(events: readonly SimEvent[], ctx: QualityContext): ShotQuality {
  const P = ctx.parts;
  const firstHit = new Map<number, { part: number; broke: boolean; afterGround: boolean }>();
  const grounded = new Set<number>();
  const caromed = new Map<number, Set<number>>();
  const glassBy = new Set<number>();
  const pieces = new Set<number>();
  const supportsDown = new Set<number>();
  let seam = false;
  let window = false;
  let bank = false;
  let released = 0;
  let secondary = 0;
  let collapsed = 0;
  let roofs = 0;
  const counts = (p: Part): boolean => p.house || p.kind === 'furniture' || p.kind === 'decor';
  for (const e of events) {
    switch (e.t) {
      case 'hit': {
        const p = P[e.part] as Part;
        if (!firstHit.has(e.ball)) firstHit.set(e.ball, { part: e.part, broke: e.broke, afterGround: grounded.has(e.ball) });
        const prior = caromed.get(e.ball);
        if (e.broke) {
          if (prior && prior.size && !prior.has(e.part) && counts(p)) bank = true;
        } else {
          if (!prior) caromed.set(e.ball, new Set([e.part]));
          else prior.add(e.part);
        }
        break;
      }
      case 'ground':
        if (!firstHit.has(e.ball)) grounded.add(e.ball);
        break;
      case 'break': {
        const p = P[e.part] as Part;
        if (counts(p)) pieces.add(e.part);
        if (p.kind === 'glass' && e.ball) glassBy.add(e.ball);
        if (e.cause === 'debris' || e.cause === 'overload' || e.cause === 'land') secondary++;
        if (isSupport(p) || ctx.focus.has(e.part)) supportsDown.add(e.part);
        break;
      }
      case 'knock': {
        const p = P[e.part] as Part;
        if (counts(p)) pieces.add(e.part);
        break;
      }
      case 'release': {
        const p = P[e.part] as Part;
        released++;
        if (counts(p)) pieces.add(e.part);
        if (isSupport(p)) supportsDown.add(e.part);
        break;
      }
      case 'seam':
        seam = true;
        break;
      case 'enter':
        if (glassBy.has(e.ball)) window = true;
        break;
      case 'exit':
        window = true;
        break;
      case 'collapse':
        collapsed += e.count;
        roofs += e.roof;
        break;
    }
  }
  let clean = false;
  let aim = false;
  for (const f of firstHit.values()) {
    const p = P[f.part] as Part;
    if (f.afterGround) continue;
    if (f.broke && counts(p)) clean = true;
    if (ctx.focus.has(f.part) && p.state !== PartState.Intact) aim = true;
  }
  let multi = false;
  for (const b of ctx.balls) if (b.def.blastRadius === 0 && b.touched.size >= QUALITY.multiFrom) multi = true;
  const share = ctx.destructionAfter - ctx.destructionBefore;
  const support = supportsDown.size > 0 && released >= QUALITY.supportFall;
  const chain = released >= QUALITY.chainReleased || secondary >= QUALITY.chainSecondary;
  const house = collapsed >= QUALITY.houseCollapse || roofs >= QUALITY.houseRoofs || share >= QUALITY.houseShare;
  const on: Record<ShotTag, boolean> = { house, support, chain, bank, seam, multi, window, aim, clean };
  const tags = TAG_ORDER.filter((t) => on[t]);
  const headline = tags[0] ?? null;
  const tier: Tier = house ? 4 : support ? 3 : chain || bank || seam || multi || window ? 2 : pieces.size > 0 ? 1 : 0;
  return { tags, headline, tier, pieces: pieces.size, released };
}
