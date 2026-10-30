import { evaluateShot, type ShotQuality, type ShotTag } from '../game/quality';
import type { BallId } from './balls';
import type { LevelDef, Objective, PowerUpId } from './levels';
import { PartState, type Part } from './parts';
import { DT, NO_MODS, World, type Ball, type Shot, type ShotMods, type SimEvent } from './world';

/**
 * One attempt at a level: the shot budget, ammunition, power-ups, scoring
 * and objectives, on top of the simulation. Scoring is read from simulation
 * events only, so the score always reflects what actually happened.
 */

export const SCORING = {
  seam: 50,
  /** Per distinct thing hit beyond the third, by one ball in one shot. */
  chainPer: 20,
  chainFrom: 4,
  /** Per piece in a collapse beyond the eighth. */
  collapsePer: 5,
  roofSection: 150,
  floor: 150,
  through: 200,
  /** A shot needs this many points to keep the streak alive. */
  streakMin: 50,
  streakStep: 0.25,
  streakMax: 2.5,
  /** Campaign: per shot left at the finish. */
  shotLeft: 250,
  /** Skill bonus per shot-quality tag. */
  tags: { clean: 20, aim: 60, window: 100, multi: 80, seam: 0, bank: 150, chain: 200, support: 250, house: 500 } as Record<ShotTag, number>,
  /** With fast resolve, a shot hands back control this long after the last ball stops, if nothing is about to give way. */
  quickQuiet: 0.9,
};

export function streakMultiplier(streak: number): number {
  return Math.min(SCORING.streakMax, 1 + SCORING.streakStep * Math.max(0, streak - 1));
}

export interface ShotReport {
  number: number;
  ball: BallId;
  points: number;
  base: number;
  multiplier: number;
  streak: number;
  bricks: number;
  glass: number;
  seams: number;
  chain: number;
  collapsed: number;
  decor: number;
  interior: number;
  entered: boolean;
  through: boolean;
  /** Headline lines for the shot card, most impressive first. */
  lines: string[];
  quality: ShotQuality;
  /** Share of the house (0..1) brought down by this shot. */
  share: number;
}

export interface SessionOptions {
  /** A world to play on instead of a freshly built one (a restored house). */
  world?: World;
  /** Special ball stock to draw from and spend, shared with the caller (the campaign inventory). */
  ammo?: Partial<Record<BallId, number>>;
  /** Hand control back once the balls stop, while the last debris settles. */
  fastResolve?: boolean;
}

export type Phase = 'aim' | 'flight' | 'done';

export interface Result {
  complete: boolean;
  stars: number;
  score: number;
  shots: number;
  medal: number;
}

export class Session {
  readonly level: LevelDef;
  world: World;
  phase: Phase = 'aim';
  shotsUsed = 0;
  ammo: Partial<Record<BallId, number>>;
  powerups: Partial<Record<PowerUpId, number>>;
  armed = new Set<PowerUpId>();
  precisionLeft = 0;
  score = 0;
  streak = 0;
  bestStreak = 0;
  seams = 0;
  maxChain = 0;
  entered = false;
  through = false;
  reports: ShotReport[] = [];
  /** Events from the last step, for effects and sound. */
  events: SimEvent[] = [];
  private scored = new Set<number>();
  private shotEvents: SimEvent[] = [];
  private shotBall: BallId = 'standard';
  private flightTime = 0;
  private quietTime = 0;
  private shotPoints = 0;
  result: Result | null = null;
  /** Called with each finished shot. */
  onShot?: (r: ShotReport) => void;
  /** House mode: called once, on the shot that meets the objectives. */
  onComplete?: () => void;
  /** House mode: the objectives have been met (play carries on). */
  completed = false;
  /** Parts the player is pointed at (pins, weak points), for shot quality. */
  focus = new Set<number>();
  private shotBalls: Ball[] = [];
  private destrBefore = 0;
  private fastResolve: boolean;

  constructor(level: LevelDef, seed = 7, opts: SessionOptions = {}) {
    this.level = level;
    this.world = opts.world ?? new World(level.house, level.yard, seed);
    if (level.wind) this.world.wind = { ...level.wind };
    this.ammo = opts.ammo ?? { ...level.balls };
    this.powerups = { ...level.powerups };
    this.fastResolve = !!opts.fastResolve;
    if (level.mode === 'house') this.completed = this.objectivesMet();
  }

