import type { SiteLayout } from './buildings';
import type { Kit } from './kit';
import type { PieceDef, PieceMaterial } from './structure';
import { DT, PIECE_FALLING, PIECE_GONE, PIECE_STANDING, heightAt, HEIGHTMAP, type Body, type WreckSim } from './sim';

/**
 * Everything on the job besides the crane: charges, the high-reach
 * excavator, the dozer, the debris blocks it pushes and the site they are
 * pushed off. All of it is simulation state, stepped inside WreckSim.step(),
 * so a recorded job replays exactly like a swing does.
 *
 * Coordinates as in structure.ts: metres, x right, y up, ground at 0.
 */

export type Tool = 'charge' | 'ball' | 'excavator' | 'dozer' | 'loader';
export type ChargeKind = 'cutter' | 'blast' | 'shaped';
export type FireCause = 'volley' | 'ball' | 'debris' | 'chain';



export const CHARGE_SPEC: Record<ChargeKind, { main: number; splash: number; radius: number; reveal: number; chainR: number }> = {
  // Cuts the member it is strapped to and little else.
  cutter: { main: 760, splash: 90, radius: 1.6, reveal: 3, chainR: 1.6 },
  // Less on the member, a wide shock that strips cladding, loosens joints and finds weak points.
  blast: { main: 420, splash: 300, radius: 3.4, reveal: 7, chainR: 3.2 },
  // Focused jet: goes through cores, chimneys and trusses, hardly touches anything else.
  shaped: { main: 1900, splash: 40, radius: 1.1, reveal: 2, chainR: 1 },
};

export const CHARGE_KINDS = new Set<PieceDef['kind']>(['column', 'core', 'stack', 'truss', 'beam', 'roof', 'legs']);
/** Fuse after the button, then the gap between charges in the firing order. */
export const FUSE_TICKS = 75;
export const STEP_TICKS = 12;

export interface Charge {
  id: number;
  piece: number;
  kind: ChargeKind;
  /** Height up the piece where it is strapped, relative to the piece's base. */
  dy: number;
  order: number;
  /** 0 set, 1 armed (fuse burning), 2 fired. */
  state: 0 | 1 | 2;
  fireTick: number;
  root: number;
  cause: FireCause | 'lost';
}

export interface Excavator {
  x: number;
  y: number;
  face: 1 | -1;
  jawX: number;
  jawY: number;
  targetX: number;
  targetY: number;
  biting: boolean;
  biteTimer: number;
  /** 0..1 jaw closing animation. */
  jaw: number;
  root: number;
  stunned: number;
  sessions: number;
  /** Arm lengths (m); the long-reach boom makes them longer. */
  l1: number;
  l2: number;
  /** A scripted operation: drive into reach, then bite this many times. */
  order?: { bites: number; t: number };
}

export interface Dozer {
  x: number;
  y: number;
  dir: 1 | -1;
  targetX: number;
  bladeDown: boolean;
  /** Rubble and blocks riding on the blade (m², for speed and drawing). */
  load: number;
  stall: '' | 'heavy' | 'structure' | 'full';
  ramTimer: number;
  root: number;
  lastRam: number;
  stunned: number;
  speed: number;
  /** Blade up: driving into position, not pushing. */
  travel: boolean;
  /** A scripted run: drive behind `from`, then push toward `to`. */
  order?: { phase: 'move' | 'push'; from: number; to: number; dir: 1 | -1; t: number; stuck: number };
}

export type LoaderPhase = 'idle' | 'go' | 'scoop' | 'carry' | 'dump';

/** The wheel loader: scoops a bucket of rubble or lifts one block, and drives it to the pad or the pit. */
export interface Loader {
  x: number;
  y: number;
  face: 1 | -1;
  phase: LoaderPhase;
  targetX: number;
  dumpX: number;
  dumpTo: 'pad' | 'pit' | '';
  /** Seconds in the current phase. */
  t: number;
  /** Rubble in the bucket (m²). */
  bucket: number;
  carry?: Block;
  /** 0 bucket on the ground, 1 raised. */
  arm: number;
  stunned: number;
  speed: number;
  loads: number;
}

export type BlockKind = 'slab' | 'steel' | 'vault';

export interface Block {
  id: number;
  kind: BlockKind;
  label: string;
  material: PieceMaterial;
  x: number;
  y: number;
  w: number;
  h: number;
  mass: number;
  hp: number;
  maxHp: number;
  /** Rubble area it turns into when broken or counted for clearance. */
  area: number;
  seed: number;
}

export interface Tally {
  /** Rubble area trucked away (m²). */
  hauled: number;
  steelSalvaged: number;
  steelScrapped: number;
  /** Vault condition when it reached the pad; -1 not yet, -2 pushed into the pit. */
  vaultSaved: number;
  vaultCondition: number;
  chargesFired: number;
  ballFired: number;
  debrisFired: number;
  chainFired: number;
  flawsExploited: number;
  machineHits: number;
  bites: number;
  /** Tick of the first action that starts the clock, or -1 while planning. */
  clockStart: number;
  /** Rubble the loader brought to the pad with the scrap sorter fitted (m²). */
  recycled: number;
}

/** Truss-heavy and steel pieces leave salvage; core walls leave slabs too heavy for the dozer. */
export const HEAVY_BLOCK = 20;
const DOZER_PUSH_MAX = 34;
export const DOZER_HALF = 2.6;
export const BLADE = 0.65;
export const BLADE_H = 1.7;
/** Rubble the blade can carry before it starts spilling over (m²). */
export const BLADE_CAP = 9;
/** How far ahead of the blade the pile it drives reaches (m). */
const PILE_W = 3.2;
const EXC_HALF = 3.2;
export const EXC_L1 = 12.5;
export const EXC_L2 = 10.5;
export const LOADER_HALF = 2.4;
/** Bucket lip ahead of the loader's centre. */
export const LOADER_REACH = 3.6;
const EXC_PIVOT_Y = 3.4;

const BITE_EVERY = 0.62;
const MAX_BLOCKS = 16;
const MAX_SLABS = 6;


export const FLAW_HIDDEN = 1;
export const FLAW_SHOWN = 2;
export const FLAW_USED = 3;
/** Damage to a flawed piece is multiplied by this. */
export const FLAW_MULT = 2;


export function blockArea(p: PieceDef): number {
  return p.w * p.h * 0.24;
}

export function initialMachines(site: SiteLayout, kit: Kit): { exc: Excavator; dozer: Dozer; loader: Loader } {
  const face: 1 | -1 = site.excX > (site.lotMin + site.lotMax) / 2 ? -1 : 1;
  const exc: Excavator = {
    x: site.excX,
    y: 0,
    face,
    jawX: 0,
    jawY: 0,
    targetX: site.excX + face * 8,
    targetY: 6,
    biting: false,
    biteTimer: 0,
    jaw: 0,
    root: 0,
    stunned: 0,
    sessions: 0,
    l1: EXC_L1 * kit.excReach,
    l2: EXC_L2 * kit.excReach,
  };
  const arm = excavatorArm(exc, exc.targetX, exc.targetY);
  exc.jawX = arm.jx;
  exc.jawY = arm.jy;
  const dozer: Dozer = { x: site.dozerX, y: 0, dir: 1, targetX: site.dozerX, bladeDown: false, load: 0, stall: '', ramTimer: 0, root: 0, lastRam: -99, stunned: 0, speed: 0, travel: false };
  const loader: Loader = { x: site.loaderX, y: 0, face: 1, phase: 'idle', targetX: site.loaderX, dumpX: 0, dumpTo: '', t: 0, bucket: 0, arm: 0, stunned: 0, speed: 0, loads: 0 };
  return { exc, dozer, loader };
}

