import {
  GROUND,
  addJoint,
  addPiece,
  buildHalden,
  finishStructure,
  reseed,
  type Builder,
  type PieceKind,
  type PieceMaterial,
  type StructureDef,
  type Zone,
} from './structure';

/**
 * Every contract's building, built from the same parts as the Halden
 * Exchange: storey-high column segments, floor slabs and the infill between
 * them, tied together by joints the load solver reads. A building is a
 * function of its spec, so the same contract always produces the same
 * structure (and the same collapse).
 *
 * Coordinates are world metres, x right, y up, ground at 0.
 */

/** Where things are on the lot. Everything outside the lot line is somebody else's. */
export interface SiteLayout {
  /** Salvage pad: steel and prizes pay here; rubble is loaded out. */
  padMin: number;
  padMax: number;
  /** Haul pit: anything pushed or tipped in is trucked away. */
  pitMin: number;
  pitMax: number;
  /** The lot that has to be left clear. */
  lotMin: number;
  lotMax: number;
  /** The protected neighbour starts here: debris past this line is collateral. */
  neighbourX: number;
  /** Crane boom length and where the crane starts. */
  boom: number;
  craneX: number;
  dozerX: number;
  excX: number;
  loaderX: number;
}

export interface FlawDef {
  label: string;
  note: string;
  /** Known from the survey (shown from the start) or waiting to be found. */
  known: boolean;
}

export interface PrizeDef {
  label: string;
  /** The ground-floor piece it sits behind: safe from falling debris while that stands. */
  home: string;
  look: 'safe' | 'bell';
  w: number;
  h: number;
  mass: number;
  /** Payout at full condition. */
  value: number;
}

export type Setting = 'town' | 'suburb' | 'farm' | 'yard' | 'wharf' | 'city';
export type NeighbourLook = 'bakery' | 'house' | 'farmhouse' | 'pumphouse' | 'tyres' | 'chandlery' | 'office';

export interface BuildingDef {
  id: string;
  name: string;
  /** One line on what kind of structure it is. */
  kind: string;
  build: () => StructureDef;
  /** How deep the building runs back from the street, for drawing (m). */
  depth: number;
  site: SiteLayout;
  flaws: FlawDef[];
  prize?: PrizeDef;
  neighbour: { name: string; look: NeighbourLook; w: number; h: number };
  setting: Setting;
  /** Lettering on the building, drawn on its sign piece. */
  sign?: string;
}

// ------------------------------------------------------------------ frame

const LINES = 'ABCDEFGHJKLMNP';

interface InfillDef {
  kind: PieceKind;
  material: PieceMaterial;
  /** Tonnes per square metre of elevation. */
  density: number;
  hp: number;
  carries: boolean;
  name: string;
  /** Only the lower part of the bay (m), for parapets. */
  height?: number;
}

const INFILL = {
  glass: { kind: 'glass', material: 'glass', density: 0.4, hp: 22, carries: false, name: 'Window bay' },
  shopfront: { kind: 'shopfront', material: 'glass', density: 0.45, hp: 18, carries: false, name: 'Shopfront' },
  brick: { kind: 'brick', material: 'brick', density: 1.25, hp: 95, carries: false, name: 'Brick bay' },
  block: { kind: 'brick', material: 'concrete', density: 1.4, hp: 120, carries: false, name: 'Block wall' },
  siding: { kind: 'siding', material: 'wood', density: 0.35, hp: 30, carries: false, name: 'Clapboard bay' },
  door: { kind: 'door', material: 'steel', density: 0.3, hp: 40, carries: false, name: 'Roller door' },
  core: { kind: 'core', material: 'concrete', density: 2.6, hp: 850, carries: true, name: 'Core wall' },
  silo: { kind: 'core', material: 'concrete', density: 2.1, hp: 560, carries: true, name: 'Silo wall' },
  stack: { kind: 'stack', material: 'brick', density: 2.2, hp: 380, carries: true, name: 'Stack' },
  truss: { kind: 'truss', material: 'steel', density: 1.6, hp: 700, carries: true, name: 'Roof truss' },
  parapet: { kind: 'parapet', material: 'concrete', density: 1.6, hp: 150, carries: false, name: 'Parapet', height: 1.1 },
} satisfies Record<string, InfillDef>;

