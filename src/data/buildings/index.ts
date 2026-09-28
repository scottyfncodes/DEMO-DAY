import type { BuildingDef } from '../../core/types';
import { GARAGE } from './garage';
import { HOUSE } from './house';
import { MILL } from './mill';
import { SHED } from './shed';
import { SILO } from './silo';
import { WAREHOUSE } from './warehouse';

export const BUILDINGS: Record<string, BuildingDef> = {
  [SHED.id]: SHED,
  [GARAGE.id]: GARAGE,
  [SILO.id]: SILO,
  [HOUSE.id]: HOUSE,
  [MILL.id]: MILL,
  [WAREHOUSE.id]: WAREHOUSE,
};

export function getBuilding(id: string): BuildingDef {
  const def = BUILDINGS[id];
  if (!def) throw new Error(`Unknown building: ${id}`);
  return def;
}
