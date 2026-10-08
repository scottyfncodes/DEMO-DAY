import type { BuildingDef, MemberDef, MemberStats } from '../core/types';
import { memberStats } from '../data/materials';

export interface SupportLink {
  /** Id of the member underneath. */
  id: string;
  /** Horizontal overlap range. */
  from: number;
  to: number;
}

export interface Member extends MemberDef {
  stats: MemberStats;
  /** Members directly underneath that this one rests on. */
  restsOn: SupportLink[];
  /** Members directly on top that rest on this one. */
  carries: string[];
  grounded: boolean;
  isHorizontal: boolean;
}

export interface Building {
  def: BuildingDef;
  members: Map<string, Member>;
  order: string[];
  totalMass: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

const EPS = 0.06;

export function isHorizontalKind(kind: MemberDef['kind']): boolean {
  return kind === 'beam' || kind === 'slab' || kind === 'roof';
}

/** Instantiates a building definition and derives the support graph from geometry. */
export function buildBuilding(def: BuildingDef): Building {
  const members = new Map<string, Member>();
  const seen = new Set<string>();
  for (const m of def.members) {
    if (seen.has(m.id)) throw new Error(`Duplicate member id: ${m.id}`);
    seen.add(m.id);
    members.set(m.id, {
      ...m,
      stats: memberStats(m),
      restsOn: [],
      carries: [],
      grounded: m.y <= EPS,
      isHorizontal: isHorizontalKind(m.kind),
    });
  }
  for (const m of members.values()) {
    for (const other of members.values()) {
      if (other === m) continue;
      // Anchored members are cladding: they hang off the frame and carry nothing.
      if (other.anchors && other.anchors.length > 0) continue;
      const otherTop = other.y + other.h;
      const explicit = m.supportedBy?.includes(other.id) ?? false;
      if (!explicit && Math.abs(otherTop - m.y) > EPS) continue;
      const from = Math.max(m.x, other.x);
      const to = Math.min(m.x + m.w, other.x + other.w);
      if (to - from < EPS) continue;
      m.restsOn.push({ id: other.id, from, to });
      other.carries.push(m.id);
    }
    if (m.supportedBy) {
      for (const s of m.supportedBy) {
        if (!members.has(s)) throw new Error(`Member ${m.id} is supported by unknown member ${s}`);
      }
    }
    if (m.anchors) {
      for (const a of m.anchors) {
        if (!members.has(a)) throw new Error(`Member ${m.id} anchors to unknown member ${a}`);
      }
    }
  }
  let totalMass = 0;
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const m of members.values()) {
    totalMass += m.stats.mass;
    bounds.minX = Math.min(bounds.minX, m.x);
    bounds.maxX = Math.max(bounds.maxX, m.x + m.w);
    bounds.minY = Math.min(bounds.minY, m.y);
    bounds.maxY = Math.max(bounds.maxY, m.y + m.h);
  }
  return { def, members, order: def.members.map((m) => m.id), totalMass, bounds };
}

/** All members that (transitively) depend on `id` for support. */
export function dependents(building: Building, id: string): string[] {
  const out: string[] = [];
  const visited = new Set<string>([id]);
  const stack = [id];
  while (stack.length) {
    const current = stack.pop() as string;
    const m = building.members.get(current);
    if (!m) continue;
    for (const c of m.carries) {
      if (!visited.has(c)) {
        visited.add(c);
        out.push(c);
        stack.push(c);
      }
    }
    for (const other of building.members.values()) {
      if (other.anchors?.includes(current) && !visited.has(other.id)) {
        visited.add(other.id);
        out.push(other.id);
        stack.push(other.id);
      }
    }
  }
  return out;
}

/** Sum of member masses (the "structure" that can be removed). */
export function targetMass(building: Building): number {
  let mass = 0;
  for (const m of building.members.values()) {
    if (!m.protect) mass += m.stats.mass;
  }
  return mass;
}

export function memberCenter(m: MemberDef): { x: number; y: number } {
  return { x: m.x + m.w / 2, y: m.y + m.h / 2 };
}

/** Columns, cores and walls carry charges along their height; beams, slabs and roofs along their span. */
export function isVerticalMember(m: Pick<MemberDef, 'kind'>): boolean {
  return m.kind === 'column' || m.kind === 'core' || m.kind === 'wall';
}

/** Default charge position: low on vertical members (you cut a column near its base), centred on horizontal ones. */
export function defaultChargeAt(m: Pick<MemberDef, 'kind'>): number {
  return isVerticalMember(m) ? 0.3 : 0.5;
}

/** Length of the axis a charge slides along, in metres. */
export function chargeAxisLength(m: Pick<MemberDef, 'kind' | 'w' | 'h'>): number {
  return isVerticalMember(m) ? m.h : m.w;
}

/** Keeps a charge at least 12 cm in from either end of the member. */
export function clampChargeAt(m: Pick<MemberDef, 'kind' | 'w' | 'h'>, at: number): number {
  const margin = Math.min(0.3, Math.max(0.04, 0.12 / Math.max(0.01, chargeAxisLength(m))));
  if (!Number.isFinite(at)) return defaultChargeAt(m);
  return Math.min(1 - margin, Math.max(margin, at));
}

/** Charge placement snaps to this grid along the member, in metres. */
export const CHARGE_SNAP = 0.1;

/**
 * Projects a world point onto the member's charge axis and snaps it to the
 * placement grid, measured from the member's bottom (vertical) or left end.
 */
export function chargeAtFromPoint(m: Pick<MemberDef, 'kind' | 'x' | 'y' | 'w' | 'h'>, px: number, py: number): number {
  const len = chargeAxisLength(m);
  const along = isVerticalMember(m) ? py - m.y : px - m.x;
  const snapped = Math.round(along / CHARGE_SNAP) * CHARGE_SNAP;
  return clampChargeAt(m, snapped / Math.max(0.01, len));
}

/**
 * Where a charge sits on a member. `at` slides it along the member's long
 * axis; without it the charge sits low on vertical members and centred on
 * horizontal ones.
 */
export function chargePoint(m: Pick<MemberDef, 'kind' | 'x' | 'y' | 'w' | 'h'>, at?: number): { x: number; y: number } {
  const vertical = isVerticalMember(m);
  const t = at === undefined ? defaultChargeAt(m) : clampChargeAt(m, at);
  return vertical ? { x: m.x + m.w / 2, y: m.y + m.h * t } : { x: m.x + m.w * t, y: m.y + m.h / 2 };
}

/** Distance from a point to the member's rectangle (0 when inside). */
export function distanceToMember(m: MemberDef, px: number, py: number): number {
  const dx = Math.max(m.x - px, 0, px - (m.x + m.w));
  const dy = Math.max(m.y - py, 0, py - (m.y + m.h));
  return Math.hypot(dx, dy);
}