export type InfillName = keyof typeof INFILL;

interface FrameOpts {
  x0: number;
  spans: number[];
  storeys: number[];
  zone: Zone;
  /** Label prefix so two frames on one lot never share a label. */
  prefix?: string;
  colW: number;
  colMat: PieceMaterial;
  /** Tonnes per square metre of column elevation. */
  colDensity: number;
  beamD: number;
  slabMat: PieceMaterial;
  /** Tonnes per metre run of slab. */
  slabDensity: number;
  roofDensity: number;
  colAt?: (line: number, storey: number) => boolean;
  infill: (bay: number, storey: number) => InfillName | null;
}

interface Frame {
  lineX: number[];
  tops: number[];
  col: Map<string, number>;
  beam: Map<string, number>;
  key: (i: number, s: number) => string;
}

/** A column-and-slab frame with infill: the same construction as the Halden tower, sized by spec. */
function frame(b: Builder, o: FrameOpts): Frame {
  const lineX: number[] = [o.x0];
  for (const w of o.spans) lineX.push((lineX[lineX.length - 1] as number) + w);
  const tops: number[] = [];
  let y = 0;
  for (const hh of o.storeys) {
    y += hh;
    tops.push(Math.round(y * 100) / 100);
  }
  const bottomOf = (s: number): number => (s === 0 ? 0 : (tops[s - 1] as number));
  const col = new Map<string, number>();
  const beam = new Map<string, number>();
  const key = (i: number, s: number): string => `${i}:${s}`;
  const has = o.colAt ?? (() => true);
  const pre = o.prefix ? `${o.prefix} ` : '';
  const half = o.colW / 2;
  const nLines = lineX.length;
  const nS = o.storeys.length;

  for (let i = 0; i < nLines; i++) {
    for (let s = 0; s < nS; s++) {
      if (!has(i, s)) continue;
      const y0 = bottomOf(s);
      const hh = (tops[s] as number) - y0;
      const id = addPiece(b, {
        label: `${pre}Column ${LINES[i]} · floor ${s + 1}`,
        kind: 'column',
        material: o.colMat,
        zone: o.zone,
        x: (lineX[i] as number) - half,
        y: y0,
        w: o.colW,
        h: hh,
        mass: o.colW * hh * o.colDensity,
        hp: 0,
        horizontal: false,
        carriesOthers: true,
      });
      col.set(key(i, s), id);
    }
  }
  const bayExists = (i: number, s: number): boolean => col.has(key(i, s)) && col.has(key(i + 1, s));
  for (let i = 0; i < nLines - 1; i++) {
    for (let s = 0; s < nS; s++) {
      if (!bayExists(i, s)) continue;
      const x0 = (lineX[i] as number) + half;
      const x1 = (lineX[i + 1] as number) - half;
      const top = tops[s] as number;
      const roof = s === nS - 1 || !bayExists(i, s + 1);
      const bay = `${LINES[i]}–${LINES[i + 1]}`;
      const id = addPiece(b, {
        label: roof ? `${pre}Roof ${bay}` : `${pre}Floor ${s + 2} slab ${bay}`,
        kind: roof ? 'roof' : 'beam',
        material: o.slabMat,
        zone: o.zone,
        x: x0,
        y: top - o.beamD,
        w: x1 - x0,
        h: o.beamD,
        mass: (x1 - x0) * (roof ? o.roofDensity : o.slabDensity),
        hp: o.slabMat === 'wood' ? (roof ? 90 : 120) : o.slabMat === 'steel' ? 180 : roof ? 240 : 320,
        horizontal: true,
        carriesOthers: true,
      });
      beam.set(key(i, s), id);
    }
  }
  for (let i = 0; i < nLines - 1; i++) {
    for (let s = 0; s < nS; s++) {
      if (!bayExists(i, s)) continue;
      const name = o.infill(i, s);
      if (!name) continue;
      const spec: InfillDef = INFILL[name];
      const x0 = (lineX[i] as number) + half;
      const x1 = (lineX[i + 1] as number) - half;
      const y0 = bottomOf(s);
      const y1full = (tops[s] as number) - o.beamD;
      const y1 = spec.height ? Math.min(y1full, y0 + spec.height) : y1full;
      const w = x1 - x0;
      const hh = y1 - y0;
      const id = addPiece(b, {
        label: `${pre}${spec.name} ${LINES[i]}–${LINES[i + 1]} · floor ${s + 1}`,
        kind: spec.kind,
        material: spec.material,
        zone: o.zone,
        x: x0,
        y: y0,
        w,
        h: hh,
        mass: w * hh * spec.density,
        hp: spec.hp,
        horizontal: !spec.carries || spec.kind === 'truss',
        carriesOthers: spec.carries,
      });
      const left = col.get(key(i, s)) as number;
      const right = col.get(key(i + 1, s)) as number;
      const above = beam.get(key(i, s)) as number;
      const below = s === 0 ? GROUND : (beam.get(key(i, s - 1)) ?? -2);
      const mid = y0 + hh / 2;
      if (spec.carries) {
        const t = spec.kind === 'truss' ? 1000 : spec.kind === 'stack' ? 520 : 800;
        addJoint(b, id, left, x0, mid, 1, t);
        addJoint(b, id, right, x1, mid, 1, t);
        addJoint(b, id, above, x0 + w / 2, y1, 1, t);
        if (below !== -2) addJoint(b, id, below, x0 + w / 2, y0, 1, t);
      } else {
        if (below !== -2) addJoint(b, id, below, x0 + w / 2, y0, 1, 60);
        addJoint(b, id, left, x0, mid, 2.5, 40);
        addJoint(b, id, right, x1, mid, 2.5, 40);
        if (below === -2) addJoint(b, id, above, x0 + w / 2, y1, 2.5, 40);
      }
    }
  }
  const tough = o.colMat === 'wood' ? 0.45 : o.colMat === 'brick' ? 0.7 : 1;
  for (let i = 0; i < nLines; i++) {
    for (let s = 0; s < nS; s++) {
      const c = col.get(key(i, s));
      if (c === undefined) continue;
      const x = lineX[i] as number;
      const y0 = bottomOf(s);
      if (s === 0) addJoint(b, c, GROUND, x, 0, 1, 1400 * tough);
      const below = col.get(key(i, s - 1));
      if (below !== undefined) addJoint(b, c, below, x, y0, 1, 900 * tough);
      const top = tops[s] as number;
      for (const bi of [i - 1, i]) {
        const bm = beam.get(key(bi, s));
        if (bm !== undefined) addJoint(b, bm, c, x, top - o.beamD / 2, 1, 700 * tough);
      }
      for (const bi of [i - 1, i]) {
        const bm = beam.get(key(bi, s - 1));
        if (bm !== undefined && below !== undefined) addJoint(b, c, bm, x, y0, 1.6, 500 * tough);
      }
    }
  }
  for (let i = 1; i < nLines - 1; i++) {
    for (let s = 0; s < nS; s++) {
      const l = beam.get(key(i - 1, s));
      const r = beam.get(key(i, s));
      if (l !== undefined && r !== undefined) addJoint(b, l, r, lineX[i] as number, (tops[s] as number) - o.beamD / 2, 3, 420 * tough);
    }
  }
  return { lineX, tops, col, beam, key };
}