export function emptyTally(): Tally {
  return { hauled: 0, steelSalvaged: 0, steelScrapped: 0, vaultSaved: -1, vaultCondition: 1, chargesFired: 0, ballFired: 0, debrisFired: 0, chainFired: 0, flawsExploited: 0, machineHits: 0, bites: 0, clockStart: -1, recycled: 0 };
}

// --------------------------------------------------------------- geometry

export function excavatorPivot(e: Pick<Excavator, 'x' | 'y' | 'face'>): { x: number; y: number } {
  return { x: e.x + e.face * 0.9, y: e.y + EXC_PIVOT_Y };
}

/** Two-link arm, elbow up, reaching as close to (tx, ty) as it can. */
export function excavatorArm(e: Pick<Excavator, 'x' | 'y' | 'face' | 'l1' | 'l2'>, tx: number, ty: number): { px: number; py: number; ex: number; ey: number; jx: number; jy: number } {
  const p = excavatorPivot(e);
  let dx = tx - p.x;
  let dy = ty - p.y;
  let d = Math.hypot(dx, dy);
  if (d < 1e-6) {
    dx = e.face;
    dy = 0;
    d = 1;
  }
  const L1 = e.l1;
  const L2 = e.l2;
  const phi = Math.atan2(dy, dx);
  const reach = Math.max(3, Math.min(L1 + L2 - 0.05, d));
  const cosA = (L1 * L1 + reach * reach - L2 * L2) / (2 * L1 * reach);
  const alpha = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const t1 = phi + (dx >= 0 ? 1 : -1) * alpha;
  return {
    px: p.x,
    py: p.y,
    ex: p.x + Math.cos(t1) * L1,
    ey: p.y + Math.sin(t1) * L1,
    jx: p.x + Math.cos(phi) * reach,
    jy: p.y + Math.sin(phi) * reach,
  };
}

/** Where a charge sits now: on its standing piece, riding a falling section, or where it went off. */
export function chargePos(sim: WreckSim, c: Charge): { x: number; y: number; a: number } {
  const p = sim.def.pieces[c.piece] as PieceDef;
  const s = sim.state;
  if (s.status[c.piece] === PIECE_FALLING) {
    const b = s.bodies.find((bb) => bb.id === s.bodyOf[c.piece]);
    const k = b ? b.pieces.indexOf(c.piece) : -1;
    if (b && k >= 0) {
      const lx = b.lx[k] as number;
      const ly = (b.ly[k] as number) - p.h / 2 + c.dy;
      return { x: b.x + lx * Math.cos(b.a) - ly * Math.sin(b.a), y: b.y + lx * Math.sin(b.a) + ly * Math.cos(b.a), a: b.a };
    }
  }
  return { x: p.x + p.w / 2, y: p.y + c.dy, a: 0 };
}

export function dozerBlade(d: Dozer): number {
  return d.x + d.dir * (DOZER_HALF + BLADE);
}

export function dozerBox(d: Dozer): { x0: number; x1: number; y0: number; y1: number } {
  return { x0: d.x - DOZER_HALF - BLADE, x1: d.x + DOZER_HALF + BLADE, y0: d.y, y1: d.y + 3.3 };
}

export function excavatorBox(e: Excavator): { x0: number; x1: number; y0: number; y1: number } {
  return { x0: e.x - EXC_HALF, x1: e.x + EXC_HALF, y0: e.y, y1: e.y + 4.2 };
}

/** The vault is safe inside the core until the core's base wall is gone. */
export function vaultProtected(sim: WreckSim): boolean {
  return sim.h.vaultHome >= 0 && sim.state.status[sim.h.vaultHome] === PIECE_STANDING;
}

export function vaultBlock(sim: WreckSim): Block | undefined {
  return sim.state.blocks.find((b) => b.kind === 'vault');
}

// --------------------------------------------------------------- charges

export function placeCharge(sim: WreckSim, piece: number, kind: ChargeKind, y: number): Charge | string {
  const s = sim.state;
  const p = sim.def.pieces[piece];
  if (!p || s.status[piece] !== PIECE_STANDING) return 'That part is already down.';
  if (!CHARGE_KINDS.has(p.kind)) return 'Cladding carries nothing. Charge the frame: columns, core walls, slabs, the truss.';
  if (s.charges.some((c) => c.piece === piece && c.state < 2)) return 'That part already has a charge.';
  if (kind === 'shaped' && !s.kit.shaped) return 'Shaped charges need the licence.';
  if ((s.chargesLeft[kind] ?? 0) <= 0) return 'No charges of that kind left.';
  s.chargesLeft[kind] -= 1;
  const c: Charge = { id: s.nextChargeId++, piece, kind, dy: Math.max(0.3, Math.min(p.h - 0.3, y - p.y)), order: s.nextChargeId, state: 0, fireTick: -1, root: 0, cause: 'volley' };
  s.charges.push(c);
  return c;
}

export function removeCharge(sim: WreckSim, id: number): boolean {
  const s = sim.state;
  const i = s.charges.findIndex((c) => c.id === id && c.state === 0);
  if (i < 0) return false;
  const c = s.charges[i] as Charge;
  s.chargesLeft[c.kind] += 1;
  s.charges.splice(i, 1);
  return true;
}

/** Arms every set charge: they fire in the order they were placed. */
export function detonate(sim: WreckSim): number {
  const s = sim.state;
  const set = s.charges.filter((c) => c.state === 0).sort((a, b) => a.order - b.order);
  if (!set.length) return 0;
  const root = sim.newRoot('charge');
  const rec = s.roots[root];
  set.forEach((c, i) => {
    c.state = 1;
    c.fireTick = s.tick + FUSE_TICKS + i * STEP_TICKS;
    c.root = root;
    c.cause = 'volley';
  });
  if (rec) {
    rec.charges = set.length;
    const first = chargePos(sim, set[0] as Charge);
    rec.hitPiece = (set[0] as Charge).piece;
    rec.hitX = first.x;
    rec.hitY = first.y;
    rec.hitT = s.time + FUSE_TICKS * DT;
  }
  sim.emit({ type: 'arm', count: set.length, root });
  return set.length;
}

export function stepCharges(sim: WreckSim): void {
  const s = sim.state;
  for (const c of s.charges) {
    if (c.state === 2) continue;
    // A member smashed before its charge went off takes the charge into the rubble with it.
    if (s.status[c.piece] === PIECE_GONE) {
      const p = sim.def.pieces[c.piece] as PieceDef;
      c.state = 2;
      c.cause = 'lost';
      sim.emit({ type: 'chargeLost', x: p.x + p.w / 2, y: p.y + c.dy });
      continue;
    }
    if (c.state === 1 && s.tick >= c.fireTick) fireCharge(sim, c, c.root, c.cause as FireCause);
  }
}

