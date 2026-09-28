import type { ChargeType, Direction, Loadout, PlacedCharge } from '../core/types';
import { CHARGES, CHARGE_ORDER } from '../data/charges';
import type { Building } from '../structure/building';

export type PlaceResult = { ok: true; charge: PlacedCharge } | { ok: false; reason: string };

/**
 * Tracks the demolition plan for one job: the finite inventory and where
 * each charge sits. Placements are free to change until the job is armed.
 */
export class Plan {
  readonly building: Building;
  readonly loadout: Loadout;
  readonly charges: PlacedCharge[] = [];
  locked = false;
  private nextId = 1;

  constructor(building: Building, loadout: Loadout) {
    this.building = building;
    this.loadout = { ...loadout };
  }

  available(type: ChargeType): number {
    return this.loadout[type] ?? 0;
  }

  used(type: ChargeType): number {
    return this.charges.filter((c) => c.type === type).length;
  }

  remaining(type: ChargeType): number {
    return this.available(type) - this.used(type);
  }

  totalAvailable(): number {
    return CHARGE_ORDER.reduce((acc, t) => acc + this.available(t), 0);
  }

  totalUsed(): number {
    return this.charges.length;
  }

  chargesOn(memberId: string): PlacedCharge[] {
    return this.charges.filter((c) => c.memberId === memberId);
  }

  place(type: ChargeType, memberId: string, direction?: Direction): PlaceResult {
    if (this.locked) return { ok: false, reason: 'Placements are locked. Demo Day is armed.' };
    if (!this.building.members.has(memberId)) return { ok: false, reason: 'Unknown component.' };
    if (this.remaining(type) <= 0) return { ok: false, reason: `No ${CHARGES[type].name.toLowerCase()}s left.` };
    const member = this.building.members.get(memberId);
    if (member?.protect) return { ok: false, reason: 'Protected structure. Charges cannot be placed here.' };
    const charge: PlacedCharge = { id: `ch${this.nextId++}`, type, memberId };
    if (CHARGES[type].directional) charge.direction = direction ?? 'left';
    this.charges.push(charge);
    return { ok: true, charge };
  }

  remove(chargeId: string): boolean {
    if (this.locked) return false;
    const index = this.charges.findIndex((c) => c.id === chargeId);
    if (index < 0) return false;
    this.charges.splice(index, 1);
    return true;
  }

  removeLastOn(memberId: string): boolean {
    for (let i = this.charges.length - 1; i >= 0; i--) {
      if (this.charges[i]?.memberId === memberId) return this.remove(this.charges[i]?.id as string);
    }
    return false;
  }

  setDirection(chargeId: string, direction: Direction): boolean {
    if (this.locked) return false;
    const c = this.charges.find((x) => x.id === chargeId);
    if (!c || !CHARGES[c.type].directional) return false;
    c.direction = direction;
    return true;
  }

  clear(): void {
    if (this.locked) return;
    this.charges.length = 0;
  }

  lock(): void {
    this.locked = true;
  }

  unlock(): void {
    this.locked = false;
  }
}
