import { Rng } from '../core/rng';
import type { BuildingDef } from '../core/types';

/**
 * The world around a job. A side-on diorama with depth:
 *
 *   district → blocks (split by cross streets) → lots → structures → details
 *
 * Everything is generated deterministically from the site seed and laid out
 * in real metres, so a 9 m house next door is a 9 m house. Depth is a scale
 * factor `k`: 1 is the play plane the target building stands on, smaller is
 * further back (and higher on screen), larger is the street in front.
 *
 * None of this touches the simulation. The gameplay neighbours (the house a
 * metre away, the highway, the river) stay in the building data; the world
 * builds around them and never puts anything inside the job's site.
 */

export type District = 'suburb' | 'farmland' | 'industrial' | 'riverside';

export interface SiteDef {
  buildingId: string;
  district: District;
  districtName: string;
  /** The street the job lot fronts. */
  street: string;
  lotNumber: number;
  seed: number;
}

export type LotKind = 'job' | 'residential' | 'commercial' | 'industrial' | 'farm' | 'park' | 'yard';
export type Surface = 'lawn' | 'gravel' | 'paving' | 'field' | 'dirt' | 'asphalt';

export interface Lot {
  x: number;
  w: number;
  kind: LotKind;
  surface: Surface;
  number: number;
}

export type CrossingKind = 'street' | 'road' | 'highway' | 'rail' | 'river';

/** Something that runs into the screen (a cross street, the highway, a river) and splits the blocks. */
export interface Crossing {
  x: number;
  w: number;
  kind: CrossingKind;
  name: string;
  /** Sidewalk width on each side (inside x..x+w), metres. */
  walk: number;
}

export type PropType =
  // structures
  | 'house'
  | 'bungalow'
  | 'shop'
  | 'apartment'
  | 'garage'
  | 'shed'
  | 'barn'
  | 'farmhouse'
  | 'grainBin'
  | 'warehouse'
  | 'factory'
  | 'tank'
  | 'stack'
  | 'crane'
  | 'trailer'
  // landscape
  | 'tree'
  | 'pine'
  | 'hedge'
  | 'bale'
  // fences
  | 'picket'
  | 'chainlink'
  | 'siteFence'
  | 'railFence'
  // street furniture
  | 'streetlight'
  | 'pole'
  | 'hydrant'
  | 'mailbox'
  | 'bin'
  | 'bench'
  | 'trafficLight'
  | 'streetSign'
  | 'stake'
  | 'jobSign'
  | 'cone'
  | 'barrier'
  // vehicles and people
  | 'car'
  | 'pickup'
  | 'van'
  | 'truck'
  | 'excavator'
  | 'dumpster'
  | 'container'
  | 'worker';

export interface Prop {
  type: PropType;
  /** Left edge and size in metres. */
  x: number;
  w: number;
  h: number;
  /** Depth scale: 1 = play plane, < 1 behind, > 1 in front. */
  k: number;
  /** Deterministic look: colours, storeys, roof shape. */
  variant: number;
  seed: number;
  flip?: boolean;
  label?: string;
}

export type BackType = 'house' | 'block' | 'tower' | 'tree' | 'factory' | 'silo' | 'stack' | 'hill' | 'turbine' | 'crane' | 'bridge' | 'barn' | 'warehouse';

/** A silhouette in one of the far layers. */
export interface BackItem {
  type: BackType;
  x: number;
  w: number;
  h: number;
  seed: number;
}

export interface World {
  site: SiteDef;
  district: District;
  /** Horizontal pan extent of the play plane. */
  minX: number;
  maxX: number;
  /** The job site itself: building, landing zone and gameplay neighbours. Nothing is generated in here. */
  siteMinX: number;
  siteMaxX: number;
  /** The job lot (site plus the crew's working pads). */
  lot: Lot;
  lots: Lot[];
  crossings: Crossing[];
  /** Sorted back to front. */
  props: Prop[];
  /** The next block back, k = BACK_K. */
  backRow: BackItem[];
  /** The skyline, k = SKY_K. */
  skyline: BackItem[];
}

