/**
 * Shared domain types for DEMO DAY.
 *
 * Everything in the game is data-driven: buildings, contracts, charges and
 * equipment are plain objects described by these interfaces.
 */

export type Material = 'wood' | 'brick' | 'concrete' | 'steel';

export type MemberKind = 'column' | 'beam' | 'slab' | 'wall' | 'core' | 'roof';

export type ChargeType = 'small' | 'heavy' | 'directional' | 'shaped';

export type Direction = 'left' | 'right';

/** A structural component of a building, defined in world metres. */
export interface MemberDef {
  id: string;
  kind: MemberKind;
  material: Material;
  /** Bottom-left corner. */
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  /** Inspection note shown to the player. */
  note?: string;
  /** Pre-existing damage, 0..1. Reduces integrity and load capacity. */
  damage?: number;
  /** Must remain standing (selective demolition / clearance). */
  protect?: boolean;
  /**
   * Members this one is fastened to (siding, cladding). If every anchor is
   * gone, the member falls even though it touches the ground.
   */
  anchors?: string[];
  /**
   * Lateral bias applied when the member starts falling without a
   * directional push. Positive leans right. Represents settled foundations.
   */
  lean?: number;
  /** Optional integrity override (hit points). */
  hp?: number;
  /** Optional mass override (hollow structures such as silos and tanks). */
  mass?: number;
  /** Optional load-capacity override. */
  capacity?: number;
  /**
   * Extra members this one is supported by even though their top edge does
   * not touch its bottom edge (slabs tied into the side of a core).
   */
  supportedBy?: string[];
  /**
   * Architectural details drawn on the member (cosmetic only). They ride
   * with the member when it falls.
   */
  decor?: DecorKind[];
}

/** Cosmetic details a member can carry. */
export type DecorKind =
  | 'window'
  | 'door'
  | 'vent'
  | 'ladder'
  | 'lettering'
  | 'truss'
  | 'ribbon'
  | 'cap'
  | 'louvre'
  | 'garageDoor';

export interface NeighborDef {
  id: string;
  label: string;
  x: number;
  w: number;
  h: number;
  /** Visual style hint. */
  style?: 'house' | 'road' | 'water' | 'fence' | 'tank' | 'shed' | 'greenhouse' | 'rail' | 'substation';
}

export interface BuildingDef {
  id: string;
  name: string;
  floors: number;
  materials: string;
  members: MemberDef[];
  /** Debris landing zone, in world metres. */
  footprint: { x: number; w: number };
  neighbors?: NeighborDef[];
  /** Visual extent of the ground plane. */
  ground?: { x: number; w: number };
}

export type ContractType =
  | 'FULL_DEMOLITION'
  | 'CONTROLLED_COLLAPSE'
  | 'PRECISION_DEMO'
  | 'SELECTIVE_DEMOLITION'
  | 'STRUCTURAL_SURGERY'
  | 'CLEARANCE';

export type Loadout = Partial<Record<ChargeType, number>>;

export interface ContractDef {
  id: string;
  jobNumber: number;
  title: string;
  buildingId: string;
  type: ContractType;
  brief: string;
  value: number;
  /** Fraction of target structure that must come down, 0..1. */
  requiredDestruction: number;
  /** Maximum collateral fraction, 0..1. */
  maxCollateral: number;
  /** Fraction of debris that should land inside the footprint for bonus. */
  targetFootprint: number;
  /** When true, missing targetFootprint fails the contract. */
  footprintRequired?: boolean;
  loadout: Loadout;
  difficulty: 1 | 2 | 3 | 4 | 5;
  /** Contract id that must be completed first. */
  requires?: string;
  hints: string[];
}

export interface ChargeDef {
  type: ChargeType;
  name: string;
  short: string;
  description: string;
  /** Damage dealt to the member it is placed on. */
  power: number;
  /** Blast radius in metres; damage falls off with distance. */
  radius: number;
  /** Lateral impulse in m/s applied to the pushed stack (directional only). */
  impulse: number;
  /** Damage multiplier per member kind. */
  multipliers: Partial<Record<MemberKind, number>>;
  directional: boolean;
  color: string;
}

export interface EquipmentDef {
  id: string;
  name: string;
  cost: number;
  description: string;
  effect: string;
}

export interface PlacedCharge {
  id: string;
  type: ChargeType;
  memberId: string;
  direction?: Direction;
  /**
   * Where along the member the charge is strapped, 0..1 along its long axis
   * (bottom to top on vertical members, left to right on horizontal ones).
   * Omitted means the default point: low on verticals, centred on horizontals.
   */
  at?: number;
}

export interface MemberStats {
  mass: number;
  hp: number;
  capacity: number;
}

export interface ContractRecord {
  attempts: number;
  completions: number;
  bestPayout: number;
  bestRemoved: number;
  bestCollateral: number;
  fewestCharges: number;
  bestEfficiency: number;
}

export interface Settings {
  sound: boolean;
  reducedMotion: boolean;
  haptics: boolean;
}

export interface SaveData {
  version: number;
  money: number;
  totalEarned: number;
  completed: string[];
  equipment: string[];
  records: Record<string, ContractRecord>;
  settings: Settings;
  lastContractId?: string;
}
