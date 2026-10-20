import type { CarId, GadgetId, UpgradeCategory, WeaponId } from '../data/config';

export interface LeaderEntry {
  name: string;
  time: number;
  score: number;
  date: number;
}

export interface SaveData {
  version: 1;
  cash: number;
  bestTime: number;
  bestScore: number;
  ownedCars: CarId[];
  car: CarId;
  upgrades: Record<UpgradeCategory, number>;
  ownedWeapons: WeaponId[];
  weapon: WeaponId;
  ownedGadgets: GadgetId[];
  gadget: GadgetId;
  playerName: string;
  leaderboard: LeaderEntry[];
  totalRuns: number;
  muted: boolean;
}

const KEY = 'escapecar_save_v1';

export function defaultSave(): SaveData {
  return {
    version: 1,
    cash: 0,
    bestTime: 0,
    bestScore: 0,
    ownedCars: ['car_sedan'],
    car: 'car_sedan',
    upgrades: { engine: 0, tires: 0, armor: 0 },
    ownedWeapons: ['weapon_tommy'],
    weapon: 'weapon_tommy',
    ownedGadgets: ['gadget_mine'],
    gadget: 'gadget_mine',
    playerName: 'YOU',
    leaderboard: [],
    totalRuns: 0,
    muted: false,
  };
}

/** localStorage-backed persistence for cash, unlocks, upgrades and local best times. */
export class SaveStore {
  data: SaveData;

  constructor() {
    this.data = this.read();
  }

  private read(): SaveData {
    const base = defaultSave();
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return base;
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      return {
        ...base,
        ...parsed,
        upgrades: { ...base.upgrades, ...(parsed.upgrades ?? {}) },
        ownedCars: parsed.ownedCars?.length ? parsed.ownedCars : base.ownedCars,
        ownedWeapons: parsed.ownedWeapons?.length ? parsed.ownedWeapons : base.ownedWeapons,
        ownedGadgets: parsed.ownedGadgets?.length ? parsed.ownedGadgets : base.ownedGadgets,
        leaderboard: Array.isArray(parsed.leaderboard) ? parsed.leaderboard : [],
      };
    } catch {
      return base;
    }
  }

  save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch (err) {
      console.warn('[save] localStorage unavailable', err);
    }
  }

  spend(amount: number): boolean {
    if (this.data.cash < amount) return false;
    this.data.cash -= amount;
    this.save();
    return true;
  }

  addLocalScore(entry: LeaderEntry): void {
    this.data.leaderboard.push(entry);
    this.data.leaderboard.sort((a, b) => b.time - a.time);
    this.data.leaderboard = this.data.leaderboard.slice(0, 20);
    this.save();
  }

  reset(): void {
    this.data = defaultSave();
    this.save();
  }
}