/** A non-structural piece sitting on (and tied to) the given supports. */
function rider(
  b: Builder,
  p: { label: string; kind: PieceKind; material: PieceMaterial; zone: Zone; x: number; y: number; w: number; h: number; mass: number; hp: number; carries?: boolean },
  on: number[],
  toughness: number,
): number {
  const id = addPiece(b, { ...p, horizontal: true, carriesOthers: p.carries ?? false });
  on.forEach((sup, k) => {
    const x = p.x + (p.w * (k + 1)) / (on.length + 1);
    addJoint(b, id, sup, x, p.y, 1, toughness);
  });
  return id;
}

const roofOf = (f: Frame, bay: number): number => {
  for (let s = f.tops.length - 1; s >= 0; s--) {
    const id = f.beam.get(f.key(bay, s));
    if (id !== undefined) return id;
  }
  throw new Error(`No roof over bay ${bay}`);
};

// -------------------------------------------------------------- buildings

function buildCornerStore(): StructureDef {
  reseed(0xc0a1);
  const b: Builder = { pieces: [], joints: [] };
  const f = frame(b, {
    x0: 0,
    spans: [4.2, 4.2, 4.2],
    storeys: [3.6, 3.2],
    zone: 'main',
    colW: 0.6,
    colMat: 'brick',
    colDensity: 2.2,
    beamD: 0.45,
    slabMat: 'wood',
    slabDensity: 2.2,
    roofDensity: 1.6,
    infill: (bay, s) => (s === 0 ? 'shopfront' : bay === 1 ? 'brick' : 'glass'),
  });
  const top = f.tops[1] as number;
  rider(b, { label: 'Store sign', kind: 'sign', material: 'steel', zone: 'roof', x: 1.2, y: top, w: 10.2, h: 1.5, mass: 1.2, hp: 50 }, [roofOf(f, 0), roofOf(f, 2)], 40);
  return finishStructure(b, 'Corner Store', 0.22);
}

