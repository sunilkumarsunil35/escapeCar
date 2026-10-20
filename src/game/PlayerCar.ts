import * as THREE from 'three';
import { RAPIER, type PhysicsWorld } from '../core/Physics';
import { PLAYER_TUNING as T } from '../data/config';
import { clamp, damp, rand, wrapAngle } from '../core/math';
import { wheelParts, type AssetRegistry } from '../assets/AssetRegistry';
import { buildLoadoutModel, computeStats, type CarStats, type Loadout } from './Loadout';
import type { FrameInput } from '../input/Input';
import type { Effects } from './Effects';
import { audio } from '../core/Audio';

interface WheelRef {
  socket: THREE.Object3D;
  steer: THREE.Object3D;
  spin: THREE.Object3D;
  radius: number;
  front: boolean;
  rear: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);
const SPARK_BLUE = 0x3fd8ff;
const SPARK_ORANGE = 0xff8a1f;

/**
 * Arcade getaway car on a Rapier dynamic body: 4-ray suspension (ramps!), auto-gas, Mario-Kart
 * hop + drift with Blue (1.5s) / Orange (3.0s) turbo tiers, nitro, and wall collisions via physics.
 */
export class PlayerCar {
  readonly root = new THREE.Group();
  model: THREE.Group = new THREE.Group();
  body!: RAPIER.RigidBody;
  collider!: RAPIER.Collider;
  stats!: CarStats;
  loadout!: Loadout;
  hp = 100;
  yaw = 0;
  steer = 0;
  vF = 0;
  vL = 0;
  vy = 0;
  grounded = true;
  airTime = 0;
  private wasGrounded = true;
  private onRamp = false;
  private halfExt = new THREE.Vector3(1, 0.4, 2.1);
  private rideHeight = T.rideHeight;
  drift = { active: false, pending: false, pendingT: 0, dir: 0, charge: 0, tier: 0 };
  boost = { time: 0, speed: 0, tier: 0 };
  nitro = 0;
  magnet = 0;
  reversing = false;
  braking = false;
  scraping = false;
  private prevDrift = false;
  private visualDriftYaw = 0;
  private pitch = 0;
  private roll = 0;
  private hopVisual = 0;
  private wheels: WheelRef[] = [];
  turret: THREE.Object3D | null = null;
  muzzles: THREE.Object3D[] = [];
  exhaust: THREE.Object3D | null = null;
  private prevPos = new THREE.Vector3();
  readonly pos = new THREE.Vector3();
  readonly renderPos = new THREE.Vector3();
  private impulse = new THREE.Vector3();
  rampHandles = new Set<number>();
  dist = 0;
  lat = 0;
  trackHeading = 0;
  wall = 12;
  dead = false;
  private fxTimer = 0;
  private skidTimer = 0;
  onSparkTier: ((tier: number) => void) | null = null;
  onBoost: ((tier: number) => void) | null = null;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  constructor(private physics: PhysicsWorld, private assets: AssetRegistry) {
    this.root.name = 'player';
  }

  get speed(): number {
    return Math.hypot(this.vF, this.vL);
  }

  get ramming(): boolean {
    return this.nitro > 0 || (this.boost.time > 0 && this.boost.tier >= 2);
  }

  get boosting(): boolean {
    return this.boost.time > 0 || this.nitro > 0;
  }

