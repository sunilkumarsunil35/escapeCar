/** Single source of truth for all gameplay tuning (mirrors the MVP design doc tables). */

export type CarId = 'car_sedan' | 'car_tuner' | 'car_truck';
export type WeaponId = 'weapon_tommy' | 'weapon_rocket';
export type GadgetId = 'gadget_mine' | 'gadget_oil';
export type EnemyKind = 'enemy_bike' | 'enemy_sedan' | 'enemy_chopper';
export type PowerupId = 'powerup_wrench' | 'powerup_nitro' | 'powerup_magnet';
export type UpgradeCategory = 'engine' | 'tires' | 'armor';
export type PresetId = 'preset_morning' | 'preset_midday' | 'preset_sunset' | 'preset_night';
export type Biome = 'city' | 'coastal';

export interface CarDef {
  id: CarId;
  name: string;
  cost: number;
  baseSpeed: number;
  hp: number;
  driftBoost: number;
  chargeRate: number;
  ramMult: number;
  trait: string;
  color: number;
}

export const CARS: Record<CarId, CarDef> = {
  car_sedan: {
    id: 'car_sedan', name: 'Classic Sedan', cost: 0, baseSpeed: 30.8, hp: 100, driftBoost: 1.0, chargeRate: 1.0, ramMult: 1,
    trait: 'Balanced handling and acceleration.', color: 0xc8402c,
  },
  car_tuner: {
    id: 'car_tuner', name: 'Street Tuner', cost: 2500, baseSpeed: 37.4, hp: 75, driftBoost: 1.35, chargeRate: 1.35, ramMult: 1,
    trait: 'Charges drift boost 35% faster; low armor.', color: 0x0ea5b7,
  },
  car_truck: {
    id: 'car_truck', name: 'Mafia Truck', cost: 5000, baseSpeed: 26.4, hp: 160, driftBoost: 0.8, chargeRate: 1.0, ramMult: 2,
    trait: 'Deals 2x side-ram damage and shrugs off hits.', color: 0x3f4a3a,
  },
};
export const CAR_ORDER: CarId[] = ['car_sedan', 'car_tuner', 'car_truck'];

export interface WeaponDef {
  id: WeaponId;
  name: string;
  cost: number;
  range: number;
  coneDeg: number;
  interval: number;
  damage: number;
  kind: 'hitscan' | 'missile';
  aoe: number;
  desc: string;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  weapon_tommy: {
    id: 'weapon_tommy', name: 'Twin Tommy Guns', cost: 0, range: 35, coneDeg: 60, interval: 0.1, damage: 12, kind: 'hitscan', aoe: 0,
    desc: '35m / 60° cone · 10 shots/sec · 12 dmg hitscan tracers.',
  },
  weapon_rocket: {
    id: 'weapon_rocket', name: 'Rocket Pod', cost: 1800, range: 50, coneDeg: 45, interval: 2.5, damage: 80, kind: 'missile', aoe: 5,
    desc: '50m / 45° cone · 1 missile / 2.5s · 80 dmg homing AOE.',
  },
};
export const WEAPON_ORDER: WeaponId[] = ['weapon_tommy', 'weapon_rocket'];

export interface GadgetDef {
  id: GadgetId;
  name: string;
  cost: number;
  cooldown: number;
  desc: string;
}

export const GADGETS: Record<GadgetId, GadgetDef> = {
  gadget_mine: { id: 'gadget_mine', name: 'Proximity Mine', cost: 0, cooldown: 6, desc: 'Arms in 0.5s · 100 AOE dmg when a chaser drives over it.' },
  gadget_oil: { id: 'gadget_oil', name: 'Oil Slick', cost: 1000, cooldown: 8, desc: 'Black puddle that zeroes enemy grip and spins them out.' },
};
export const GADGET_ORDER: GadgetId[] = ['gadget_mine', 'gadget_oil'];

export interface UpgradeTier {
  name: string;
  cost: number;
  desc: string;
}

