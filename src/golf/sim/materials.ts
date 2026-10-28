/**
 * Materials: how hard a part is to break, how a ball bounces off it, what it
 * breaks into and what it is worth. Every number here is read by the
 * simulation; colours are only a default tint for the renderer.
 */

export type MaterialId =
  | 'brick'
  | 'oldBrick'
  | 'foundation'
  | 'glass'
  | 'frame'
  | 'lintel'
  | 'door'
  | 'tile'
  | 'deck'
  | 'timber'
  | 'floor'
  | 'plaster'
  | 'slab'
  | 'soft'
  | 'wood'
  | 'ceramic'
  | 'metal'
  | 'electronics'
  | 'trunk'
  | 'branch'
  | 'foliage'
  | 'hedge'
  | 'fence'
  | 'plastic';

export type DebrisKind = 'brick' | 'glass' | 'wood' | 'dust' | 'ceramic' | 'leaf' | 'metal' | 'tile' | 'fabric';

export interface Material {
  /** Damage needed to break a fresh part (Infinity = never breaks). */
  hp: number;
  /** Bounce factor, multiplied by the ball's own. */
  bounce: number;
  /** Share of tangential speed lost on contact (0..1). */
  grip: number;
  /** Share of leftover speed a ball keeps when it breaks clean through. */
  passKeep: number;
  /** Can a ball carry on through the hole once this part breaks? */
  passable: boolean;
  /** Mass of one cubic metre, in the game's mass units (for debris and loads). */
  density: number;
  debris: DebrisKind;
  /** Sound family. */
  sound: 'brick' | 'glass' | 'wood' | 'concrete' | 'steel' | 'soft' | 'ceramic' | 'leaf';
  /** Points for breaking one part, before multipliers. */
  points: number;
  color: number;
}

export const MATERIALS: Record<MaterialId, Material> = {
  brick: { hp: 1.6, bounce: 0.55, grip: 0.25, passKeep: 0.4, passable: true, density: 18, debris: 'brick', sound: 'brick', points: 10, color: 0xb5553a },
  oldBrick: { hp: 0.85, bounce: 0.45, grip: 0.3, passKeep: 0.65, passable: true, density: 17, debris: 'brick', sound: 'brick', points: 10, color: 0x9a6a52 },
  foundation: { hp: 6, bounce: 0.6, grip: 0.2, passKeep: 0.4, passable: true, density: 24, debris: 'dust', sound: 'concrete', points: 25, color: 0x9d9a92 },
  glass: { hp: 0.12, bounce: 0.3, grip: 0.1, passKeep: 0.88, passable: true, density: 25, debris: 'glass', sound: 'glass', points: 30, color: 0xbfe3f2 },
  frame: { hp: 2.4, bounce: 0.45, grip: 0.2, passKeep: 0.6, passable: true, density: 6, debris: 'wood', sound: 'wood', points: 5, color: 0xf3efe6 },
  lintel: { hp: 5, bounce: 0.6, grip: 0.2, passKeep: 0.4, passable: true, density: 24, debris: 'dust', sound: 'concrete', points: 80, color: 0xd8d0c0 },
  door: { hp: 2.2, bounce: 0.4, grip: 0.25, passKeep: 0.6, passable: true, density: 6, debris: 'wood', sound: 'wood', points: 40, color: 0x2f6f73 },
  tile: { hp: 0.9, bounce: 0.5, grip: 0.3, passKeep: 0.7, passable: true, density: 20, debris: 'tile', sound: 'ceramic', points: 15, color: 0x4f5d75 },
  deck: { hp: 4, bounce: 0.4, grip: 0.3, passKeep: 0.5, passable: true, density: 6, debris: 'wood', sound: 'wood', points: 100, color: 0x8a6a4a },
  timber: { hp: 2.6, bounce: 0.45, grip: 0.25, passKeep: 0.55, passable: true, density: 7, debris: 'wood', sound: 'wood', points: 80, color: 0xe9e2d2 },
  floor: { hp: 4.5, bounce: 0.45, grip: 0.3, passKeep: 0.5, passable: true, density: 7, debris: 'wood', sound: 'wood', points: 60, color: 0xb98a5a },
  plaster: { hp: 1.0, bounce: 0.35, grip: 0.35, passKeep: 0.7, passable: true, density: 12, debris: 'dust', sound: 'concrete', points: 12, color: 0xf1e9d8 },
  slab: { hp: Infinity, bounce: 0.6, grip: 0.25, passKeep: 0, passable: false, density: 24, debris: 'dust', sound: 'concrete', points: 0, color: 0xc9c2b4 },
  soft: { hp: 3.5, bounce: 0.18, grip: 0.6, passKeep: 0.3, passable: true, density: 3, debris: 'fabric', sound: 'soft', points: 60, color: 0x6d8fa6 },
  wood: { hp: 1.6, bounce: 0.45, grip: 0.25, passKeep: 0.6, passable: true, density: 6, debris: 'wood', sound: 'wood', points: 40, color: 0x9a6b43 },
  ceramic: { hp: 0.5, bounce: 0.55, grip: 0.2, passKeep: 0.8, passable: true, density: 10, debris: 'ceramic', sound: 'ceramic', points: 50, color: 0xf4f1ea },
  metal: { hp: 3.2, bounce: 0.7, grip: 0.15, passKeep: 0.5, passable: true, density: 30, debris: 'metal', sound: 'steel', points: 60, color: 0xdfe3e6 },
  electronics: { hp: 0.9, bounce: 0.4, grip: 0.2, passKeep: 0.7, passable: true, density: 8, debris: 'glass', sound: 'glass', points: 120, color: 0x22262a },
  trunk: { hp: Infinity, bounce: 0.5, grip: 0.3, passKeep: 0, passable: false, density: 8, debris: 'wood', sound: 'wood', points: 0, color: 0x6b4a32 },
  branch: { hp: Infinity, bounce: 0.42, grip: 0.35, passKeep: 0, passable: false, density: 8, debris: 'wood', sound: 'wood', points: 0, color: 0x6b4a32 },
  foliage: { hp: Infinity, bounce: 0.1, grip: 0.5, passKeep: 0, passable: false, density: 1, debris: 'leaf', sound: 'leaf', points: 0, color: 0x5f9a4a },
  hedge: { hp: Infinity, bounce: 0.12, grip: 0.7, passKeep: 0, passable: false, density: 2, debris: 'leaf', sound: 'leaf', points: 0, color: 0x4d8a3e },
  fence: { hp: Infinity, bounce: 0.4, grip: 0.3, passKeep: 0, passable: false, density: 6, debris: 'wood', sound: 'wood', points: 0, color: 0xf6f2ea },
  plastic: { hp: 0.6, bounce: 0.5, grip: 0.2, passKeep: 0.8, passable: true, density: 4, debris: 'ceramic', sound: 'ceramic', points: 50, color: 0xff7aa8 },
};

export const material = (id: MaterialId): Material => MATERIALS[id];