export const BACK_K = 0.5;
export const SKY_K = 0.22;
/** How far the world reaches beyond the job site on each side, metres. */
export const WORLD_REACH = 150;
/** The street in front of the lots, as depth bands. */
export const APRON = {
  walk: [1.0, 1.055] as const,
  curb: 1.058,
  road: [1.062, 1.34] as const,
  farWalk: [1.34, 1.4] as const,
  end: 1.4,
};
/** Parking lane depth on the front street. */
export const PARKING_K = 1.1;

interface DistrictStyle {
  lotW: [number, number];
  lotsPerBlock: [number, number];
  crossing: { kind: CrossingKind; w: number; walk: number };
  surface: Surface;
  lotKind: LotKind;
  streetNames: string[];
}

const STYLES: Record<District, DistrictStyle> = {
  suburb: {
    lotW: [11, 16],
    lotsPerBlock: [4, 6],
    crossing: { kind: 'street', w: 13, walk: 2 },
    surface: 'lawn',
    lotKind: 'residential',
    streetNames: ['Birch St', 'Alder Rd', 'Fern Ave', 'Rowan St', 'Hazel Way', 'Elm St', 'Cedar Ct', 'Poplar Ave'],
  },
  farmland: {
    lotW: [44, 76],
    lotsPerBlock: [2, 3],
    crossing: { kind: 'road', w: 8, walk: 0 },
    surface: 'field',
    lotKind: 'farm',
    streetNames: ['County Rd 4', 'Mill Lane', 'Gravel Pit Rd', 'Orchard Rd'],
  },
  industrial: {
    lotW: [22, 36],
    lotsPerBlock: [3, 4],
    crossing: { kind: 'street', w: 14, walk: 2 },
    surface: 'gravel',
    lotKind: 'industrial',
    streetNames: ['Smelter St', 'Anvil Rd', 'Coke Ave', 'Slag Way', 'Bessemer St'],
  },
  riverside: {
    lotW: [18, 28],
    lotsPerBlock: [3, 5],
    crossing: { kind: 'street', w: 12, walk: 2 },
    surface: 'paving',
    lotKind: 'industrial',
    streetNames: ['Ferry St', 'Cooper Ave', 'Rope Walk', 'Salt St', 'Barge Ln'],
  },
};

const NEIGHBOR_CROSSING: Record<string, CrossingKind | undefined> = { road: 'highway', rail: 'rail', water: 'river' };