  get fwd(): THREE.Vector3 {
    return this.tmp2.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** (Re)spawns the car with a loadout at the origin. */
  spawn(loadout: Loadout): void {
    this.loadout = loadout;
    this.stats = computeStats(loadout);
    this.hp = this.stats.maxHp;
    this.root.remove(this.model);
    this.model = buildLoadoutModel(this.assets, loadout);
    this.root.add(this.model);
    this.collectSockets();

    const col = (this.model.userData.collider as [number, number, number] | null) ?? [2, 0.8, 4.2];
    this.halfExt.set(col[0] / 2, col[1] / 2, col[2] / 2);
    this.rideHeight = T.rideHeight;
    if (this.body) this.physics.world.removeRigidBody(this.body);
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, this.rideHeight, 0)
      .enabledRotations(false, false, false)
      .setLinearDamping(0)
      .setCcdEnabled(true)
      .setCanSleep(false);
    this.body = this.physics.world.createRigidBody(desc);
    const r = 0.15;
    const yOff = 0.3 + this.halfExt.y - this.rideHeight;
    this.collider = this.physics.world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(this.halfExt.x - r, this.halfExt.y - r, this.halfExt.z - r, r)
        .setTranslation(0, yOff, 0)
        .setDensity(120)
        .setFriction(0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitution(0.15),
      this.body,
    );
    this.yaw = 0;
    this.steer = 0;
    this.vF = 0;
    this.vL = 0;
    this.vy = 0;
    this.drift = { active: false, pending: false, pendingT: 0, dir: 0, charge: 0, tier: 0 };
    this.boost = { time: 0, speed: 0, tier: 0 };
    this.nitro = 0;
    this.magnet = 0;
    this.dead = false;
    this.grounded = true;
    this.wasGrounded = true;
    this.airTime = 0;
    this.visualDriftYaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.pos.set(0, this.rideHeight, 0);
    this.prevPos.copy(this.pos);
    this.renderPos.copy(this.pos);
    this.impulse.set(0, 0, 0);
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.root.visible = true;
  }

  private collectSockets(): void {
    this.wheels = [];
    for (const name of ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR']) {
      const s = this.model.getObjectByName(name);
      if (!s) continue;
      const front = name === 'wheel_FL' || name === 'wheel_FR';
      this.wheels.push({ socket: s, ...wheelParts(s), front, rear: !front });
    }
    const weapon = this.model.getObjectByName('equipped_weapon');
    this.turret = weapon?.getObjectByName('turret') ?? weapon ?? null;
    this.muzzles = [];
    for (const n of ['muzzle_L', 'muzzle_R', 'muzzle_center']) {
      const m = weapon?.getObjectByName(n);
      if (m) this.muzzles.push(m);
    }
    this.exhaust = this.model.getObjectByName('exhaust') ?? null;
  }

  addImpulse(v: THREE.Vector3): void {
    this.impulse.add(v);
  }

  triggerBoost(tier: number): void {
    const cfg = tier >= 2 ? T.orangeBoost : T.blueBoost;
    this.boost.tier = tier;
    this.boost.speed = cfg.speed * this.stats.burstMult;
    this.boost.time = cfg.time;
    audio.boost(tier);
    this.onBoost?.(tier);
  }

  takeDamage(amount: number): number {
    if (this.dead) return 0;
    const dmg = amount * this.stats.damageTaken;
    this.hp = Math.max(0, this.hp - dmg);
    return dmg;
  }

  heal(fraction: number): void {
    this.hp = Math.min(this.stats.maxHp, this.hp + this.stats.maxHp * fraction);
  }

  /** Raycast suspension: returns highest ground height under the four wheels. */
  private probeGround(bx: number, by: number, bz: number): { h: number; hit: boolean; ramp: boolean; front: number; rear: number; left: number; right: number } {
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const hx = this.halfExt.x * 0.8;
    const hz = this.halfExt.z * 0.7;
    let best = -Infinity;
    let ramp = false;
    let front = 0;
    let rear = 0;
    let left = 0;
    let right = 0;
    let hits = 0;
    const maxLen = this.rideHeight + 0.3 + 0.9;
    const corners: [number, number][] = [[-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz]];
    for (let i = 0; i < 4; i++) {
      const [lx, lz] = corners[i];
      const wx = bx + lx * c + lz * s;
      const wz = bz - lx * s + lz * c;
      this.ray.origin = { x: wx, y: by + 0.3, z: wz };
      const hit = this.physics.world.castRay(this.ray, maxLen, true, undefined, undefined, this.collider);
      let gh = -10;
      if (hit) {
        gh = by + 0.3 - hit.timeOfImpact;
        hits++;
        if (this.rampHandles.has(hit.collider.handle)) ramp = true;
      }
      best = Math.max(best, gh);
      if (lz < 0) front += gh / 2;
      else rear += gh / 2;
      if (lx < 0) left += gh / 2;
      else right += gh / 2;
    }
    return { h: best, hit: hits > 0, ramp, front, rear, left, right };
  }

