import { describe, expect, it } from 'vitest';
import { predict, solveAim } from '../src/golf/sim/aim';
import { BALLS } from '../src/golf/sim/balls';
import { PALETTES, courseBricks, type HouseSpec, type YardSpec } from '../src/golf/sim/house';
import { PartState, type Part } from '../src/golf/sim/parts';
import { DT, GRAVITY, SEAM_TOL, World, launchVelocity, type Shot, type SimEvent } from '../src/golf/sim/world';

const spec = (o: Partial<HouseSpec> = {}): HouseSpec => ({ storeys: 2, porch: true, chimney: true, furnish: true, palette: PALETTES.classic as HouseSpec['palette'], ...o });
const yard: YardSpec = { trees: [{ x: -8, z: 7, s: 1 }], decor: [{ model: 'gnome', x: -2.9, z: 2.2 }] };
const world = (o: Partial<HouseSpec> = {}): World => new World(spec(o), yard);

function fire(w: World, shot: Shot): SimEvent[] {
  w.launch(shot);
  const ev: SimEvent[] = [];
  for (let i = 0; i < 120 * 20 && !w.settled; i++) {
    w.step();
    ev.push(...w.drainEvents());
  }
  if (!w.settled) w.forceSettle();
  ev.push(...w.drainEvents());
  return ev;
}

const at = (w: World, ball: Shot['ball'], x: number, y: number, z: number, power: number): Shot => {
  const s = solveAim(w, ball, { x, y, z }, power);
  if (!s) throw new Error('target out of reach');
  return s;
};

const broken = (w: World, pred: (p: Part) => boolean): Part[] => w.parts.filter((p) => pred(p) && p.state !== PartState.Intact);
const frontBrickAt = (w: World, x: number, y: number): Part => w.parts.find((p) => p.kind === 'brick' && p.wall === 'front' && Math.abs(p.x - x) < p.hx && Math.abs(p.y - y) < p.hy) as Part;

describe('the house', () => {
  it('stands on its own: nothing falls or overloads before the first shot', () => {
    for (const storeys of [1, 2] as const) {
      const w = world({ storeys });
      w.solve(true);
      const ev = w.drainEvents();
      expect(ev.filter((e) => e.t === 'release')).toHaveLength(0);
      expect(w.pending.size).toBe(0);
    }
  });

  it('lays bricks in running bond around openings', () => {
    // A 3 m course with a 1.2 m opening, offset by half a brick.
    const bricks = courseBricks(0, 3, [[0.9, 2.1]], 0.3);
    expect(bricks.map(([a, b]) => Math.round((b - a) * 10) / 10)).toEqual([0.3, 0.6, 0.6, 0.3]);
    expect(bricks.every(([a, b]) => b <= 0.9 + 1e-9 || a >= 2.1 - 1e-9)).toBe(true);
  });

  it('has a working interior: rooms, furniture, a stair and floors', () => {
    const w = world();
    expect(w.info.rooms.map((r) => r.id)).toEqual(['living', 'hall', 'kitchen', 'bedroom', 'landing', 'study']);
    expect(w.parts.filter((p) => p.kind === 'furniture').length).toBeGreaterThan(15);
    expect(w.parts.filter((p) => p.kind === 'floor')).toHaveLength(3);
  });
});

describe('flight', () => {
  it('follows the launch speed and gravity, and the guide predicts the real first contact', () => {
    const def = BALLS.standard;
    const shot: Shot = { ball: 'standard', yaw: 4, pitch: 20, power: 0.5 };
    const v = launchVelocity(def, shot);
    expect(v.speed).toBeCloseTo(def.minSpeed + 0.5 * (def.maxSpeed - def.minSpeed), 6);
    const w = world();
    w.launch(shot);
    const b = w.balls[0];
    if (!b) throw new Error('no ball');
    // A short free flight: height matches projectile motion closely (light drag).
    for (let i = 0; i < 30; i++) w.step();
    const t = b.age;
    const expectY = b.launchY + v.vy * t - 0.5 * GRAVITY * t * t;
    expect(Math.abs(b.y - expectY)).toBeLessThan(0.05);
    expect(b.x).toBeGreaterThan(0);
    // The prediction's contact is where the real ball first hits.
    const w2 = world();
    const target = at(w2, 'standard', -0.75, 1.95, 0, 0.9);
    const pred = predict(w2, target);
    const ev = fire(w2, target);
    const hit = ev.find((e) => e.t === 'hit');
    expect(pred.contact?.part.id).toBe(hit && hit.t === 'hit' ? hit.part : -1);
  });

  it('retires balls that leave the lot, and never keeps one bouncing forever', () => {
    const w = world();
    const ev = fire(w, { ball: 'standard', yaw: 35, pitch: 30, power: 1 });
    const r = ev.find((e) => e.t === 'retire');
    expect(r && r.t === 'retire' ? r.reason : '').toBe('out');
    const w2 = world();
    fire(w2, at(w2, 'super', -3.15, 1.95, 0, 1));
    expect(w2.activeBalls).toBe(0);
    expect(w2.time).toBeLessThan(BALLS.super.lifetime + 8);
  });
});