/** Builds the world around a building. Deterministic for a given building and site. */
export function generateWorld(def: BuildingDef, site: SiteDef): World {
  const rng = new Rng(site.seed);
  const style = STYLES[site.district];

  // The job site: structure, landing zone and every gameplay neighbour, plus a little air.
  let siteMinX = def.footprint.x;
  let siteMaxX = def.footprint.x + def.footprint.w;
  for (const m of def.members) {
    siteMinX = Math.min(siteMinX, m.x);
    siteMaxX = Math.max(siteMaxX, m.x + m.w);
  }
  for (const n of def.neighbors ?? []) {
    siteMinX = Math.min(siteMinX, n.x);
    siteMaxX = Math.max(siteMaxX, n.x + n.w);
  }
  siteMinX = Math.floor(siteMinX - 2);
  siteMaxX = Math.ceil(siteMaxX + 2);

  const props: Prop[] = [];
  const lots: Lot[] = [];
  const crossings: Crossing[] = [];
  const add = (p: Omit<Prop, 'seed' | 'variant'> & { variant?: number }): void => {
    props.push({ variant: rng.int(0, 5), seed: Math.floor(rng.next() * 1e9), ...p });
  };

  // Gameplay neighbours that run into the screen become crossings of the block.
  for (const n of def.neighbors ?? []) {
    const kind = NEIGHBOR_CROSSING[n.style ?? ''];
    if (kind) crossings.push({ x: n.x, w: n.w, kind, name: n.label, walk: 0 });
  }

  // Working pads either side of the site: the crew, their trucks and the sign.
  const padW = site.district === 'farmland' ? 14 : 11;
  const jobLot: Lot = {
    x: siteMinX - padW,
    w: siteMaxX - siteMinX + padW * 2,
    kind: 'job',
    surface: site.district === 'suburb' ? 'dirt' : site.district === 'farmland' ? 'field' : 'gravel',
    number: site.lotNumber,
  };
  lots.push(jobLot);
  fillJobPads(def, site, jobLot, siteMinX, siteMaxX, add, rng);

  const minX = jobLot.x - WORLD_REACH;
  const maxX = jobLot.x + jobLot.w + WORLD_REACH;

  // Blocks outward from the job lot: lots, then a cross street, then more lots.
  let names = 0;
  const streetName = (): string => style.streetNames[names++ % style.streetNames.length] as string;
  let lotNo = site.lotNumber;
  for (const dir of [-1, 1] as const) {
    let edge = dir < 0 ? jobLot.x : jobLot.x + jobLot.w;
    let inBlock = rng.int(1, style.lotsPerBlock[1] - 1);
    let number = lotNo;
    while (dir < 0 ? edge > minX - 40 : edge < maxX + 40) {
      if (inBlock <= 0) {
        const c = style.crossing;
        const x = dir < 0 ? edge - c.w : edge;
        crossings.push({ x, w: c.w, kind: c.kind, name: streetName(), walk: c.walk });
        addCrossingFurniture(x, c.w, c.walk, site.district, add);
        edge += dir * c.w;
        inBlock = rng.int(style.lotsPerBlock[0], style.lotsPerBlock[1]);
        continue;
      }
      const w = Math.round(rng.range(style.lotW[0], style.lotW[1]));
      const x = dir < 0 ? edge - w : edge;
      number += dir * 2;
      const lot = fillLot(x, w, site.district, style, Math.max(1, number), add, rng);
      lots.push(lot);
      edge += dir * w;
      inBlock--;
    }
    lotNo = site.lotNumber;
  }

  addStreetFurniture(site.district, minX - 40, maxX + 40, siteMinX, siteMaxX, crossings, add, rng);

  lots.sort((a, b) => a.x - b.x);
  crossings.sort((a, b) => a.x - b.x);
  props.sort((a, b) => a.k - b.k || a.x - b.x);

  return {
    site,
    district: site.district,
    minX,
    maxX,
    siteMinX,
    siteMaxX,
    lot: jobLot,
    lots,
    crossings,
    props,
    backRow: generateBackRow(site.district, minX, maxX, rng),
    skyline: generateSkyline(site.district, (minX + maxX) / 2, maxX - minX, rng),
  };
}

type AddProp = (p: Omit<Prop, 'seed' | 'variant'> & { variant?: number }) => void;