  get shotsLeft(): number {
    return this.level.shots - this.shotsUsed;
  }

  canUse(ball: BallId): boolean {
    return ball === 'standard' || (this.ammo[ball] ?? 0) > 0;
  }

  /** Arms or disarms a power-up for the next shot. */
  toggle(p: PowerUpId): boolean {
    if (this.phase !== 'aim') return false;
    if (this.armed.has(p)) {
      this.armed.delete(p);
      return true;
    }
    if ((this.powerups[p] ?? 0) <= 0) return false;
    this.armed.add(p);
    return true;
  }

  get guideFull(): boolean {
    return !!this.level.fullGuide || this.precisionLeft > 0 || this.armed.has('precision');
  }

  mods(): ShotMods {
    const m: ShotMods = { ...NO_MODS };
    if (this.armed.has('drive')) {
      m.damage = 1.5;
      m.speed = 1.12;
    }
    if (this.armed.has('ricochet')) {
      m.bounceBonus = 0.3;
      m.bounceHits = 8;
    }
    if (this.armed.has('golfers')) m.golfers = 3;
    return m;
  }

  /** Takes a shot. Returns false (and spends nothing) if it is not allowed. */
  fire(shot: Shot): boolean {
    if (this.phase !== 'aim' || this.shotsLeft <= 0 || !this.canUse(shot.ball)) return false;
    const mods = this.mods();
    for (const p of this.armed) this.powerups[p] = (this.powerups[p] ?? 0) - 1;
    // Precision Mode covers this shot and the next two.
    if (this.armed.has('precision')) this.precisionLeft = 3;
    if (this.precisionLeft > 0) this.precisionLeft--;
    this.armed.clear();
    if (shot.ball !== 'standard') this.ammo[shot.ball] = (this.ammo[shot.ball] ?? 0) - 1;
    this.shotsUsed++;
    this.shotBall = shot.ball;
    this.shotEvents = [];
    this.flightTime = 0;
    this.quietTime = 0;
    this.shotPoints = 0;
    this.destrBefore = this.world.destruction();
    this.shotBalls = this.world.launch(shot, mods);
    this.phase = 'flight';
    return true;
  }

  /** Quality of the shot in flight so far (for live callouts), or null when aiming. */
  liveQuality(): ShotQuality | null {
    if (this.phase !== 'flight') return null;
    return evaluateShot(this.shotEvents, { parts: this.world.parts, balls: this.shotBalls, focus: this.focus, destructionBefore: this.destrBefore, destructionAfter: this.world.destruction() });
  }

  /** Advances one fixed step. */
  step(): void {
    const w = this.world;
    w.step(DT);
    const ev = w.drainEvents();
    this.events.push(...ev);
    if (this.phase === 'aim') {
      // Debris still settling after a fast hand-back: its damage still scores.
      for (const e of ev) if (e.t === 'break' || e.t === 'release') this.score += this.award(this.world.parts[e.part] as Part);
    }
    if (this.phase === 'flight') {
      for (const e of ev) this.ingest(e);
      this.shotEvents.push(...ev);
      this.flightTime += DT;
      if (w.activeBalls === 0) this.quietTime += DT;
      const quick = this.fastResolve && w.activeBalls === 0 && w.pending.size === 0 && this.quietTime > SCORING.quickQuiet;
      // A shot ends when everything is still; stragglers are put to rest so nobody waits.
      if (quick) this.endShot();
      else if (w.settled || this.quietTime > 3.5 || this.flightTime > 16) {
        if (!w.settled) {
          w.forceSettle();
          for (const e of w.drainEvents()) {
            this.ingest(e);
            this.shotEvents.push(e);
            this.events.push(e);
          }
        }
        this.endShot();
      }
    }
  }

  takeEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private award(p: Part): number {
    if (this.scored.has(p.id)) return 0;
    this.scored.add(p.id);
    return p.points;
  }

  private ingest(e: SimEvent): void {
    const P = this.world.parts;
    switch (e.t) {
      case 'break':
      case 'knock':
      case 'release':
        this.shotPoints += this.award(P[e.part] as Part);
        break;
      case 'seam':
        this.seams++;
        this.shotPoints += SCORING.seam;
        break;
      case 'collapse':
        this.shotPoints += Math.max(0, e.count - 8) * SCORING.collapsePer + e.roof * SCORING.roofSection + e.floor * SCORING.floor;
        break;
      case 'enter':
        this.entered = true;
        break;
      case 'exit':
        this.through = true;
        this.shotPoints += SCORING.through;
        break;
    }
  }

