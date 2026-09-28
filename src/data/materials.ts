import type { Material, MemberDef, MemberStats } from '../core/types';

export interface MaterialDef {
  name: string;
  /** Integrity per 0.3 m of thickness. */
  strength: number;
  /** Mass per square metre of cross-section. */
  density: number;
  color: string;
  edge: string;
  rubble: string;
}

export const MATERIALS: Record<Material, MaterialDef> = {
  wood: { name: 'Timber', strength: 35, density: 0.5, color: '#c98b4a', edge: '#7a4e22', rubble: '#8b5a2b' },
  brick: { name: 'Brick', strength: 60, density: 1.8, color: '#b8503c', edge: '#6e2b1f', rubble: '#8c3a2b' },
  concrete: { name: 'Concrete', strength: 110, density: 2.4, color: '#a9adb3', edge: '#5c6167', rubble: '#7d8187' },
  steel: { name: 'Steel', strength: 170, density: 3.0, color: '#6f8fb3', edge: '#2f4a68', rubble: '#4d6482' },
};

/** Fraction of integrity that converts into load-bearing capacity. */
export const CAPACITY_FACTOR = 0.12;

/**
 * Computes mass, integrity and load capacity for a member.
 * Thickness is the smaller dimension: a 0.3 m timber post has 35 hp,
 * a 0.5 m concrete column about 183 hp, a 1.5 m concrete core 440 hp.
 */
export function memberStats(def: MemberDef): MemberStats {
  const mat = MATERIALS[def.material];
  const thickness = Math.min(def.w, def.h);
  const thicknessFactor = Math.min(4, Math.max(0.6, thickness / 0.3));
  const damage = Math.min(0.95, Math.max(0, def.damage ?? 0));
  const baseHp = def.hp ?? mat.strength * thicknessFactor;
  const hp = baseHp * (1 - damage);
  const densityMul = def.kind === 'wall' && def.anchors ? 0.3 : 1;
  const mass = def.mass ?? def.w * def.h * mat.density * densityMul;
  // Beams and slabs are designed to carry load across their span, so their
  // bearing capacity is well above what their thickness alone suggests.
  const horizontal = def.kind === 'beam' || def.kind === 'slab' || def.kind === 'roof';
  const capacity = (def.capacity ?? baseHp * CAPACITY_FACTOR * (horizontal ? 3 : 1)) * (1 - damage);
  return { mass, hp, capacity };
}
