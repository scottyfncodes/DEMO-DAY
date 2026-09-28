import type { Direction } from '../core/types';
import type { Building, Member } from './building';

export type SupportStatus =
  | { kind: 'stable' }
  | { kind: 'free' }
  | { kind: 'tilt'; direction: Direction; pivotX: number };

/** Fraction of a horizontal member's span that may hang unsupported. */
export const MAX_CANTILEVER = 0.4;

/**
 * Decides whether a member is still supported given which members are
 * standing. Vertical members need any support beneath them (or the ground);
 * horizontal members need support near both ends or they tip toward the
 * unsupported side.
 */
export function evaluateSupport(member: Member, isStanding: (id: string) => boolean): SupportStatus {
  if (member.anchors && member.anchors.length > 0) {
    const anchored = member.anchors.some((a) => isStanding(a));
    if (!anchored) return { kind: 'free' };
  }
  if (member.grounded) return { kind: 'stable' };

  const supporters = member.restsOn.filter((link) => isStanding(link.id));
  if (supporters.length === 0) return { kind: 'free' };
  if (!member.isHorizontal) return { kind: 'stable' };

  let leftmost = Infinity;
  let rightmost = -Infinity;
  for (const s of supporters) {
    leftmost = Math.min(leftmost, s.from);
    rightmost = Math.max(rightmost, s.to);
  }
  const overhangLeft = leftmost - member.x;
  const overhangRight = member.x + member.w - rightmost;
  const limit = member.w * MAX_CANTILEVER;
  const failLeft = overhangLeft > limit;
  const failRight = overhangRight > limit;
  if (failLeft && failRight) {
    return overhangRight > overhangLeft
      ? { kind: 'tilt', direction: 'right', pivotX: rightmost }
      : { kind: 'tilt', direction: 'left', pivotX: leftmost };
  }
  if (failLeft) return { kind: 'tilt', direction: 'left', pivotX: leftmost };
  if (failRight) return { kind: 'tilt', direction: 'right', pivotX: rightmost };
  return { kind: 'stable' };
}

/**
 * Computes the load resting on every standing member (mass from above,
 * excluding the member's own mass). Loads flow down through the support
 * graph, split between supporters by horizontal overlap.
 *
 * `extra` adds mass sitting on a member (fallen debris that came to rest).
 */
export function computeLoads(
  building: Building,
  isStanding: (id: string) => boolean,
  extra?: Map<string, number>,
): Map<string, number> {
  const loads = new Map<string, number>();
  const standing: Member[] = [];
  for (const id of building.order) {
    const m = building.members.get(id) as Member;
    if (isStanding(id)) {
      standing.push(m);
      loads.set(id, extra?.get(id) ?? 0);
    }
  }
  // Highest members first so their loads are complete before they pass down.
  standing.sort((a, b) => b.y + b.h - (a.y + a.h));
  for (const m of standing) {
    if (m.grounded) continue;
    const supporters = m.restsOn.filter((l) => isStanding(l.id));
    if (supporters.length === 0) continue;
    const totalOverlap = supporters.reduce((acc, l) => acc + (l.to - l.from), 0) || 1;
    const carried = (loads.get(m.id) ?? 0) + m.stats.mass;
    for (const s of supporters) {
      const share = (s.to - s.from) / totalOverlap;
      loads.set(s.id, (loads.get(s.id) ?? 0) + carried * share);
    }
  }
  return loads;
}

/** Ids of members whose load exceeds their (current) capacity. */
export function findCrushed(loads: Map<string, number>, capacityOf: (id: string) => number): string[] {
  const out: string[] = [];
  for (const [id, load] of loads) {
    if (load > capacityOf(id)) out.push(id);
  }
  return out;
}