  private endShot(): void {
    const P = this.world.parts;
    const ev = this.shotEvents;
    let chain = 0;
    for (const b of this.world.balls) chain = Math.max(chain, b.touched.size);
    // Balls from earlier shots are retired; only count this shot's.
    const mine = new Set(ev.filter((e) => e.t === 'launch').map((e) => (e as { ball: number }).ball));
    chain = 0;
    for (const b of this.world.balls) if (mine.has(b.id)) chain = Math.max(chain, b.touched.size);
    let chainBonus = 0;
    for (const b of this.world.balls) if (mine.has(b.id) && b.touched.size >= SCORING.chainFrom) chainBonus += (b.touched.size - SCORING.chainFrom + 1) * SCORING.chainPer;
    this.maxChain = Math.max(this.maxChain, chain);
    const quality = evaluateShot(ev, { parts: P, balls: this.shotBalls, focus: this.focus, destructionBefore: this.destrBefore, destructionAfter: this.world.destruction() });
    const base = this.shotPoints + chainBonus + quality.tags.reduce((s, t) => s + SCORING.tags[t], 0);
    if (base >= SCORING.streakMin) this.streak++;
    else this.streak = 0;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    const mult = base >= SCORING.streakMin ? streakMultiplier(this.streak) : 1;
    const points = Math.round(base * mult);
    this.score += points;
    const count = (pred: (p: Part, e: SimEvent) => boolean): number => {
      const seen = new Set<number>();
      for (const e of ev) {
        if ((e.t === 'break' || e.t === 'release' || e.t === 'knock') && !seen.has(e.part) && pred(P[e.part] as Part, e)) seen.add(e.part);
      }
      return seen.size;
    };
    const bricks = count((p) => p.kind === 'brick' || p.kind === 'foundation');
    const glass = count((p) => p.kind === 'glass');
    const collapsed = count((_, e) => e.t === 'release');
    const decor = count((p) => p.kind === 'decor');
    const interior = count((p) => p.kind === 'furniture');
    const seams = ev.filter((e) => e.t === 'seam').length;
    const entered = ev.some((e) => e.t === 'enter');
    const through = ev.some((e) => e.t === 'exit');
    const lines: string[] = [];
    const roofs = ev.reduce((s, e) => s + (e.t === 'collapse' ? e.roof : 0), 0);
    if (roofs) lines.push(roofs === 1 ? 'Roof section down' : `${roofs} roof sections down`);
    if (collapsed >= 8) lines.push(`Collapse: ${collapsed} pieces`);
    if (seams) lines.push(seams === 1 ? 'Seam shot: two bricks' : `${seams} seam shots`);
    if (through) lines.push('In one side, out the other');
    if (chain >= SCORING.chainFrom) lines.push(`Ricochet chain: ${chain} hits`);
    if (interior) lines.push(interior === 1 ? 'Something broke inside' : `${interior} things broke inside`);
    if (bricks) lines.push(bricks === 1 ? '1 brick' : `${bricks} bricks`);
    if (glass) lines.push(glass === 1 ? '1 pane of glass' : `${glass} panes of glass`);
    if (decor) lines.push(decor === 1 ? '1 garden piece' : `${decor} garden pieces`);
    if (!lines.length) lines.push(entered ? 'Inside, but nothing broke' : 'No damage');
    const share = Math.max(0, this.world.destruction() - this.destrBefore);
    const report: ShotReport = { number: this.shotsUsed, ball: this.shotBall, points, base, multiplier: mult, streak: this.streak, bricks, glass, seams, chain, collapsed, decor, interior, entered, through, lines, quality, share };
    this.reports.push(report);
    this.phase = 'aim';
    const done = this.objectivesMet();
    if (this.level.mode === 'house') {
      // Houses never end: meeting the objective opens the next one, and play carries on.
      this.onShot?.(report);
      if (done && !this.completed) {
        this.completed = true;
        this.onComplete?.();
      }
      return;
    }
    if ((done && this.level.mode !== 'sandbox' && this.level.mode !== 'score') || this.shotsLeft <= 0) this.finish(done);
    this.onShot?.(report);
  }

