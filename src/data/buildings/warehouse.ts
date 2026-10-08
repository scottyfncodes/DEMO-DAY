import type { BuildingDef, MemberDef } from '../../core/types';

/**
 * JOB 06 — Riverside Warehouse. Three floors of concrete slabs on concrete
 * columns with a central stair core. The outer columns are close to their
 * load limit; the core is not, and it holds the two middle bays up on its own.
 */
const COL_X = [0, 4, 12, 16];
const LEVELS = [
  { y: 0, h: 3.5 },
  { y: 3.75, h: 3.5 },
  { y: 7.5, h: 3.5 },
];
const SLAB_Y = [3.5, 7.25, 11.0];

function columns(): MemberDef[] {
  const out: MemberDef[] = [];
  LEVELS.forEach((lvl, li) => {
    COL_X.forEach((cx, ci) => {
      out.push({
        id: `c${li + 1}_${ci + 1}`,
        kind: 'column',
        material: 'concrete',
        x: cx - 0.25,
        y: lvl.y,
        w: 0.5,
        h: lvl.h,
        label: `L${li + 1} Column ${ci + 1}`,
        note: li === 0 ? 'Ground-floor column. Carries everything above it and is near its rated load.' : 'Upper column. Stands on the slab below.',
      });
    });
  });
  return out;
}

function slabs(): MemberDef[] {
  const bays: Array<{ x: number; w: number; label: string; note: string }> = [
    { x: -0.25, w: 4.5, label: 'Bay A', note: 'Spans columns 1 and 2.' },
    { x: 3.75, w: 5.25, label: 'Bay B', note: 'Spans column 2 and the stair core.' },
    { x: 7.5, w: 4.75, label: 'Bay C', note: 'Spans the stair core and column 3.' },
    { x: 11.75, w: 4.5, label: 'Bay D', note: 'Spans columns 3 and 4.' },
  ];
  const out: MemberDef[] = [];
  SLAB_Y.forEach((y, li) => {
    bays.forEach((bay, bi) => {
      const isRoof = li === SLAB_Y.length - 1;
      const touchesCore = bi === 1 || bi === 2;
      out.push({
        id: `s${li + 1}_${String.fromCharCode(65 + bi)}`,
        kind: isRoof ? 'roof' : 'slab',
        material: 'concrete',
        x: bay.x,
        y,
        w: bay.w,
        h: 0.25,
        label: `${isRoof ? 'Roof' : `L${li + 1} Slab`} ${bay.label}`,
        note: bay.note,
        ...(touchesCore ? { supportedBy: ['core'] } : {}),
      });
    });
  });
  return out;
}

function cladding(): MemberDef[] {
  const out: MemberDef[] = [];
  LEVELS.forEach((lvl, li) => {
    out.push({
      id: `clad${li + 1}_l`,
      kind: 'wall',
      material: 'steel',
      x: 0.25,
      y: lvl.y,
      w: 3.5,
      h: lvl.h - 0.1,
      mass: 1.2,
      decor: ['ribbon'],
      label: `L${li + 1} Cladding West`,
      anchors: [`c${li + 1}_1`, `c${li + 1}_2`],
      note: 'Profiled steel cladding hung from the columns. Not structural.',
    });
    out.push({
      id: `clad${li + 1}_r`,
      kind: 'wall',
      material: 'steel',
      x: 12.25,
      y: lvl.y,
      w: 3.5,
      h: lvl.h - 0.1,
      mass: 1.2,
      decor: li === 0 ? ['ribbon', 'door'] : ['ribbon'],
      label: `L${li + 1} Cladding East`,
      anchors: [`c${li + 1}_3`, `c${li + 1}_4`],
      note: 'Profiled steel cladding hung from the columns. Not structural.',
    });
  });
  return out;
}

export const WAREHOUSE: BuildingDef = {
  id: 'warehouse',
  name: 'Riverside Warehouse',
  floors: 3,
  materials: 'Concrete / Steel',
  footprint: { x: -1.6, w: 19.4 },
  ground: { x: -20, w: 48 },
  neighbors: [
    { id: 'river', label: 'River', x: -13, w: 11, h: 0.2, style: 'water' },
    { id: 'substation', label: 'Substation', x: 19.2, w: 3.6, h: 3.2, style: 'substation' },
  ],
  members: [
    ...columns(),
    {
      id: 'core',
      kind: 'core',
      material: 'concrete',
      x: 7.5,
      y: 0,
      w: 1.5,
      h: 11.25,
      hp: 1000,
      label: 'Stair Core',
      decor: ['vent'],
      note: 'Solid reinforced-concrete stair core. Carries bays B and C on every floor. One shaped charge will not cut it; two will.',
    },
    ...slabs(),
    ...cladding(),
  ],
};
