import { GROUND, type StructureDef } from './structure';

/**
 * Structural load solver.
 *
 * Load is routed from every standing piece down to the ground along the
 * cheapest intact paths (Dijkstra over the joint graph, columns and cores
 * being cheap, sideways transfer through slabs expensive). Each piece passes
 * its weight plus everything it carries to the neighbours that are closer to
 * the ground, split by how strong each joint is.
 *
 * Moment arms are tracked as "run": how far the load has travelled sideways
 * since it last bore straight down onto a support. A slab bridging a lost
 * column, or a wing hanging off a truss, multiplies the stress on the joints
 * that hold it.
 *
 * Pure function of its inputs, so it is deterministic and easy to test.
 */

/** Sideways run (m) that doubles a joint's stress. */
export const LEVER_REF = 4;

export interface SolveInput {
  alive: Uint8Array;
  jointOk: Uint8Array;
  /** Current capacity of each piece (tonnes). */
  pieceCap: Float32Array;
  /** Current capacity of each joint. */
  jointCap: Float32Array;
  /** Extra mass resting on a piece (debris perched on it). */
  extra?: Float32Array;
}

export interface SolveResult {
  /** Piece reachable from the ground through intact load paths. */
  connected: Uint8Array;
  /** Load through the piece including its own weight (tonnes). */
  load: Float32Array;
  pieceStress: Float32Array;
  jointLoad: Float32Array;
  jointStress: Float32Array;
  /** Load-path distance to the ground; lower is closer. */
  dist: Float32Array;
  /** Groups of standing pieces no longer tied to the ground, each a falling section. */
  detached: number[][];
}

export interface Adjacency {
  /** For each piece, the joints it takes part in. */
  joints: number[][];
}

export function buildAdjacency(def: StructureDef): Adjacency {
  const joints: number[][] = def.pieces.map(() => []);
  for (const j of def.joints) {
    (joints[j.a] as number[]).push(j.id);
    if (j.b !== GROUND) (joints[j.b] as number[]).push(j.id);
  }
  return { joints };
}

/** Min-heap keyed on distance. */
class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, key: number): void {
    const ids = this.ids;
    const keys = this.keys;
    ids.push(id);
    keys.push(key);
    let i = ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((keys[p] as number) <= key) break;
      ids[i] = ids[p] as number;
      keys[i] = keys[p] as number;
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): { id: number; key: number } {
    const ids = this.ids;
    const keys = this.keys;
    const id = ids[0] as number;
    const key = keys[0] as number;
    const lastId = ids.pop() as number;
    const lastKey = keys.pop() as number;
    if (ids.length > 0) {
      let i = 0;
      const n = ids.length;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        let mk = lastKey;
        if (l < n && (keys[l] as number) < mk) {
          m = l;
          mk = keys[l] as number;
        }
        if (r < n && (keys[r] as number) < mk) {
          m = r;
          mk = keys[r] as number;
        }
        if (m === i) break;
        ids[i] = ids[m] as number;
        keys[i] = keys[m] as number;
        i = m;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return { id, key };
  }
}

export function solve(def: StructureDef, adj: Adjacency, input: SolveInput): SolveResult {
  const n = def.pieces.length;
  const nj = def.joints.length;
  const { alive, jointOk, pieceCap, jointCap, extra } = input;
  const dist = new Float32Array(n).fill(Infinity);
  const connected = new Uint8Array(n);
  const load = new Float32Array(n);
  const pieceStress = new Float32Array(n);
  const jointLoad = new Float32Array(nj);
  const jointStress = new Float32Array(nj);

  // Dijkstra from the ground. Infill can be reached (it hangs off the frame)
  // but never relays support to anything else.
  const heap = new Heap();
  for (const j of def.joints) {
    if (j.b !== GROUND || !jointOk[j.id] || !alive[j.a]) continue;
    if (j.cost < (dist[j.a] as number)) {
      dist[j.a] = j.cost;
      heap.push(j.a, j.cost);
    }
  }
  const done = new Uint8Array(n);
  const order: number[] = [];
  while (heap.size > 0) {
    const { id, key } = heap.pop();
    if (done[id]) continue;
    done[id] = 1;
    connected[id] = 1;
    order.push(id);
    const p = def.pieces[id];
    if (!p || !p.carriesOthers) continue;
    for (const jid of adj.joints[id] as number[]) {
      if (!jointOk[jid]) continue;
      const j = def.joints[jid];
      if (!j || j.b === GROUND) continue;
      const other = j.a === id ? j.b : j.a;
      if (!alive[other] || done[other]) continue;
      // Hanging load from something above costs far more than bearing on something below.
      const op = def.pieces[other] as { y: number; h: number };
      const upward = p.y + p.h / 2 > op.y + op.h / 2 + 0.3;
      // A tiny bias by height breaks exact ties so load always runs downhill.
      const nd = key + j.cost * (upward ? 3 : 1) + 1e-4 * Math.max(0, op.y - p.y);
      if (nd < (dist[other] as number)) {
        dist[other] = nd;
        heap.push(other, nd);
      }
    }
  }

  // Push load down from the farthest pieces.
  const fx = new Float64Array(n);
  const fr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (!connected[i]) continue;
    const p = def.pieces[i] as StructureDef['pieces'][number];
    const m = p.mass + (extra ? (extra[i] as number) : 0);
    load[i] = m;
    fx[i] = m * (p.x + p.w / 2);
  }
  const outs: number[] = [];
  const ws: number[] = [];
  for (let k = order.length - 1; k >= 0; k--) {
    const id = order[k] as number;
    const p = def.pieces[id] as StructureDef['pieces'][number];
    const total = load[id] as number;
    if (p.carriesOthers) pieceStress[id] = total / Math.max(1e-3, pieceCap[id] as number);
    const myDist = dist[id] as number;
    outs.length = 0;
    ws.length = 0;
    let wsum = 0;
    for (const jid of adj.joints[id] as number[]) {
      if (!jointOk[jid]) continue;
      const j = def.joints[jid] as StructureDef['joints'][number];
      let target: number;
      if (j.b === GROUND) target = GROUND;
      else {
        target = j.a === id ? j.b : j.a;
        if (!alive[target] || !connected[target]) continue;
        const tp = def.pieces[target] as StructureDef['pieces'][number];
        if (!tp.carriesOthers) continue;
        if ((dist[target] as number) >= myDist) continue;
      }
      const w = Math.max(1e-3, jointCap[jid] as number) / j.cost;
      outs.push(jid);
      ws.push(w);
      wsum += w;
    }
    if (wsum <= 0 || total <= 0) continue;
    const cx = (fx[id] as number) / total;
    const run = (fr[id] as number) / total;
    for (let o = 0; o < outs.length; o++) {
      const jid = outs[o] as number;
      const j = def.joints[jid] as StructureDef['joints'][number];
      const share = (total * (ws[o] as number)) / wsum;
      // Bearing straight down onto a support resets the moment arm.
      const bearing = !p.horizontal && j.y <= p.y + 0.05;
      const r = bearing ? 0 : run + Math.abs(cx - j.x);
      jointLoad[jid] = share;
      jointStress[jid] = (share * (1 + r / LEVER_REF)) / Math.max(1e-3, jointCap[jid] as number);
      if (j.b === GROUND) continue;
      const target = j.a === id ? j.b : j.a;
      load[target] = (load[target] as number) + share;
      fx[target] = (fx[target] as number) + share * j.x;
      fr[target] = (fr[target] as number) + share * r;
    }
  }

  // Standing pieces cut off from the ground, grouped by intact joints.
  const detached: number[][] = [];
  const seen = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!alive[i] || connected[i] || seen[i]) continue;
    const group: number[] = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const cur = stack.pop() as number;
      group.push(cur);
      for (const jid of adj.joints[cur] as number[]) {
        if (!jointOk[jid]) continue;
        const j = def.joints[jid] as StructureDef['joints'][number];
        if (j.b === GROUND) continue;
        const other = j.a === cur ? j.b : j.a;
        if (!alive[other] || connected[other] || seen[other]) continue;
        seen[other] = 1;
        stack.push(other);
      }
    }
    detached.push(group);
  }

  return { connected, load, pieceStress, jointLoad, jointStress, dist, detached };
}