export const UPGRADES: Record<UpgradeCategory, UpgradeTier[]> = {
  engine: [
    { name: 'Stock V6', cost: 0, desc: 'Base speed & turbo recharge.' },
    { name: 'Supercharged V8', cost: 1000, desc: '+15% top speed, louder exhaust.' },
    { name: 'Twin-Turbo V12', cost: 2500, desc: '+25% top speed, charges drift boost 50% faster.' },
  ],
  tires: [
    { name: 'Street Tires', cost: 0, desc: 'Standard road grip.' },
    { name: 'Drift Slicks', cost: 1000, desc: 'Wider slide angle, +25% drift burst speed.' },
    { name: 'Run-Flat Armored Tires', cost: 2500, desc: 'Drift Slicks perks + immune to wall scrape slowdowns.' },
  ],
  armor: [
    { name: 'Stock Chassis', cost: 0, desc: 'Factory sheet metal.' },
    { name: 'Reinforced Chassis', cost: 1000, desc: '+25% Max HP.' },
    { name: 'Front Dozer Blade', cost: 2500, desc: '+25% Max HP and smashes roadblocks without losing speed.' },
  ],
};

export const ENGINE_SPEED_MULT = [1, 1.15, 1.25];
export const ENGINE_CHARGE_MULT = [1, 1, 1.5];
export const TIRE_BURST_MULT = [1, 1.25, 1.25];
export const ARMOR_HP_MULT = [1, 1.25, 1.25];

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  hp: number;
  speed: number;
  cash: number;
  dps: number;
  range: number;
  halfW: number;
  halfL: number;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  enemy_bike: { kind: 'enemy_bike', name: 'Hitman Bike', hp: 30, speed: 33, cash: 50, dps: 5, range: 7, halfW: 0.45, halfL: 1.1 },
  enemy_sedan: { kind: 'enemy_sedan', name: 'Tommy Sedan', hp: 90, speed: 30, cash: 120, dps: 7, range: 30, halfW: 1.0, halfL: 2.1 },
  enemy_chopper: { kind: 'enemy_chopper', name: 'Mafia Chopper', hp: 300, speed: 0, cash: 500, dps: 0, range: 0, halfW: 2.2, halfL: 4.5 },
};

export interface HeatDef {
  level: 1 | 2 | 3 | 4;
  start: number;
  maxEnemies: number;
  kinds: EnemyKind[];
  barrels: boolean;
  ramps: boolean;
  barricades: boolean;
  chopper: boolean;
  preset: PresetId;
  biome: Biome;
}

export const HEAT_LEVELS: HeatDef[] = [
  { level: 1, start: 0, maxEnemies: 3, kinds: ['enemy_bike'], barrels: false, ramps: true, barricades: false, chopper: false, preset: 'preset_morning', biome: 'city' },
  { level: 2, start: 60, maxEnemies: 5, kinds: ['enemy_bike', 'enemy_sedan'], barrels: true, ramps: true, barricades: false, chopper: false, preset: 'preset_midday', biome: 'coastal' },
  { level: 3, start: 150, maxEnemies: 7, kinds: ['enemy_bike', 'enemy_sedan'], barrels: true, ramps: true, barricades: true, chopper: false, preset: 'preset_sunset', biome: 'city' },
  { level: 4, start: 240, maxEnemies: 8, kinds: ['enemy_bike', 'enemy_sedan'], barrels: true, ramps: true, barricades: true, chopper: true, preset: 'preset_night', biome: 'city' },
];

export interface PowerupDef {
  id: PowerupId;
  name: string;
  duration: number;
  color: number;
}

export const POWERUPS: Record<PowerupId, PowerupDef> = {
  powerup_wrench: { id: 'powerup_wrench', name: 'REPAIR +35%', duration: 0, color: 0x22c55e },
  powerup_nitro: { id: 'powerup_nitro', name: 'NITRO!', duration: 4, color: 0x38bdf8 },
  powerup_magnet: { id: 'powerup_magnet', name: 'CASH MAGNET', duration: 10, color: 0xef4444 },
};