function fillJobPads(def: BuildingDef, site: SiteDef, lot: Lot, siteMinX: number, siteMaxX: number, add: AddProp, rng: Rng): void {
  const left = lot.x;
  const right = lot.x + lot.w;
  // Survey stakes on the property line.
  add({ type: 'stake', x: left + 0.3, w: 0.08, h: 0.9, k: 1.0 });
  add({ type: 'stake', x: right - 0.4, w: 0.08, h: 0.9, k: 1.0 });
  // Left pad: site office, the boss's pickup, the sign and two of the crew.
  add({ type: 'trailer', x: left + 1.2, w: 6.2, h: 2.7, k: 0.9 });
  add({ type: 'pickup', x: left + 1.5, w: 5.3, h: 1.85, k: 0.98, variant: 0 });
  add({ type: 'jobSign', x: siteMinX - 3.4, w: 2.4, h: 2.2, k: 1.01, label: `${def.name}` });
  add({ type: 'worker', x: siteMinX - 5.6, w: 0.5, h: 1.78, k: 1.03, variant: 0 });
  add({ type: 'worker', x: siteMinX - 6.4, w: 0.5, h: 1.72, k: 1.03, variant: 1, flip: true });
  add({ type: 'cone', x: siteMinX - 0.8, w: 0.36, h: 0.7, k: 1.04 });
  // Right pad: the skip, a machine and the barrier line.
  add({ type: 'excavator', x: right - 9.2, w: 5.6, h: 3.1, k: 0.9 });
  add({ type: 'dumpster', x: right - 5.2, w: 3.8, h: 1.6, k: 0.97 });
  add({ type: 'worker', x: siteMaxX + 3.2, w: 0.5, h: 1.75, k: 1.03, variant: 2, flip: true });
  add({ type: 'cone', x: siteMaxX + 0.5, w: 0.36, h: 0.7, k: 1.04 });
  add({ type: 'barrier', x: siteMaxX + 1.4, w: 1.6, h: 1.0, k: 1.05 });
  add({ type: 'barrier', x: siteMinX - 2.0, w: 1.6, h: 1.0, k: 1.05 });
  // Temporary fence along the back of the lot.
  for (let x = left + 0.2; x < right - 0.2; x += 3.5) add({ type: 'siteFence', x, w: Math.min(3.5, right - 0.2 - x), h: 1.8, k: 0.8 });
  if (site.district !== 'farmland' && rng.next() < 0.8) add({ type: 'tree', x: left + 7.8, w: 4.6, h: 7.2, k: 0.82 });
}

