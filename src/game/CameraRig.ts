import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../core/math';
import type { PlayerCar } from './PlayerCar';

/**
 * Third-person chase cam matched to the concept art: ~4.8 m high, ~9.5 m behind, 62° FOV, looking
 * slightly ahead of the car. It follows the velocity heading so drifts show the car's flank.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private yaw = 0;
  private trauma = 0;
  private shakeT = 0;
  private follow = new THREE.Vector3();
  /** Accessibility: 1 = full, 0.4 = reduced, 0 = off. */
  shakeScale = 1;
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
    this.trauma = 0;
    this.place(car, 1 / 60, 1 / 60, true);
  }

  /** Adds screen-shake trauma (0..1). Hits add up; the shake decays on its own. */
  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount * 0.7);
  }

  update(car: PlayerCar, dt: number, wreck: boolean, realDt = dt): void {
    this.place(car, dt, realDt, false, wreck);
  }

  private place(car: PlayerCar, dt: number, realDt: number, snap: boolean, wreck = false): void {
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
    // Smooth follow lives in its own state so shake never feeds back into it.
    if (snap) this.follow.copy(this.desired);
    else {
      const k = 1 - Math.exp(-(wreck ? 3 : 9) * dt);
      this.follow.lerp(this.desired, k);
      this.follow.y = damp(this.follow.y, this.desired.y, 6, dt);
    }
    const ahead = wreck ? 0 : 7;
    this.lookTarget.set(p.x - Math.sin(this.yaw) * ahead, p.y + 0.9, p.z - Math.cos(this.yaw) * ahead);
    this.camera.position.copy(this.follow);
    this.camera.lookAt(this.lookTarget);
    // Trauma shake (game-feel): intensity = trauma², smooth layered sines, decays on wall-clock time.
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - 1.3 * realDt);
      const s = this.trauma * this.trauma * this.shakeScale;
      this.shakeT += realDt * 28;
      const n = (a: number, b: number): number => Math.sin(this.shakeT * a) * 0.6 + Math.sin(this.shakeT * b + 1.3) * 0.4;
      this.camera.translateX(0.9 * s * n(1.7, 3.1));
      this.camera.translateY(0.6 * s * n(2.3, 4.1));
      this.camera.rotateZ(0.06 * s * n(1.1, 2.7));
    }
    const fov = this.baseFov + clamp((speed - 26) * 0.45, 0, 12) + (car.boosting ? 4 : 0);
    this.camera.fov = snap ? fov : damp(this.camera.fov, fov, 4, dt);
    this.camera.updateProjectionMatrix();
  }
}
