import { buildAdjacency, calibrate, solve, type Adjacency, type SolveResult } from './solver';
import { GROUND, buildHalden, type PieceDef, type PieceMaterial, type StructureDef } from './structure';
import {
  FLAW_HIDDEN,
  FLAW_MULT,
  FLAW_SHOWN,
  FLAW_USED,
  FLAWS,
  VAULT_HOME,
  VAULT_LABEL,
  blockFromPiece,
  breakBlock,
  detonate,
  emptyTally,
  initialMachines,
  placeCharge,
  removeCharge,
  revealNear,
  startBite,
  stepCharges,
  stepDozer,
  stepExcavator,
  stepSite,
  stopBite,
  triggerChargesAt,
  turnDozer,
  vaultImpact,
  type Block,
  type Charge,
  type ChargeKind,
  type Dozer,
  type Excavator,
  type FireCause,
  type Tally,
  type Tool,
} from './tools';

/**
 * The wrecking-ball simulation. Hybrid by design:
 *
 *  - Standing structure is a dependency graph solved for load (solver.ts).
 *    Pieces never move while they stand; they carry damage, strain and load.
 *  - Overloaded pieces and joints creep (strain builds over time) and fail,
 *    so damage can go quiet and then give way seconds later.
 *  - Whatever loses its path to the ground becomes a rigid falling section
 *    that keeps its shape until impacts break it apart.
 *  - Sections hit what is below them, damaging it, which is how failure
 *    cascades through floors.
 *  - Sections that come to rest become rubble (a heightmap plus the posed
 *    pieces themselves). Fine debris and dust are left to the renderer.
 *
 * Fixed 60 Hz tick, no randomness: the same inputs at the same ticks give the
 * same collapse, which is what makes replays possible.
 */

export const DT = 1 / 60;
export const GRAVITY = 12;
export const BALL_R = 1.05;
export const BALL_MASS = 4.5;
export const BOOM = 64;
const BOOM_FOOT_Y = 3.2;
export const CABLE_MIN = 4;
export const CABLE_MAX = 30;
const THETA_MIN = (18 * Math.PI) / 180;
const THETA_MAX = (82 * Math.PI) / 180;
const CRANE_SPEED = 7;
const LUFF_SPEED = 0.45;
/** How fast overload turns into failure: strain per second per unit of overstress. */
const CREEP = 1.25;
const SNAP_STRESS = 2.3;
const SNAPS_PER_TICK = 2;
const HM_CELL = 0.5;
const HM_MIN_X = -90;
const HM_MAX_X = 120;
const GRID = 2;
/** Heap area per square metre of fallen piece. */
const RUBBLE_BULK = 0.12;
const MAX_WRECK = 260;

export const PIECE_STANDING = 0;
export const PIECE_FALLING = 1;
export const PIECE_GONE = 2;

export type BodyState = 'moving' | 'perched' | 'rubble';

export interface Body {
  id: number;
  pieces: number[];
  /** Piece centres in body space. */
  lx: number[];
  ly: number[];
  /** Collision sample points in body space. */
  px: number[];
  py: number[];
  ppiece: number[];
  x: number;
  y: number;
  a: number;
  vx: number;
  vy: number;
  w: number;
  mass: number;
  inertia: number;
  radius: number;
  state: BodyState;
  still: number;
  root: number;
  /** Standing pieces it leans on while perched. */
  perchOn: number[];
  /** Seconds since it last broke apart or was created (fresh splits do not re-shatter at once). */
  age: number;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  aiming: boolean;
  cable: number;
}

export interface Crane {
  baseX: number;
  theta: number;
  targetX: number;
  targetY: number;
}

export interface RootRecord {
  /** Action number (every swing, volley, crunch and ram is one). */
  swing: number;
  tool: Tool;
  /** Nth use of that tool: swing 3, volley 2. */
  index: number;
  /** Separate failures that followed on from this action. */
  chain: number;
  /** Charges that went off as part of it. */
  charges: number;
  /** Strongest hit of the swing. */
  hitPiece: number;
  hitEnergy: number;
  hitSpeed: number;
  hitX: number;
  hitY: number;
  hitT: number;
  /** First thing that gave way because of this swing that the ball did not break itself. */
  firstFailPiece: number;
  firstFailKind: 'buckled' | 'tore loose' | 'crushed' | 'tipped' | '';
  firstFailT: number;
  mass: number;
  peakMoving: number;
  lastT: number;
}

export interface WreckState {
  tick: number;
  time: number;
  swing: number;
  status: Uint8Array;
  hp: Float32Array;
  strain: Float32Array;
  blame: Int16Array;
  bodyOf: Int16Array;
  jointOk: Uint8Array;
  jointDmg: Float32Array;
  jointStrain: Float32Array;
  jointBlame: Int16Array;
  extra: Float32Array;
  heightmap: Float32Array;
  bodies: Body[];
  nextBodyId: number;
  ball: Ball;
  crane: Crane;
  dirty: boolean;
  lastRoot: number;
  roots: RootRecord[];
  quietFor: number;
  standingMass: number;
  /** Set when a block overturns, so its falling body starts rotating the right way. */
  pendingTip?: { side: number; edge: number };
  /** Actions so far (roots are numbered by action). */
  actions: number;
  /** The root the ball's current swing is credited to. */
  ballRoot: number;
  /** Per piece: 0 sound, 1 hidden weak point, 2 found, 3 used. */
  flaw: Uint8Array;
  charges: Charge[];
  nextChargeId: number;
  chargesLeft: Record<ChargeKind, number>;
  volleys: number;
  exc: Excavator;
  dozer: Dozer;
  blocks: Block[];
  nextBlockId: number;
  tally: Tally;
  /** Members lying where their section came to rest, half sunk in the heap, until the dozer moves them. */
  wreck: Wreck[];
}

export interface Wreck {
  piece: number;
  x: number;
  y: number;
  a: number;
  /** Heap height under it when it settled: it sinks as the heap is pushed away. */
  g: number;
}

/** Everything the player can do, as data, so it can be recorded and replayed. */
export type Command =
  | { kind: 'hook'; x: number; y: number }
  | { kind: 'release'; x: number; y: number; cable: number }
  | { kind: 'charge'; piece: number; charge: ChargeKind; y: number }
  | { kind: 'uncharge'; id: number }
  | { kind: 'detonate' }
  | { kind: 'exc'; x: number; y: number }
  | { kind: 'bite'; on: boolean }
  | { kind: 'dozer'; x: number }
  | { kind: 'turn' };

export type WreckEvent =
  | { type: 'hit'; x: number; y: number; energy: number; speed: number; piece: number; material: PieceMaterial; destroyed: boolean; swing: number }
  | { type: 'shatter'; piece: number; x: number; y: number; a: number; vx: number; vy: number; material: PieceMaterial; cause: DamageCause | 'overload' }
  | { type: 'crack'; x: number; y: number; material: PieceMaterial; strength: number }
  | { type: 'creak'; x: number; y: number; strength: number }
  | { type: 'detach'; x: number; y: number; mass: number; count: number; root: number }
  | { type: 'land'; x: number; y: number; energy: number; mass: number; material: PieceMaterial }
  | { type: 'swing'; swing: number }
  | { type: 'arm'; count: number; root: number }
  | { type: 'blast'; x: number; y: number; kind: ChargeKind; cause: FireCause; root: number; piece: number }
  | { type: 'reveal'; piece: number }
  | { type: 'bite'; x: number; y: number; piece: number; material: PieceMaterial; target: 'structure' | 'section' | 'block' | 'vault' | 'air' }
  | { type: 'blockBreak'; x: number; y: number; material: PieceMaterial; mass: number }
  | { type: 'ram'; x: number; y: number; piece: number; material: PieceMaterial }
  | { type: 'salvage'; x: number; y: number; kind: Block['kind']; value: number; where: 'pad' | 'pit' }
  | { type: 'machineHit'; machine: 'excavator' | 'dozer'; x: number; y: number }
  | { type: 'chargeLost'; x: number; y: number };

export type DamageCause = 'ball' | 'impact' | 'blast';

export interface Prediction {
  path: number[];
  hitPiece: number;
  hitX: number;
  hitY: number;
  speed: number;
}

export interface Halden {
  def: StructureDef;
  adj: Adjacency;
  grid: Map<number, number[]>;
  /** Pieces with a weak point, in FLAWS order. */
  flaws: number[];
  /** The core wall the vault sits behind. */
  vaultHome: number;
  /** Pieces low enough to block a machine on the ground. */
  lowPieces: number[];
}

let cached: Halden | undefined;

/** The calibrated building and its lookups; built once and shared. */
export function halden(): Halden {
  if (cached) return cached;
  const def = buildHalden();
  calibrate(def);
  const adj = buildAdjacency(def);
  const grid = new Map<number, number[]>();
  for (const p of def.pieces) {
    for (let gx = Math.floor(p.x / GRID); gx <= Math.floor((p.x + p.w) / GRID); gx++) {
      for (let gy = Math.floor(p.y / GRID); gy <= Math.floor((p.y + p.h) / GRID); gy++) {
        const k = gridKey(gx, gy);
        let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        list.push(p.id);
      }
    }
  }
  const find = (label: string): number => {
    const p = def.pieces.find((q) => q.label === label);
    if (!p) throw new Error(`No piece ${label}`);
    return p.id;
  };
  const flaws = FLAWS.map((f) => find(f.label));
  const lowPieces = def.pieces.filter((p) => p.y < 3).map((p) => p.id);
  cached = { def, adj, grid, flaws, vaultHome: find(VAULT_HOME), lowPieces };
  return cached;
}

