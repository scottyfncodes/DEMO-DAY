import type { SiteDef } from '../world/world';

/**
 * Where each job sits in the world. The building, its neighbours and its
 * landing zone come from the building data; the site places that lot inside a
 * district so the generator can build the streets, lots and blocks around it.
 */
export const SITES: Record<string, SiteDef> = {
  shed: { buildingId: 'shed', district: 'suburb', districtName: 'Eastgate', street: 'Larch Lane', lotNumber: 27, seed: 1101 },
  garage: { buildingId: 'garage', district: 'suburb', districtName: 'Eastgate', street: 'Copper Street', lotNumber: 9, seed: 2203 },
  silo: { buildingId: 'silo', district: 'farmland', districtName: 'Holloway Flats', street: 'Highway 9', lotNumber: 3, seed: 3307 },
  house: { buildingId: 'house', district: 'suburb', districtName: 'Old Orchard', street: 'Quince Avenue', lotNumber: 41, seed: 4409 },
  mill: { buildingId: 'mill', district: 'industrial', districtName: 'Ironworks Yard', street: 'Foundry Road', lotNumber: 2, seed: 5501 },
  warehouse: { buildingId: 'warehouse', district: 'riverside', districtName: 'Wharf District', street: 'Tannery Quay', lotNumber: 16, seed: 6607 },
};

export function getSite(buildingId: string): SiteDef {
  return SITES[buildingId] ?? { buildingId, district: 'suburb', districtName: 'Eastgate', street: 'Main Street', lotNumber: 1, seed: 7 };
}
