import RAPIER from '@dimforge/rapier3d-compat';
import { PLAYER_TUNING } from '../data/config';

let ready: Promise<void> | null = null;

/** Boots the Rapier WASM module once. */
export function initPhysics(): Promise<void> {
  if (!ready) ready = RAPIER.init();
  return ready;
}

export const FIXED_DT = 1 / 60;

/** Thin wrapper over the Rapier world: fixed 60 Hz step + a ground slab that follows the player. */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  private ground: RAPIER.RigidBody;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: PLAYER_TUNING.gravity, z: 0 });
    this.world.timestep = FIXED_DT;
    this.ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -1, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(400, 1, 400).setFriction(0.2), this.ground);
  }

  followGround(x: number, z: number): void {
    this.ground.setNextKinematicTranslation({ x, y: -1, z });
  }

  step(): void {
    this.world.step();
  }
}

export { RAPIER };
