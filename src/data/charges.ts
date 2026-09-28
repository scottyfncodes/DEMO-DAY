import type { ChargeDef, ChargeType } from '../core/types';

/**
 * Charge catalogue. Numbers are tuned against MATERIALS in materials.ts:
 * a small charge breaks wood and thin brick, a heavy charge breaks a concrete
 * column, and a shaped charge breaks anything it is placed on including a
 * structural core.
 */
export const CHARGES: Record<ChargeType, ChargeDef> = {
  small: {
    type: 'small',
    name: 'Small Charge',
    short: 'SMALL',
    description: 'Localized cut. Breaks timber, thin brick and light steel.',
    power: 60,
    radius: 1.6,
    impulse: 0,
    multipliers: {},
    directional: false,
    color: '#ffb020',
  },
  heavy: {
    type: 'heavy',
    name: 'Heavy Charge',
    short: 'HEAVY',
    description: 'Large blast. Breaks concrete columns and damages everything nearby.',
    power: 200,
    radius: 3.2,
    impulse: 0,
    multipliers: {},
    directional: false,
    color: '#ff5a36',
  },
  directional: {
    type: 'directional',
    name: 'Directional Charge',
    short: 'DIRECT',
    description: 'Kicks the structure above it sideways. Choose which way it falls.',
    power: 130,
    radius: 1.8,
    impulse: 3.2,
    multipliers: {},
    directional: true,
    color: '#38c6ff',
  },
  shaped: {
    type: 'shaped',
    name: 'Shaped Charge',
    short: 'SHAPED',
    description: 'Focused cut through one component. Devastating on columns and cores.',
    power: 420,
    radius: 0.35,
    impulse: 0,
    multipliers: { column: 1.5, core: 1.5, slab: 0.6, roof: 0.6, wall: 0.8 },
    directional: false,
    color: '#b46bff',
  },
};

export const CHARGE_ORDER: ChargeType[] = ['small', 'heavy', 'directional', 'shaped'];

export function chargeDef(type: ChargeType): ChargeDef {
  return CHARGES[type];
}