function gridKey(gx: number, gy: number): number {
  return (gx + 1000) * 4096 + (gy + 100);
}

export function craneHook(c: Crane): { x: number; y: number } {
  return { x: c.baseX + BOOM * Math.cos(c.theta), y: BOOM_FOOT_Y + BOOM * Math.sin(c.theta) };
}

export function craneFoot(c: Crane): { x: number; y: number } {
  return { x: c.baseX, y: BOOM_FOOT_Y };
}

export function initialState(h: Halden = halden()): WreckState {
  const n = h.def.pieces.length;
  const nj = h.def.joints.length;
  const crane: Crane = { baseX: -36, theta: 0.73, targetX: 0, targetY: 0 };
  const hook = craneHook(crane);
  crane.targetX = hook.x;
  crane.targetY = hook.y;
  const cable = 16;
  const flaw = new Uint8Array(n);
  FLAWS.forEach((f, i) => {
    flaw[h.flaws[i] as number] = f.known ? FLAW_SHOWN : FLAW_HIDDEN;
  });
  const home = h.def.pieces[h.vaultHome] as PieceDef;
  const vault: Block = { id: 1, kind: 'vault', label: VAULT_LABEL, material: 'steel', x: home.x + home.w / 2, y: 0, w: 2.2, h: 1.9, mass: 14, hp: 1, maxHp: 1, area: 0.5, seed: 77 };
  const { exc, dozer } = initialMachines();
  return {
    tick: 0,
    time: 0,
    swing: 0,
    status: new Uint8Array(n),
    hp: new Float32Array(h.def.pieces.map((p) => p.hp)),
    strain: new Float32Array(n),
    blame: new Int16Array(n),
    bodyOf: new Int16Array(n).fill(-1),
    jointOk: new Uint8Array(nj).fill(1),
    jointDmg: new Float32Array(nj),
    jointStrain: new Float32Array(nj),
    jointBlame: new Int16Array(nj),
    extra: new Float32Array(n),
    heightmap: new Float32Array(Math.ceil((HM_MAX_X - HM_MIN_X) / HM_CELL) + 1),
    bodies: [],
    nextBodyId: 1,
    ball: { x: hook.x, y: hook.y - cable, vx: 0, vy: 0, aiming: false, cable },
    crane,
    dirty: true,
    lastRoot: 0,
    roots: [],
    quietFor: 0,
    standingMass: h.def.totalMass,
    actions: 0,
    ballRoot: 0,
    flaw,
    charges: [],
    nextChargeId: 1,
    chargesLeft: { cutter: 3, blast: 2 },
    volleys: 0,
    exc,
    dozer,
    blocks: [vault],
    nextBlockId: 2,
    tally: emptyTally(),
    wreck: [],
  };
}

export function heightAt(hm: Float32Array, x: number): number {
  const f = (x - HM_MIN_X) / HM_CELL;
  const i = Math.floor(f);
  if (i < 0 || i >= hm.length - 1) return 0;
  const t = f - i;
  return (hm[i] as number) * (1 - t) + (hm[i + 1] as number) * t;
}

export const HEIGHTMAP = { cell: HM_CELL, minX: HM_MIN_X };

export class WreckSim {
  readonly h: Halden;
  readonly def: StructureDef;
  state: WreckState;
  /** Latest load solution; rebuilt whenever the structure changes. */
  solution!: SolveResult;
  private events: WreckEvent[] = [];

  constructor(state?: WreckState, h: Halden = halden()) {
    this.h = h;
    this.def = h.def;
    this.state = state ?? initialState(h);
    this.state.dirty = true;
    this.resolve();
  }

  snapshot(): WreckState {
    return structuredClone(this.state);
  }

  // ------------------------------------------------------------- controls

  setHookTarget(x: number, y: number): void {
    this.state.crane.targetX = x;
    this.state.crane.targetY = y;
  }

  /** Grab the ball: it follows the finger (as a ghost, it cannot push anything) until released. */
  aim(x: number, y: number): void {
    const s = this.state;
    const hook = craneHook(s.crane);
    let dx = x - hook.x;
    let dy = y - hook.y;
    let d = Math.hypot(dx, dy);
    if (d < 1e-6) {
      dx = 0;
      dy = -1;
      d = 1;
    }
    // Keep the ball below the boom tip: you can pull it out sideways, not throw it over the top.
    const ang = Math.atan2(dx, -dy);
    const maxAng = (100 * Math.PI) / 180;
    const clampedAng = Math.max(-maxAng, Math.min(maxAng, ang));
    const len = Math.max(CABLE_MIN, Math.min(CABLE_MAX, d));
    let bx = hook.x + Math.sin(clampedAng) * len;
    let by = hook.y - Math.cos(clampedAng) * len;
    by = Math.max(BALL_R + heightAt(s.heightmap, bx), by);
    // Never park the ghost inside the building.
    for (let iter = 0; iter < 4; iter++) {
      const push = this.pushOutOfStructure(bx, by, BALL_R);
      if (!push) break;
      bx += push.x;
      by += push.y;
    }
    s.ball.x = bx;
    s.ball.y = by;
    s.ball.vx = 0;
    s.ball.vy = 0;
    s.ball.aiming = true;
    s.ball.cable = Math.max(CABLE_MIN, Math.min(CABLE_MAX, Math.hypot(bx - hook.x, by - hook.y)));
  }

  release(): void {
    const s = this.state;
    if (!s.ball.aiming) return;
    s.ball.aiming = false;
    s.ballRoot = this.newRoot('ball');
    this.events.push({ type: 'swing', swing: s.ballRoot });
  }

  /** Starts a new action and returns its root number. */
  newRoot(tool: Tool): number {
    const s = this.state;
    s.actions += 1;
    if (s.tally.clockStart < 0) s.tally.clockStart = s.tick;
    let index = 1;
    if (tool === 'ball') index = s.swing += 1;
    else if (tool === 'charge') index = s.volleys += 1;
    else if (tool === 'excavator') index = s.exc.sessions;
    else for (const r of s.roots) if (r && r.tool === tool) index++;
    s.roots[s.actions] = {
      swing: s.actions,
      tool,
      index,
      chain: 0,
      charges: 0,
      hitPiece: -1,
      hitEnergy: 0,
      hitSpeed: 0,
      hitX: 0,
      hitY: 0,
      hitT: 0,
      firstFailPiece: -1,
      firstFailKind: '',
      firstFailT: 0,
      mass: 0,
      peakMoving: 0,
      lastT: s.time,
    };
    return s.actions;
  }

  emit(e: WreckEvent): void {
    this.events.push(e);
  }

  /** Applies one player command. The screen records them so a job can be replayed. */
  command(c: Command): string | undefined {
    switch (c.kind) {
      case 'hook':
        this.setHookTarget(c.x, c.y);
        return undefined;
      case 'release': {
        const b = this.state.ball;
        b.x = c.x;
        b.y = c.y;
        b.cable = c.cable;
        b.vx = 0;
        b.vy = 0;
        b.aiming = true;
        this.release();
        return undefined;
      }
      case 'charge': {
        const r = placeCharge(this, c.piece, c.charge, c.y);
        return typeof r === 'string' ? r : undefined;
      }
      case 'uncharge':
        removeCharge(this, c.id);
        return undefined;
      case 'detonate':
        detonate(this);
        return undefined;
      case 'exc':
        this.state.exc.targetX = c.x;
        this.state.exc.targetY = c.y;
        return undefined;
      case 'bite':
        if (c.on) startBite(this);
        else stopBite(this);
        return undefined;
      case 'dozer':
        this.state.dozer.targetX = c.x;
        if (this.state.tally.clockStart < 0 && Math.abs(c.x - this.state.dozer.x) > 0.5) this.state.tally.clockStart = this.state.tick;
        return undefined;
      case 'turn':
        turnDozer(this);
        return undefined;
    }
  }

  /** Seconds on the job clock (it starts with the first thing that moves). */
  get clock(): number {
    const t = this.state.tally.clockStart;
    return t < 0 ? 0 : (this.state.tick - t) * DT;
  }

  get standingFraction(): number {
    return this.state.standingMass / this.def.totalMass;
  }

  /** Mass currently in motion (tonnes). */
  movingMass(): number {
    let m = 0;
    for (const b of this.state.bodies) if (b.state === 'moving') m += b.mass;
    return m;
  }