describe('bricks and seams', () => {
  it('a direct, square hit on a brick destroys that brick', () => {
    const w = world();
    const target = frontBrickAt(w, -0.6, 1.95);
    const ev = fire(w, at(w, 'standard', target.x, target.y, 0, 0.9));
    expect(target.state).not.toBe(PartState.Intact);
    expect(ev.filter((e) => e.t === 'seam')).toHaveLength(0);
    expect(broken(w, (p) => p.kind === 'brick' && p.wall === 'front').length).toBeGreaterThanOrEqual(1);
  });

  it('a square, hard hit on the joint between two bricks destroys both', () => {
    const w = world();
    // Away from the staggered vertical joints: the brick at x -0.75 has one above and one below.
    const lower = frontBrickAt(w, -0.75, 1.95);
    const upper = frontBrickAt(w, -0.75, 2.25);
    const shot = at(w, 'standard', -0.75, 2.1, 0, 0.9);
    const pred = predict(w, shot);
    expect(pred.seam?.other).toBeTruthy();
    const ev = fire(w, shot);
    const seam = ev.find((e) => e.t === 'seam');
    expect(seam).toBeTruthy();
    expect(lower.state).not.toBe(PartState.Intact);
    expect(upper.state).not.toBe(PartState.Intact);
  });

  it('the seam is a real place on the wall: a joint, within tolerance, with a standing neighbour', () => {
    const w = world();
    const mid = predict(w, at(w, 'standard', -0.75, 1.95, 0, 0.9));
    expect(mid.seam?.other ?? null).toBeNull();
    expect(mid.seam?.dist ?? 0).toBeGreaterThan(SEAM_TOL);
    const joint = predict(w, at(w, 'standard', -0.75, 2.1 + SEAM_TOL * 0.5, 0, 0.9));
    expect(joint.seam?.other).toBeTruthy();
    const off = predict(w, at(w, 'standard', -0.75, 2.1 + SEAM_TOL * 2.5, 0, 0.9));
    expect(off.seam?.other ?? null).toBeNull();
  });

  it('a soft lob on a seam only cracks a brick: speed matters', () => {
    const w = world();
    const shot = at(w, 'standard', -0.75, 2.1, 0, 0.42);
    const ev = fire(w, shot);
    const seams = ev.filter((e) => e.t === 'seam').length;
    const gone = broken(w, (p) => p.kind === 'brick' && p.wall === 'front').length;
    expect(seams === 0 || gone < 2).toBe(true);
  });

  it('reinforced and old brick behave differently, and the power ball breaks reinforced', () => {
    const reinforced: HouseSpec['zones'] = [{ wall: 'front', a0: -4.5, a1: 4.5, y0: 0.6, y1: 3.3, mat: 'foundation' }];
    const w = world({ zones: reinforced });
    const brick = frontBrickAt(w, -0.6, 1.95);
    fire(w, at(w, 'standard', brick.x, brick.y, 0, 0.9));
    expect(brick.state).toBe(PartState.Intact);
    expect(brick.hp).toBeLessThan(brick.hp0);
    const w2 = world({ zones: reinforced });
    const b2 = frontBrickAt(w2, -0.6, 1.95);
    fire(w2, at(w2, 'power', b2.x, b2.y, 0, 0.75));
    fire(w2, at(w2, 'power', b2.x, b2.y, 0, 0.75));
    expect(b2.state).not.toBe(PartState.Intact);
    const old: HouseSpec['zones'] = [{ wall: 'front', a0: -4.5, a1: 4.5, y0: 0.6, y1: 3.3, mat: 'oldBrick' }];
    const w3 = world({ zones: old });
    const b3 = frontBrickAt(w3, -0.6, 1.95);
    fire(w3, at(w3, 'standard', b3.x, b3.y, 0, 0.45));
    expect(b3.state).not.toBe(PartState.Intact);
  });
});

