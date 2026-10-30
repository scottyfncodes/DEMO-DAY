import { BALL_ORDER, type BallId } from '../sim/balls';
import { TAG_ORDER, type ShotQuality, type ShotTag } from './quality';

/**
 * The special ball economy. Standard balls are unlimited; specials come out
 * of a meter that skilful shots fill. Every number that balances it lives in
 * REWARD, so tuning happens here and nowhere else.
 */

export type SpecialId = Exclude<BallId, 'standard'>;

export const SPECIALS: SpecialId[] = BALL_ORDER.filter((b): b is SpecialId => b !== 'standard');

export const REWARD = {
  /** Meter points for one special ball. */
  meterSize: 100,
  /** Ordinary damage: per piece broken or brought down, up to a cap per shot. */
  perPiece: 0.8,
  pieceCap: 10,
  /** Skill: what each tag adds to the meter. */
  tag: { clean: 4, aim: 8, window: 8, multi: 9, seam: 15, bank: 16, chain: 22, support: 25, house: 40 } as Record<ShotTag, number>,
  /** A tag earned again soon is worth this much less each time (multiplied per recent repeat). */
  fatigue: 0.5,
  /** How much of a repeat is forgiven per shot that does not earn the tag. */
  recover: 1,
  /** Meter gains on a house that is already finished. */
  finishedHouse: 0.5,
  /** Most of one special a player can carry. */
  cap: 9,
  /** Specials paid out by one shot at most, however big. */
  maxPerShot: 2,
  /** The skill decides the ball: what each headline pays out. */
  payout: { clean: 'power', seam: 'power', aim: 'heavy', support: 'heavy', bank: 'super', window: 'super', multi: 'multi', chain: 'blast', house: 'blast' } as Record<ShotTag, SpecialId>,
};

export interface Economy {
  meter: number;
  inventory: Partial<Record<SpecialId, number>>;
  /** Recent repeats per tag, for fatigue. */
  fatigue: Partial<Record<ShotTag, number>>;
}

export function emptyEconomy(): Economy {
  return { meter: 0, inventory: {}, fatigue: {} };
}

export interface MeterLine {
  tag: ShotTag | 'damage';
  value: number;
}

/** What a shot is worth on the meter, line by line, before it is applied. */
export function meterLines(q: ShotQuality, econ: Economy, finished = false): MeterLine[] {
  const k = finished ? REWARD.finishedHouse : 1;
  const out: MeterLine[] = [];
  for (const t of q.tags) {
    const v = REWARD.tag[t] * Math.pow(REWARD.fatigue, econ.fatigue[t] ?? 0) * k;
    if (v >= 0.5) out.push({ tag: t, value: v });
  }
  const dmg = Math.min(REWARD.pieceCap, q.pieces * REWARD.perPiece) * k;
  if (dmg > 0) out.push({ tag: 'damage', value: dmg });
  return out;
}

export interface ShotReward {
  gain: number;
  lines: MeterLine[];
  /** Specials paid out by this shot, in order. */
  awarded: SpecialId[];
  /** The skill that paid them out (the shot's headline), or null for plain damage. */
  reason: ShotTag | null;
}

/** Picks the special a fill pays out: the headline's ball if it is open and not full, else the scarcest open one. */
export function payoutFor(reason: ShotTag | null, econ: Economy, unlocked: readonly BallId[]): SpecialId | null {
  const open = SPECIALS.filter((b) => unlocked.includes(b) && (econ.inventory[b] ?? 0) < REWARD.cap);
  if (!open.length) return null;
  const want = reason ? REWARD.payout[reason] : null;
  if (want && open.includes(want)) return want;
  return [...open].sort((a, b) => (econ.inventory[a] ?? 0) - (econ.inventory[b] ?? 0) || SPECIALS.indexOf(a) - SPECIALS.indexOf(b))[0] ?? null;
}

/** Applies a finished shot to the economy: fills the meter, pays out specials, ages fatigue. Mutates econ. */
export function applyShot(econ: Economy, q: ShotQuality, unlocked: readonly BallId[], finished = false): ShotReward {
  const lines = meterLines(q, econ, finished);
  const gain = lines.reduce((s, l) => s + l.value, 0);
  for (const t of TAG_ORDER) {
    if (q.tags.includes(t)) econ.fatigue[t] = (econ.fatigue[t] ?? 0) + 1;
    else if (econ.fatigue[t]) {
      const f = Math.max(0, (econ.fatigue[t] as number) - REWARD.recover);
      if (f > 0) econ.fatigue[t] = f;
      else delete econ.fatigue[t];
    }
  }
  econ.meter += gain;
  const awarded: SpecialId[] = [];
  while (econ.meter >= REWARD.meterSize && awarded.length < REWARD.maxPerShot) {
    const ball = payoutFor(q.headline, econ, unlocked);
    if (!ball) break;
    econ.meter -= REWARD.meterSize;
    econ.inventory[ball] = (econ.inventory[ball] ?? 0) + 1;
    awarded.push(ball);
  }
  // Overflow past the per-shot limit waits just under the top; with every special full, the meter waits at the top.
  if (econ.meter >= REWARD.meterSize) econ.meter = payoutFor(q.headline, econ, unlocked) ? REWARD.meterSize - 0.01 : REWARD.meterSize;
  return { gain, lines, awarded, reason: awarded.length ? q.headline : null };
}

/** Spends one special. Returns false if there is none. */
export function spend(econ: Economy, ball: BallId): boolean {
  if (ball === 'standard') return true;
  const n = econ.inventory[ball] ?? 0;
  if (n <= 0) return false;
  econ.inventory[ball] = n - 1;
  return true;
}