/** Sets a charge off now. Used by the volley, by the ball and by falling debris. */
export function fireCharge(sim: WreckSim, c: Charge, root: number, cause: FireCause): void {
  const s = sim.state;
  if (c.state === 2) return;
  c.state = 2;
  c.root = root;
  c.cause = cause;
  const t = s.tally;
  t.chargesFired++;
  if (cause === 'ball') t.ballFired++;
  else if (cause === 'debris') t.debrisFired++;
  else if (cause === 'chain') t.chainFired++;
  if (t.clockStart < 0) t.clockStart = s.tick;
  const base = CHARGE_SPEC[c.kind];
  const kit = s.kit;
  const spec = { ...base, main: base.main * kit.chargePower, splash: base.splash * kit.chargePower, radius: base.radius * kit.chargeRadius, reveal: base.reveal * kit.chargeRadius };
  const pos = chargePos(sim, c);
  const rec = s.roots[root];
  if (rec && cause !== 'volley') rec.charges += 1;
  if (s.status[c.piece] === PIECE_STANDING) {
    const cp = sim.def.pieces[c.piece] as PieceDef;
    // A shaped jet is made for mass concrete, masonry and steel; it does far less to a light member.
    const jet = c.kind === 'shaped' && !(cp.kind === 'core' || cp.kind === 'stack' || cp.kind === 'truss' || cp.material === 'steel' || cp.kind === 'column') ? 0.5 : 1;
    sim.damageStanding(c.piece, spec.main * jet, root, 'blast', 0, 2);
  } else if (s.status[c.piece] === PIECE_FALLING) {
    const b = s.bodies.find((bb) => bb.id === s.bodyOf[c.piece]);
    if (b) {
      const k = b.pieces.indexOf(c.piece);
      if (b.state === 'perched') sim.wake(b);
      if (k >= 0) sim.damageBodyPiece(b, k, spec.main, root);
    }
  }
  // The shock wave.
  for (const id of sim.query(pos.x - spec.radius, pos.y - spec.radius, pos.x + spec.radius, pos.y + spec.radius)) {
    if (id === c.piece || s.status[id] !== PIECE_STANDING) continue;
    const p = sim.def.pieces[id] as PieceDef;
    const d = distToRect(pos.x, pos.y, p.x, p.y, p.w, p.h);
    if (d > spec.radius) continue;
    const k = 1 - d / spec.radius;
    // Glass and brick take a blast far worse than the frame does.
    const soft = p.carriesOthers ? 1 : 1.4;
    sim.damageStanding(id, spec.splash * k * soft, root, 'blast', Math.sign(p.x + p.w / 2 - pos.x) * 3 * k, 2 * k);
  }
  revealNear(sim, pos.x, pos.y, spec.reveal);
  sim.emit({ type: 'blast', x: pos.x, y: pos.y, kind: c.kind, cause, root, piece: c.piece });
  // Close neighbours go off in sympathy.
  for (const o of s.charges) {
    if (o.state === 2 || o === c) continue;
    const op = chargePos(sim, o);
    if (Math.hypot(op.x - pos.x, op.y - pos.y) > spec.chainR) continue;
    if (o.state === 1) {
      // Already burning: the shock just brings it forward.
      o.fireTick = Math.min(o.fireTick, s.tick + 4);
      continue;
    }
    o.state = 1;
    o.fireTick = s.tick + 4;
    o.root = root;
    o.cause = 'chain';
  }
}

/** A blow or a falling section landing on a charged part sets it off. */
export function triggerChargesAt(sim: WreckSim, piece: number, x: number, y: number, root: number, cause: FireCause, reach: number): void {
  for (const c of sim.state.charges) {
    if (c.state !== 0) continue;
    if (c.piece !== piece) {
      const p = chargePos(sim, c);
      if (Math.hypot(p.x - x, p.y - y) > reach) continue;
    }
    fireCharge(sim, c, root, cause);
  }
}

// ----------------------------------------------------------------- flaws

/** Uncovers hidden weak points near (x, y). */
export function revealNear(sim: WreckSim, x: number, y: number, r: number): void {
  const s = sim.state;
  for (const id of sim.h.flaws) {
    if (s.flaw[id] !== FLAW_HIDDEN || s.status[id] !== PIECE_STANDING) continue;
    const p = sim.def.pieces[id] as PieceDef;
    if (distToRect(x, y, p.x, p.y, p.w, p.h) > r) continue;
    s.flaw[id] = FLAW_SHOWN;
    sim.emit({ type: 'reveal', piece: id });
  }
}

// ------------------------------------------------------------- excavator

export function stepExcavator(sim: WreckSim): void {
  const s = sim.state;
  const e = s.exc;
  e.jaw = Math.max(0, e.jaw - DT * 2.5);
  if (e.stunned > 0) {
    e.stunned -= DT;
    return;
  }
  // Face the work, and drive until it is within comfortable reach.
  const tx = e.targetX;
  const ty = Math.max(0.6, e.targetY);
  if (Math.abs(tx - e.x) > 1.5) e.face = tx > e.x ? 1 : -1;
  const pivot = excavatorPivot(e);
  const horiz = Math.abs(tx - pivot.x);
  const vert = ty - pivot.y;
  const comfortable = Math.sqrt(Math.max(0, (e.l1 + e.l2 - 2.5) ** 2 - vert * vert));
  let want = e.x;
  if (horiz > comfortable) want = tx - e.face * (comfortable + 0.9 - 0.2);
  else if (horiz < 4) want = tx - e.face * (4.9);
  const lim = travelLimits(sim, e.x, EXC_HALF, 2.6);
  const site = sim.h.site;
  want = Math.max(Math.max(site.padMin - 14, lim.min), Math.min(Math.min(site.neighbourX + 14, lim.max), want));
  const v = 7 * DT;
  e.x += Math.max(-v, Math.min(v, want - e.x));
  e.y += (groundUnder(sim, e.x, EXC_HALF) - e.y) * 0.2;
  // The jaw follows the finger at hydraulic speed.
  const arm = excavatorArm(e, tx, Math.max(heightAt(s.heightmap, tx) + 0.5, ty));
  const jdx = arm.jx - e.jawX;
  const jdy = arm.jy - e.jawY;
  const jd = Math.hypot(jdx, jdy);
  const jv = 12 * DT;
  if (jd > jv) {
    e.jawX += (jdx / jd) * jv;
    e.jawY += (jdy / jd) * jv;
  } else {
    e.jawX = arm.jx;
    e.jawY = arm.jy;
  }
  // Keep the jaw on the arm's reach as the machine moves.
  const fixed = excavatorArm(e, e.jawX, e.jawY);
  e.jawX = fixed.jx;
  e.jawY = fixed.jy;
  const o = e.order;
  if (o && !e.biting) {
    o.t += DT;
    // In position once the tracks have stopped and the jaws are where they can get.
    const settled = Math.abs(want - e.x) < 0.05 && jd < 0.1;
    if (settled || o.t > 7) startBite(sim);
  }
  if (!e.biting) return;
  e.biteTimer -= DT;
  if (e.biteTimer > 0) return;
  e.biteTimer = BITE_EVERY;
  bite(sim);
  if (o) {
    o.bites -= 1;
    if (o.bites <= 0) {
      stopBite(sim);
      e.order = undefined;
    }
  }
}

/** One excavator operation: drive into reach of (x, y) and take `bites` bites there. */
export function orderExcavator(sim: WreckSim, x: number, y: number, bites: number): void {
  const e = sim.state.exc;
  e.targetX = x;
  e.targetY = y;
  e.biting = false;
  e.order = { bites: Math.max(1, bites), t: 0 };
}

