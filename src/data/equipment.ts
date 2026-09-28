import type { ChargeType, EquipmentDef, Loadout } from '../core/types';

export const EQUIPMENT: EquipmentDef[] = [
  {
    id: 'scanner',
    name: 'Structural Scanner',
    cost: 12000,
    description: 'Shows every load path at once during inspection: what carries what, and what is close to its limit.',
    effect: 'Load paths visible for all members',
  },
  {
    id: 'directional_kit',
    name: 'Directional Kit',
    cost: 18000,
    description: 'Adds one directional charge to every loadout. Decide which way things fall.',
    effect: '+1 Directional Charge per contract',
  },
  {
    id: 'heavy_kit',
    name: 'Heavy Charge Licence',
    cost: 30000,
    description: 'Adds one heavy charge to every loadout. Concrete stops being a problem.',
    effect: '+1 Heavy Charge per contract',
  },
  {
    id: 'shaped_kit',
    name: 'Shaped Charge Kit',
    cost: 45000,
    description: 'Adds one shaped charge to every loadout. Cuts cores and columns that nothing else will.',
    effect: '+1 Shaped Charge per contract',
  },
  {
    id: 'high_yield',
    name: 'High-Yield Blend',
    cost: 60000,
    description: 'Every charge hits 20% harder. Two smalls now do what a heavy used to.',
    effect: '+20% charge power',
  },
];

export function getEquipment(id: string): EquipmentDef {
  const e = EQUIPMENT.find((x) => x.id === id);
  if (!e) throw new Error(`Unknown equipment: ${id}`);
  return e;
}

const LOADOUT_BONUS: Record<string, ChargeType> = {
  directional_kit: 'directional',
  heavy_kit: 'heavy',
  shaped_kit: 'shaped',
};

/** Applies owned equipment to a contract's base loadout. */
export function effectiveLoadout(base: Loadout, owned: readonly string[]): Loadout {
  const out: Loadout = { ...base };
  for (const id of owned) {
    const type = LOADOUT_BONUS[id];
    if (type) out[type] = (out[type] ?? 0) + 1;
  }
  return out;
}

export function powerMultiplier(owned: readonly string[]): number {
  return owned.includes('high_yield') ? 1.2 : 1;
}

export function hasScanner(owned: readonly string[]): boolean {
  return owned.includes('scanner');
}