  fixedUpdate(dt: number, input: FrameInput): void {
    if (this.dead) {
      const lv = this.body.linvel();
      this.body.setLinvel({ x: lv.x * 0.97, y: lv.y, z: lv.z * 0.97 }, true);
      return;
    }
    const t = this.body.translation();
    this.prevPos.copy(this.pos);
    const lv = this.body.linvel();
    let vx = lv.x + this.impulse.x;
    let vz = lv.z + this.impulse.z;
    let vy = lv.y + this.impulse.y;
    this.impulse.set(0, 0, 0);

    // --- Suspension ---
    const g = this.probeGround(t.x, t.y, t.z);
    const compress = g.h + this.rideHeight - t.y;
    this.grounded = g.hit && compress > -0.18;
    if (this.grounded) {
      vy += (T.springK * compress - T.springC * vy - T.gravity) * dt;
      if (compress > 0.5) vy = Math.max(vy, compress * 8);
    }
    const leftRamp = this.onRamp && !g.ramp && !this.grounded;
    if (leftRamp && vy > 1) vy += T.rampLaunchBonus;
    this.onRamp = g.ramp && this.grounded;
    this.pitch = damp(this.pitch, this.grounded ? Math.atan2(g.front - g.rear, this.halfExt.z * 1.4) : clamp(vy * 0.03, -0.35, 0.3), 10, dt);

    // --- Inputs ---
    this.steer = input.steer;
    this.reversing = input.reverse && this.speed < 14;
    const driftHeld = input.drift && !this.reversing;
    if (driftHeld && !this.prevDrift && this.grounded && this.vF > 8) {
      vy = T.hopVelocity;
      this.drift.pending = true;
      this.drift.pendingT = 0;
      this.hopVisual = 1;
      audio.hop();
    }
    if (this.drift.pending) {
      this.drift.pendingT += dt;
      if (!driftHeld || this.drift.pendingT > 0.6) this.drift.pending = false;
      else if (Math.abs(this.steer) > 0.2) {
        this.drift.pending = false;
        this.drift.active = true;
        this.drift.dir = Math.sign(this.steer);
        this.drift.charge = 0;
        this.drift.tier = 0;
      }
    }
    if (this.drift.active && (!driftHeld || this.vF < 8)) {
      if (!driftHeld && this.drift.tier > 0) this.triggerBoost(this.drift.tier);
      this.drift.active = false;
      this.drift.tier = 0;
      this.drift.charge = 0;
    }
    if (this.drift.active && this.grounded) {
      this.drift.charge += dt * this.stats.chargeMult;
      const tier = this.drift.charge >= T.tier2Time ? 2 : this.drift.charge >= T.tier1Time ? 1 : 0;
      if (tier !== this.drift.tier) {
        this.drift.tier = tier;
        audio.sparkTier(tier);
        this.onSparkTier?.(tier);
      }
    }
    this.braking = driftHeld && !this.drift.active && !this.drift.pending && Math.abs(this.steer) < 0.2 && this.grounded;
    this.prevDrift = driftHeld;

    // --- Yaw ---
    const fwdSpeed = vx * -Math.sin(this.yaw) + vz * -Math.cos(this.yaw);
    let yawRate: number;
    if (this.drift.active) {
      // Mario-Kart style: steering into the drift tightens the arc, counter-steer holds a near-straight slide.
      const tight = clamp(this.steer * this.drift.dir, -1, 1);
      yawRate = -this.drift.dir * (0.35 + 0.75 * tight) * (this.stats.slicks ? 1.12 : 1);
    } else {
      const sf = Math.max(0.35, clamp(Math.abs(fwdSpeed) / 8, 0, 1)) * (1 - 0.3 * clamp((Math.abs(fwdSpeed) - 25) / 20, 0, 1));
      yawRate = -this.steer * T.turnRate * sf * Math.sign(fwdSpeed || 1);
    }
    if (!this.grounded) yawRate *= 0.35;
    this.yaw += yawRate * dt;
    const rel = wrapAngle(this.yaw - this.trackHeading);
    if (this.grounded && !this.reversing) {
      // Hands-off lane assist: gently realign with the road when the player isn't steering.
      if (!this.drift.active && Math.abs(this.steer) < 0.08) this.yaw -= rel * (1 - Math.exp(-1.6 * dt));
      // Arcade wall glance: if pressed against a wall and pointing into it, swing the nose back along the road.
      const edge = Math.abs(this.lat) > this.wall - this.lateralExtent() - 0.6;
      const intoWall = (this.lat > 0 && rel < 0) || (this.lat < 0 && rel > 0);
      if (edge && intoWall) this.yaw -= rel * (1 - Math.exp(-7 * dt));
    }

    // --- Longitudinal / lateral ---
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    let vF = vx * fx + vz * fz;
    let vL = vx * rx + vz * rz;
    this.boost.time = Math.max(0, this.boost.time - dt);
    this.nitro = Math.max(0, this.nitro - dt);
    this.magnet = Math.max(0, this.magnet - dt);
    const base = this.stats.maxSpeed;
    let target: number;
    if (this.reversing) target = -10;
    else if (this.braking) target = base * 0.45;
    else target = base + (this.boost.time > 0 ? this.boost.speed : 0) + (this.nitro > 0 ? base * 0.5 : 0);
    if (this.scraping && !this.stats.runFlat) target *= 0.8;
    if (this.grounded) {
      if (vF < target) vF = Math.min(target, vF + (this.boosting ? T.boostAccel : T.accel) * dt);
      else vF = Math.max(target, vF - (this.braking || this.reversing ? T.brakeDecel : 9) * dt);
    }
    const grip = !this.grounded ? T.airGrip : this.drift.active ? (this.stats.slicks ? T.driftGripSlicks : T.driftGrip) : T.grip;
    vL *= Math.exp(-grip * dt);
    vx = fx * vF + rx * vL;
    vz = fz * vF + rz * vL;
    this.vF = vF;
    this.vL = vL;
    this.vy = vy;
    this.body.setLinvel({ x: vx, y: vy, z: vz }, true);
    const q = new THREE.Quaternion().setFromAxisAngle(UP, this.yaw);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);