/** Where the excavator will stand to work at (x, y), and where its jaws can actually get to. */
export function excavatorReach(sim: WreckSim, x: number, y: number): { standX: number; jawX: number; jawY: number; short: boolean } {
  const e = sim.state.exc;
  const face: 1 | -1 = Math.abs(x - e.x) > 1.5 ? (x > e.x ? 1 : -1) : e.face;
  const probe = { ...e, face };
  const ty = Math.max(0.6, y);
  const pivotY = probe.y + 3.4;
  const vert = ty - pivotY;
  const comfortable = Math.sqrt(Math.max(0, (e.l1 + e.l2 - 2.5) ** 2 - vert * vert));
  const pivotX = (sx: number): number => sx + face * 0.9;
  let want = e.x;
  const horiz = Math.abs(x - pivotX(e.x));
  if (horiz > comfortable) want = x - face * (comfortable + 0.7);
  else if (horiz < 4) want = x - face * 4.9;
  const lim = travelLimits(sim, e.x, EXC_HALF, 2.6);
  const site = sim.h.site;
  want = Math.max(Math.max(site.padMin - 14, lim.min), Math.min(Math.min(site.neighbourX + 14, lim.max), want));
  const arm = excavatorArm({ ...probe, x: want, y: 0 }, x, Math.max(heightAt(sim.state.heightmap, x) + 0.5, ty));
  return { standX: want, jawX: arm.jx, jawY: arm.jy, short: Math.hypot(arm.jx - x, arm.jy - ty) > 1.2 };
}

export function startBite(sim: WreckSim): void {
  const s = sim.state;
  const e = s.exc;
  if (e.biting) return;
  e.biting = true;
  e.biteTimer = 0.18;
  e.sessions += 1;
  e.root = sim.newRoot('excavator');
  if (s.tally.clockStart < 0) s.tally.clockStart = s.tick;
  const rec = s.roots[e.root];
  if (rec) {
    rec.hitX = e.jawX;
    rec.hitY = e.jawY;
    rec.hitT = s.time;
  }
}

export function stopBite(sim: WreckSim): void {
  sim.state.exc.biting = false;
}

const BITE_MULT: Record<PieceMaterial, number> = { concrete: 1, brick: 1.3, glass: 1, steel: 0.6, wood: 1.4 };

function biteMult(sim: WreckSim, material: PieceMaterial, kind?: PieceDef['kind']): number {
  const shears = sim.state.kit.shears;
  let m = material === 'steel' && shears ? 2.2 : BITE_MULT[material];
  if (kind === 'core' || kind === 'stack') m *= shears ? 1.7 : 1.25;
  return m;
}

function bite(sim: WreckSim): void {
  const s = sim.state;
  const e = s.exc;
  const root = e.root;
  e.jaw = 1;
  s.tally.bites++;
  const jx = e.jawX;
  const jy = e.jawY;
  const r = 0.9;
  const rec = s.roots[root];
  // Standing structure first, structural parts before cladding.
  let best = -1;
  let bestScore = Infinity;
  for (const id of sim.query(jx - r, jy - r, jx + r, jy + r)) {
    if (s.status[id] !== PIECE_STANDING) continue;
    const p = sim.def.pieces[id] as PieceDef;
    const d = distToRect(jx, jy, p.x, p.y, p.w, p.h);
    if (d > r) continue;
    const score = d + (p.carriesOthers ? 0 : 0.5);
    if (score < bestScore) {
      bestScore = score;
      best = id;
    }
  }
  if (best >= 0) {
    const p = sim.def.pieces[best] as PieceDef;
    const mult = biteMult(sim, p.material, p.kind);
    const BITE_ENERGY = s.kit.bite;
    if (rec && rec.hitPiece < 0) {
      rec.hitPiece = best;
      rec.hitX = jx;
      rec.hitY = jy;
      rec.hitT = s.time;
    }
    sim.damageStanding(best, BITE_ENERGY * mult, root, 'impact', -e.face * 0.5, 0.5);
    revealNear(sim, jx, jy, 2.5);
    triggerChargesAt(sim, best, jx, jy, root, 'debris', 0.8);
    sim.emit({ type: 'bite', x: jx, y: jy, piece: best, material: p.material, target: 'structure' });
    return;
  }
  // A section hung up on the frame, or still coming down.
  for (const b of s.bodies) {
    if (b.state === 'rubble' || Math.hypot(b.x - jx, b.y - jy) > b.radius + r) continue;
    const k = pieceInBody(sim, b, jx, jy, r);
    if (k < 0) continue;
    if (b.state === 'perched') sim.wake(b);
    const id = b.pieces[k] as number;
    const p = sim.def.pieces[id] as PieceDef;
    sim.damageBodyPiece(b, k, s.kit.bite * 1.6 * biteMult(sim, p.material, p.kind), root);
    b.vx += -e.face * 0.8;
    sim.emit({ type: 'bite', x: jx, y: jy, piece: id, material: p.material, target: 'section' });
    return;
  }
  // Debris on the ground: the nearest block under the jaws, debris before the vault.
  let hit: Block | undefined;
  let hitScore = Infinity;
  for (const blk of s.blocks) {
    // Jaws resting on the rubble over a buried block still dig down to it.
    const top = Math.max(blk.y + blk.h, heightAt(s.heightmap, jx) + 0.6);
    if (jx < blk.x - blk.w / 2 - r || jx > blk.x + blk.w / 2 + r || jy < blk.y - r || jy > top + r) continue;
    const score = Math.abs(jx - blk.x) + (blk.kind === 'vault' ? 3 : 0);
    if (score < hitScore) {
      hitScore = score;
      hit = blk;
    }
  }
  if (hit?.kind === 'vault') {
    s.tally.vaultCondition = Math.max(0, s.tally.vaultCondition - 0.2);
    sim.emit({ type: 'bite', x: jx, y: jy, piece: -1, material: 'steel', target: 'vault' });
    return;
  }
  if (hit) {
    hit.hp -= s.kit.bite * biteMult(sim, hit.material) * (s.kit.shears ? 1.6 : 1);
    sim.emit({ type: 'bite', x: jx, y: jy, piece: -1, material: hit.material, target: 'block' });
    if (hit.hp <= 0) breakBlock(sim, hit);
    return;
  }
  sim.emit({ type: 'bite', x: jx, y: jy, piece: -1, material: 'concrete', target: 'air' });
}