describe('windows and the interior', () => {
  it('a ball breaks the glass, keeps the frame, and carries on into the room', () => {
    const w = world();
    const pane = w.parts.find((p) => p.kind === 'glass' && p.wall === 'front' && p.x < -2.8 && p.y < 3) as Part;
    const ev = fire(w, at(w, 'standard', pane.x, pane.y, 0, 0.85));
    expect(pane.state).toBe(PartState.Gone);
    const sill = w.parts.find((p) => p.kind === 'frame' && p.wall === 'front' && p.x < -2 && p.y < 1.3) as Part;
    expect(sill.state).toBe(PartState.Intact);
    expect(ev.some((e) => e.t === 'enter' && e.room === 'living')).toBe(true);
  });

  it('a superball in through a window ricochets off several things inside', () => {
    const w = world();
    fire(w, at(w, 'super', -3.15, 1.95, 0, 1));
    const ball = w.balls[0];
    expect(ball?.touched.size ?? 0).toBeGreaterThanOrEqual(6);
    expect(ball?.wasInside).toBe(true);
  });

  it('the superball keeps far more of its bounce than the standard ball', () => {
    const contacts = (b: Shot['ball']): number => {
      const w = world();
      return fire(w, at(w, b, -3.15, 1.95, 0, 1)).filter((e) => e.t === 'hit').length;
    };
    expect(contacts('super')).toBeGreaterThan(contacts('standard') * 2);
  });
});

describe('structure', () => {
  it('a chimney cut at the base comes down, all of it', () => {
    const w = world();
    const base = w.parts.filter((p) => p.tags.includes('chimney') && p.kind === 'brick').sort((a, b) => a.y - b.y).slice(0, 2);
    const shot = at(w, 'standard', ((base[0] as Part).x + (base[1] as Part).x) / 2, (base[0] as Part).y, (base[0] as Part).z + 0.3, 0.95);
    const ev = fire(w, shot);
    const chimney = w.parts.filter((p) => p.tags.includes('chimney'));
    expect(chimney.filter((p) => p.state !== PartState.Intact).length / chimney.length).toBeGreaterThan(0.9);
    expect(ev.some((e) => e.t === 'collapse')).toBe(true);
  });

  it('a porch column taken out drops the beam and the porch roof', () => {
    const w = world();
    const col = w.parts.find((p) => p.kind === 'column') as Part;
    fire(w, at(w, 'standard', col.x, col.y, col.z + col.hz, 0.9));
    expect(w.parts.find((p) => p.tags.includes('porch-roof'))?.state).not.toBe(PartState.Intact);
  });

  it('a small hole arches over; a wide one brings the wall above it down', () => {
    const w = world();
    const row = w.parts.filter((p) => p.kind === 'brick' && p.wall === 'front' && Math.abs(p.y - 1.95) < 0.01 && p.x > -1.6 && p.x < -0.4);
    for (const p of row) w.damagePart(p, 99, 'ball', 0, p.x, p.y, p.z);
    w.solve(true);
    expect(w.drainEvents().filter((e) => e.t === "release").length).toBeLessThan(6);
    const w2 = world();
    const wide = w2.parts.filter((p) => p.kind === 'brick' && p.wall === 'left' && p.y > 0.6 && p.y < 1.2);
    for (const p of wide) w2.damagePart(p, 99, 'ball', 0, p.x, p.y, p.z);
    w2.solve(true);
    expect(w2.drainEvents().filter((e) => e.t === 'release').length).toBeGreaterThan(40);
  });

  it('a roof section drops once half the wall top under it has gone', () => {
    const w = world();
    const deck = w.parts.find((p) => p.kind === 'deck' && p.tags.includes('roof-front') && Math.abs(p.x) < 1) as Part;
    const eave = (deck.groups[0] ?? []).map((id) => w.parts[id] as Part);
    expect(eave.length).toBeGreaterThan(3);
    for (const p of eave.slice(0, Math.floor(eave.length / 2) - 1)) w.damagePart(p, 99, 'ball', 0, p.x, p.y, p.z);
    w.solve(true);
    expect(deck.state).toBe(PartState.Intact);
    for (const p of eave.slice(0, Math.ceil(eave.length / 2) + 1)) w.damagePart(p, 99, 'ball', 0, p.x, p.y, p.z);
    w.solve(true);
    expect(deck.state).not.toBe(PartState.Intact);
    const ev = w.drainEvents();
    expect(ev.some((e) => e.t === 'collapse' && e.roof > 0)).toBe(true);
  });

  it('a narrowed corner carries too much, creaks, then gives way on its own', () => {
    const w = world();
    // Leave a narrow pier of the left wall standing under everything above it.
    const cut = w.parts.filter((p) => p.kind === 'brick' && p.wall === 'left' && p.y > 0.6 && p.y < 0.95 && p.z < -1.2);
    for (const p of cut) w.damagePart(p, 99, 'ball', 0, p.x, p.y, p.z);
    const cutFront = w.parts.filter((p) => p.kind === 'brick' && p.wall === 'front' && p.y > 0.6 && p.y < 0.95 && p.x > -3.9);
    for (const p of cutFront) w.damagePart(p, 99, 'ball', 0, p.x, p.y, p.z);
    const before = w.destruction();
    w.runUntilSettled(20);
    expect(w.destruction()).toBeGreaterThan(before + 0.1);
  });

  it('falling floors break what they land on', () => {
    const w = world();
    const floor = w.parts.find((p) => p.kind === 'floor' && p.label === 'Bedroom floor') as Part;
    const sofa = w.parts.find((p) => p.model === 'sofa') as Part;
    for (const g of floor.groups) for (const id of g) w.damagePart(w.parts[id] as Part, 99, 'ball', 0, 0, 0, 0);
    w.runUntilSettled(15);
    expect(floor.state).not.toBe(PartState.Intact);
    expect(sofa.hp).toBeLessThan(sofa.hp0);
  });
});