  /** Progress on one objective as [current, target]. */
  progress(o: Objective): [number, number] {
    const P = this.world.parts;
    const gone = (p: Part): boolean => p.state !== PartState.Intact;
    const n = (pred: (p: Part) => boolean): number => {
      let c = 0;
      for (const p of P) if (pred(p) && gone(p)) c++;
      return c;
    };
    const all = (pred: (p: Part) => boolean): number => P.filter(pred).length;
    switch (o.kind) {
      case 'bricks':
        return [n((p) => p.kind === 'brick' && p.house), o.n];
      case 'seams':
        return [this.seams, o.n];
      case 'windows':
        return [n((p) => p.kind === 'glass'), o.n];
      case 'target': {
        const t = all((p) => p.tags.includes(o.tag));
        return [n((p) => p.tags.includes(o.tag)), t];
      }
      case 'enter':
        return [this.entered ? 1 : 0, 1];
      case 'through':
        return [this.through ? 1 : 0, 1];
      case 'chain':
        return [this.maxChain, o.n];
      case 'collapse': {
        if (o.what === 'roof') return [n((p) => p.kind === 'deck' && p.tags.includes('roof')), o.n];
        if (o.what === 'porch') return [n((p) => p.tags.includes('porch-roof')), 1];
        if (o.what === 'floor') return [n((p) => p.kind === 'floor'), o.n];
        const total = all((p) => p.tags.includes('chimney'));
        const down = n((p) => p.tags.includes('chimney'));
        return [down / total >= 0.6 ? 1 : 0, 1];
      }
      case 'destruction':
        return [Math.floor(this.world.destruction() * 100), o.pct];
      case 'wall': {
        const mine = (p: Part): boolean => p.wall === o.wall && (p.kind === 'brick' || p.kind === 'lintel') && !p.tags.includes('gable');
        return [Math.floor((n(mine) / Math.max(1, all(mine))) * 100), o.pct];
      }
      case 'decor':
        return [n((p) => p.kind === 'decor'), o.n];
      case 'score':
        return [this.score, o.n];
    }
  }

  objectiveDone(o: Objective): boolean {
    const [a, b] = this.progress(o);
    return a >= b;
  }

  objectivesMet(): boolean {
    const obj = this.level.objectives;
    return obj.length > 0 && obj.every((o) => this.objectiveDone(o));
  }

  /** Ends the attempt now (out of shots, objectives met, or the player stops a score run). */
  finish(complete = this.objectivesMet()): Result {
    const L = this.level;
    let stars = 0;
    let medal = 0;
    if (L.mode === 'score' || (L.mode === 'daily' && !L.objectives.length)) {
      complete = true;
      const m = L.medals ?? [Infinity, Infinity, Infinity];
      medal = this.score >= m[2] ? 3 : this.score >= m[1] ? 2 : this.score >= m[0] ? 1 : 0;
      stars = medal;
    } else if (complete) {
      if (L.mode === 'campaign' || L.mode === 'daily') this.score += Math.max(0, this.shotsLeft) * SCORING.shotLeft;
      stars = starsFor(L, this.shotsUsed);
    }
    this.phase = 'done';
    this.result = { complete, stars, score: this.score, shots: this.shotsUsed, medal };
    return this.result;
  }
}

/** Stars for a completed level: three at or under par, two within half a par again, one otherwise. */
export function starsFor(level: LevelDef, shots: number): number {
  if (shots <= level.par) return 3;
  if (shots <= level.par + Math.max(1, Math.ceil(level.par / 2))) return 2;
  return 1;
}

/** Runs a scripted list of shots to the end. Used by the level tests and the solution search. */
export function playScript(level: LevelDef, shots: Array<Shot & { powerups?: PowerUpId[] }>): Session {
  const s = new Session(level);
  for (const shot of shots) {
    if (s.phase !== 'aim') break;
    for (const p of shot.powerups ?? []) s.toggle(p);
    if (!s.fire(shot)) throw new Error(`shot refused: ${JSON.stringify(shot)}`);
    let guard = 0;
    while ((s.phase as string) === 'flight' && guard++ < 120 * 30) s.step();
    s.takeEvents();
  }
  return s;
}