export interface LightingPreset {
  sky: number;
  fog: number;
  amb: number;
  ambInt: number;
  sun: number;
  sunInt: number;
  sunPos: [number, number, number];
  hemiSky: number;
  hemiGround: number;
  hemiInt: number;
  fogNear: number;
  fogFar: number;
  bloom: number;
  bloomThreshold: number;
  windowTint: number;
  nightFx: number;
  headlights: number;
  exposure: number;
}

export const LIGHTING_PRESETS: Record<PresetId, LightingPreset> = {
  preset_morning: {
    sky: 0x87ceeb, fog: 0xcfe8f7, amb: 0xffffff, ambInt: 0.9, sun: 0xfffdf2, sunInt: 2.2, sunPos: [30, 50, 20],
    hemiSky: 0xbfe3ff, hemiGround: 0x8a6a55, hemiInt: 0.55, fogNear: 70, fogFar: 520, bloom: 0.22, bloomThreshold: 0.92,
    windowTint: 0x5b6f86, nightFx: 0, headlights: 0, exposure: 1.0,
  },
  preset_midday: {
    sky: 0x38bdf8, fog: 0xbae6fd, amb: 0xffffff, ambInt: 1.1, sun: 0xffffff, sunInt: 2.5, sunPos: [10, 80, 10],
    hemiSky: 0xd6f0ff, hemiGround: 0xc2a27a, hemiInt: 0.5, fogNear: 80, fogFar: 560, bloom: 0.18, bloomThreshold: 0.95,
    windowTint: 0x6b86a3, nightFx: 0, headlights: 0, exposure: 0.95,
  },
  preset_sunset: {
    sky: 0xf97316, fog: 0xfdba74, amb: 0xfed7aa, ambInt: 0.8, sun: 0xffedd5, sunInt: 2.0, sunPos: [-40, 25, -30],
    hemiSky: 0xffc58a, hemiGround: 0x5a2d1e, hemiInt: 0.55, fogNear: 50, fogFar: 430, bloom: 0.35, bloomThreshold: 0.85,
    windowTint: 0xd9a35c, nightFx: 0.45, headlights: 0.5, exposure: 1.0,
  },
  preset_night: {
    sky: 0x0f172a, fog: 0x1e293b, amb: 0x334155, ambInt: 0.5, sun: 0x64748b, sunInt: 0.8, sunPos: [0, 60, 0],
    hemiSky: 0x3b4a7a, hemiGround: 0x0b0f1a, hemiInt: 0.6, fogNear: 40, fogFar: 380, bloom: 0.55, bloomThreshold: 0.72,
    windowTint: 0xc8954a, nightFx: 1, headlights: 1, exposure: 1.05,
  },
};

export const GARAGE_PRESET = { bg: 0x1c1917, amb: 0x44403c, ambInt: 0.6, spot: 0xf59e0b, spotInt: 2.4 };

/** Road layout constants (meters). */
export const ROAD = {
  chunkLength: 50,
  halfWidth: 10,
  lanes: [-7.5, -2.5, 2.5, 7.5],
  cityWall: 12.6,
  coastalWall: 10.9,
  chunkCount: 10,
  chunksBehind: 2,
};

export const PLAYER_TUNING = {
  rideHeight: 0.72,
  gravity: -20,
  springK: 220,
  springC: 18,
  accel: 14,
  boostAccel: 40,
  brakeDecel: 30,
  turnRate: 1.5,
  grip: 10,
  driftGrip: 2.3,
  driftGripSlicks: 1.6,
  airGrip: 0.4,
  hopVelocity: 4.6,
  tier1Time: 1.5,
  tier2Time: 3.0,
  blueBoost: { speed: 8, time: 1.0 },
  orangeBoost: { speed: 14, time: 1.8 },
  rampLaunchBonus: 4.5,
};

export const PICKUP_CASH_VALUE = 25;
export const NEAR_MISS_BONUS = 25;
export const MAGNET_RADIUS = 25;