  /** Where the ball goes from the aimed position if released now, up to the first thing it hits. */
  predict(): Prediction {
    const s = this.state;
    const hook = craneHook(s.crane);
    let x = s.ball.x;
    let y = s.ball.y;
    let vx = 0;
    let vy = 0;
    const L = s.ball.cable;
    const path: number[] = [x, y];
    const h = 1 / 30;
    for (let i = 0; i < 150; i++) {
      vy -= GRAVITY * h;
      x += vx * h;
      y += vy * h;
      const dx = x - hook.x;
      const dy = y - hook.y;
      const d = Math.hypot(dx, dy);
      if (d > L) {
        const ux = dx / d;
        const uy = dy / d;
        x = hook.x + ux * L;
        y = hook.y + uy * L;
        const vr = vx * ux + vy * uy;
        if (vr > 0) {
          vx -= vr * ux;
          vy -= vr * uy;
        }
      }
      path.push(x, y);
      const hit = this.firstContact(x, y, BALL_R);
      if (hit >= 0) return { path, hitPiece: hit, hitX: x, hitY: y, speed: Math.hypot(vx, vy) };
      if (y - BALL_R < heightAt(s.heightmap, x) + 0.05 && i > 2) break;
      // Stop once it has swung through and is coming back.
      if (i > 10 && Math.abs(vx) < 0.05 && Math.abs(vy) < 0.05) break;
    }
    return { path, hitPiece: -1, hitX: x, hitY: y, speed: 0 };
  }

  // ---------------------------------------------------------------- tick

  step(): WreckEvent[] {
    this.events = [];
    const s = this.state;
    s.tick += 1;
    s.time = s.tick * DT;
    this.updateCrane();
    stepCharges(this);
    if (s.dirty) this.resolve();
    this.updateStrain();
    if (s.dirty) this.resolve();
    this.updateBall(DT / 2);
    this.updateBall(DT / 2);
    this.updateBodies();
    stepExcavator(this);
    stepDozer(this);
    if (s.dirty) this.resolve();
    if (s.tick % 4 === 0) this.relaxRubble();
    stepSite(this);
    this.trackQuiet();
    return this.events;
  }

  // -------------------------------------------------------------- crane

  /** Moves the crane straight to its target (planning and tests only). */
  settleCrane(): void {
    for (let i = 0; i < 600; i++) this.updateCrane();
  }

  private updateCrane(): void {
    const c = this.state.crane;
    const ty = Math.max(BOOM_FOOT_Y + BOOM * Math.sin(THETA_MIN), Math.min(BOOM_FOOT_Y + BOOM * Math.sin(THETA_MAX), c.targetY));
    const theta = Math.asin((ty - BOOM_FOOT_Y) / BOOM);
    const base = Math.max(-80, Math.min(this.craneLimit(), c.targetX - BOOM * Math.cos(theta)));
    const dTheta = theta - c.theta;
    const maxT = LUFF_SPEED * DT;
    c.theta += Math.max(-maxT, Math.min(maxT, dTheta));
    const dBase = base - c.baseX;
    const maxB = CRANE_SPEED * DT;
    c.baseX += Math.max(-maxB, Math.min(maxB, dBase));
  }

  /** The crane can drive up to a few metres short of whatever still stands at street level. */
  craneLimit(): number {
    let minX = Infinity;
    for (const p of this.def.pieces) {
      if (this.state.status[p.id] !== PIECE_STANDING || p.y > 3) continue;
      if (p.x < minX) minX = p.x;
    }
    if (!Number.isFinite(minX)) minX = 40;
    return Math.min(minX - 9, 60);
  }

  // ------------------------------------------------------------ solving

