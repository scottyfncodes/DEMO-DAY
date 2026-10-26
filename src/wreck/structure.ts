/**
 * The structure for the wrecking-ball slice: a framed building cut into
 * storey-high column segments, floor slabs, infill panels and a few heavy
 * rooftop pieces, tied together by joints. Everything is in world metres,
 * x to the right, y up, ground at y = 0.
 *
 * The building is data, not art: the load solver, the damage model and the
 * renderer all read the same pieces.
 */

export type PieceKind =
  | 'column'
  | 'beam'
  | 'glass'
  | 'brick'
  | 'shopfront'
  | 'core'
  | 'truss'
  | 'roof'
  | 'tank'
  | 'legs'
  | 'mast'
  | 'sign'
  | 'siding'
  | 'door'
  | 'stack'
  | 'gable'
  | 'parapet';

export type PieceMaterial = 'concrete' | 'brick' | 'glass' | 'steel' | 'wood';

export type Zone = 'podium' | 'tower' | 'wing' | 'roof' | 'dock' | 'main' | 'annex';

export interface PieceDef {
  id: number;
  label: string;
  kind: PieceKind;
  material: PieceMaterial;
  zone: Zone;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Tonnes. */
  mass: number;
  /** Energy (kJ) it takes to destroy the piece outright. */
  hp: number;
  /** Load (tonnes) the piece can pass on when undamaged. Set by calibration. */
  cap: number;
  /** Horizontal pieces spread load sideways, so moment arms grow through them. */
  horizontal: boolean;
  /** Infill and cladding: weight only, never part of a load path for others. */
  carriesOthers: boolean;
  /** Deterministic per-piece number for cosmetic variation. */
  seed: number;
}

export interface JointDef {
  id: number;
  a: number;
  /** Second piece, or -1 for the ground. */
  b: number;
  x: number;
  y: number;
  /** Routing cost: load prefers cheap (vertical, stiff) paths. */
  cost: number;
  /** Load (tonnes, times lever) the joint can transfer. Set by calibration. */
  cap: number;
  /** Energy (kJ) of nearby impact that fully breaks the joint. */
  toughness: number;
}