    // Landing
    if (this.grounded && !this.wasGrounded) {
      if (this.airTime > 0.45) this.triggerBoost(2);
      if (this.airTime > 0.25) this.hopVisual = -0.6;
    }
    this.airTime = this.grounded ? 0 : this.airTime + dt;
    this.wasGrounded = this.grounded;
  }

  /** Called after world.step(): caches the new physics position. */
  postStep(): void {
    const t = this.body.translation();
    this.pos.set(t.x, t.y, t.z);
    if (t.y < -20) {
      this.body.setTranslation({ x: t.x, y: this.rideHeight + 2, z: t.z }, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  teleportTo(x: number, z: number, yaw: number): void {
    this.body.setTranslation({ x, y: this.rideHeight + 0.5, z }, true);
    this.yaw = yaw;
    this.pos.set(x, this.rideHeight + 0.5, z);
    this.prevPos.copy(this.pos);
  }

  updateVisual(alpha: number, dt: number, fx: Effects): void {
    this.renderPos.lerpVectors(this.prevPos, this.pos, alpha);
    this.root.position.set(this.renderPos.x, this.renderPos.y - this.rideHeight, this.renderPos.z);
    const targetDriftYaw = this.drift.active ? this.drift.dir * 0.42 : 0;
    this.visualDriftYaw = damp(this.visualDriftYaw, targetDriftYaw, 7, dt);
    const lean = clamp(-this.vL * 0.012 - this.steer * (this.grounded ? 0.05 : 0), -0.14, 0.14) + (this.drift.active ? -this.drift.dir * 0.05 : 0);
    this.roll = damp(this.roll, lean, 8, dt);
    this.hopVisual = damp(this.hopVisual, 0, 6, dt);
    this.model.position.y = Math.max(0, this.hopVisual) * 0.08;
    this.root.rotation.set(0, 0, 0);
    this.root.rotateY(this.yaw + this.visualDriftYaw);
    this.root.rotateX(-this.pitch);
    this.root.rotateZ(this.roll);

    for (const w of this.wheels) {
      w.spin.rotation.x -= (this.vF / Math.max(0.2, w.radius)) * dt;
      if (w.front) {
        const steerAngle = this.drift.active ? -this.drift.dir * 0.28 + this.steer * 0.12 : -this.steer * 0.42;
        w.steer.rotation.y = damp(w.steer.rotation.y, steerAngle, 14, dt);
      }
    }
    if (this.dead) return;

    // --- Drift / boost effects ---
    this.fxTimer -= dt;
    this.skidTimer -= dt;
    const rearWheels = this.wheels.filter((w) => w.rear);
    if (this.drift.active && this.grounded) {
      const side = this.tmp.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(-this.drift.dir);
      for (const w of rearWheels) {
        w.socket.getWorldPosition(this.tmp2);
        this.tmp2.y = 0.12;
        if (this.drift.tier >= 1) {
          const color = this.drift.tier >= 2 ? SPARK_ORANGE : SPARK_BLUE;
          const back = new THREE.Vector3(Math.sin(this.yaw), 0.35, Math.cos(this.yaw)).add(side.clone().multiplyScalar(0.6));
          fx.sparkBurst(this.tmp2, back, this.drift.tier >= 2 ? 3 : 2, color, 9, 0.6, this.drift.tier >= 2 ? 0.75 : 0.6, 0.3);
        } else if (Math.random() < 0.4) {
          fx.sparkBurst(this.tmp2, new THREE.Vector3(Math.sin(this.yaw), 0.4, Math.cos(this.yaw)), 1, 0xfff1a8, 6, 0.6, 0.35, 0.2);
        }
        if (this.fxTimer <= 0) {
          fx.puff(this.tmp2, new THREE.Vector3(Math.sin(this.yaw) * 3 + rand(-1, 1), rand(0.5, 1.5), Math.cos(this.yaw) * 3 + rand(-1, 1)), rand(0.35, 0.6), rand(0.5, 0.9));
        }
        if (this.skidTimer <= 0) fx.skid(this.tmp2, this.yaw + this.visualDriftYaw);
      }
      if (this.fxTimer <= 0) this.fxTimer = 0.05;
      if (this.skidTimer <= 0) this.skidTimer = 0.03;
    }
    if (this.boosting && this.exhaust) {
      this.exhaust.getWorldPosition(this.tmp2);
      const back = new THREE.Vector3(Math.sin(this.yaw), 0.1, Math.cos(this.yaw)).multiplyScalar(6);
      if (this.boost.tier >= 2 || this.nitro > 0) fx.flame(this.tmp2, back, rand(0.35, 0.55), 0.25);
      else if (Math.random() < 0.6) fx.flame(this.tmp2, back, rand(0.2, 0.32), 0.18);
      if (Math.random() < 0.3) fx.puff(this.tmp2, back.multiplyScalar(0.5), 0.3, 0.6);
    } else if (this.exhaust && Math.random() < dt * 6) {
      this.exhaust.getWorldPosition(this.tmp2);
      fx.puff(this.tmp2, new THREE.Vector3(Math.sin(this.yaw) * 2, 0.6, Math.cos(this.yaw) * 2), 0.18, 0.5, 0xdddddd);
    }
    if (this.scraping && Math.random() < 0.7) {
      const side = Math.sign(this.lat);
      this.tmp2.set(Math.cos(this.yaw) * side * this.halfExt.x, 0.5, -Math.sin(this.yaw) * side * this.halfExt.x).add(this.renderPos);
      fx.sparkBurst(this.tmp2, new THREE.Vector3(Math.sin(this.yaw), 0.5, Math.cos(this.yaw)), 2, 0xffc040, 10, 0.5, 0.45, 0.3);
    }
  }

  /** Muzzle world-space helper for combat. */
  muzzleWorld(i: number, out: THREE.Vector3): THREE.Vector3 {
    const m = this.muzzles[i % Math.max(1, this.muzzles.length)];
    if (m) return m.getWorldPosition(out);
    return out.copy(this.renderPos).add(new THREE.Vector3(0, 1.4, 0));
  }

  /** Half-width of the car's footprint across the road, accounting for its angle to the track. */
  lateralExtent(): number {
    const rel = wrapAngle(this.yaw - this.trackHeading);
    return this.halfExt.x * Math.abs(Math.cos(rel)) + this.halfExt.z * Math.abs(Math.sin(rel));
  }

  get halfWidth(): number {
    return this.halfExt.x;
  }

  get halfLength(): number {
    return this.halfExt.z;
  }

  destroy(): void {
    if (this.body) this.physics.world.removeRigidBody(this.body);
  }
}
