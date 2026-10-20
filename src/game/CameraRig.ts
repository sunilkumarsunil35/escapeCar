import * as THREE from 'three';
import { clamp, damp, dampAngle, rand } from '../core/math';
import type { PlayerCar } from './PlayerCar';

/**
 * Third-person chase cam matched to the concept art: ~4.8 m high, ~9.5 m behind, 62° FOV, looking
 * slightly ahead of the car. It follows the velocity heading so drifts show the car's flank.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private yaw = 0;
  private shakeAmt = 0;
  private lookTarget = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private orbit = 0;
  /** Optional clamp that keeps the camera inside the street corridor (never inside buildings). */
  constrain: ((pos: THREE.Vector3) => void) | null = null;
  height = 4.8;
  distance = 9.5;
  baseFov = 62;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, 16 / 9, 0.3, 1200);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    // Portrait / narrow screens get a wider FOV so the road stays readable.
    this.baseFov = w / h < 1.2 ? 75 : 62;
    this.camera.updateProjectionMatrix();
  }

  reset(car: PlayerCar): void {
    this.yaw = car.yaw;
    this.orbit = 0;
    this.shakeAmt = 0;
    this.place(car, 1, 1 / 60, true);
  }

  shake(amount: number): void {
    this.shakeAmt = Math.min(1.2, this.shakeAmt + amount);
  }

  update(car: PlayerCar, dt: number, wreck: boolean): void {
    this.place(car, 0, dt, false, wreck);
  }

  private place(car: PlayerCar, _alpha: number, dt: number, snap: boolean, wreck = false): void {
    const p = car.renderPos;
    let targetYaw = car.yaw;
    const speed = car.speed;
    if (speed > 4 && car.vF > 0) {
      const vx = -Math.sin(car.yaw) * car.vF + Math.cos(car.yaw) * car.vL;
      const vz = -Math.cos(car.yaw) * car.vF - Math.sin(car.yaw) * car.vL;
      const velYaw = Math.atan2(-vx, -vz);
      targetYaw = velYaw + (car.drift.active ? car.drift.dir * -0.12 : 0);
    }
    if (wreck) {
      this.orbit += dt * 0.6;
      targetYaw = car.yaw + this.orbit;
    }
    this.yaw = snap ? targetYaw : dampAngle(this.yaw, targetYaw, wreck ? 2 : 4.5, dt);
    const boostPull = car.boosting ? 1.4 : 0;
    const dist = (wreck ? 11 : this.distance) + boostPull;
    const h = wreck ? 5.5 : this.height + clamp(car.renderPos.y - 0.72, 0, 4) * 0.3;
    this.desired.set(p.x + Math.sin(this.yaw) * dist, p.y + h, p.z + Math.cos(this.yaw) * dist);
    this.constrain?.(this.desired);
    if (snap) this.camera.position.copy(this.desired);
    else {
      const k = 1 - Math.exp(-(wreck ? 3 : 9) * dt);
      this.camera.position.lerp(this.desired, k);
      this.camera.position.y = damp(this.camera.position.y, this.desired.y, 6, dt);
    }
    const ahead = wreck ? 0 : 7;
    this.lookTarget.set(p.x - Math.sin(this.yaw) * ahead, p.y + 0.9, p.z - Math.cos(this.yaw) * ahead);
    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt * 0.35;
      this.camera.position.add(new THREE.Vector3(rand(-s, s), rand(-s, s), rand(-s, s)));
      this.shakeAmt = damp(this.shakeAmt, 0, 6, dt);
    }
    this.camera.lookAt(this.lookTarget);
    const fov = this.baseFov + clamp((speed - 26) * 0.45, 0, 12) + (car.boosting ? 4 : 0);
    this.camera.fov = snap ? fov : damp(this.camera.fov, fov, 4, dt);
    this.camera.updateProjectionMatrix();
  }
}