export interface StructureDef {
  name: string;
  /** Scales the calibration floors: small, light buildings get members sized to their real loads. */
  sturdy?: number;
  pieces: PieceDef[];
  joints: JointDef[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  totalMass: number;
}

export const GROUND = -1;
export const COL_W = 0.7;
const BEAM_D = 0.6;

/** Column-line letters, left to right (no I, it reads as 1). */
const LINES = 'ABCDEFGHJKLMNP';

export interface Builder {
  pieces: PieceDef[];
  joints: JointDef[];
}

let seedState = 1;
export function reseed(seed: number): void {
  seedState = seed;
}
function nextSeed(): number {
  seedState = (Math.imul(seedState ^ (seedState >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
  return seedState;
}

export function addPiece(b: Builder, p: Omit<PieceDef, 'id' | 'seed' | 'cap'> & { cap?: number }): number {
  const id = b.pieces.length;
  b.pieces.push({ ...p, id, seed: nextSeed(), cap: p.cap ?? 0 });
  return id;
}

export function addJoint(b: Builder, a: number, other: number, x: number, y: number, cost: number, toughness: number): void {
  if (a < 0 && other < 0) return;
  if (a < 0) [a, other] = [other, a];
  b.joints.push({ id: b.joints.length, a, b: other, x, y, cost, cap: 0, toughness });
}

const floorName = (s: number): string => `floor ${s + 1}`;

/**
 * The Halden Exchange: a three-storey brick podium on the left, a fifteen
 * storey framed tower with a concrete core, a five storey wing cantilevered
 * off the tower on a transfer truss, and a low loading dock under the wing.
 */
export function buildHalden(): StructureDef {
  seedState = 0x5eed;
  const b: Builder = { pieces: [], joints: [] };

  const lineX = (i: number): number => i * 4;
  // Storey tops: three tall commercial storeys, then office floors.
  const tops: number[] = [];
  {
    let y = 0;
    for (let s = 0; s < 15; s++) {
      y += s < 3 ? 4.2 : 3.4;
      tops.push(Math.round(y * 100) / 100);
    }
  }
  const bottomOf = (s: number): number => (s === 0 ? 0 : (tops[s - 1] as number));

  // col[line][storey] -> piece id
  const col = new Map<string, number>();
  const beam = new Map<string, number>();
  const key = (i: number, s: number): string => `${i}:${s}`;

  /** Lines 0..4 podium (A..E), 4..9 tower (E..K), 9..11 wing (K..M). */
  const storeysAt = (i: number): number[] => {
    const out: number[] = [];
    for (let s = 0; s < 15; s++) {
      const podium = i <= 4 && s < 3;
      const tower = i >= 4 && i <= 9;
      const wing = i >= 10 && i <= 11 && s >= 5 && s <= 9;
      if (podium || tower || wing) out.push(s);
    }
    return out;
  };

  // Columns.
  for (let i = 0; i <= 11; i++) {
    const x = lineX(i);
    for (const s of storeysAt(i)) {
      const y0 = bottomOf(s);
      const h = (tops[s] as number) - y0 - BEAM_D;
      const lower = s < 3;
      const zone: Zone = i < 4 ? 'podium' : i >= 10 ? 'wing' : 'tower';
      const id = addPiece(b, {
        label: `Column ${LINES[i]} · ${floorName(s)}`,
        kind: 'column',
        material: 'concrete',
        zone,
        x: x - COL_W / 2,
        y: y0,
        w: COL_W,
        h: h + BEAM_D,
        mass: COL_W * (h + BEAM_D) * (lower ? 5.2 : 4.6),
        hp: 0,
        horizontal: false,
        carriesOthers: true,
      });
      col.set(key(i, s), id);
    }
  }

  // Floor slabs (beam + slab edge) between column faces at each storey top.
  const bayExists = (i: number, s: number): boolean => col.has(key(i, s)) && col.has(key(i + 1, s));
  for (let i = 0; i < 11; i++) {
    for (let s = 0; s < 15; s++) {
      if (!bayExists(i, s)) continue;
      const x0 = lineX(i) + COL_W / 2;
      const x1 = lineX(i + 1) - COL_W / 2;
      const top = tops[s] as number;
      const roofLevel = s === 14 || (i < 4 && s === 2) || (i >= 9 && s === 9);
      const zone: Zone = i < 4 ? 'podium' : i >= 9 ? 'wing' : 'tower';
      const id = addPiece(b, {
        label: roofLevel ? `Roof slab ${LINES[i]}–${LINES[i + 1]}` : `Floor ${s + 2} slab ${LINES[i]}–${LINES[i + 1]}`,
        kind: roofLevel ? 'roof' : 'beam',
        material: 'concrete',
        zone,
        x: x0,
        y: top - BEAM_D,
        w: x1 - x0,
        h: BEAM_D,
        mass: (x1 - x0) * (roofLevel ? 4.2 : i < 4 ? 6.6 : 6),
        hp: roofLevel ? 240 : 320,
        horizontal: true,
        carriesOthers: true,
      });
      beam.set(key(i, s), id);
    }
  }

  // Infill between columns and slabs.
  for (let i = 0; i < 11; i++) {
    for (let s = 0; s < 15; s++) {
      if (!bayExists(i, s)) continue;
      const x0 = lineX(i) + COL_W / 2;
      const x1 = lineX(i + 1) - COL_W / 2;
      const y0 = s === 0 ? 0 : bottomOf(s);
      const y1 = (tops[s] as number) - BEAM_D;
      const w = x1 - x0;
      const hh = y1 - y0;
      const bay = `${LINES[i]}–${LINES[i + 1]}`;
      let kind: PieceKind;
      let material: PieceMaterial;
      let mass: number;
      let hp: number;
      let label: string;
      let carries = false;
      let zone: Zone = i < 4 ? 'podium' : i >= 9 ? 'wing' : 'tower';
      if (i < 4) {
        if (s === 0) {
          kind = 'shopfront';
          material = 'glass';
          mass = w * hh * 0.45;
          hp = 18;
          label = `Shopfront ${bay}`;
        } else {
          kind = 'brick';
          material = 'brick';
          mass = w * hh * 1.25;
          hp = 95;
          label = `Brick bay ${bay} · ${floorName(s)}`;
        }
      } else if (i === 6) {
        kind = 'core';
        material = 'concrete';
        mass = w * hh * 2.6;
        hp = 850;
        label = `Core wall · ${floorName(s)}`;
        carries = true;
        zone = 'tower';
      } else if (i >= 9 && s === 5) {
        kind = 'truss';
        material = 'steel';
        mass = w * hh * 1.9;
        hp = 950;
        label = `Transfer truss ${bay}`;
        carries = true;
      } else {
        kind = 'glass';
        material = 'glass';
        mass = w * hh * 0.4;
        hp = 22;
        label = `Window bay ${bay} · ${floorName(s)}`;
      }
      const id = addPiece(b, { label, kind, material, zone, x: x0, y: y0, w, h: hh, mass, hp, horizontal: !carries || kind === 'truss', carriesOthers: carries });
      const left = col.get(key(i, s)) as number;
      const right = col.get(key(i + 1, s)) as number;
      const above = beam.get(key(i, s)) as number;
      const below = s === 0 ? GROUND : (beam.get(key(i, s - 1)) ?? -2);
      const mid = y0 + hh / 2;
      if (carries) {
        // Core walls and trusses are structure: stiff ties on every side.
        const t = kind === 'core' ? 900 : 1100;
        addJoint(b, id, left, x0, mid, 1, t);
        addJoint(b, id, right, x1, mid, 1, t);
        addJoint(b, id, above, x0 + w / 2, y1, 1, t);
        if (below !== -2) addJoint(b, id, below, x0 + w / 2, y0, 1, t);
      } else {
        // Infill hangs in its frame: it sits on the slab below, held lightly at the sides.
        if (below !== -2) addJoint(b, id, below, x0 + w / 2, y0, 1, 60);
        addJoint(b, id, left, x0, mid, 2.5, 40);
        addJoint(b, id, right, x1, mid, 2.5, 40);
        if (below === -2) addJoint(b, id, above, x0 + w / 2, y1, 2.5, 40);
      }
    }
  }

  // Frame joints.
  for (let i = 0; i <= 11; i++) {
    const ss = storeysAt(i);
    for (const s of ss) {
      const c = col.get(key(i, s)) as number;
      const x = lineX(i);
      const y0 = bottomOf(s);
      if (s === 0) addJoint(b, c, GROUND, x, 0, 1, 1400);
      const below = col.get(key(i, s - 1));
      if (below !== undefined) addJoint(b, c, below, x, y0, 1, 900);
      // Slabs frame into the column head on both sides.
      const top = tops[s] as number;
      for (const bi of [i - 1, i]) {
        const bm = beam.get(key(bi, s));
        if (bm !== undefined) addJoint(b, bm, c, x, top - BEAM_D / 2, 1, 700);
      }
      // The column above also bears on the slabs at its foot.
      for (const bi of [i - 1, i]) {
        const bm = beam.get(key(bi, s - 1));
        if (bm !== undefined && below !== undefined) addJoint(b, c, bm, x, y0, 1.6, 500);
      }
    }
  }
  // Slab continuity across each column: lets floors bridge a lost column, at a price.
  for (let i = 1; i < 11; i++) {
    for (let s = 0; s < 15; s++) {
      const l = beam.get(key(i - 1, s));
      const r = beam.get(key(i, s));
      if (l !== undefined && r !== undefined) addJoint(b, l, r, lineX(i), (tops[s] as number) - BEAM_D / 2, 3, 420);
    }
  }
  // The truss storey has no columns at K beneath the wing: tie the truss into the tower column above and below.
  {
    const truss = b.pieces.find((p) => p.kind === 'truss' && p.x < lineX(10)) as PieceDef;
    for (const s of [4, 6]) {
      const c = col.get(key(9, s));
      if (c !== undefined) addJoint(b, truss.id, c, lineX(9), s === 4 ? truss.y : truss.y + truss.h, 1, 1100);
    }
  }

  // Rooftop: water tank on a steel stand, the sign, and the antenna mast.
  const roofY = tops[14] as number;
  const roofBeam = (i: number): number => beam.get(key(i, 14)) as number;
  const legs = addPiece(b, { label: 'Tank stand', kind: 'legs', material: 'steel', zone: 'roof', x: 17, y: roofY, w: 3.6, h: 2.4, mass: 4, hp: 70, horizontal: true, carriesOthers: true });
  addJoint(b, legs, roofBeam(4), 18.6, roofY, 1, 120);
  addJoint(b, legs, col.get(key(5, 14)) as number, 20, roofY, 1, 120);
  const tank = addPiece(b, { label: 'Water tank', kind: 'tank', material: 'wood', zone: 'roof', x: 16.8, y: roofY + 2.4, w: 4, h: 4.2, mass: 46, hp: 160, horizontal: true, carriesOthers: false });
  addJoint(b, tank, legs, 18.8, roofY + 2.4, 1, 110);
  const sign = addPiece(b, { label: 'HALDEN sign', kind: 'sign', material: 'steel', zone: 'roof', x: 22.6, y: roofY, w: 10.4, h: 2.8, mass: 9, hp: 90, horizontal: true, carriesOthers: false });
  addJoint(b, sign, roofBeam(5), 23.5, roofY, 1, 80);
  addJoint(b, sign, roofBeam(7), 30.5, roofY, 1, 80);
  const mast = addPiece(b, { label: 'Antenna mast', kind: 'mast', material: 'steel', zone: 'roof', x: 34.8, y: roofY, w: 0.35, h: 11, mass: 2.5, hp: 45, horizontal: false, carriesOthers: false });
  addJoint(b, mast, roofBeam(8), 35, roofY, 1, 40);

  // Loading dock under the wing: a separate, low brick-and-steel shed.
  {
    const lines = [37.6, 41.4, 45.2, 49];
    const dTops = [4, 8];
    const dcol: number[][] = [];
    lines.forEach((x, li) => {
      dcol[li] = [];
      dTops.forEach((top, s) => {
        const y0 = s === 0 ? 0 : (dTops[s - 1] as number);
        const id = addPiece(b, { label: `Dock column ${li + 1}`, kind: 'column', material: 'concrete', zone: 'dock', x: x - 0.25, y: y0, w: 0.5, h: top - y0, mass: 0.5 * (top - y0) * 3.6, hp: 170, horizontal: false, carriesOthers: true });
        (dcol[li] as number[])[s] = id;
        if (s === 0) addJoint(b, id, GROUND, x, 0, 1, 700);
        else addJoint(b, id, (dcol[li] as number[])[s - 1] as number, x, y0, 1, 500);
      });
    });
    const dbeam: number[][] = [];
    for (let li = 0; li < lines.length - 1; li++) {
      dbeam[li] = [];
      for (let s = 0; s < 2; s++) {
        const x0 = (lines[li] as number) + 0.25;
        const x1 = (lines[li + 1] as number) - 0.25;
        const top = dTops[s] as number;
        const roof = s === 1;
        const id = addPiece(b, { label: roof ? `Dock roof ${li + 1}` : `Dock floor ${li + 1}`, kind: roof ? 'roof' : 'beam', material: roof ? 'steel' : 'concrete', zone: 'dock', x: x0, y: top - 0.45, w: x1 - x0, h: 0.45, mass: (x1 - x0) * (roof ? 1.6 : 3.6), hp: roof ? 90 : 160, horizontal: true, carriesOthers: true });
        (dbeam[li] as number[])[s] = id;
        addJoint(b, id, (dcol[li] as number[])[s] as number, x0, top - 0.2, 1, 380);
        addJoint(b, id, (dcol[li + 1] as number[])[s] as number, x1, top - 0.2, 1, 380);
        const y0 = s === 0 ? 0 : (dTops[s - 1] as number);
        const wid = addPiece(b, { label: `Dock wall ${li + 1}`, kind: 'brick', material: 'brick', zone: 'dock', x: x0, y: y0, w: x1 - x0, h: top - 0.45 - y0, mass: (x1 - x0) * (top - 0.45 - y0) * 1.1, hp: 70, horizontal: true, carriesOthers: false });
        addJoint(b, wid, s === 0 ? GROUND : ((dbeam[li] as number[])[0] as number), x0 + (x1 - x0) / 2, y0, 1, 50);
        addJoint(b, wid, (dcol[li] as number[])[s] as number, x0, y0 + 1.5, 2.5, 30);
        addJoint(b, wid, (dcol[li + 1] as number[])[s] as number, x1, y0 + 1.5, 2.5, 30);
      }
    }
  }

  return finishStructure(b, 'The Halden Exchange');
}

/** Wraps built pieces and joints up with their bounds and total mass. */
export function finishStructure(b: Builder, name: string, sturdy = 1): StructureDef {
  const def: StructureDef = { name, sturdy, pieces: b.pieces, joints: b.joints, bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 }, totalMass: 0 };
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let total = 0;
  for (const p of def.pieces) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + p.h);
    total += p.mass;
  }
  def.bounds = { minX, maxX, minY: 0, maxY };
  def.totalMass = total;
  return def;
}