  private resolve(): void {
    const s = this.state;
    const def = this.def;
    const n = def.pieces.length;
    const alive = new Uint8Array(n);
    const pieceCap = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      alive[i] = s.status[i] === PIECE_STANDING ? 1 : 0;
      const p = def.pieces[i] as PieceDef;
      pieceCap[i] = p.cap * integrity(s.hp[i] as number, p.hp);
    }
    const jointCap = new Float32Array(def.joints.length);
    for (const j of def.joints) jointCap[j.id] = j.cap * Math.max(0.02, 1 - (s.jointDmg[j.id] as number));
    this.solution = solve(def, this.h.adj, { alive, jointOk: s.jointOk, pieceCap, jointCap, extra: s.extra });
    s.dirty = false;
    // Blame new overload on whatever last changed the structure.
    const r = this.solution;
    for (let i = 0; i < n; i++) {
      if ((r.pieceStress[i] as number) > 1 && s.blame[i] === 0) s.blame[i] = s.lastRoot;
      else if ((r.pieceStress[i] as number) < 0.9 && (s.strain[i] as number) === 0) s.blame[i] = 0;
    }
    for (let j = 0; j < def.joints.length; j++) {
      if ((r.jointStress[j] as number) > 1 && s.jointBlame[j] === 0) s.jointBlame[j] = s.lastRoot;
      else if ((r.jointStress[j] as number) < 0.9 && (s.jointStrain[j] as number) === 0) s.jointBlame[j] = 0;
    }
    if (this.checkOverturning()) {
      this.resolve();
      return;
    }
    if (r.detached.length) this.detachGroups(r.detached);
  }

  /**
   * A standing structure whose centre of mass has passed beyond its outermost
   * footing cannot stay up, however strong its joints: it goes over as one
   * piece. Lets the player undercut one side of a tall block and topple it.
   */
  private checkOverturning(): boolean {
    const s = this.state;
    const def = this.def;
    const r = this.solution;
    const seen = new Uint8Array(def.pieces.length);
    let toppled = false;
    for (let start = 0; start < def.pieces.length; start++) {
      if (seen[start] || !r.connected[start] || s.status[start] !== PIECE_STANDING) continue;
      const stack = [start];
      seen[start] = 1;
      let mass = 0;
      let mx = 0;
      let minG = Infinity;
      let maxG = -Infinity;
      const footings: number[] = [];
      while (stack.length) {
        const cur = stack.pop() as number;
        const p = def.pieces[cur] as PieceDef;
        mass += p.mass + (s.extra[cur] as number);
        mx += (p.mass + (s.extra[cur] as number)) * (p.x + p.w / 2);
        for (const jid of this.h.adj.joints[cur] as number[]) {
          if (!s.jointOk[jid]) continue;
          const j = def.joints[jid];
          if (!j) continue;
          if (j.b === GROUND) {
            if (p.carriesOthers) {
              minG = Math.min(minG, p.x);
              maxG = Math.max(maxG, p.x + p.w);
              footings.push(jid);
            }
            continue;
          }
          const other = j.a === cur ? j.b : j.a;
          if (seen[other] || !r.connected[other] || s.status[other] !== PIECE_STANDING) continue;
          seen[other] = 1;
          stack.push(other);
        }
      }
      if (!footings.length || mass < 30) continue;
      const cx = mx / mass;
      if (cx >= minG && cx <= maxG) continue;
      // Over it goes: the footings let go and the whole block becomes one falling body.
      for (const jid of footings) s.jointOk[jid] = 0;
      const root = s.lastRoot;
      const rec = s.roots[root];
      const edge = cx < minG ? minG : maxG;
      const edgePiece = footings
        .map((jid) => (def.joints[jid] as { a: number }).a)
        .sort((a, b) => Math.abs((def.pieces[a] as PieceDef).x - edge) - Math.abs((def.pieces[b] as PieceDef).x - edge))[0];
      if (rec && rec.firstFailPiece < 0 && edgePiece !== undefined) {
        rec.firstFailPiece = edgePiece;
        rec.firstFailKind = 'tipped';
        rec.firstFailT = s.time;
      }
      s.pendingTip = { side: cx < minG ? -1 : 1, edge };
      this.bumpChain(root, 3);
      toppled = true;
    }
    return toppled;
  }

  private updateStrain(): void {
    const s = this.state;
    const r = this.solution;
    const def = this.def;
    let creak = 0;
    let creakX = 0;
    let creakY = 0;
    // Only the worst-overloaded few snap outright this tick; the rest creep while
    // the structure re-solves, so the weakest link goes first and a block that
    // loses its support drops as a block instead of every member failing at once.
    const snapOk = this.snapCandidates();
    for (let i = 0; i < def.pieces.length; i++) {
      if (s.status[i] !== PIECE_STANDING) continue;
      const stress = r.pieceStress[i] as number;
      if (stress <= 1) continue;
      const before = s.strain[i] as number;
      const after = stress > SNAP_STRESS && snapOk.has(i) ? 1 : before + (stress - 1) * CREEP * DT;
      s.strain[i] = after;
      const p = def.pieces[i] as PieceDef;
      if (stress > creak) {
        creak = stress;
        creakX = p.x + p.w / 2;
        creakY = p.y + p.h / 2;
      }
      if (Math.floor(before * 3) !== Math.floor(after * 3) && after < 1) {
        this.events.push({ type: 'crack', x: p.x + p.w / 2, y: p.y + p.h * 0.5, material: p.material, strength: after });
      }
      if (after >= 1) {
        const root = s.blame[i] || s.lastRoot;
        this.bumpChain(root);
        this.noteFailure(root, i, p.horizontal ? 'crushed' : 'buckled');
        this.buckle(i, root);
      }
    }
    for (const j of def.joints) {
      if (!s.jointOk[j.id]) continue;
      const stress = r.jointStress[j.id] as number;
      if (stress <= 1) continue;
      const a = s.status[j.a] === PIECE_STANDING;
      const b = j.b === GROUND || s.status[j.b] === PIECE_STANDING;
      if (!a || !b) continue;
      const before = s.jointStrain[j.id] as number;
      const after = stress > SNAP_STRESS && snapOk.has(-1 - j.id) ? 1 : before + (stress - 1) * CREEP * DT;
      s.jointStrain[j.id] = after;
      if (stress > creak) {
        creak = stress;
        creakX = j.x;
        creakY = j.y;
      }
      if (after >= 1) {
        const root = s.jointBlame[j.id] || s.lastRoot;
        this.breakJoint(j.id, root);
        const pa = def.pieces[j.a] as PieceDef;
        if (pa.carriesOthers) {
          this.bumpChain(root);
          this.noteFailure(root, j.a, 'tore loose');
          this.events.push({ type: 'crack', x: j.x, y: j.y, material: pa.material, strength: 1 });
        }
      }
    }
    if (creak > 1.02 && s.tick % 20 === 0) this.events.push({ type: 'creak', x: creakX, y: creakY, strength: Math.min(1, creak - 1) });
  }

  /**
   * Makes `root` the action that new failures are blamed on. A machine
   * nibbling at the edge of a collapse that a swing or a volley started does
   * not take the credit for it.
   */
  private claim(root: number): void {
    const s = this.state;
    if (root <= s.lastRoot) return;
    const rec = s.roots[root];
    const cur = s.roots[s.lastRoot];
    if (rec && cur && (rec.tool === 'excavator' || rec.tool === 'dozer') && (cur.tool === 'ball' || cur.tool === 'charge') && s.time - cur.lastT < 2.5) return;
    s.lastRoot = root;
  }

  private bumpChain(root: number, n = 1): void {
    const rec = this.state.roots[root];
    if (rec) rec.chain += n;
  }

  /** The few most overloaded pieces (id) and joints (-1 - id) allowed to snap this tick. */
  private snapCandidates(): Set<number> {
    const s = this.state;
    const r = this.solution;
    const list: Array<[number, number]> = [];
    for (let i = 0; i < r.pieceStress.length; i++) {
      const st = r.pieceStress[i] as number;
      if (st > SNAP_STRESS && s.status[i] === PIECE_STANDING) list.push([i, st]);
    }
    for (let j = 0; j < r.jointStress.length; j++) {
      const st = r.jointStress[j] as number;
      if (st > SNAP_STRESS && s.jointOk[j]) list.push([-1 - j, st]);
    }
    list.sort((a, b) => b[1] - a[1]);
    return new Set(list.slice(0, SNAPS_PER_TICK).map((e) => e[0]));
  }

  /**
   * An overloaded member gives way: it buckles, tears out of its connections
   * and comes down with whatever it was holding, rather than vanishing.
   */
  private buckle(id: number, root: number): void {
    const s = this.state;
    const p = this.def.pieces[id] as PieceDef;
    s.hp[id] = Math.min(s.hp[id] as number, p.hp * 0.25);
    s.strain[id] = 0;
    for (const jid of this.h.adj.joints[id] as number[]) this.breakJoint(jid, root);
    s.dirty = true;
    this.events.push({ type: 'crack', x: p.x + p.w / 2, y: p.y + p.h / 2, material: p.material, strength: 1 });
  }

  private noteFailure(root: number, piece: number, kind: RootRecord['firstFailKind']): void {
    const rec = this.state.roots[root];
    if (!rec || rec.firstFailPiece >= 0) return;
    if (piece === rec.hitPiece && kind !== 'buckled') return;
    rec.firstFailPiece = piece;
    rec.firstFailKind = kind;
    rec.firstFailT = this.state.time;
  }

  private breakJoint(jid: number, root: number): void {
    const s = this.state;
    if (!s.jointOk[jid]) return;
    s.jointOk[jid] = 0;
    s.dirty = true;
    if (root) this.claim(root);
  }

  private credit(root: number, mass: number): void {
    const s = this.state;
    s.standingMass -= mass;
    const rec = s.roots[root];
    if (rec) {
      rec.mass += mass;
      rec.lastT = s.time;
    }
  }

  /** Removes a standing piece from the structure entirely: it becomes debris. */
  destroyStanding(id: number, root: number, cause: DamageCause | 'overload', vx = 0, vy = 0): void {
    const s = this.state;
    if (s.status[id] !== PIECE_STANDING) return;
    const p = this.def.pieces[id] as PieceDef;
    if (s.flaw[id] === FLAW_SHOWN) {
      s.flaw[id] = FLAW_USED;
      s.tally.flawsExploited++;
    }
    // Losing cladding or a member lets you see into the frame around it.
    if (cause !== 'overload') revealNear(this, p.x + p.w / 2, p.y + p.h / 2, p.carriesOthers ? 3 : 4.5);
    s.status[id] = PIECE_GONE;
    s.hp[id] = 0;
    s.extra[id] = 0;
    s.dirty = true;
    if (root) this.claim(root);
    this.credit(root, p.mass);
    this.depositMound(p.x + p.w / 2, p.w, p.w * p.h * RUBBLE_BULK);
    this.events.push({ type: 'shatter', piece: id, x: p.x + p.w / 2, y: p.y + p.h / 2, a: 0, vx, vy, material: p.material, cause });
  }

  damageStanding(id: number, energy: number, root: number, cause: DamageCause, vx: number, vy: number): number {
    const s = this.state;
    if (s.status[id] !== PIECE_STANDING || energy <= 0) return 0;
    if (s.flaw[id]) energy *= FLAW_MULT;
    const before = s.hp[id] as number;
    const absorbed = Math.min(before, energy);
    s.hp[id] = before - energy;
    s.dirty = true;
    if (root) this.claim(root);
    if (s.blame[id] === 0) s.blame[id] = root;
    // Impact loosens the piece's connections too.
    for (const jid of this.h.adj.joints[id] as number[]) {
      if (!s.jointOk[jid]) continue;
      const j = this.def.joints[jid];
      if (!j) continue;
      s.jointDmg[jid] = Math.min(1, (s.jointDmg[jid] as number) + (energy * 0.35) / j.toughness);
      if (s.jointBlame[jid] === 0) s.jointBlame[jid] = root;
      if ((s.jointDmg[jid] as number) >= 1) this.breakJoint(jid, root);
    }
    if ((s.hp[id] as number) <= 0) this.destroyStanding(id, root, cause, vx, vy);
    return absorbed;
  }

  // --------------------------------------------------------------- ball

  private updateBall(h: number): void {
    const s = this.state;
    const ball = s.ball;
    const hook = craneHook(s.crane);
    if (ball.aiming) return;
    ball.vy -= GRAVITY * h;
    const drag = 1 - 0.03 * h;
    ball.vx *= drag;
    ball.vy *= drag;
    ball.x += ball.vx * h;
    ball.y += ball.vy * h;
    // Cable: taut at full length, slack inside it.
    const dx = ball.x - hook.x;
    const dy = ball.y - hook.y;
    const d = Math.hypot(dx, dy);
    if (d > ball.cable) {
      const ux = dx / d;
      const uy = dy / d;
      ball.x = hook.x + ux * ball.cable;
      ball.y = hook.y + uy * ball.cable;
      const vr = ball.vx * ux + ball.vy * uy;
      if (vr > 0) {
        ball.vx -= vr * ux;
        ball.vy -= vr * uy;
      }
    }
    // Ground and rubble.
    const floor = heightAt(s.heightmap, ball.x) + BALL_R;
    if (ball.y < floor) {
      ball.y = floor;
      if (ball.vy < 0) ball.vy *= -0.15;
      ball.vx *= 0.9;
    }
    this.ballVsStructure();
    this.ballVsBodies();
    this.ballVsBlocks();
  }

  /** The ball can smash debris on the ground too. */
  private ballVsBlocks(): void {
    const s = this.state;
    const ball = s.ball;
    for (const b of s.blocks) {
      const c = circleRect(ball.x, ball.y, BALL_R, b.x - b.w / 2, b.y, b.w, b.h);
      if (!c) continue;
      const vn = ball.vx * c.nx + ball.vy * c.ny;
      ball.x += c.nx * c.depth;
      ball.y += c.ny * c.depth;
      if (vn >= 0) continue;
      ball.vx -= 1.3 * vn * c.nx;
      ball.vy -= 1.3 * vn * c.ny;
      const energy = 0.5 * BALL_MASS * vn * vn;
      if (energy < 40) continue;
      this.events.push({ type: 'hit', x: ball.x - c.nx * BALL_R, y: ball.y - c.ny * BALL_R, energy, speed: -vn, piece: -1, material: b.material, destroyed: false, swing: s.ballRoot });
      if (b.kind === 'vault') {
        s.tally.vaultCondition = Math.max(0, s.tally.vaultCondition - energy / 3000);
        continue;
      }
      b.hp -= energy * 0.7;
      if (b.hp <= 0) breakBlock(this, b);
      break;
    }
  }

  private ballVsStructure(): void {
    const s = this.state;
    const ball = s.ball;
    const def = this.def;
    const contacts: Array<{ id: number; nx: number; ny: number; depth: number }> = [];
    for (const id of this.query(ball.x - BALL_R, ball.y - BALL_R, ball.x + BALL_R, ball.y + BALL_R)) {
      if (s.status[id] !== PIECE_STANDING) continue;
      const p = def.pieces[id] as PieceDef;
      const c = circleRect(ball.x, ball.y, BALL_R, p.x, p.y, p.w, p.h);
      if (c) contacts.push({ id, ...c });
    }
    if (!contacts.length) return;
    // The face the ball meets head-on takes the blow.
    let primary = contacts[0] as (typeof contacts)[number];
    let vnMin = 0;
    for (const c of contacts) {
      const vn = ball.vx * c.nx + ball.vy * c.ny;
      if (vn < vnMin) {
        vnMin = vn;
        primary = c;
      }
    }
    const speed = -vnMin;
    if (speed > 1.2) {
      const energy = 0.5 * BALL_MASS * speed * speed;
      const root = s.ballRoot;
      const pp = def.pieces[primary.id] as PieceDef;
      const rec = s.roots[root];
      if (rec && energy > rec.hitEnergy) {
        rec.hitEnergy = energy;
        rec.hitPiece = primary.id;
        rec.hitSpeed = speed;
        rec.hitX = ball.x - primary.nx * BALL_R;
        rec.hitY = ball.y - primary.ny * BALL_R;
        rec.hitT = s.time;
      }
      // Spread the blow: most into the struck piece, some into whatever else the ball is touching or nearly touching.
      const near: Array<{ id: number; w: number }> = [{ id: primary.id, w: 1 }];
      const reach = BALL_R + 0.7;
      for (const id of this.query(ball.x - reach, ball.y - reach, ball.x + reach, ball.y + reach)) {
        if (id === primary.id || s.status[id] !== PIECE_STANDING) continue;
        const p = def.pieces[id] as PieceDef;
        const d = distToRect(ball.x, ball.y, p.x, p.y, p.w, p.h);
        if (d > reach) continue;
        near.push({ id, w: 0.38 * (1 - Math.max(0, d - BALL_R * 0.6) / reach) });
      }
      let wsum = 0;
      for (const nn of near) wsum += nn.w;
      const budget = energy * 0.9;
      let absorbedPrimary = 0;
      const ivx = ball.vx * 0.35;
      const ivy = ball.vy * 0.35;
      for (const nn of near) {
        const e = (budget * nn.w) / wsum;
        const a = this.damageStanding(nn.id, e, root, 'ball', ivx, ivy);
        if (nn.id === primary.id) absorbedPrimary = a;
      }
      if (energy > 60) {
        const hx = ball.x - primary.nx * BALL_R;
        const hy = ball.y - primary.ny * BALL_R;
        revealNear(this, hx, hy, 2.2);
        triggerChargesAt(this, primary.id, hx, hy, root, 'ball', BALL_R + 0.4);
      }
      const destroyed = s.status[primary.id] !== PIECE_STANDING;
      this.events.push({ type: 'hit', x: ball.x - primary.nx * BALL_R, y: ball.y - primary.ny * BALL_R, energy, speed, piece: primary.id, material: pp.material, destroyed, swing: root });
      if (destroyed) {
        // Punched through: keep going with what the piece did not soak up.
        const left = Math.max(0, energy - absorbedPrimary * 1.4);
        const k = Math.sqrt(left / energy);
        ball.vx *= k;
        ball.vy *= k;
      } else {
        const vn = ball.vx * primary.nx + ball.vy * primary.ny;
        ball.vx -= 1.18 * vn * primary.nx;
        ball.vy -= 1.18 * vn * primary.ny;
        ball.vx *= 0.85;
        ball.vy *= 0.85;
      }
    }
    // Resolve overlap with whatever is still standing.
    for (const c of contacts) {
      if (s.status[c.id] !== PIECE_STANDING) continue;
      const p = def.pieces[c.id] as PieceDef;
      const again = circleRect(ball.x, ball.y, BALL_R, p.x, p.y, p.w, p.h);
      if (!again) continue;
      ball.x += again.nx * again.depth;
      ball.y += again.ny * again.depth;
      const vn = ball.vx * again.nx + ball.vy * again.ny;
      if (vn < 0) {
        ball.vx -= vn * again.nx;
        ball.vy -= vn * again.ny;
      }
    }
  }

  private ballVsBodies(): void {
    const s = this.state;
    const ball = s.ball;
    for (const b of s.bodies) {
      if (b.state === 'rubble') continue;
      if (Math.hypot(b.x - ball.x, b.y - ball.y) > b.radius + BALL_R) continue;
      const cos = Math.cos(b.a);
      const sin = Math.sin(b.a);
      // Ball centre in body space.
      const rx = ball.x - b.x;
      const ry = ball.y - b.y;
      const lx = rx * cos + ry * sin;
      const ly = -rx * sin + ry * cos;
      for (let k = 0; k < b.pieces.length; k++) {
        const p = this.def.pieces[b.pieces[k] as number] as PieceDef;
        const cx = b.lx[k] as number;
        const cy = b.ly[k] as number;
        const c = circleRect(lx, ly, BALL_R, cx - p.w / 2, cy - p.h / 2, p.w, p.h);
        if (!c) continue;
        const nx = c.nx * cos - c.ny * sin;
        const ny = c.nx * sin + c.ny * cos;
        const cpx = ball.x - nx * BALL_R - b.x;
        const cpy = ball.y - ny * BALL_R - b.y;
        const bvx = b.vx - b.w * cpy;
        const bvy = b.vy + b.w * cpx;
        const vn = (ball.vx - bvx) * nx + (ball.vy - bvy) * ny;
        ball.x += nx * c.depth;
        ball.y += ny * c.depth;
        if (vn >= 0) break;
        const rn = cpx * ny - cpy * nx;
        const inv = 1 / BALL_MASS + 1 / b.mass + (rn * rn) / b.inertia;
        const j = (-(1 + 0.2) * vn) / inv;
        ball.vx += (j * nx) / BALL_MASS;
        ball.vy += (j * ny) / BALL_MASS;
        b.vx -= (j * nx) / b.mass;
        b.vy -= (j * ny) / b.mass;
        b.w -= (j * rn) / b.inertia;
        if (b.state === 'perched') this.wake(b);
        const energy = 0.5 * BALL_MASS * vn * vn;
        if (energy > 20) {
          this.events.push({ type: 'hit', x: ball.x - nx * BALL_R, y: ball.y - ny * BALL_R, energy, speed: -vn, piece: b.pieces[k] as number, material: p.material, destroyed: false, swing: s.ballRoot });
          this.damageBodyPiece(b, k, energy * 0.6, s.ballRoot || b.root);
        }
        break;
      }
    }
  }

  pushOutOfStructure(x: number, y: number, r: number): { x: number; y: number } | undefined {
    let best: { x: number; y: number; d: number } | undefined;
    for (const id of this.query(x - r, y - r, x + r, y + r)) {
      if (this.state.status[id] !== PIECE_STANDING) continue;
      const p = this.def.pieces[id] as PieceDef;
      const c = circleRect(x, y, r, p.x, p.y, p.w, p.h);
      if (c && (!best || c.depth > best.d)) best = { x: c.nx * (c.depth + 0.01), y: c.ny * (c.depth + 0.01), d: c.depth };
    }
    return best ? { x: best.x, y: best.y } : undefined;
  }

  private firstContact(x: number, y: number, r: number): number {
    let hit = -1;
    let best = 0;
    for (const id of this.query(x - r, y - r, x + r, y + r)) {
      if (this.state.status[id] !== PIECE_STANDING) continue;
      const p = this.def.pieces[id] as PieceDef;
      const c = circleRect(x, y, r, p.x, p.y, p.w, p.h);
      if (c && c.depth > best) {
        best = c.depth;
        hit = id;
      }
    }
    return hit;
  }

  /** Piece ids whose grid cells overlap the box (may repeat; callers filter). */
  query(x0: number, y0: number, x1: number, y1: number): number[] {
    const out: number[] = [];
    const seen = new Set<number>();
    for (let gx = Math.floor(x0 / GRID); gx <= Math.floor(x1 / GRID); gx++) {
      for (let gy = Math.floor(y0 / GRID); gy <= Math.floor(y1 / GRID); gy++) {
        const list = this.h.grid.get(gridKey(gx, gy));
        if (!list) continue;
        for (const id of list) {
          if (seen.has(id)) continue;
          seen.add(id);
          out.push(id);
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------- bodies

  private detachGroups(groups: number[][]): void {
    const s = this.state;
    for (const group of groups) {
      const root = s.lastRoot;
      let mass = 0;
      let cx = 0;
      let cy = 0;
      for (const id of group) {
        const p = this.def.pieces[id] as PieceDef;
        mass += p.mass;
        cx += p.mass * (p.x + p.w / 2);
        cy += p.mass * (p.y + p.h / 2);
      }
      cx /= mass;
      cy /= mass;
      // Where it let go: the ties from this group to anything outside it.
      const set = new Set(group);
      let hingeX = 0;
      let hingeW = 0;
      for (const id of group) {
        for (const jid of this.h.adj.joints[id] as number[]) {
          const j = this.def.joints[jid];
          if (!j) continue;
          const other = j.a === id ? j.b : j.a;
          if (other !== GROUND && set.has(other)) continue;
          hingeX += j.x;
          hingeW += 1;
        }
      }
      if (hingeW > 0) hingeX /= hingeW;
      for (const id of group) {
        s.status[id] = PIECE_FALLING;
        s.extra[id] = 0;
      }
      this.credit(root, mass);
      if (mass > 20) this.bumpChain(root);
      const body = this.makeBody(group, root);
      // Tip away from where support was lost.
      if (s.pendingTip && cx > s.pendingTip.edge - 30 && cx < s.pendingTip.edge + 30 && mass > 30) {
        body.w = s.pendingTip.side < 0 ? 0.12 : -0.12;
        s.pendingTip = undefined;
      } else if (hingeW > 0) body.w = Math.max(-0.35, Math.min(0.35, (hingeX - cx) * 0.03));
      s.bodies.push(body);
      this.events.push({ type: 'detach', x: cx, y: cy, mass, count: group.length, root });
    }
  }

  private makeBody(pieces: number[], root: number, pose?: { x: number; y: number; a: number; wx: number[]; wy: number[] }): Body {
    const s = this.state;
    const def = this.def;
    let mass = 0;
    let cx = 0;
    let cy = 0;
    const wx: number[] = [];
    const wy: number[] = [];
    pieces.forEach((id, k) => {
      const p = def.pieces[id] as PieceDef;
      const x = pose ? (pose.wx[k] as number) : p.x + p.w / 2;
      const y = pose ? (pose.wy[k] as number) : p.y + p.h / 2;
      wx.push(x);
      wy.push(y);
      mass += p.mass;
      cx += p.mass * x;
      cy += p.mass * y;
    });
    cx /= mass;
    cy /= mass;
    const a = pose ? pose.a : 0;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const lx: number[] = [];
    const ly: number[] = [];
    let inertia = 0;
    let radius = 0;
    const px: number[] = [];
    const py: number[] = [];
    const ppiece: number[] = [];
    const seen = new Set<string>();
    pieces.forEach((id, k) => {
      const p = def.pieces[id] as PieceDef;
      const rx = (wx[k] as number) - cx;
      const ry = (wy[k] as number) - cy;
      const bx = rx * cos + ry * sin;
      const by = -rx * sin + ry * cos;
      lx.push(bx);
      ly.push(by);
      inertia += (p.mass * (p.w * p.w + p.h * p.h)) / 12 + p.mass * (bx * bx + by * by);
      radius = Math.max(radius, Math.hypot(bx, by) + Math.hypot(p.w, p.h) / 2);
      // Corners plus points along long edges.
      const nx = Math.max(1, Math.ceil(p.w / 1.4));
      const ny = Math.max(1, Math.ceil(p.h / 1.4));
      const add = (u: number, v: number): void => {
        const qx = bx + u;
        const qy = by + v;
        const key = `${Math.round(qx * 50)},${Math.round(qy * 50)}`;
        if (seen.has(key)) return;
        seen.add(key);
        px.push(qx);
        py.push(qy);
        ppiece.push(k);
      };
      for (let i = 0; i <= nx; i++) {
        const u = -p.w / 2 + (p.w * i) / nx;
        add(u, -p.h / 2);
        add(u, p.h / 2);
      }
      for (let i = 1; i < ny; i++) {
        const v = -p.h / 2 + (p.h * i) / ny;
        add(-p.w / 2, v);
        add(p.w / 2, v);
      }
    });
    const body: Body = {
      id: s.nextBodyId++,
      pieces: [...pieces],
      lx,
      ly,
      px,
      py,
      ppiece,
      x: cx,
      y: cy,
      a,
      vx: 0,
      vy: 0,
      w: 0,
      mass,
      inertia: Math.max(inertia, 1e-3),
      radius,
      state: 'moving',
      still: 0,
      root,
      perchOn: [],
      age: 0,
    };
    for (const id of pieces) s.bodyOf[id] = body.id;
    return body;
  }

  wake(b: Body): void {
    const s = this.state;
    if (b.state !== 'perched') return;
    for (const id of b.perchOn) s.extra[id] = Math.max(0, (s.extra[id] as number) - b.mass / b.perchOn.length);
    b.perchOn = [];
    b.root = Math.max(b.root, s.lastRoot);
    b.state = 'moving';
    b.still = 0;
    s.dirty = true;
  }

  private updateBodies(): void {
    const s = this.state;
    const bodies = s.bodies;
    let moving = 0;
    for (let bi = 0; bi < bodies.length; bi++) {
      const b = bodies[bi] as Body;
      if (b.state === 'rubble') continue;
      if (b.state === 'perched') {
        if (b.perchOn.some((id) => s.status[id] !== PIECE_STANDING)) this.wake(b);
        else continue;
      }
      moving += b.mass;
      b.age += DT;
      this.stepBody(b);
    }
    // Remove emptied bodies.
    if (bodies.some((b) => b.pieces.length === 0)) s.bodies = bodies.filter((b) => b.pieces.length > 0);
    for (const rec of s.roots) {
      if (rec && rec.swing === s.lastRoot && moving > rec.peakMoving) rec.peakMoving = moving;
    }
  }

  private stepBody(b: Body): void {
    const s = this.state;
    const def = this.def;
    b.vy -= GRAVITY * DT;
    b.w *= 1 - 0.15 * DT;
    b.x += b.vx * DT;
    b.y += b.vy * DT;
    b.a += b.w * DT;
    const cos = Math.cos(b.a);
    const sin = Math.sin(b.a);
    interface Contact {
      rx: number;
      ry: number;
      nx: number;
      ny: number;
      depth: number;
      piece: number;
      k: number;
      jn: number;
    }
    const contacts: Contact[] = [];
    let standingContacts = 0;
    let groundContacts = 0;
    // Broad phase against the standing structure.
    const minX = b.x - b.radius;
    const maxX = b.x + b.radius;
    const minY = b.y - b.radius;
    const maxY = b.y + b.radius;
    const near = this.query(minX, minY, maxX, maxY).filter((id) => s.status[id] === PIECE_STANDING);
    let groundNear = false;
    {
      const g = Math.max(heightAt(s.heightmap, minX), heightAt(s.heightmap, b.x), heightAt(s.heightmap, maxX));
      groundNear = minY < g + 6;
    }
    if (!near.length && !groundNear) {
      b.still = 0;
      return;
    }
    for (let i = 0; i < b.px.length; i++) {
      const lx = b.px[i] as number;
      const ly = b.py[i] as number;
      const rx = lx * cos - ly * sin;
      const ry = lx * sin + ly * cos;
      const wx = b.x + rx;
      const wy = b.y + ry;
      if (groundNear) {
        const g = heightAt(s.heightmap, wx);
        if (wy < g) {
          contacts.push({ rx, ry, nx: 0, ny: 1, depth: g - wy, piece: -1, k: b.ppiece[i] as number, jn: 0 });
          groundContacts++;
          continue;
        }
      }
      for (const id of near) {
        const p = def.pieces[id] as PieceDef;
        const m = 0.03;
        if (wx <= p.x + m || wx >= p.x + p.w - m || wy <= p.y + m || wy >= p.y + p.h - m) continue;
        // Push out along the shallowest axis.
        const dl = wx - p.x;
        const dr = p.x + p.w - wx;
        const db = wy - p.y;
        const dt = p.y + p.h - wy;
        let nx = 0;
        let ny = 1;
        let depth = dt;
        if (dl < depth) {
          depth = dl;
          nx = -1;
          ny = 0;
        }
        if (dr < depth) {
          depth = dr;
          nx = 1;
          ny = 0;
        }
        if (db < depth) {
          depth = db;
          nx = 0;
          ny = -1;
        }
        contacts.push({ rx, ry, nx, ny, depth, piece: id, k: b.ppiece[i] as number, jn: 0 });
        standingContacts++;
        break;
      }
    }
    if (!contacts.length) {
      b.still = 0;
      return;
    }

    // Impact damage on first touch, before the impulses kill the velocity.
    const broken = new Set<number>();
    const share = b.mass / contacts.length;
    let landE = 0;
    let landX = 0;
    let landY = 0;
    const bodyHits = new Map<number, number>();
    for (const c of contacts) {
      const vpx = b.vx - b.w * c.ry;
      const vpy = b.vy + b.w * c.rx;
      const vn = vpx * c.nx + vpy * c.ny;
      if (vn > -2) continue;
      const e = Math.min(5000, 0.5 * share * vn * vn);
      if (c.piece >= 0) {
        if (broken.has(c.piece)) continue;
        if (e > 150) triggerChargesAt(this, c.piece, b.x + c.rx, b.y + c.ry, b.root, 'debris', 0.6);
        const absorbed = this.damageStanding(c.piece, e * 0.6, b.root, 'impact', b.vx * 0.3, b.vy * 0.3);
        if (s.status[c.piece] !== PIECE_STANDING) {
          broken.add(c.piece);
          // Breaking through costs the section some of its momentum.
          const ke = 0.5 * b.mass * (b.vx * b.vx + b.vy * b.vy) + 1e-6;
          const k = Math.sqrt(Math.max(0.2, 1 - absorbed / ke));
          b.vx *= k;
          b.vy *= k;
        }
        bodyHits.set(c.k, (bodyHits.get(c.k) ?? 0) + e * 0.4);
      } else {
        bodyHits.set(c.k, (bodyHits.get(c.k) ?? 0) + e * 0.55);
        if (e > landE) {
          landE = e;
          landX = b.x + c.rx;
          landY = b.y + c.ry;
        }
      }
    }
    // A hard landing racks the whole section, not just the corner that hit:
    // tall frames break up along their joints as they slam down.
    let totalE = 0;
    for (const v of bodyHits.values()) totalE += v;
    if (totalE > 400 && b.pieces.length > 3 && b.age > 0.12) {
      const perPiece = (totalE * 1.1) / b.pieces.length;
      for (const id of b.pieces) {
        if (id < 0) continue;
        for (const jid of this.h.adj.joints[id] as number[]) {
          if (!s.jointOk[jid]) continue;
          const j = def.joints[jid];
          if (!j || j.b === GROUND || j.a !== id) continue;
          if (s.bodyOf[j.b] !== b.id) continue;
          s.jointDmg[jid] = Math.min(1, (s.jointDmg[jid] as number) + perPiece / j.toughness);
          if ((s.jointDmg[jid] as number) >= 1) s.jointOk[jid] = 0;
        }
      }
    }
    if (landE > 60) {
      vaultImpact(this, landX, landE * contacts.length);
      const p = def.pieces[Math.max(0, b.pieces.find((id) => id >= 0) ?? 0)] as PieceDef;
      this.events.push({ type: 'land', x: landX, y: landY, energy: landE * contacts.length, mass: b.mass, material: p.material });
    }

    // Sequential impulses.
    const e = 0.08;
    const mu = 0.7;
    for (let iter = 0; iter < 4; iter++) {
      for (const c of contacts) {
        if (c.piece >= 0 && broken.has(c.piece)) continue;
        const vpx = b.vx - b.w * c.ry;
        const vpy = b.vy + b.w * c.rx;
        const vn = vpx * c.nx + vpy * c.ny;
        const rn = c.rx * c.ny - c.ry * c.nx;
        const invN = 1 / b.mass + (rn * rn) / b.inertia;
        let jn = (-(1 + e) * vn) / invN;
        const old = c.jn;
        c.jn = Math.max(0, old + jn);
        jn = c.jn - old;
        b.vx += (jn * c.nx) / b.mass;
        b.vy += (jn * c.ny) / b.mass;
        b.w += (jn * rn) / b.inertia;
        // Friction.
        const tx = -c.ny;
        const ty = c.nx;
        const vpx2 = b.vx - b.w * c.ry;
        const vpy2 = b.vy + b.w * c.rx;
        const vt = vpx2 * tx + vpy2 * ty;
        const rt = c.rx * ty - c.ry * tx;
        const invT = 1 / b.mass + (rt * rt) / b.inertia;
        let jt = -vt / invT;
        const maxF = mu * c.jn;
        jt = Math.max(-maxF, Math.min(maxF, jt));
        b.vx += (jt * tx) / b.mass;
        b.vy += (jt * ty) / b.mass;
        b.w += (jt * rt) / b.inertia;
      }
    }
    // Positional correction from the deepest contacts.
    let cx = 0;
    let cy = 0;
    let deepest = 0;
    for (const c of contacts) {
      if (c.piece >= 0 && broken.has(c.piece)) continue;
      if (c.depth > deepest) {
        deepest = c.depth;
        cx = c.nx;
        cy = c.ny;
      }
    }
    if (deepest > 0.01) {
      const corr = Math.min(0.25, (deepest - 0.01) * 0.6);
      b.x += cx * corr;
      b.y += cy * corr;
    }

    // A big section bearing on something crumples under its own weight,
    // worst where it bears and worse the further it leans.
    if (b.mass > 150 && b.pieces.length > 4 && b.age > 0.3 && this.crumple(b, contacts)) {
      this.splitBody(b);
      return;
    }

    // Break the section where it was hit hardest.
    if (bodyHits.size && b.age > 0.12) {
      let changed = b.pieces.some((id) => id >= 0 && this.brokenInside(b, id));
      for (const [k, energy] of bodyHits) {
        if (energy < 25) continue;
        if (this.damageBodyPiece(b, k, energy, b.root, true)) changed = true;
      }
      if (changed) {
        this.splitBody(b);
        return;
      }
    }

    // Settling.
    const speed = Math.hypot(b.vx, b.vy);
    if (speed < 0.45 && Math.abs(b.w) < 0.3) b.still += DT;
    else b.still = 0;
    // Anything barely creeping after a long time down is treated as settled.
    if (b.age > 10 && speed < 1.2 && Math.abs(b.w) < 0.5) b.still = Math.max(b.still, 0.46);
    if (b.still > 0.45) {
      if (standingContacts > 0) {
        const on = [...new Set(contacts.filter((c) => c.piece >= 0 && !broken.has(c.piece)).map((c) => c.piece))];
        if (on.length) {
          b.state = 'perched';
          b.perchOn = on;
          b.vx = 0;
          b.vy = 0;
          b.w = 0;
          for (const id of on) s.extra[id] = (s.extra[id] as number) + b.mass / on.length;
          s.dirty = true;
          if (b.root) this.claim(b.root);
        }
      } else if (groundContacts > 0) {
        // Nothing tall and slender comes to rest standing on end: it goes over in pieces.
        if (this.tooTallToRest(b)) {
          this.fallApart(b);
          return;
        }
        this.toRubble(b);
      }
    }
  }

  private tooTallToRest(b: Body): boolean {
    if (b.pieces.filter((id) => id >= 0).length < 2) return false;
    const cos = Math.cos(b.a);
    const sin = Math.sin(b.a);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < b.px.length; i++) {
      const y = b.y + (b.px[i] as number) * sin + (b.py[i] as number) * cos;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    return hi - lo > 6;
  }

  /** Breaks every tie inside a section and lets the pieces topple on their own. */
  private fallApart(b: Body): void {
    const s = this.state;
    for (const id of b.pieces) {
      if (id < 0) continue;
      for (const jid of this.h.adj.joints[id] as number[]) {
        const j = this.def.joints[jid];
        if (!j || j.b === GROUND || !s.jointOk[jid]) continue;
        const other = j.a === id ? j.b : j.a;
        if (s.bodyOf[other] === b.id) s.jointOk[jid] = 0;
      }
    }
    const before = new Set(s.bodies);
    this.splitBody(b);
    // A nudge, alternating, so the pieces go over instead of balancing.
    let k = 0;
    for (const nb of s.bodies) {
      if (before.has(nb)) continue;
      nb.w = (k++ % 2 === 0 ? 1 : -1) * 0.9;
      nb.vx += nb.w * 0.4;
    }
  }

  /** Self-weight damage to a section's internal ties. Returns true if any gave way. */
  private crumple(b: Body, contacts: Array<{ ry: number }>): boolean {
    const s = this.state;
    const def = this.def;
    let lowY = Infinity;
    for (const c of contacts) lowY = Math.min(lowY, b.y + c.ry);
    const lean = Math.min(1, Math.abs(Math.sin(b.a)) * 2.5 + 0.35);
    const k = DT * 2 * lean * Math.min(2.5, b.mass / 700);
    const cos = Math.cos(b.a);
    const sin = Math.sin(b.a);
    let changed = false;
    b.pieces.forEach((id, idx) => {
      if (id < 0) return;
      const wy = b.y + (b.lx[idx] as number) * sin + (b.ly[idx] as number) * cos;
      const near = Math.exp(-Math.max(0, wy - lowY) / 9);
      if (near < 0.05) return;
      for (const jid of this.h.adj.joints[id] as number[]) {
        if (!s.jointOk[jid]) continue;
        const j = def.joints[jid];
        if (!j || j.b === GROUND || j.a !== id || s.bodyOf[j.b] !== b.id) continue;
        s.jointDmg[jid] = Math.min(1, (s.jointDmg[jid] as number) + k * near * (600 / j.toughness));
        if ((s.jointDmg[jid] as number) >= 1) {
          s.jointOk[jid] = 0;
          changed = true;
        }
      }
    });
    return changed;
  }

  private brokenInside(b: Body, id: number): boolean {
    const s = this.state;
    for (const jid of this.h.adj.joints[id] as number[]) {
      const j = this.def.joints[jid];
      if (!j || j.b === GROUND || s.jointOk[jid]) continue;
      const other = j.a === id ? j.b : j.a;
      if (s.bodyOf[other] === b.id && s.status[other] === PIECE_FALLING) return true;
    }
    return false;
  }

  /** Damages one piece of a falling section. Returns true if the section's shape changed. */
  damageBodyPiece(b: Body, k: number, energy: number, root: number, deferSplit = false): boolean {
    const s = this.state;
    const id = b.pieces[k];
    if (id === undefined) return false;
    let changed = false;
    s.hp[id] = (s.hp[id] as number) - energy;
    for (const jid of this.h.adj.joints[id] as number[]) {
      if (!s.jointOk[jid]) continue;
      const j = this.def.joints[jid];
      if (!j || j.b === GROUND) continue;
      const other = j.a === id ? j.b : j.a;
      if (s.bodyOf[other] !== b.id) continue;
      s.jointDmg[jid] = Math.min(1, (s.jointDmg[jid] as number) + (energy * 0.5) / j.toughness);
      if ((s.jointDmg[jid] as number) >= 1) {
        s.jointOk[jid] = 0;
        changed = true;
      }
    }
    if ((s.hp[id] as number) <= 0) {
      const p = this.def.pieces[id] as PieceDef;
      const cos = Math.cos(b.a);
      const sin = Math.sin(b.a);
      const lx = b.lx[k] as number;
      const ly = b.ly[k] as number;
      const wx = b.x + lx * cos - ly * sin;
      const wy = b.y + lx * sin + ly * cos;
      s.status[id] = PIECE_GONE;
      s.bodyOf[id] = -1;
      this.events.push({ type: 'shatter', piece: id, x: wx, y: wy, a: b.a, vx: b.vx, vy: b.vy, material: p.material, cause: 'impact' });
      this.depositMound(wx, p.w, p.w * p.h * RUBBLE_BULK);
      // Smashed on landing, a member still lies there, battered, in the heap.
      const ground = heightAt(s.heightmap, wx);
      if (p.material !== 'glass' && wy < ground + 5) {
        s.wreck.push({ piece: id, x: wx, y: ground + Math.min(p.w, p.h) * 0.3, a: b.a, g: ground });
        if (s.wreck.length > MAX_WRECK) s.wreck.shift();
      }
      b.pieces[k] = -1;
      changed = true;
      void root;
    }
    if (changed && !deferSplit) this.splitBody(b);
    return changed;
  }

  /** Rebuilds a section after pieces broke off or ties snapped, splitting it into its connected parts. */
  private splitBody(b: Body): void {
    const s = this.state;
    const cos = Math.cos(b.a);
    const sin = Math.sin(b.a);
    const live: number[] = [];
    const wx = new Map<number, number>();
    const wy = new Map<number, number>();
    b.pieces.forEach((id, k) => {
      if (id < 0) return;
      live.push(id);
      const lx = b.lx[k] as number;
      const ly = b.ly[k] as number;
      wx.set(id, b.x + lx * cos - ly * sin);
      wy.set(id, b.y + lx * sin + ly * cos);
    });
    const index = s.bodies.indexOf(b);
    if (!live.length) {
      b.pieces = [];
      return;
    }
    const set = new Set(live);
    const seen = new Set<number>();
    const groups: number[][] = [];
    for (const start of live) {
      if (seen.has(start)) continue;
      const g: number[] = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const cur = stack.pop() as number;
        g.push(cur);
        for (const jid of this.h.adj.joints[cur] as number[]) {
          if (!s.jointOk[jid]) continue;
          const j = this.def.joints[jid];
          if (!j || j.b === GROUND) continue;
          const other = j.a === cur ? j.b : j.a;
          if (!set.has(other) || seen.has(other)) continue;
          seen.add(other);
          stack.push(other);
        }
      }
      groups.push(g);
    }
    // Ties broke but nothing actually came apart: it is still the same section.
    if (groups.length === 1 && live.length === b.pieces.length) return;
    const made: Body[] = [];
    for (const g of groups) {
      const nb = this.makeBody(g, b.root, { x: b.x, y: b.y, a: b.a, wx: g.map((id) => wx.get(id) as number), wy: g.map((id) => wy.get(id) as number) });
      // Carry the motion of the parent at the new centre of mass.
      const rx = nb.x - b.x;
      const ry = nb.y - b.y;
      nb.vx = b.vx - b.w * ry;
      nb.vy = b.vy + b.w * rx;
      nb.w = b.w;
      nb.age = 0;
      made.push(nb);
    }
    b.pieces = [];
    if (index >= 0) s.bodies.splice(index, 1, ...made);
    else s.bodies.push(...made);
  }

  /**
   * A section at rest on the ground breaks up into a rubble heap: a frame
   * that has fallen is mostly air, so the heap is far lower than the section
   * was tall.
   */
  private toRubble(b: Body): void {
    const s = this.state;
    const cos = Math.cos(b.a);
    const sin = Math.sin(b.a);
    let shown = 0;
    const kept: Array<{ piece: number; x: number; y: number }> = [];
    b.pieces.forEach((id, k) => {
      if (id < 0) return;
      const p = this.def.pieces[id] as PieceDef;
      const lx = b.lx[k] as number;
      const ly = b.ly[k] as number;
      const cx = b.x + lx * cos - ly * sin;
      const cy = b.y + lx * sin + ly * cos;
      s.status[id] = PIECE_GONE;
      s.bodyOf[id] = -1;
      if (blockFromPiece(this, p, cx)) return;
      this.depositMound(cx, Math.max(p.w, p.h) * 0.8, p.w * p.h * RUBBLE_BULK);
      // The frame stays where it landed, so a collapse leaves a wreck you can read, not a smear.
      if (p.material !== 'glass') kept.push({ piece: id, x: cx, y: cy });
      else if (shown < 10) {
        shown++;
        this.events.push({ type: 'shatter', piece: id, x: cx, y: cy, a: b.a, vx: 0, vy: 0, material: p.material, cause: 'impact' });
      }
    });
    for (const w of kept) s.wreck.push({ ...w, a: b.a, g: heightAt(s.heightmap, w.x) });
    if (s.wreck.length > MAX_WRECK) s.wreck.splice(0, s.wreck.length - MAX_WRECK);
    b.pieces = [];
    b.state = 'rubble';
  }

  depositMound(x: number, w: number, area: number): void {
    const hm = this.state.heightmap;
    const half = Math.max(1, w * 0.9);
    const peak = area / half;
    const i0 = Math.max(0, Math.floor((x - half - HM_MIN_X) / HM_CELL));
    const i1 = Math.min(hm.length - 1, Math.ceil((x + half - HM_MIN_X) / HM_CELL));
    for (let i = i0; i <= i1; i++) {
      const cx = HM_MIN_X + i * HM_CELL;
      const t = 1 - Math.abs(cx - x) / half;
      if (t > 0) hm[i] = (hm[i] as number) + peak * t * HM_CELL;
    }
  }

  /** Lets rubble slump to a natural slope. */
  private relaxRubble(): void {
    const hm = this.state.heightmap;
    const maxStep = HM_CELL * 0.62;
    for (let i = 0; i < hm.length - 1; i++) {
      const a = hm[i] as number;
      const b = hm[i + 1] as number;
      const d = a - b;
      if (d > maxStep) {
        const m = (d - maxStep) * 0.25;
        hm[i] = a - m;
        hm[i + 1] = b + m;
      } else if (-d > maxStep) {
        const m = (-d - maxStep) * 0.25;
        hm[i] = a + m;
        hm[i + 1] = b - m;
      }
    }
  }

  private trackQuiet(): void {
    const s = this.state;
    const active = s.bodies.some((b) => b.state === 'moving' && b.mass > 2 && (Math.hypot(b.vx, b.vy) > 0.6 || Math.abs(b.w) > 0.3)) || this.anyCreeping();
    s.quietFor = active ? 0 : s.quietFor + DT;
  }

  private anyCreeping(): boolean {
    const r = this.solution;
    const s = this.state;
    for (let i = 0; i < r.pieceStress.length; i++) if ((r.pieceStress[i] as number) > 1 && s.status[i] === PIECE_STANDING) return true;
    for (let j = 0; j < r.jointStress.length; j++) if ((r.jointStress[j] as number) > 1 && s.jointOk[j]) return true;
    return false;
  }

  /** The swing whose chain brought down the most. */
  decisiveSwing(): RootRecord | undefined {
    let best: RootRecord | undefined;
    for (const r of this.state.roots) if (r && (!best || r.mass > best.mass)) best = r;
    return best;
  }
}

/** Fraction of capacity left at a given remaining hit energy. */
export function integrity(hp: number, maxHp: number): number {
  if (maxHp <= 0) return 1;
  const f = Math.max(0, hp) / maxHp;
  return 0.12 + 0.88 * f;
}

function distToRect(px: number, py: number, x: number, y: number, w: number, h: number): number {
  const dx = Math.max(x - px, 0, px - (x + w));
  const dy = Math.max(y - py, 0, py - (y + h));
  return Math.hypot(dx, dy);
}

/** Circle against an axis-aligned rectangle: normal points from the rectangle to the circle. */
function circleRect(cx: number, cy: number, r: number, x: number, y: number, w: number, h: number): { nx: number; ny: number; depth: number } | undefined {
  const qx = Math.max(x, Math.min(cx, x + w));
  const qy = Math.max(y, Math.min(cy, y + h));
  const dx = cx - qx;
  const dy = cy - qy;
  const d2 = dx * dx + dy * dy;
  if (d2 > r * r) return undefined;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, ny: dy / d, depth: r - d };
  }
  // Centre inside: push out the nearest side.
  const dl = cx - x;
  const dr = x + w - cx;
  const db = cy - y;
  const dt = y + h - cy;
  const m = Math.min(dl, dr, db, dt);
  if (m === dl) return { nx: -1, ny: 0, depth: r + dl };
  if (m === dr) return { nx: 1, ny: 0, depth: r + dr };
  if (m === db) return { nx: 0, ny: -1, depth: r + db };
  return { nx: 0, ny: 1, depth: r + dt };
}
