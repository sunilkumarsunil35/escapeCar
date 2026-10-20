import type * as THREE from 'three';
import type { PlayerCar } from './PlayerCar';
import type { Track } from './Track';
import type { Effects } from './Effects';
import type { EnemyManager, Enemy } from './Enemies';
import type { HazardManager } from './Hazards';
import type { Combat } from './Combat';
import type { HeatDef, PowerupId } from '../data/config';

/** Shared runtime context passed to every gameplay system each frame. */
export interface GameCtx {
  player: PlayerCar;
  track: Track;
  fx: Effects;
  enemies: EnemyManager;
  hazards: HazardManager;
  combat: Combat;
  camera: THREE.PerspectiveCamera;
  heat: HeatDef;
  time: number;
  damagePlayer(amount: number, shake?: number): void;
  onEnemyKilled(e: Enemy): void;
  collectCash(value: number): void;
  applyPowerup(id: PowerupId): void;
  nearMiss(): void;
  shake(amount: number): void;
  toast(text: string, cls?: string): void;
}