function pieceInBody(sim: WreckSim, b: Body, x: number, y: number, r: number): number {
  const cos = Math.cos(b.a);
  const sin = Math.sin(b.a);
  const rx = x - b.x;
  const ry = y - b.y;
  const lx = rx * cos + ry * sin;
  const ly = -rx * sin + ry * cos;
  let best = -1;
  let bestD = r;
  for (let k = 0; k < b.pieces.length; k++) {
    const id = b.pieces[k] as number;
    if (id < 0) continue;
    const p = sim.def.pieces[id] as PieceDef;
    const d = distToRect(lx, ly, (b.lx[k] as number) - p.w / 2, (b.ly[k] as number) - p.h / 2, p.w, p.h);
    if (d <= bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/** A broken block becomes two halves the dozer can push, or loose rubble. */
export function breakBlock(sim: WreckSim, blk: Block): void {
  const s = sim.state;
  const i = s.blocks.indexOf(blk);
  if (i < 0) return;
  s.blocks.splice(i, 1);
  sim.emit({ type: 'blockBreak', x: blk.x, y: blk.y + blk.h / 2, material: blk.material, mass: blk.mass });
  const half = blk.mass / 2;
  if (half < 6 || blk.w < 1.4) {
    sim.depositMound(blk.x, blk.w, blk.area);
    return;
  }
  sim.depositMound(blk.x, blk.w, blk.area * 0.3);
  for (const side of [-1, 1]) {
    const w = blk.w * 0.48;
    s.blocks.push({
      ...blk,
      id: s.nextBlockId++,
      label: blk.kind === 'steel' ? 'Cut steel' : 'Broken slab',
      x: blk.x + side * blk.w * 0.27,
      w,
      h: blk.h * 0.85,
      mass: half,
      hp: blk.maxHp * 0.6,
      maxHp: blk.maxHp * 0.6,
      area: blk.area * 0.35,
      seed: (blk.seed * 31 + side * 7) >>> 0,
    });
  }
}

// ----------------------------------------------------------------- dozer

export function stepDozer(sim: WreckSim): void {
  const s = sim.state;
  const d = s.dozer;
  if (d.stunned > 0) {
    d.stunned -= DT;
    d.speed = 0;
    return;
  }
  d.ramTimer = Math.max(0, d.ramTimer - DT);
  runOrder(sim, d);
  const dx = d.targetX - d.x;
  const forward = !d.travel && Math.sign(dx) === d.dir;
  d.stall = '';
  if (Math.abs(dx) < 0.04) {
    d.speed = 0;
    if (d.bladeDown) holdPile(sim, d);
    d.load = loadAhead(sim, d);
    return;
  }
  d.load = loadAhead(sim, d);
  const vmax = forward ? 7 * Math.max(0.5, Math.min(1, 1.15 - d.load / (s.kit.bladeCap * 2.4))) : 8;
  let step = Math.max(-vmax * DT, Math.min(vmax * DT, dx));
  // Site limits: the blade can reach over the pit and the pad, the tracks cannot.
  const { minX, maxX } = dozerRange(sim);
  const lim = travelLimits(sim, d.x, DOZER_HALF + (forward ? BLADE : 0), BLADE_H);
  step = Math.max(Math.max(minX, lim.min) - d.x, Math.min(Math.min(maxX, lim.max) - d.x, step));
  if (forward) {
    d.bladeDown = true;
    step = push(sim, d, step);
  } else {
    d.bladeDown = false;
  }
  d.x += step;
  d.speed = step / DT;
  d.y += (groundUnder(sim, d.x, DOZER_HALF) - d.y) * 0.25;
  if (forward) holdPile(sim, d);
}

/** Where the dozer's tracks may go on this site. */
export function dozerRange(sim: WreckSim): { minX: number; maxX: number } {
  const site = sim.h.site;
  return { minX: Math.min(site.padMin, site.pitMin) - 6, maxX: Math.max(site.pitMax, site.padMax) - DOZER_HALF - 1 };
}

/** Where the dozer parks to start a run that pushes from `from`. */
export function dozerStart(from: number, dir: 1 | -1): number {
  return from - dir * (DOZER_HALF + BLADE + 0.4);
}

/** Where the dozer's centre ends a run whose blade reaches `to`. */
export function dozerEnd(to: number, dir: 1 | -1): number {
  return to - dir * (DOZER_HALF + BLADE);
}

/** One dozer run: get behind `from` with the blade up, then push toward `to`. */
export function orderPush(sim: WreckSim, from: number, to: number): void {
  const d = sim.state.dozer;
  const dir: 1 | -1 = to >= from ? 1 : -1;
  d.order = { phase: 'move', from, to, dir, t: 0, stuck: 0 };
  d.travel = true;
  d.bladeDown = false;
  d.targetX = dozerStart(from, dir);
  if (sim.state.tally.clockStart < 0) sim.state.tally.clockStart = sim.state.tick;
}

function runOrder(sim: WreckSim, d: Dozer): void {
  const o = d.order;
  if (!o) return;
  o.t += DT;
  const moving = Math.abs(d.speed) > 0.3;
  o.stuck = moving ? 0 : o.stuck + DT;
  if (o.phase === 'move') {
    d.travel = true;
    d.targetX = dozerStart(o.from, o.dir);
    const there = Math.abs(d.targetX - d.x) < 0.05;
    if (there || o.t > 8 || (o.stuck > 0.6 && o.t > 0.3)) {
      o.phase = 'push';
      o.t = 0;
      o.stuck = 0;
      d.travel = false;
      d.dir = o.dir;
      d.targetX = dozerEnd(o.to, o.dir);
      d.root = sim.newRoot('dozer');
    }
    return;
  }
  // A run ends at its mark, or when the blade has been held up too long.
  const there = Math.abs(d.targetX - d.x) < 0.05;
  const giveUp = d.stall === 'structure' && sim.state.kit.ram ? 2.4 : 1;
  if (there || o.t > 12 || (o.stuck > giveUp && o.t > 0.4)) {
    d.order = undefined;
    d.targetX = d.x;
  }
}

/** Moves the blade forward by up to `step` (signed), pushing what is in front. Returns the step it managed. */
function push(sim: WreckSim, d: Dozer, step: number): number {
  const s = sim.state;
  const dir = d.dir;
  const f0 = dozerBlade(d);
  let f1 = f0 + step;
  // Standing structure at blade height stops it; it rams instead.
  for (const id of sim.h.lowPieces) {
    if (s.status[id] !== PIECE_STANDING) continue;
    const p = sim.def.pieces[id] as PieceDef;
    if (p.y > BLADE_H + d.y) continue;
    const near = dir > 0 ? p.x : p.x + p.w;
    if (dir > 0 ? near < f0 - 0.05 || near > f1 : near > f0 + 0.05 || near < f1) continue;
    f1 = near;
    d.stall = 'structure';
    if (d.ramTimer <= 0) {
      d.ramTimer = 0.45;
      if (!d.root || s.time - d.lastRam > 4) d.root = sim.newRoot('dozer');
      d.lastRam = s.time;
      const ram = s.kit.ram ? 5 : 1;
      sim.damageStanding(id, (p.carriesOthers ? 55 : 70) * ram, d.root, 'impact', dir * 2, 0.5);
      sim.emit({ type: 'ram', x: near, y: p.y + 0.8, piece: id, material: p.material });
    }
  }
  // Blocks ride on the blade; anything too heavy stops it.
  const train = blocksAhead(sim, f0, dir);
  let mass = 0;
  let heavy: Block | undefined;
  for (const b of train) {
    mass += b.mass;
    if (b.mass > s.kit.heavyPush && !heavy) heavy = b;
  }
  if (train.length && heavy) {
    const first = train[0] as Block;
    const edge = first.x - dir * first.w / 2;
    if (dir > 0 ? f1 > edge : f1 < edge) {
      f1 = edge;
      d.stall = 'heavy';
    }
  } else if (train.length) {
    // Slower with the weight on the blade.
    const slow = Math.max(0.55, 1 - mass / (DOZER_PUSH_MAX * (s.kit.heavyPush / HEAVY_BLOCK)) / 2.2);
    f1 = f0 + (f1 - f0) * slow;
    let face = f1;
    for (const b of train) {
      const edge = b.x - dir * b.w / 2;
      if (dir > 0 ? edge < face : edge > face) b.x = face + dir * b.w / 2;
      face = b.x + dir * b.w / 2;
      b.y = Math.min(b.y, Math.max(0, heightAt(s.heightmap, b.x) * 0.5));
    }
  }
  // Rubble: the blade scrapes to grade and drives the pile in front of it.
  // What it cannot carry spills over and is left behind for the next pass.
  const swept = takeRange(sim, dir > 0 ? f0 - 0.25 : f1, dir > 0 ? f1 : f0 + 0.25) + takeRange(sim, dir > 0 ? f0 : f0 - PILE_W, dir > 0 ? f0 + PILE_W : f0);
  const carried = Math.min(swept, s.kit.bladeCap);
  const spill = swept - carried;
  if (spill > 0) dropMound(sim, d.x - dir * (DOZER_HALF + 0.8), 1.6, spill);
  if (carried > 0) depositAhead(sim, f1, dir, carried);
  // Wrecked members in the blade's path go with the pile.
  const lo = Math.min(f0, f1);
  const hi = Math.max(f0, f1);
  const w = s.wreck;
  for (let i = w.length - 1; i >= 0; i--) {
    const x = (w[i] as { x: number }).x;
    if (x >= lo - 0.3 && x <= hi + 0.3) w.splice(i, 1);
  }
  if (spill > 0.02) d.stall = d.stall || 'full';
  return f1 - f0;
}

/** Removes and returns the rubble area between a and b. */
function takeRange(sim: WreckSim, a: number, b: number): number {
  const hm = sim.state.heightmap;
  const cell = HEIGHTMAP.cell;
  let sum = 0;
  const i0 = Math.max(0, Math.ceil((a - HEIGHTMAP.minX) / cell));
  const i1 = Math.min(hm.length - 1, Math.floor((b - HEIGHTMAP.minX) / cell));
  for (let i = i0; i <= i1; i++) {
    sum += (hm[i] as number) * cell;
    hm[i] = 0;
  }
  return sum;
}

function dropMound(sim: WreckSim, x: number, half: number, area: number): void {
  const hm = sim.state.heightmap;
  const cell = HEIGHTMAP.cell;
  const i0 = Math.max(0, Math.ceil((x - half - HEIGHTMAP.minX) / cell));
  const i1 = Math.min(hm.length - 1, Math.floor((x + half - HEIGHTMAP.minX) / cell));
  let wsum = 0;
  for (let i = i0; i <= i1; i++) wsum += 1 - Math.abs(HEIGHTMAP.minX + i * cell - x) / (half + cell);
  if (wsum <= 0) return;
  for (let i = i0; i <= i1; i++) {
    const w = 1 - Math.abs(HEIGHTMAP.minX + i * cell - x) / (half + cell);
    hm[i] = (hm[i] as number) + (area * w) / wsum / cell;
  }
}

/** Keeps the pile in front of the blade: what slumps back against it is put back in front. */
function holdPile(sim: WreckSim, d: Dozer): void {
  const hm = sim.state.heightmap;
  const cell = HEIGHTMAP.cell;
  const f = dozerBlade(d);
  let moved = 0;
  const back = d.dir > 0 ? [f - 0.75, f] : [f, f + 0.75];
  const i0 = Math.max(0, Math.ceil(((back[0] as number) - HEIGHTMAP.minX) / cell));
  const i1 = Math.min(hm.length - 1, Math.floor(((back[1] as number) - HEIGHTMAP.minX) / cell));
  for (let i = i0; i <= i1; i++) {
    moved += (hm[i] as number) * cell;
    hm[i] = 0;
  }
  if (moved > 0) depositAhead(sim, f, d.dir, moved);
}

function depositAhead(sim: WreckSim, face: number, dir: number, area: number): void {
  const hm = sim.state.heightmap;
  const cell = HEIGHTMAP.cell;
  // A pile rides on the blade: tallest against it, tapering out ahead. Its length grows with its size.
  const len = Math.min(PILE_W, 0.8 + Math.sqrt(area) * 0.7);
  const cells: Array<[number, number]> = [];
  let wsum = 0;
  for (let u = cell * 0.5; u < len; u += cell) {
    const i = Math.round((face + dir * u - HEIGHTMAP.minX) / cell);
    if (i < 0 || i >= hm.length) continue;
    const w = 1 - (u / len) * 0.8;
    cells.push([i, w]);
    wsum += w;
  }
  if (!cells.length) return;
  for (const [i, w] of cells) hm[i] = (hm[i] as number) + (area * w) / wsum / cell;
}

function loadAhead(sim: WreckSim, d: Dozer): number {
  const hm = sim.state.heightmap;
  const cell = HEIGHTMAP.cell;
  const f = dozerBlade(d);
  const a = d.dir > 0 ? f : f - PILE_W;
  const b = d.dir > 0 ? f + PILE_W : f;
  let sum = 0;
  for (let i = Math.max(0, Math.ceil((a - HEIGHTMAP.minX) / cell)); i <= Math.min(hm.length - 1, Math.floor((b - HEIGHTMAP.minX) / cell)); i++) sum += (hm[i] as number) * cell;
  for (const blk of blocksAhead(sim, f, d.dir)) sum += blk.area;
  return sum;
}

/** Blocks touching the blade face, and those touching them, nearest first. */
function blocksAhead(sim: WreckSim, face: number, dir: number): Block[] {
  const list = sim.state.blocks
    .filter((b) => {
      const near = b.x - dir * b.w / 2;
      return dir > 0 ? near >= face - 0.35 && b.x > face - 0.1 : near <= face + 0.35 && b.x < face + 0.1;
    })
    .sort((a, b) => dir * (a.x - b.x));
  const train: Block[] = [];
  let reach = face + dir * 0.3;
  for (const b of list) {
    const near = b.x - dir * b.w / 2;
    if (dir > 0 ? near > reach : near < reach) break;
    train.push(b);
    reach = b.x + dir * (b.w / 2 + 0.3);
  }
  return train;
}

export function turnDozer(sim: WreckSim): void {
  const d = sim.state.dozer;
  d.dir = d.dir > 0 ? -1 : 1;
  d.bladeDown = false;
  d.targetX = d.x;
}

// ------------------------------------------------------------------ site

/** Hauls what reaches the pit and the pad, settles blocks, and checks the machines for falling debris. */
export function stepSite(sim: WreckSim): void {
  const s = sim.state;
  const hm = s.heightmap;
  const cell = HEIGHTMAP.cell;
  const L = sim.h.site;
  for (const [a, b] of [
    [L.pitMin, L.pitMax],
    [L.padMin, L.padMax],
  ] as const) {
    const i0 = Math.max(0, Math.ceil((a - HEIGHTMAP.minX) / cell));
    const i1 = Math.min(hm.length - 1, Math.floor((b - HEIGHTMAP.minX) / cell));
    let got = 0;
    for (let i = i0; i <= i1; i++) {
      // Loaded out steadily, not all at once, so you can see the pile go.
      const take = Math.min(hm[i] as number, 0.35 * DT + (hm[i] as number) * 0.6 * DT);
      got += take * cell;
      hm[i] = (hm[i] as number) - take;
    }
    s.tally.hauled += got;
  }
  for (let i = s.blocks.length - 1; i >= 0; i--) {
    const b = s.blocks[i] as Block;
    b.y = Math.min(b.y, Math.max(0, heightAt(hm, b.x)));
    const inPit = b.x > L.pitMin && b.x < L.pitMax;
    const inPad = b.x > L.padMin && b.x < L.padMax;
    if (!inPit && !inPad) continue;
    s.blocks.splice(i, 1);
    bank(sim, b, inPad);
  }
  if (s.tick % 2 === 0) checkMachines(sim);
  if (s.tick % 6 === 0) {
    for (let i = s.wreck.length - 1; i >= 0; i--) {
      const w = s.wreck[i] as { x: number; g: number };
      const inPit = w.x > L.pitMin && w.x < L.pitMax;
      const inPad = w.x > L.padMin && w.x < L.padMax;
      // Once the ground under it has been scraped bare, it has gone with the rubble.
      if (inPit || inPad || (w.g > 0.4 && heightAt(hm, w.x) < 0.12)) s.wreck.splice(i, 1);
    }
  }
}

/** A block delivered to the pad (salvage) or the pit (hauled away). */
function bank(sim: WreckSim, b: Block, inPad: boolean): void {
  const s = sim.state;
  const where = inPad ? 'pad' : 'pit';
  if (b.kind === 'vault') {
    s.tally.vaultSaved = inPad ? s.tally.vaultCondition : -2;
    sim.emit({ type: 'salvage', x: b.x, y: b.y, kind: 'vault', value: inPad ? s.tally.vaultCondition : 0, where });
  } else if (b.kind === 'steel') {
    if (inPad) s.tally.steelSalvaged += b.mass;
    else s.tally.steelScrapped += b.mass;
    sim.emit({ type: 'salvage', x: b.x, y: b.y, kind: 'steel', value: b.mass, where });
  } else {
    s.tally.hauled += b.area;
    sim.emit({ type: 'salvage', x: b.x, y: b.y, kind: 'slab', value: b.mass, where });
  }
}

// ---------------------------------------------------------------- loader

/** Bucket width for the current kit. */
export function bucketWidth(kit: Kit): number {
  return 2.4 + kit.bucket * 0.09;
}

/** Where a loaded bucket goes: valuables to the pad, rubble to the pit, whichever the loader can reach. */
export function loaderDump(sim: WreckSim, fromX: number, valuable: boolean): { to: 'pad' | 'pit'; x: number } | undefined {
  const L = sim.h.site;
  const lim = travelLimits(sim, fromX, LOADER_HALF, 2);
  const pad = { to: 'pad' as const, x: (L.padMin + L.padMax) / 2 };
  const pit = { to: 'pit' as const, x: (L.pitMin + L.pitMax) / 2 };
  const ok = (d: { x: number }): boolean => d.x - LOADER_REACH >= lim.min - 0.5 && d.x + LOADER_REACH <= lim.max + 0.5;
  // Rubble goes to whichever is closer; the sorter pays for it on the pad.
  const order = valuable || sim.state.kit.sorter ? [pad, pit] : Math.abs(fromX - pad.x) < Math.abs(fromX - pit.x) ? [pad, pit] : [pit, pad];
  return order.find(ok);
}

/** What one scoop at x would take: the block it would lift (if any) and the rubble. */
export function scoopAt(sim: WreckSim, x: number): { block?: Block; heavy?: Block; area: number } {
  const s = sim.state;
  const kit = s.kit;
  const half = bucketWidth(kit) / 2;
  const rank = (b: Block): number => (b.kind === 'vault' ? 0 : b.kind === 'steel' ? 1 : 2);
  let block: Block | undefined;
  let heavy: Block | undefined;
  for (const b of s.blocks) {
    if (b.x + b.w / 2 < x - half || b.x - b.w / 2 > x + half) continue;
    if (b.mass > kit.lift) {
      if (!heavy || b.mass > heavy.mass) heavy = b;
      continue;
    }
    if (!block || rank(b) < rank(block) || (rank(b) === rank(block) && Math.abs(b.x - x) < Math.abs(block.x - x))) block = b;
  }
  const hm = s.heightmap;
  const cell = HEIGHTMAP.cell;
  let area = 0;
  const i0 = Math.max(0, Math.ceil((x - half - HEIGHTMAP.minX) / cell));
  const i1 = Math.min(hm.length - 1, Math.floor((x + half - HEIGHTMAP.minX) / cell));
  for (let i = i0; i <= i1; i++) area += (hm[i] as number) * cell;
  return { block, heavy, area: Math.min(area, kit.bucket) };
}

/** One loader trip: scoop at x, then carry it off. */
export function orderLoader(sim: WreckSim, x: number): void {
  const l = sim.state.loader;
  l.targetX = x;
  l.face = x >= l.x ? 1 : -1;
  l.phase = 'go';
  l.t = 0;
  if (sim.state.tally.clockStart < 0) sim.state.tally.clockStart = sim.state.tick;
}

export function stepLoader(sim: WreckSim): void {
  const s = sim.state;
  const l = s.loader;
  if (l.stunned > 0) {
    l.stunned -= DT;
    l.speed = 0;
    return;
  }
  l.t += DT;
  const drive = (centre: number, vmax: number): boolean => {
    const lim = travelLimits(sim, l.x, LOADER_HALF, 2);
    const goal = Math.max(lim.min, Math.min(lim.max, centre));
    const dx = goal - l.x;
    const step = Math.max(-vmax * DT, Math.min(vmax * DT, dx));
    l.x += step;
    l.speed = step / DT;
    l.y += (groundUnder(sim, l.x, LOADER_HALF) - l.y) * 0.25;
    return Math.abs(goal - l.x) < 0.05;
  };
  switch (l.phase) {
    case 'idle':
      l.speed = 0;
      l.arm = Math.max(0, l.arm - DT * 2);
      return;
    case 'go': {
      l.arm = Math.max(0, l.arm - DT * 2);
      const there = drive(l.targetX - l.face * LOADER_REACH, 9);
      if (there || l.t > 8) {
        l.phase = 'scoop';
        l.t = 0;
      }
      return;
    }
    case 'scoop': {
      l.speed = 0;
      if (l.t < 0.55) return;
      const bx = l.x + l.face * LOADER_REACH;
      const take = scoopAt(sim, bx);
      if (take.block) {
        const i = s.blocks.indexOf(take.block);
        if (i >= 0) s.blocks.splice(i, 1);
        l.carry = take.block;
      }
      l.bucket = take.area > 0 ? removeArea(sim, bx, bucketWidth(s.kit) / 2, take.area) : 0;
      sim.emit({ type: 'scoop', x: bx, y: l.y + 0.6, area: l.bucket, block: l.carry?.kind ?? '' });
      const dump = l.carry || l.bucket > 0.05 ? loaderDump(sim, l.x, !!l.carry && l.carry.kind !== 'slab') : undefined;
      if (!dump) {
        // Nothing worth carrying (or nowhere to take it): tip it back.
        if (l.bucket > 0) dropMound(sim, bx, 1.2, l.bucket);
        if (l.carry) s.blocks.push({ ...l.carry, x: bx, y: Math.max(0, heightAt(s.heightmap, bx)) });
        l.bucket = 0;
        l.carry = undefined;
        l.phase = 'idle';
        return;
      }
      l.dumpTo = dump.to;
      l.dumpX = dump.x;
      l.face = dump.x >= l.x ? 1 : -1;
      l.phase = 'carry';
      l.t = 0;
      return;
    }
    case 'carry': {
      l.arm = Math.min(1, l.arm + DT * 2);
      const there = drive(l.dumpX - l.face * LOADER_REACH, 8);
      if (there || l.t > 10) {
        l.phase = 'dump';
        l.t = 0;
      }
      return;
    }
    case 'dump': {
      l.speed = 0;
      if (l.t < 0.5) return;
      const L = sim.h.site;
      const bx = l.x + l.face * LOADER_REACH;
      const inPad = bx > L.padMin - 1 && bx < L.padMax + 1;
      const inPit = bx > L.pitMin - 1 && bx < L.pitMax + 1;
      if (l.bucket > 0) {
        if (inPad || inPit) {
          s.tally.hauled += l.bucket;
          if (inPad && s.kit.sorter) s.tally.recycled += l.bucket;
        } else dropMound(sim, bx, 1.2, l.bucket);
      }
      if (l.carry) {
        const b = { ...l.carry, x: bx };
        if (inPad || inPit) bank(sim, b, inPad);
        else s.blocks.push({ ...b, y: Math.max(0, heightAt(s.heightmap, bx)) });
      }
      sim.emit({ type: 'dump', x: bx, y: l.y + 2, area: l.bucket, where: inPad ? 'pad' : 'pit' });
      l.loads += 1;
      l.bucket = 0;
      l.carry = undefined;
      l.phase = 'idle';
      return;
    }
  }
}

/** Takes up to `area` m² of rubble from around x (evenly, cell by cell). Returns what it took. */
function removeArea(sim: WreckSim, x: number, half: number, area: number): number {
  const hm = sim.state.heightmap;
  const cell = HEIGHTMAP.cell;
  const i0 = Math.max(0, Math.ceil((x - half - HEIGHTMAP.minX) / cell));
  const i1 = Math.min(hm.length - 1, Math.floor((x + half - HEIGHTMAP.minX) / cell));
  let have = 0;
  for (let i = i0; i <= i1; i++) have += (hm[i] as number) * cell;
  if (have <= 0) return 0;
  const k = Math.min(1, area / have);
  for (let i = i0; i <= i1; i++) hm[i] = (hm[i] as number) * (1 - k);
  return have * k;
}

export function loaderBox(l: Loader): { x0: number; x1: number; y0: number; y1: number } {
  return { x0: l.x - LOADER_HALF - (l.face < 0 ? 1.2 : 0), x1: l.x + LOADER_HALF + (l.face > 0 ? 1.2 : 0), y0: l.y, y1: l.y + 3.4 };
}

function checkMachines(sim: WreckSim): void {
  const s = sim.state;
  const boxes: Array<{ m: 'excavator' | 'dozer' | 'loader'; box: { x0: number; x1: number; y0: number; y1: number }; stunned: number }> = [
    { m: 'excavator', box: excavatorBox(s.exc), stunned: s.exc.stunned },
    { m: 'dozer', box: dozerBox(s.dozer), stunned: s.dozer.stunned },
    { m: 'loader', box: loaderBox(s.loader), stunned: s.loader.stunned },
  ];
  for (const b of s.bodies) {
    if (b.state !== 'moving' || b.mass < 3) continue;
    const speed = Math.hypot(b.vx, b.vy);
    if (speed < 3) continue;
    for (const mb of boxes) {
      if (mb.stunned > 0) continue;
      const { x0, x1, y0, y1 } = mb.box;
      if (b.x + b.radius < x0 || b.x - b.radius > x1 || b.y - b.radius > y1) continue;
      const cos = Math.cos(b.a);
      const sin = Math.sin(b.a);
      let hit = false;
      for (let i = 0; i < b.px.length && !hit; i++) {
        const lx = b.px[i] as number;
        const ly = b.py[i] as number;
        const wx = b.x + lx * cos - ly * sin;
        const wy = b.y + lx * sin + ly * cos;
        if (wx > x0 && wx < x1 && wy > y0 && wy < y1) hit = true;
      }
      if (!hit) continue;
      mb.stunned = 6;
      if (mb.m === 'excavator') {
        s.exc.stunned = 6;
        s.exc.biting = false;
      } else if (mb.m === 'dozer') s.dozer.stunned = 6;
      else s.loader.stunned = 6;
      s.tally.machineHits++;
      sim.emit({ type: 'machineHit', machine: mb.m, x: (x0 + x1) / 2, y: y1 });
    }
  }
}

/** Debris from a section that has come to rest: heavy concrete and steel stay as blocks. */
export function blockFromPiece(sim: WreckSim, p: PieceDef, x: number): boolean {
  const s = sim.state;
  const steel = p.material === 'steel' && (p.kind === 'truss' || p.kind === 'legs' || p.kind === 'mast' || p.kind === 'sign');
  const slab = p.kind === 'core';
  if (!steel && !slab) return false;
  if (s.blocks.filter((b) => b.kind !== 'vault').length >= MAX_BLOCKS) return false;
  // Only the lower core comes down in slabs too big to push; the rest breaks up.
  if (slab && (p.y > 16 || s.blocks.filter((b) => b.kind === 'slab').length >= MAX_SLABS)) return false;
  const long = Math.max(p.w, p.h);
  const short = Math.min(p.w, p.h);
  const w = Math.min(6, long * 0.9);
  const h = steel ? Math.min(1.1, Math.max(0.4, short * 0.4)) : Math.min(1.4, short * 0.5);
  s.blocks.push({
    id: s.nextBlockId++,
    kind: steel ? 'steel' : 'slab',
    label: steel ? (p.kind === 'truss' ? 'Truss steel' : `${p.label} steel`) : 'Core slab',
    material: p.material,
    x,
    y: Math.max(0, heightAt(s.heightmap, x)),
    w,
    h,
    mass: p.mass,
    hp: steel ? 420 : 520,
    maxHp: steel ? 420 : 520,
    area: blockArea(p),
    seed: p.seed,
  });
  return true;
}

/** Damage to the vault from what lands on it once the core no longer shields it. */
export function vaultImpact(sim: WreckSim, x: number, energy: number): void {
  const v = vaultBlock(sim);
  if (!v || vaultProtected(sim)) return;
  if (Math.abs(x - v.x) > v.w / 2 + 1.5) return;
  const t = sim.state.tally;
  t.vaultCondition = Math.max(0, t.vaultCondition - Math.min(0.25, energy / 9000));
}

// --------------------------------------------------------------- helpers

/** How far a machine centred at x with this half-length can travel before standing structure stops it. */
export function travelLimits(sim: WreckSim, x: number, half: number, height: number): { min: number; max: number } {
  const s = sim.state;
  let min = -Infinity;
  let max = Infinity;
  for (const id of sim.h.lowPieces) {
    if (s.status[id] !== PIECE_STANDING) continue;
    const p = sim.def.pieces[id] as PieceDef;
    if (p.y > height) continue;
    if (p.x >= x) max = Math.min(max, p.x - half);
    else if (p.x + p.w <= x) min = Math.max(min, p.x + p.w + half);
    else {
      // Already overlapping (it was standing when the machine drove in): back out the near way.
      if (p.x + p.w / 2 > x) max = Math.min(max, x);
      else min = Math.max(min, x);
    }
  }
  return { min, max };
}

function groundUnder(sim: WreckSim, x: number, half: number): number {
  const hm = sim.state.heightmap;
  let g = Math.max(heightAt(hm, x - half * 0.7), heightAt(hm, x), heightAt(hm, x + half * 0.7));
  for (const b of sim.state.blocks) {
    if (b.x + b.w / 2 < x - half || b.x - b.w / 2 > x + half) continue;
    g = Math.max(g, b.y + b.h * 0.6);
  }
  return Math.min(g, 3);
}

export function distToRect(px: number, py: number, x: number, y: number, w: number, h: number): number {
  const dx = Math.max(x - px, 0, px - (x + w));
  const dy = Math.max(y - py, 0, py - (y + h));
  return Math.hypot(dx, dy);
}