function buildGarage(): StructureDef {
  reseed(0x6a7a);
  const b: Builder = { pieces: [], joints: [] };
  frame(b, {
    x0: 0,
    spans: [6, 6, 6, 6],
    storeys: [4.6, 1.5],
    zone: 'main',
    colW: 0.45,
    colMat: 'steel',
    colDensity: 2.4,
    beamD: 0.35,
    slabMat: 'steel',
    slabDensity: 1.6,
    roofDensity: 1.5,
    infill: (bay, s) => (s === 1 ? 'truss' : bay <= 1 ? 'door' : bay === 2 ? 'block' : 'glass'),
  });
  return finishStructure(b, 'Halsey Auto', 0.3);
}

function buildSilo(): StructureDef {
  reseed(0x5110);
  const b: Builder = { pieces: [], joints: [] };
  // The loading shed on the left, timber and clapboard.
  frame(b, {
    x0: -8.6,
    spans: [4, 4],
    storeys: [4.2],
    zone: 'annex',
    prefix: 'Shed',
    colW: 0.35,
    colMat: 'wood',
    colDensity: 1.4,
    beamD: 0.35,
    slabMat: 'wood',
    slabDensity: 1.4,
    roofDensity: 1.2,
    infill: (bay) => (bay === 0 ? 'siding' : 'door'),
  });
  const f = frame(b, {
    x0: 0,
    spans: [3.3, 3.3],
    storeys: [3.4, 3.4, 3.4, 3.4, 3.4, 3.4, 3.4, 3.4],
    zone: 'main',
    colW: 0.6,
    colMat: 'concrete',
    colDensity: 3.8,
    beamD: 0.4,
    slabMat: 'concrete',
    slabDensity: 2.4,
    roofDensity: 2.2,
    infill: () => 'silo',
  });
  const top = f.tops[f.tops.length - 1] as number;
  const legs = rider(b, { label: 'Headhouse frame', kind: 'legs', material: 'steel', zone: 'roof', x: 0.4, y: top, w: 5.8, h: 1.2, mass: 3, hp: 80, carries: true }, [roofOf(f, 0), roofOf(f, 1)], 120);
  rider(b, { label: 'Headhouse', kind: 'siding', material: 'wood', zone: 'roof', x: 0.6, y: top + 1.2, w: 5.4, h: 2.6, mass: 2.2, hp: 50 }, [legs], 60);
  return finishStructure(b, 'Holloway Silo', 0.35);
}