/** Safety factors: how many times its intact load each part was built to carry. */
const PIECE_SF: Record<string, number> = { column: 1.9, core: 2.6, truss: 3.4, beam: 2.4, roof: 2.6, legs: 3 };
const PIECE_MIN: Record<string, number> = { column: 30, core: 120, truss: 200, beam: 40, roof: 30, legs: 60 };

/** Joint safety factor and floor, by routing cost (which encodes the joint type). */
function jointRating(def: StructureDef, jid: number): { sf: number; min: number } {
  const j = def.joints[jid] as StructureDef['joints'][number];
  const a = def.pieces[j.a] as StructureDef['pieces'][number];
  const b = j.b === GROUND ? undefined : def.pieces[j.b];
  const kinds = [a.kind, b?.kind];
  if (kinds.includes('truss')) return { sf: 3.2, min: 260 };
  if (kinds.includes('core')) return { sf: 2.6, min: 120 };
  if (!a.carriesOthers || (b && !b.carriesOthers)) return { sf: 3, min: 3 };
  if (j.b === GROUND) return { sf: 2.4, min: 60 };
  if (j.cost >= 3) return { sf: 2.2, min: 26 };
  if (j.cost > 1.5) return { sf: 2.2, min: 24 };
  if (a.horizontal !== b?.horizontal) return { sf: 2.2, min: 30 };
  return { sf: 2.2, min: 50 };
}

/**
 * Sizes every member for the loads it carries in the intact building, the
 * way an engineer would: so the standing structure sits at a comfortable
 * fraction of its capacity everywhere and only loses that margin when the
 * player takes something away.
 */
export function calibrate(def: StructureDef): void {
  const adj = buildAdjacency(def);
  const n = def.pieces.length;
  const nj = def.joints.length;
  const alive = new Uint8Array(n).fill(1);
  const jointOk = new Uint8Array(nj).fill(1);
  const pieceCap = new Float32Array(n).fill(1e6);
  const jointCap = new Float32Array(nj);
  for (let i = 0; i < nj; i++) jointCap[i] = jointRating(def, i).min;
  for (let pass = 0; pass < 4; pass++) {
    const r = solve(def, adj, { alive, jointOk, pieceCap, jointCap });
    for (let i = 0; i < nj; i++) {
      const { sf, min } = jointRating(def, i);
      const stressLoad = (r.jointStress[i] as number) * (jointCap[i] as number);
      jointCap[i] = Math.max(min, stressLoad * sf);
    }
    if (pass === 3) {
      for (const p of def.pieces) {
        if (!p.carriesOthers) {
          p.cap = 1e6;
          continue;
        }
        const sf = PIECE_SF[p.kind] ?? 2.4;
        const min = PIECE_MIN[p.kind] ?? 20;
        p.cap = Math.max(min, (r.load[p.id] as number) * sf);
      }
    }
  }
  for (const j of def.joints) j.cap = jointCap[j.id] as number;
  for (const p of def.pieces) {
    if (p.kind === 'column') p.hp = Math.round(Math.min(760, Math.max(140, 100 + p.cap * 0.55)));
  }
}