function fillLot(x: number, w: number, district: District, style: DistrictStyle, number: number, add: AddProp, rng: Rng): Lot {
  const r = rng.next();
  switch (district) {
    case 'suburb': {
      if (r < 0.1) {
        // Pocket park.
        for (let tx = x + 1.5; tx < x + w - 3; tx += rng.range(3.5, 5.5)) add({ type: rng.next() < 0.3 ? 'pine' : 'tree', x: tx, w: rng.range(3.4, 5.2), h: rng.range(5.5, 9), k: rng.range(0.84, 0.97) });
        add({ type: 'bench', x: x + w / 2 - 0.9, w: 1.8, h: 0.9, k: 1.0 });
        add({ type: 'bin', x: x + w / 2 + 1.4, w: 0.55, h: 0.95, k: 1.01 });
        return { x, w, kind: 'park', surface: 'lawn', number };
      }
      if (r < 0.22) {
        // Corner shop: no setback, awning to the sidewalk.
        const sw = Math.min(w - 2, rng.range(8, 11));
        add({ type: 'shop', x: x + (w - sw) / 2, w: sw, h: rng.range(5.2, 6.4), k: 0.98 });
        add({ type: 'bin', x: x + 0.6, w: 0.55, h: 0.95, k: 1.01 });
        return { x, w, kind: 'commercial', surface: 'paving', number };
      }
      if (r < 0.3) {
        const aw = Math.min(w - 2, rng.range(10, 13));
        add({ type: 'apartment', x: x + (w - aw) / 2, w: aw, h: rng.range(10.5, 13.5), k: 0.9 });
        add({ type: 'hedge', x: x + 0.5, w: w - 1, h: 0.9, k: 1.0 });
        return { x, w, kind: 'residential', surface: 'lawn', number };
      }
      // Detached house with a driveway, a car, a fence and a tree or two.
      const bungalow = r > 0.72;
      const hw = Math.min(w - 4.5, bungalow ? rng.range(8, 10.5) : rng.range(7, 8.8));
      const drive = rng.next() < 0.5 ? 'left' : 'right';
      const hx = drive === 'left' ? x + w - hw - 1.2 : x + 1.2;
      const dx = drive === 'left' ? x + 0.4 : x + w - 3.6;
      add({ type: bungalow ? 'bungalow' : 'house', x: hx, w: hw, h: bungalow ? rng.range(4.6, 5.4) : rng.range(7.2, 8.4), k: rng.range(0.9, 0.94) });
      if (rng.next() < 0.35) add({ type: 'garage', x: dx - 0.1, w: 3.6, h: 3.0, k: 0.86 });
      if (rng.next() < 0.75) add({ type: rng.next() < 0.25 ? 'van' : 'car', x: dx, w: rng.range(4.1, 4.6), h: 1.45, k: 0.975, flip: rng.next() < 0.5 });
      if (rng.next() < 0.75) add({ type: rng.next() < 0.25 ? 'pine' : 'tree', x: drive === 'left' ? x + w - 2.6 : x + rng.range(0.2, 1.4), w: rng.range(3.2, 4.8), h: rng.range(5.4, 8.6), k: rng.range(0.86, 0.96) });
      const fenceFrom = drive === 'left' ? x + 4.2 : x + 0.2;
      const fenceTo = drive === 'left' ? x + w - 0.2 : x + w - 4.2;
      if (rng.next() < 0.5) add({ type: 'picket', x: fenceFrom, w: fenceTo - fenceFrom, h: 1.0, k: 0.995 });
      else add({ type: 'hedge', x: fenceFrom, w: fenceTo - fenceFrom, h: rng.range(0.8, 1.3), k: 0.995 });
      add({ type: 'mailbox', x: drive === 'left' ? x + 3.8 : x + w - 4.4, w: 0.45, h: 1.15, k: 1.01 });
      if (rng.next() < 0.5) add({ type: 'bin', x: drive === 'left' ? x + 3.2 : x + w - 3.6, w: 0.55, h: 0.95, k: 1.005 });
      return { x, w, kind: 'residential', surface: 'lawn', number };
    }
    case 'farmland': {
      if (r < 0.45) {
        // Farmstead: house, barn, grain bins and a windbreak of pines.
        add({ type: 'farmhouse', x: x + 4, w: 9, h: 7.6, k: 0.9 });
        add({ type: 'barn', x: x + 16, w: 13, h: 9.5, k: 0.82 });
        const binX = x + 31;
        for (let i = 0; i < rng.int(1, 3); i++) add({ type: 'grainBin', x: binX + i * 5.2, w: 4.6, h: rng.range(7, 9), k: 0.8 });
        add({ type: 'pickup', x: x + 13.2, w: 5.3, h: 1.85, k: 0.97, variant: rng.int(1, 4) });
        for (let tx = x + 2; tx < x + w - 3; tx += rng.range(3.2, 4.8)) add({ type: 'pine', x: tx, w: 3.4, h: rng.range(8, 11), k: 0.7 });
      } else {
        // Open field: bales and a hedgerow.
        for (let bx = x + 3; bx < x + w - 3; bx += rng.range(6, 12)) add({ type: 'bale', x: bx, w: 1.5, h: 1.2, k: rng.range(0.82, 0.98) });
        for (let tx = x + 1; tx < x + w - 3; tx += rng.range(5, 9)) add({ type: rng.next() < 0.4 ? 'pine' : 'tree', x: tx, w: rng.range(4, 6), h: rng.range(6, 10), k: 0.72 });
      }
      add({ type: 'railFence', x: x + 0.3, w: w - 0.6, h: 1.2, k: 0.995 });
      return { x, w, kind: 'farm', surface: 'field', number };
    }
    case 'industrial':
    case 'riverside': {
      const big = rng.range(0.6, 0.85) * w;
      const bx = x + rng.range(1, w - big - 1);
      if (r < 0.4) {
        add({ type: 'factory', x: bx, w: big, h: rng.range(8, 12), k: 0.88 });
        if (district === 'industrial' && rng.next() < 0.6) add({ type: 'stack', x: bx + big * 0.75, w: 1.6, h: rng.range(18, 26), k: 0.84 });
      } else if (r < 0.75) {
        add({ type: 'warehouse', x: bx, w: big, h: rng.range(7, 10), k: 0.9 });
      } else {
        for (let tx = x + 1.5; tx < x + w - 6; tx += 7) add({ type: 'tank', x: tx, w: 6, h: rng.range(6, 9), k: 0.86 });
      }
      // Yard clutter in front of the building line.
      if (rng.next() < 0.7) add({ type: 'container', x: x + rng.range(0.5, Math.max(0.6, w - 7)), w: 6.1, h: 2.6, k: 0.96, variant: rng.int(0, 4) });
      if (rng.next() < 0.6) add({ type: 'truck', x: x + rng.range(0.5, Math.max(0.6, w - 9)), w: 8.5, h: 3.4, k: 0.98, flip: rng.next() < 0.5 });
      if (district === 'riverside' && rng.next() < 0.3) add({ type: 'crane', x: x + w * 0.4, w: 12, h: 24, k: 0.78 });
      add({ type: 'chainlink', x: x + 0.3, w: w - 0.6, h: 2.1, k: 0.995 });
      return { x, w, kind: style.lotKind, surface: style.surface, number };
    }
  }
}

