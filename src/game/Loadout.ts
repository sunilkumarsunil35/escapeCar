import * as THREE from 'three';
import type { AssetRegistry } from '../assets/AssetRegistry';
import {
  ARMOR_HP_MULT, CARS, ENGINE_CHARGE_MULT, ENGINE_SPEED_MULT, TIRE_BURST_MULT, type CarId, type GadgetId, type WeaponId,
} from '../data/config';
import type { SaveData } from '../core/Save';

export interface Loadout {
  car: CarId;
  weapon: WeaponId;
  gadget: GadgetId;
  engine: number;
  tires: number;
  armor: number;
}

export function loadoutFromSave(d: SaveData): Loadout {
  return { car: d.car, weapon: d.weapon, gadget: d.gadget, engine: d.upgrades.engine, tires: d.upgrades.tires, armor: d.upgrades.armor };
}

export interface CarStats {
  maxSpeed: number;
  maxHp: number;
  chargeMult: number;
  burstMult: number;
  ramMult: number;
  damageTaken: number;
  dozer: boolean;
  runFlat: boolean;
  slicks: boolean;
}

export function computeStats(l: Loadout): CarStats {
  const car = CARS[l.car];
  return {
    maxSpeed: car.baseSpeed * ENGINE_SPEED_MULT[l.engine],
    maxHp: Math.round(car.hp * ARMOR_HP_MULT[l.armor]),
    chargeMult: car.chargeRate * ENGINE_CHARGE_MULT[l.engine],
    burstMult: car.driftBoost * TIRE_BURST_MULT[l.tires],
    ramMult: car.ramMult,
    damageTaken: l.car === 'car_truck' ? 0.85 : 1,
    dozer: l.armor >= 2,
    runFlat: l.tires >= 2,
    slicks: l.tires >= 1,
  };
}

/** Builds the full player car (body + roof weapon on socket_roof_weapon + dozer on socket_front_armor). */
export function buildLoadoutModel(assets: AssetRegistry, l: Loadout): THREE.Group {
  const car = assets.instantiate(l.car, { wheelStyle: l.tires >= 2 ? 'armored' : undefined });
  const roof = car.getObjectByName('socket_roof_weapon');
  if (roof) {
    const weapon = assets.instantiate(l.weapon);
    weapon.name = 'equipped_weapon';
    roof.add(weapon);
  }
  if (l.armor >= 2) {
    const front = car.getObjectByName('socket_front_armor');
    if (front) {
      const dozer = assets.instantiate('upgrade_dozer');
      dozer.name = 'equipped_armor';
      front.add(dozer);
    }
  }
  return car;
}