function buildHouse(): StructureDef {
  reseed(0x4005);
  const b: Builder = { pieces: [], joints: [] };
  const f = frame(b, {
    x0: 0,
    spans: [4.4, 4.4, 4.4],
    storeys: [3, 2.8],
    zone: 'main',
    colW: 0.35,
    colMat: 'wood',
    colDensity: 1.6,
    beamD: 0.35,
    slabMat: 'wood',
    slabDensity: 1.6,
    roofDensity: 1.3,
    infill: (bay, s) => (bay === 1 ? 'siding' : s === 0 && bay === 2 ? 'siding' : 'glass'),
  });
  const top = f.tops[1] as number;
  rider(b, { label: 'Gable roof', kind: 'gable', material: 'wood', zone: 'roof', x: -0.5, y: top, w: 14.2, h: 3.4, mass: 6, hp: 70 }, [roofOf(f, 0), roofOf(f, 1), roofOf(f, 2)], 70);
  // The chimney runs up the left wall, tied in at each floor.
  let below = GROUND;
  const h = [3, 2.8, 2.2, 2.2];
  let y = 0;
  h.forEach((hh, k) => {
    const id = addPiece(b, { label: `Chimney · course ${k + 1}`, kind: 'stack', material: 'brick', zone: 'main', x: -1.5, y, w: 1.2, h: hh, mass: 1.2 * hh * 1.9, hp: 140, horizontal: false, carriesOthers: true });
    addJoint(b, id, below, -0.9, y, 1, below === GROUND ? 500 : 260);
    const c = f.col.get(f.key(0, k));
    if (c !== undefined) addJoint(b, id, c, -0.3, y + hh / 2, 2.5, 60);
    below = id;
    y += hh;
  });
  return finishStructure(b, 'No. 12 Maple Street', 0.2);
}

function buildStack(): StructureDef {
  reseed(0x57ac);
  const b: Builder = { pieces: [], joints: [] };
  frame(b, {
    x0: -16,
    spans: [5, 5, 5],
    storeys: [5.4],
    zone: 'annex',
    prefix: 'Boiler house',
    colW: 0.6,
    colMat: 'brick',
    colDensity: 2.2,
    beamD: 0.4,
    slabMat: 'steel',
    slabDensity: 1.6,
    roofDensity: 1.4,
    infill: (bay) => (bay === 1 ? 'door' : 'brick'),
  });
  frame(b, {
    x0: 0,
    spans: [2.8],
    storeys: Array.from({ length: 12 }, () => 3),
    zone: 'main',
    colW: 0.8,
    colMat: 'brick',
    colDensity: 2.6,
    beamD: 0.3,
    slabMat: 'brick',
    slabDensity: 1.8,
    roofDensity: 1.8,
    infill: () => 'stack',
  });
  return finishStructure(b, 'Ironworks Stack', 0.4);
}

function buildWarehouse(): StructureDef {
  reseed(0x3a3e);
  const b: Builder = { pieces: [], joints: [] };
  const f = frame(b, {
    x0: 0,
    spans: [5.5, 5.5, 5.5, 5.5, 5.5, 5.5],
    storeys: [4.4, 4, 4, 4, 1.6],
    zone: 'main',
    colW: 0.6,
    colMat: 'concrete',
    colDensity: 4.4,
    beamD: 0.5,
    slabMat: 'concrete',
    slabDensity: 5.2,
    roofDensity: 2.4,
    infill: (bay, s) => {
      if (s === 4) return 'truss';
      if (bay === 3) return 'core';
      if (s === 0) return bay === 1 || bay === 4 ? 'door' : 'brick';
      return s === 3 && bay !== 0 && bay !== 5 ? 'glass' : 'brick';
    },
  });
  const top = f.tops[f.tops.length - 1] as number;
  const legs = rider(b, { label: 'Tank stand', kind: 'legs', material: 'steel', zone: 'roof', x: 23.4, y: top, w: 3.4, h: 2.2, mass: 3.4, hp: 70, carries: true }, [roofOf(f, 4)], 120);
  rider(b, { label: 'Water tank', kind: 'tank', material: 'wood', zone: 'roof', x: 23.1, y: top + 2.2, w: 4, h: 3.8, mass: 30, hp: 140 }, [legs], 110);
  rider(b, { label: 'Warehouse sign', kind: 'sign', material: 'steel', zone: 'roof', x: 2, y: top, w: 14, h: 2.4, mass: 4, hp: 70 }, [roofOf(f, 0), roofOf(f, 2)], 70);
  return finishStructure(b, 'Riverside Stores', 0.7);
}