function addCrossingFurniture(x: number, w: number, walk: number, district: District, add: AddProp): void {
  if (district === 'farmland') {
    add({ type: 'streetSign', x: x + w + 0.4, w: 0.9, h: 2.6, k: 1.02 });
    return;
  }
  add({ type: 'trafficLight', x: x + walk * 0.4, w: 0.3, h: 4.2, k: 1.04 });
  add({ type: 'trafficLight', x: x + w - walk * 0.4 - 0.3, w: 0.3, h: 4.2, k: 1.04, flip: true });
  add({ type: 'streetSign', x: x + w + 0.3, w: 0.9, h: 2.8, k: 1.02 });
  add({ type: 'hydrant', x: x - 1.2, w: 0.42, h: 0.75, k: 1.03 });
}

function inSite(x: number, w: number, siteMinX: number, siteMaxX: number, pad: number): boolean {
  return x + w > siteMinX - pad && x < siteMaxX + pad;
}

function inCrossing(x: number, w: number, crossings: Crossing[]): boolean {
  return crossings.some((c) => x + w > c.x - 0.5 && x < c.x + c.w + 0.5);
}

function addStreetFurniture(district: District, from: number, to: number, siteMinX: number, siteMaxX: number, crossings: Crossing[], add: AddProp, rng: Rng): void {
  // Streetlights on the front sidewalk, poles and wires along the back of the lots.
  if (district !== 'farmland') {
    for (let x = from; x < to; x += 26) {
      if (inSite(x, 0.4, siteMinX, siteMaxX, 3) || inCrossing(x, 0.4, crossings)) continue;
      add({ type: 'streetlight', x, w: 0.3, h: 6.5, k: 1.045, flip: rng.next() < 0.5 });
    }
  }
  const poleStep = district === 'farmland' ? 44 : 34;
  for (let x = from + 7; x < to; x += poleStep) {
    if (inCrossing(x, 0.4, crossings) || inSite(x, 0.4, siteMinX, siteMaxX, 6)) continue;
    add({ type: 'pole', x, w: 0.32, h: district === 'farmland' ? 10.5 : 9.5, k: district === 'farmland' ? 1.02 : 0.8 });
  }
  // Parked cars along the front street, never across the job site or a junction.
  if (district === 'suburb' || district === 'riverside') {
    for (let x = from + rng.range(2, 8); x < to; x += rng.range(7, 16)) {
      if (inSite(x, 4.6, siteMinX, siteMaxX, 4) || inCrossing(x, 4.6, crossings)) continue;
      if (rng.next() < 0.45) continue;
      add({ type: rng.next() < 0.2 ? 'van' : 'car', x, w: 4.4, h: 1.45, k: PARKING_K, flip: rng.next() < 0.5 });
    }
  }
}

