import type { ChargeType, Direction, PlacedCharge } from '../core/types';
import { CHARGES } from '../data/charges';
import { chargePoint, distanceToMember, type Building, type Member } from '../structure/building';
import { computeLoads } from '../structure/support';

export interface EffectLine {
  memberId: string;
  label: string;
  /** Damage as a fraction of remaining integrity. */
  fraction: number;
  destroyed: boolean;
  /** Survives the blast but is too weak to carry what sits on it. */
  crushed: boolean;
}

export interface Preview {
  target: EffectLine;
  splash: EffectLine[];
  warnings: string[];
  summary: string;
}

/**
 * Predicts the direct blast effect of placing a charge on a member, given
 * the charges already planned. Deliberately says nothing about the collapse
 * that follows: the player reasons about that.
 */
export function previewCharge(
  building: Building,
  planned: PlacedCharge[],
  type: ChargeType,
  memberId: string,
  powerMul = 1,
  direction?: Direction,
  at?: number,
): Preview {
  const def = CHARGES[type];
  const target = building.members.get(memberId) as Member;
  const { x: px, y: py } = chargePoint(target, at);

  // Damage already planned per member.
  const existing = new Map<string, number>();
  for (const c of planned) {
    const cd = CHARGES[c.type];
    const t = building.members.get(c.memberId);
    if (!t) continue;
    const { x: cx, y: cy } = chargePoint(t, c.at);
    for (const m of building.members.values()) {
      const mul = cd.multipliers[m.kind] ?? 1;
      let dmg = 0;
      if (m.id === t.id) dmg = cd.power * powerMul * mul;
      else {
        const d = distanceToMember(m, cx, cy);
        if (d < cd.radius) dmg = cd.power * powerMul * (1 - (d / cd.radius) ** 2) * mul;
      }
      if (dmg > 0) existing.set(m.id, (existing.get(m.id) ?? 0) + dmg);
    }
  }

  const loads = computeLoads(building, () => true);
  const line = (m: Member, dmg: number): EffectLine => {
    const remaining = Math.max(0, m.stats.hp - (existing.get(m.id) ?? 0));
    const alreadyGone = remaining <= 0;
    const fraction = alreadyGone ? 1 : Math.min(1, dmg / remaining);
    const destroyed = alreadyGone || dmg >= remaining;
    const integrityAfter = m.stats.hp > 0 ? Math.max(0, remaining - dmg) / m.stats.hp : 0;
    const crushed = !destroyed && (loads.get(m.id) ?? 0) > m.stats.capacity * integrityAfter;
    return { memberId: m.id, label: m.label ?? m.id, fraction, destroyed, crushed };
  };

  const targetMul = def.multipliers[target.kind] ?? 1;
  const targetLine = line(target, def.power * powerMul * targetMul);
  const splash: EffectLine[] = [];
  for (const m of building.members.values()) {
    if (m.id === target.id) continue;
    const d = distanceToMember(m, px, py);
    if (d >= def.radius) continue;
    const mul = def.multipliers[m.kind] ?? 1;
    const dmg = def.power * powerMul * (1 - (d / def.radius) ** 2) * mul;
    if (dmg < 1) continue;
    splash.push(line(m, dmg));
  }
  splash.sort((a, b) => b.fraction - a.fraction);

  const warnings: string[] = [];
  for (const s of splash) {
    const m = building.members.get(s.memberId) as Member;
    if (m.protect && s.fraction > 0.05) warnings.push(`Blast reaches protected ${s.label}.`);
  }
  for (const n of building.def.neighbors ?? []) {
    const gap = Math.max(n.x - (target.x + target.w), target.x - (n.x + n.w));
    if (gap < def.radius + 1.5) warnings.push(`${n.label} is ${Math.max(0, gap).toFixed(1)} m away. Debris may reach it.`);
  }
  if (def.directional) {
    warnings.push(`Pushes everything above ${target.label ?? target.id} to the ${direction ?? 'left'}.`);
  }

  let summary: string;
  if (targetLine.destroyed) summary = `Breaks ${targetLine.label}.`;
  else if (targetLine.crushed) summary = `Cracks ${targetLine.label} (${Math.round(targetLine.fraction * 100)}%). Too weak to carry its load: it will give way.`;
  else if (targetLine.fraction >= 0.5) summary = `Cracks ${targetLine.label} (${Math.round(targetLine.fraction * 100)}%). It will still stand.`;
  else summary = `Scorches ${targetLine.label} (${Math.round(targetLine.fraction * 100)}%). Not enough to break it.`;
  const broken = splash.filter((s) => s.destroyed);
  if (broken.length > 0) summary += ` Also breaks ${broken.map((b) => b.label).join(', ')}.`;
  const crushed = splash.filter((s) => s.crushed);
  if (crushed.length > 0) summary += ` ${crushed.map((b) => b.label).join(', ')} will give way under load.`;

  return { target: targetLine, splash, warnings, summary };
}
