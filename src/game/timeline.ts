import type { Material, MemberKind, PlacedCharge } from '../core/types';
import { Simulation, corners, type SimEvent, type SimOptions, type SimResult } from '../sim/simulation';
import type { Building, Member } from '../structure/building';

export type FailureCause = 'blast' | 'crush' | 'drop' | 'topple' | 'impact';

/** The first moment a member stopped doing its job, and why. */
export interface Failure {
  memberId: string;
  label: string;
  kind: MemberKind;
  material: Material;
  t: number;
  cause: FailureCause;
  x: number;
  y: number;
  /** Carried other members, or is a column/core: its loss moves load. */
  major: boolean;
  /** Members that were resting on this one when it failed. */
  carried: string[];
}

export interface CollapseTimeline {
  failures: Failure[];
  byMember: Map<string, Failure>;
  /** Failures caused by the structure itself rather than a charge. */
  cascadeCount: number;
  /** Most non-blast failures inside any CHAIN_WINDOW seconds. */
  peakChain: number;
  /** Extents of everything once it settles (debris spread), world metres. */
  settledBounds: { minX: number; maxX: number; minY: number; maxY: number };
  duration: number;
}

/** Window used to decide that several members failed "in rapid succession". */
export const CHAIN_WINDOW = 0.7;
/** How long before a cascade failure the member visibly strains. */
export const STRAIN_LEAD = 0.3;

const CAUSE_BY_EVENT: Partial<Record<SimEvent['type'], FailureCause>> = {
  break: 'impact',
  crush: 'crush',
  drop: 'drop',
  topple: 'topple',
};

/**
 * Reads the event log of a finished (or running) simulation and extracts the
 * order in which members failed. Pure: it never touches the simulation.
 */
export function analyzeEvents(building: Building, events: readonly SimEvent[]): Omit<CollapseTimeline, 'settledBounds' | 'duration'> {
  const byMember = new Map<string, Failure>();
  const failures: Failure[] = [];
  for (const e of events) {
    if (!e.memberId || e.fragment) continue;
    let cause = CAUSE_BY_EVENT[e.type];
    if (!cause) continue;
    // Everything destroyed at the instant of detonation was the charges' doing.
    if (e.type === 'break' && e.t <= 1e-9) cause = 'blast';
    if (byMember.has(e.memberId)) continue;
    const m = building.members.get(e.memberId) as Member | undefined;
    if (!m) continue;
    const f: Failure = {
      memberId: m.id,
      label: m.label ?? m.id,
      kind: m.kind,
      material: m.material,
      t: e.t,
      cause,
      x: m.x + m.w / 2,
      y: m.y + m.h / 2,
      major: m.carries.length > 0 || m.kind === 'column' || m.kind === 'core',
      carried: [...m.carries],
    };
    byMember.set(m.id, f);
    failures.push(f);
  }
  failures.sort((a, b) => a.t - b.t);
  const cascade = failures.filter((f) => f.cause !== 'blast');
  let peakChain = 0;
  let start = 0;
  for (let end = 0; end < cascade.length; end++) {
    while ((cascade[end] as Failure).t - (cascade[start] as Failure).t > CHAIN_WINDOW) start++;
    peakChain = Math.max(peakChain, end - start + 1);
  }
  return { failures, byMember, cascadeCount: cascade.length, peakChain };
}

/**
 * Runs the deterministic simulation headlessly for a locked plan, so the
 * presentation knows what is about to happen: which members strain before
 * they go, how wide the debris spreads, whether a chain reaction is coming.
 * The live simulation is a separate instance that produces the same result.
 */
export function precomputeCollapse(
  building: Building,
  charges: PlacedCharge[],
  options: SimOptions = {},
): { timeline: CollapseTimeline; result: SimResult } {
  const sim = new Simulation(building, charges.map((c) => ({ ...c })), options);
  const result = sim.runToEnd();
  const b = { ...building.bounds };
  for (const c of sim.chunks) {
    if (c.state === 'gone') continue;
    for (const [x, y] of corners(c)) {
      b.minX = Math.min(b.minX, x);
      b.maxX = Math.max(b.maxX, x);
      b.minY = Math.min(b.minY, y);
      b.maxY = Math.max(b.maxY, y);
    }
  }
  return { timeline: { ...analyzeEvents(building, sim.events), settledBounds: b, duration: sim.time }, result };
}

/** True when the run is worth a special "that was clean" treatment. */
export function isNearPerfect(removed: number, efficiency: number): boolean {
  return removed >= 0.995 && efficiency >= 0.6;
}
