import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../src/data/buildings';
import { SITES, getSite } from '../src/data/sites';
import { WORLD_REACH, generateWorld } from '../src/world/world';

const worlds = Object.values(BUILDINGS).map((def) => ({ def, world: generateWorld(def, getSite(def.id)) }));

describe('world generation', () => {
  it('gives every building a site in a district', () => {
    for (const id of Object.keys(BUILDINGS)) expect(SITES[id]?.buildingId).toBe(id);
  });

  it('is deterministic for a building and its site', () => {
    for (const { def, world } of worlds) {
      expect(JSON.stringify(generateWorld(def, getSite(def.id)))).toBe(JSON.stringify(world));
    }
  });

  it('reaches well beyond the job site on both sides', () => {
    for (const { world } of worlds) {
      expect(world.siteMinX - world.minX).toBeGreaterThanOrEqual(WORLD_REACH);
      expect(world.maxX - world.siteMaxX).toBeGreaterThanOrEqual(WORLD_REACH);
      expect(world.maxX - world.minX).toBeGreaterThan(300);
    }
  });

  it('keeps the job site clear: nothing generated stands on the play plane inside it', () => {
    for (const { def, world } of worlds) {
      // The site covers the structure, the landing zone and every gameplay neighbour.
      expect(world.siteMinX).toBeLessThanOrEqual(def.footprint.x);
      expect(world.siteMaxX).toBeGreaterThanOrEqual(def.footprint.x + def.footprint.w);
      for (const n of def.neighbors ?? []) {
        expect(world.siteMinX).toBeLessThanOrEqual(n.x);
        expect(world.siteMaxX).toBeGreaterThanOrEqual(n.x + n.w);
      }
      for (const p of world.props) {
        if (p.k < 0.85) continue;
        const overlaps = p.x + p.w > world.siteMinX && p.x < world.siteMaxX;
        expect(overlaps, `${def.id}: ${p.type} at ${p.x.toFixed(1)} (k ${p.k})`).toBe(false);
      }
    }
  });

  it('lays lots edge to edge without overlaps, split by cross streets', () => {
    for (const { def, world } of worlds) {
      const lots = [...world.lots].sort((a, b) => a.x - b.x);
      for (let i = 1; i < lots.length; i++) {
        const a = lots[i - 1]!;
        const b = lots[i]!;
        expect(b.x, `${def.id}: lot ${b.number}`).toBeGreaterThanOrEqual(a.x + a.w - 1e-6);
      }
      const streets = world.crossings.filter((c) => c.x + c.w <= world.lot.x || c.x >= world.lot.x + world.lot.w);
      expect(streets.length).toBeGreaterThanOrEqual(2);
      for (const c of streets) {
        for (const l of lots) expect(c.x + c.w <= l.x + 1e-6 || c.x >= l.x + l.w - 1e-6, `${def.id}: ${c.name}`).toBe(true);
      }
    }
  });

  it('turns roads, rails and rivers next to the job into crossings of the block', () => {
    const silo = worlds.find((w) => w.def.id === 'silo')!.world;
    expect(silo.crossings.some((c) => c.kind === 'highway' && c.name === 'Highway 9')).toBe(true);
    const warehouse = worlds.find((w) => w.def.id === 'warehouse')!.world;
    expect(warehouse.crossings.some((c) => c.kind === 'river')).toBe(true);
    const mill = worlds.find((w) => w.def.id === 'mill')!.world;
    expect(mill.crossings.some((c) => c.kind === 'rail')).toBe(true);
  });

  it('fills the district with real-scale structures and street furniture', () => {
    for (const { def, world } of worlds) {
      expect(world.props.length, def.id).toBeGreaterThan(60);
      expect(world.backRow.length).toBeGreaterThan(20);
      expect(world.skyline.length).toBeGreaterThan(10);
      // Props are sorted back to front so they draw in depth order.
      for (let i = 1; i < world.props.length; i++) expect(world.props[i]!.k).toBeGreaterThanOrEqual(world.props[i - 1]!.k);
      // A car is a car, a house is a house: sizes stay believable.
      for (const p of world.props) {
        if (p.type === 'car') expect(p.w).toBeGreaterThan(3.8);
        if (p.type === 'car') expect(p.w).toBeLessThan(5);
        if (p.type === 'house') expect(p.h).toBeGreaterThan(6);
        if (p.type === 'worker') expect(p.h).toBeLessThan(2);
      }
    }
  });

  it('puts the crew and their kit on the job lot, outside the landing zone', () => {
    for (const { def, world } of worlds) {
      const crew = world.props.filter((p) => p.type === 'worker' || p.type === 'jobSign' || p.type === 'trailer');
      expect(crew.length).toBeGreaterThanOrEqual(4);
      for (const p of crew) {
        expect(p.x).toBeGreaterThanOrEqual(world.lot.x);
        expect(p.x + p.w).toBeLessThanOrEqual(world.lot.x + world.lot.w);
        const inZone = p.x + p.w > def.footprint.x && p.x < def.footprint.x + def.footprint.w;
        expect(inZone, `${def.id}: ${p.type}`).toBe(false);
      }
    }
  });
});