function buildParkade(): StructureDef {
  reseed(0x9a4c);
  const b: Builder = { pieces: [], joints: [] };
  const f = frame(b, {
    x0: 0,
    spans: [7, 7, 7, 7, 7],
    storeys: [3.4, 3.1, 3.1, 3.1, 3.1],
    zone: 'main',
    colW: 0.75,
    colMat: 'concrete',
    colDensity: 5,
    beamD: 0.6,
    slabMat: 'concrete',
    slabDensity: 6.8,
    roofDensity: 6.2,
    infill: (bay, s) => (bay === 0 ? 'core' : s === 0 ? null : 'parapet'),
  });
  const top = f.tops[f.tops.length - 1] as number;
  for (const bay of [1, 3]) {
    const x = (f.lineX[bay] as number) + 3.3;
    rider(b, { label: `Lamp post ${bay}`, kind: 'mast', material: 'steel', zone: 'roof', x, y: top, w: 0.25, h: 5, mass: 0.6, hp: 30 }, [roofOf(f, bay)], 30);
  }
  return finishStructure(b, 'Market Street Parkade', 0.8);
}

// --------------------------------------------------------------- catalog

export const BUILDINGS: BuildingDef[] = [
  {
    id: 'corner',
    name: 'Corner Store',
    kind: 'Two-storey brick shop',
    build: buildCornerStore,
    depth: 9,
    setting: 'town',
    sign: 'CORNER STORE',
    site: { padMin: -15, padMax: -8, pitMin: 19, pitMax: 25, lotMin: -4, lotMax: 17, neighbourX: 29, boom: 24, craneX: -22, dozerX: -6, excX: 16, loaderX: -11 },
    flaws: [{ label: 'Column B · floor 1', note: 'cracked brick pier', known: true }],
    neighbour: { name: 'the laundromat', look: 'bakery', w: 10, h: 7 },
  },
  {
    id: 'garage',
    name: 'Halsey Auto',
    kind: 'Steel-frame workshop',
    build: buildGarage,
    depth: 12,
    setting: 'suburb',
    sign: 'HALSEY AUTO',
    site: { padMin: -16, padMax: -8, pitMin: 30, pitMax: 37, lotMin: -4, lotMax: 28, neighbourX: 41, boom: 26, craneX: -24, dozerX: -6, excX: 27, loaderX: -12 },
    flaws: [
      { label: 'Column C · floor 1', note: 'rusted base plate', known: true },
      { label: 'Column E · floor 1', note: 'impact-bent flange', known: false },
    ],
    neighbour: { name: 'the tyre shop', look: 'tyres', w: 12, h: 6 },
  },
  {
    id: 'house',
    name: 'No. 12 Maple Street',
    kind: 'Timber-frame house',
    build: buildHouse,
    depth: 10,
    setting: 'suburb',
    site: { padMin: -17, padMax: -9, pitMin: 19, pitMax: 25, lotMin: -5, lotMax: 17, neighbourX: 29, boom: 24, craneX: -24, dozerX: -6, excX: 16, loaderX: -13 },
    flaws: [{ label: 'Chimney · course 1', note: 'crumbling mortar', known: true }],
    prize: { label: 'Old floor safe', home: 'Clapboard bay B–C · floor 1', look: 'safe', w: 1.2, h: 1.2, mass: 4, value: 6000 },
    neighbour: { name: 'No. 14', look: 'house', w: 11, h: 8 },
  },
  {
    id: 'silo',
    name: 'Holloway Silo',
    kind: 'Concrete grain silo',
    build: buildSilo,
    depth: 7,
    setting: 'farm',
    site: { padMin: -46, padMax: -37, pitMin: 9.5, pitMax: 14.5, lotMin: -34, lotMax: 8.5, neighbourX: 17, boom: 34, craneX: -42, dozerX: -30, excX: -24, loaderX: -40 },
    flaws: [
      { label: 'Column A · floor 1', note: 'spalled stave', known: true },
      { label: 'Silo wall A–B · floor 2', note: 'delaminated pour', known: false },
    ],
    neighbour: { name: 'the farmhouse', look: 'farmhouse', w: 11, h: 9 },
  },
  {
    id: 'stack',
    name: 'Ironworks Stack',
    kind: 'Brick chimney and boiler house',
    build: buildStack,
    depth: 8,
    setting: 'yard',
    site: { padMin: -58, padMax: -48, pitMin: 8, pitMax: 13, lotMin: -46, lotMax: 7.5, neighbourX: 16, boom: 40, craneX: -52, dozerX: -36, excX: -28, loaderX: -52 },
    flaws: [
      { label: 'Column A · floor 1', note: 'burnt-out brick', known: true },
      { label: 'Stack A–B · floor 3', note: 'frost-split courses', known: false },
    ],
    neighbour: { name: 'the pump house', look: 'pumphouse', w: 9, h: 7 },
  },
  {
    id: 'warehouse',
    name: 'Riverside Stores',
    kind: 'Four-storey warehouse',
    build: buildWarehouse,
    depth: 14,
    setting: 'wharf',
    sign: 'RIVERSIDE STORES',
    site: { padMin: -19, padMax: -9, pitMin: 40, pitMax: 48, lotMin: -5, lotMax: 38, neighbourX: 52, boom: 44, craneX: -30, dozerX: -7, excX: 37, loaderX: -14 },
    flaws: [
      { label: 'Column B · floor 1', note: 'tidal rot at the base', known: true },
      { label: 'Column F · floor 2', note: 'corroded rebar', known: false },
      { label: 'Core wall D–E · floor 1', note: 'cold joint', known: false },
    ],
    prize: { label: 'Ship’s bell', home: 'Core wall D–E · floor 1', look: 'bell', w: 1.3, h: 1.5, mass: 2, value: 9000 },
    neighbour: { name: 'the chandlery', look: 'chandlery', w: 12, h: 9 },
  },
  {
    id: 'parkade',
    name: 'Market Street Parkade',
    kind: 'Five-deck concrete car park',
    build: buildParkade,
    depth: 16,
    setting: 'city',
    site: { padMin: -19, padMax: -9, pitMin: 38, pitMax: 46, lotMin: -5, lotMax: 37, neighbourX: 50, boom: 40, craneX: -30, dozerX: -7, excX: 36, loaderX: -14 },
    flaws: [
      { label: 'Column C · floor 1', note: 'salt-damaged base', known: true },
      { label: 'Column E · floor 2', note: 'punching crack', known: false },
    ],
    neighbour: { name: 'the office block', look: 'office', w: 14, h: 16 },
  },
  {
    id: 'halden',
    name: 'The Halden Exchange',
    kind: 'Fifteen-storey framed tower',
    build: buildHalden,
    depth: 16,
    setting: 'city',
    sign: 'HALDEN',
    site: { padMin: -16, padMax: -6, pitMin: 54, pitMax: 62, lotMin: -3, lotMax: 52, neighbourX: 66, boom: 64, craneX: -36, dozerX: -44, excX: 78, loaderX: -24 },
    flaws: [
      { label: 'Column F · floor 1', note: 'spalled base, rebar exposed', known: true },
      { label: 'Column J · floor 3', note: 'honeycombed pour', known: true },
      { label: 'Column H · floor 6', note: 'corroded ties', known: false },
      { label: 'Core wall · floor 2', note: 'cold joint in the pour', known: false },
      { label: 'Column E · floor 9', note: 'fire-damaged cover', known: false },
      { label: 'Column K · floor 6', note: 'cracked truss bearing', known: false },
      { label: 'Column C · floor 2', note: 'water-damaged base', known: false },
      { label: 'Column G · floor 12', note: 'undersized repair', known: false },
    ],
    prize: { label: 'Exchange vault', home: 'Core wall · floor 1', look: 'safe', w: 2.2, h: 1.9, mass: 14, value: 25000 },
    neighbour: { name: 'Pellow’s Bakery', look: 'bakery', w: 16, h: 9 },
  },
];

export function getBuilding(id: string): BuildingDef {
  const b = BUILDINGS.find((x) => x.id === id);
  if (!b) throw new Error(`Unknown building: ${id}`);
  return b;
}