function generateBackRow(district: District, minX: number, maxX: number, rng: Rng): BackItem[] {
  const out: BackItem[] = [];
  // The back row sits further away, so it has to cover more ground to fill the view.
  const from = minX - 220;
  const to = maxX + 220;
  let x = from;
  while (x < to) {
    const seed = Math.floor(rng.next() * 1e9);
    switch (district) {
      case 'suburb': {
        const r = rng.next();
        if (r < 0.25) {
          const w = rng.range(4, 7);
          out.push({ type: 'tree', x, w, h: rng.range(6, 10), seed });
          x += w * 0.7;
        } else if (r < 0.32) {
          const w = rng.range(12, 18);
          out.push({ type: 'block', x, w, h: rng.range(12, 20), seed });
          x += w + rng.range(2, 5);
        } else {
          const w = rng.range(7, 10);
          out.push({ type: 'house', x, w, h: rng.range(6, 8.5), seed });
          x += w + rng.range(3, 6);
        }
        break;
      }
      case 'farmland': {
        const r = rng.next();
        if (r < 0.6) {
          const w = rng.range(4, 7);
          out.push({ type: 'tree', x, w, h: rng.range(6, 11), seed });
          x += w * rng.range(0.6, 2.5);
        } else if (r < 0.75) {
          const w = rng.range(10, 14);
          out.push({ type: 'barn', x, w, h: rng.range(8, 10), seed });
          x += w + rng.range(30, 60);
        } else {
          const w = 4.5;
          out.push({ type: 'silo', x, w, h: rng.range(12, 18), seed });
          x += w + rng.range(25, 50);
        }
        break;
      }
      case 'industrial':
      case 'riverside': {
        const r = rng.next();
        if (r < 0.5) {
          const w = rng.range(18, 34);
          out.push({ type: 'warehouse', x, w, h: rng.range(8, 13), seed });
          x += w + rng.range(2, 6);
        } else if (r < 0.75) {
          const w = rng.range(16, 26);
          out.push({ type: 'factory', x, w, h: rng.range(10, 15), seed });
          x += w + rng.range(2, 6);
        } else if (r < 0.88) {
          out.push({ type: 'stack', x, w: 2, h: rng.range(22, 34), seed });
          x += rng.range(6, 12);
        } else {
          const w = rng.range(12, 20);
          out.push({ type: district === 'riverside' ? 'crane' : 'block', x, w, h: rng.range(18, 28), seed });
          x += w + rng.range(4, 8);
        }
        break;
      }
    }
  }
  return out;
}

function generateSkyline(district: District, centre: number, span: number, rng: Rng): BackItem[] {
  const out: BackItem[] = [];
  const from = centre - span * 2.2;
  const to = centre + span * 2.2;
  // Rolling hills behind everything.
  for (let x = from; x < to; ) {
    const w = rng.range(80, 160);
    out.push({ type: 'hill', x, w, h: rng.range(10, district === 'farmland' ? 34 : 22), seed: Math.floor(rng.next() * 1e9) });
    x += w * 0.6;
  }
  // Downtown: a cluster of towers somewhere off to one side, scattered blocks elsewhere.
  const downtown = centre + (rng.next() < 0.5 ? -1 : 1) * span * rng.range(0.45, 0.8);
  let x = from;
  while (x < to) {
    const seed = Math.floor(rng.next() * 1e9);
    const near = Math.abs(x - downtown) < 110;
    if (district === 'farmland' && !near) {
      if (rng.next() < 0.25) out.push({ type: 'turbine', x, w: 6, h: rng.range(40, 55), seed });
      x += rng.range(30, 70);
      continue;
    }
    if (near) {
      const w = rng.range(12, 24);
      out.push({ type: 'tower', x, w, h: rng.range(40, 110), seed });
      x += w + rng.range(1, 5);
    } else {
      const w = rng.range(14, 30);
      const r = rng.next();
      out.push({ type: district === 'industrial' && r < 0.3 ? 'stack' : r < 0.65 ? 'block' : 'tower', x, w: district === 'industrial' && r < 0.3 ? 3 : w, h: rng.range(14, 40), seed });
      x += w + rng.range(4, 22);
    }
  }
  if (district === 'riverside') out.push({ type: 'bridge', x: downtown - 160, w: 220, h: 42, seed: 7 });
  return out;
}