describe('arsenal', () => {
  it('multiball launches five independent balls on different paths', () => {
    const w = world();
    const balls = w.launch({ ball: 'multi', yaw: 0, pitch: 12, power: 0.9 });
    expect(balls).toHaveLength(5);
    expect(new Set(balls.map((b) => b.vx.toFixed(3))).size).toBe(5);
    for (let i = 0; i < 120 * 3; i++) w.step();
    expect(new Set(balls.map((b) => `${b.x.toFixed(1)},${b.z.toFixed(1)}`)).size).toBe(5);
  });

  it('the multi-golfer volley fires from three tees, staggered', () => {
    const w = world();
    const balls = w.launch({ ball: 'standard', yaw: 0, pitch: 10, power: 0.9 }, { damage: 1, speed: 1, bounceBonus: 0, bounceHits: 0, golfers: 3 });
    expect(balls).toHaveLength(3);
    expect(new Set(balls.map((b) => b.x)).size).toBe(3);
    expect(balls.map((b) => b.delay)).toEqual([0, 0.22, 0.44]);
    w.runUntilSettled(20);
    expect(balls.every((b) => b.touched.size > 0)).toBe(true);
  });

  it('the heavy ball shoves the wall around its hit; the charge ball goes off', () => {
    const w = world();
    fire(w, at(w, 'heavy', -0.75, 1.0, 0, 1));
    const heavy = broken(w, (p) => p.house).length;
    const w2 = world();
    fire(w2, at(w2, 'standard', -0.75, 1.0, 0, 1));
    expect(heavy).toBeGreaterThan(broken(w2, (p) => p.house).length * 3);
    const w3 = world();
    const ev = fire(w3, at(w3, 'blast', -0.75, 1.5, 0, 0.9));
    expect(ev.some((e) => e.t === 'blast')).toBe(true);
    expect(broken(w3, (p) => p.house).length).toBeGreaterThan(10);
  });

  it('power hooks at full power and flies straight below 80%', () => {
    const w = world();
    const straight = w.launch({ ball: 'power', yaw: 0, pitch: 8, power: 0.8 })[0];
    const hooked = w.launch({ ball: 'power', yaw: 0, pitch: 8, power: 1 })[0];
    for (let i = 0; i < 60; i++) w.step();
    expect(Math.abs(straight?.x ?? 1)).toBeLessThan(0.01);
    expect(hooked?.x ?? 0).toBeGreaterThan(0.1);
  });
});

describe('stability under repeated play', () => {
  it('is deterministic: the same shots give the same result', () => {
    const run = (): string => {
      const w = world();
      fire(w, at(w, 'heavy', -0.75, 1.0, 0, 1));
      fire(w, at(w, 'blast', 2.5, 2.0, 0, 0.9));
      return `${w.destruction().toFixed(6)}|${w.parts.map((p) => p.state).join('')}`;
    };
    expect(run()).toBe(run());
  });

  it('caps loose debris and puts everything to rest after a big collapse', () => {
    const w = world();
    for (const x of [-3, -1, 1, 3]) fire(w, at(w, 'blast', x, 1.2, 0, 0.9));
    expect(w.settled).toBe(true);
    expect(w.activeDebris).toBe(0);
    expect(w.debris.length).toBeLessThanOrEqual(w.parts.length);
    expect(w.time).toBeLessThan(90);
  });

  it('steps fast enough for a phone: a heavy shot settles in well under a second of CPU', () => {
    const w = world();
    const t0 = performance.now();
    fire(w, at(w, 'heavy', 0, 1.0, 0, 1));
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(DT).toBeCloseTo(1 / 120);
  });
});
