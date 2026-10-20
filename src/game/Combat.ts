import * as THREE from 'three';
import { GADGETS, WEAPONS, type GadgetDef, type WeaponDef } from '../data/config';
import { damp, dampAngle, DEG, rand, wrapAngle } from '../core/math';
import type { AssetRegistry } from '../assets/AssetRegistry';
import type { FrameInput } from '../input/Input';
import type { GameCtx } from './types';
import type { Enemy } from './Enemies';
import type { Hazard } from './Hazards';
import type { Loadout } from './Loadout';
import { audio } from '../core/Audio';

type Target = { kind: 'enemy'; enemy: Enemy } | { kind: 'barrel'; barrel: Hazard };

interface Missile {
  obj: THREE.Object3D;
  active: boolean;
  vel: THREE.Vector3;
  target: Target | null;
  life: number;
  trailT: number;
}

interface Mine {
  obj: THREE.Object3D;
  beacon: THREE.Object3D | null;
  active: boolean;
  dist: number;
  lat: number;
  arm: number;
  life: number;
}

interface Oil {
  obj: THREE.Object3D;
  active: boolean;
  dist: number;
  lat: number;
  life: number;
}

const OIL_LIFE = 10;

/** Auto-aiming roof weapons, homing missiles, rear gadgets and the shared explosion routine. */
export class Combat {
  readonly root = new THREE.Group();
  weapon: WeaponDef = WEAPONS.weapon_tommy;
  gadget: GadgetDef = GADGETS.gadget_mine;
  fireCd = 0;
  gadgetCd = 0;
  target: Target | null = null;
  private muzzleIdx = 0;
  private missiles: Missile[] = [];
  private mines: Mine[] = [];
  private oils: Oil[] = [];
  private turretYaw = 0;
  private turretPitch = 0;
  /** True once the turret has swung onto the current target (hits only land when aligned). */
  private aligned = false;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private aim = new THREE.Vector3();
  kills = 0;

  constructor(scene: THREE.Scene, assets: AssetRegistry) {
    this.root.name = 'combat';
    scene.add(this.root);
    for (let i = 0; i < 8; i++) {
      const obj = assets.instantiate('projectile_missile');
      obj.visible = false;
      this.root.add(obj);
      this.missiles.push({ obj, active: false, vel: new THREE.Vector3(), target: null, life: 0, trailT: 0 });
    }
    for (let i = 0; i < 6; i++) {
      const obj = assets.instantiate('gadget_mine');
      obj.visible = false;
      this.root.add(obj);
      this.mines.push({ obj, beacon: obj.getObjectByName('beacon') ?? null, active: false, dist: 0, lat: 0, arm: 0, life: 0 });
    }
    for (let i = 0; i < 4; i++) {
      const obj = assets.instantiate('gadget_oil');
      obj.visible = false;
      this.root.add(obj);
      this.oils.push({ obj, active: false, dist: 0, lat: 0, life: 0 });
    }
  }

  reset(l: Loadout): void {
    this.weapon = WEAPONS[l.weapon];
    this.gadget = GADGETS[l.gadget];
    this.fireCd = 0;
    this.gadgetCd = 0;
    this.target = null;
    this.turretYaw = 0;
    this.turretPitch = 0;
    this.kills = 0;
    for (const m of this.missiles) {
      m.active = false;
      m.obj.visible = false;
    }
    for (const m of this.mines) {
      m.active = false;
      m.obj.visible = false;
    }
    for (const o of this.oils) {
      o.active = false;
      o.obj.visible = false;
    }
  }

  get gadgetReady(): boolean {
    return this.gadgetCd <= 0;
  }

  private targetPos(t: Target, out: THREE.Vector3): THREE.Vector3 {
    if (t.kind === 'enemy') return out.copy(t.enemy.aimPos);
    return out.copy(t.barrel.pos).setY(0.7);
  }

  private targetValid(t: Target | null): boolean {
    if (!t) return false;
    return t.kind === 'enemy' ? t.enemy.alive : t.barrel.active && t.barrel.broken === 0 && t.barrel.fuse === 0;
  }

  /** Picks the closest enemy (or shootable barrel) inside the weapon's front cone. */
  private acquire(ctx: GameCtx): Target | null {
    const p = ctx.player;
    const yaw = p.yaw;
    const halfCone = (this.weapon.coneDeg / 2) * DEG;
    const range = this.weapon.range;
    let best: Target | null = null;
    let bestScore = Infinity;
    const consider = (pos: THREE.Vector3, t: Target, bias: number, rangeMul: number): void => {
      const dx = pos.x - p.renderPos.x;
      const dz = pos.z - p.renderPos.z;
      const d = Math.hypot(dx, dz);
      if (d > range * rangeMul || d < 1) return;
      const ang = Math.abs(wrapAngle(Math.atan2(-dx, -dz) - yaw));
      // 360° roof turret: the weapon cone is a priority zone; flankers and chasers outside it are
      // still engaged (at slightly reduced range) because that's where pursuers actually sit.
      const inCone = ang <= halfCone;
      if (!inCone && d > range * rangeMul * 0.85) return;
      let score = d + (inCone ? ang * 6 : 12 + ang * 4) + bias;
      if (this.target && this.sameTarget(this.target, t)) score -= 8;
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    };
    for (const e of ctx.enemies.targets()) consider(e.aimPos, { kind: 'enemy', enemy: e }, e.isChopper ? -4 : 0, e.isChopper ? 1.5 : 1);
    for (const b of ctx.hazards.targetableBarrels()) {
      let nearEnemy = false;
      for (const e of ctx.enemies.targets()) if (!e.isChopper && e.worldPos.distanceTo(b.pos) < 10) nearEnemy = true;
      consider(b.pos, { kind: 'barrel', barrel: b }, nearEnemy ? -6 : 10, 1);
    }
    return best;
  }

  private sameTarget(a: Target, b: Target): boolean {
    return a.kind === 'enemy' && b.kind === 'enemy' ? a.enemy === b.enemy : a.kind === 'barrel' && b.kind === 'barrel' ? a.barrel === b.barrel : false;
  }

  private hitTarget(t: Target, dmg: number, ctx: GameCtx): void {
    if (t.kind === 'enemy') ctx.enemies.damage(t.enemy, dmg, ctx);
    else ctx.hazards.shootBarrel(t.barrel, dmg, ctx);
  }

  update(dt: number, input: FrameInput, ctx: GameCtx): void {
    const p = ctx.player;
    this.fireCd -= dt;
    this.gadgetCd = Math.max(0, this.gadgetCd - dt);

    // --- Target acquisition & turret aim ---
    const prev = this.target;
    this.target = p.dead ? null : this.acquire(ctx);
    if (this.target && (!prev || !this.sameTarget(prev, this.target))) audio.lockOn();
    let aimYaw = 0;
    let aimPitch = 0;
    if (this.target && p.turret?.parent) {
      this.targetPos(this.target, this.aim);
      const local = p.turret.parent.worldToLocal(this.tmp.copy(this.aim));
      local.sub(p.turret.position);
      aimYaw = Math.atan2(-local.x, -local.z);
      aimPitch = Math.atan2(local.y, Math.hypot(local.x, local.z));
    }
    this.turretYaw = dampAngle(this.turretYaw, aimYaw, 16, dt);
    this.aligned = this.target !== null && Math.abs(wrapAngle(this.turretYaw - aimYaw)) < 0.45;
    this.turretPitch = damp(this.turretPitch, Math.max(-0.2, Math.min(0.6, aimPitch)), 10, dt);
    if (p.turret) {
      p.turret.rotation.set(0, 0, 0);
      p.turret.rotateY(this.turretYaw);
      p.turret.rotateX(this.turretPitch);
    }
    ctx.fx.setReticle(this.target ? this.targetPos(this.target, this.aim) : null, ctx.camera, this.target?.kind === 'enemy' && this.target.enemy.isChopper ? 2.2 : 1.0);

    // --- Firing ---
    const wantFire = input.shoot || (input.autoFire && this.target !== null && this.aligned);
    if (wantFire && !p.dead && this.fireCd <= 0) {
      this.fireCd = this.weapon.interval;
      if (this.weapon.kind === 'hitscan') this.fireHitscan(ctx);
      else this.fireMissile(ctx);
    }

    // --- Gadget drop ---
    if (input.gadgetPressed && !p.dead && this.gadgetCd <= 0) {
      this.gadgetCd = this.gadget.cooldown;
      this.dropGadget(ctx);
    }

    this.updateMissiles(dt, ctx);
    this.updateMines(dt, ctx);
    this.updateOils(dt, ctx);
  }

  private fireHitscan(ctx: GameCtx): void {
    const p = ctx.player;
    const muzzle = p.muzzleWorld(this.muzzleIdx++, this.tmp);
    let end: THREE.Vector3;
    if (this.target && this.targetValid(this.target) && this.aligned) {
      end = this.targetPos(this.target, this.tmp2).add(new THREE.Vector3(rand(-0.3, 0.3), rand(-0.2, 0.3), rand(-0.3, 0.3)));
      this.hitTarget(this.target, this.weapon.damage, ctx);
      ctx.fx.sparkBurst(end, null, 3, 0xffd060, 6, 1, 0.35, 0.2);
    } else {
      const dir = this.tmp2.set(0, 0, -1);
      if (p.turret) p.turret.getWorldDirection(dir).multiplyScalar(-1);
      else dir.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
      end = dir.multiplyScalar(this.weapon.range).add(muzzle);
    }
    const dir = end.clone().sub(muzzle).normalize();
    ctx.fx.muzzleFlash(muzzle, dir, 1.0);
    ctx.fx.tracer(muzzle, end, 0xffd36b, 0.07);
    audio.gun();
  }

  private fireMissile(ctx: GameCtx): void {
    const p = ctx.player;
    const m = this.missiles.find((x) => !x.active);
    if (!m) return;
    const muzzle = p.muzzleWorld(0, this.tmp);
    m.active = true;
    m.obj.visible = true;
    m.obj.position.copy(muzzle);
    m.life = 2.6;
    m.trailT = 0;
    m.target = this.target;
    const dir = this.tmp2.set(-Math.sin(p.yaw), 0.12, -Math.cos(p.yaw));
    if (p.turret) p.turret.getWorldDirection(dir).multiplyScalar(-1).add(new THREE.Vector3(0, 0.15, 0)).normalize();
    m.vel.copy(dir).multiplyScalar(30).add(new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw)).multiplyScalar(Math.max(0, p.vF)));
    ctx.fx.muzzleFlash(muzzle, dir, 1.6);
    for (let i = 0; i < 5; i++) ctx.fx.puff(muzzle, new THREE.Vector3(rand(-2, 2), rand(0, 2), rand(-2, 2)).addScaledVector(dir, -4), 0.5, 0.6);
    audio.rocket();
  }

  private updateMissiles(dt: number, ctx: GameCtx): void {
    for (const m of this.missiles) {
      if (!m.active) continue;
      m.life -= dt;
      if (m.target && this.targetValid(m.target)) {
        const want = this.targetPos(m.target, this.tmp).sub(m.obj.position);
        const speed = Math.max(45, m.vel.length() + 40 * dt);
        want.normalize().multiplyScalar(speed);
        m.vel.lerp(want, Math.min(1, dt * 5));
        m.vel.setLength(speed);
      } else {
        m.vel.y -= 2 * dt;
      }
      m.obj.position.addScaledVector(m.vel, dt);
      m.obj.lookAt(this.tmp.copy(m.obj.position).add(m.vel));
      m.obj.rotateY(Math.PI);
      m.trailT -= dt;
      if (m.trailT <= 0) {
        m.trailT = 0.025;
        ctx.fx.puff(m.obj.position, new THREE.Vector3(rand(-0.5, 0.5), rand(0, 0.8), rand(-0.5, 0.5)), 0.35, 0.6);
        ctx.fx.flame(m.obj.position, m.vel.clone().multiplyScalar(-0.1), 0.25, 0.12);
      }
      let hit = m.obj.position.y < 0.15 || m.life <= 0;
      if (!hit && m.target && this.targetValid(m.target)) {
        hit = this.targetPos(m.target, this.tmp).distanceTo(m.obj.position) < 2.0;
      }
      if (!hit) {
        for (const e of ctx.enemies.targets()) {
          if (e.aimPos.distanceTo(m.obj.position) < 1.8) {
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        m.active = false;
        m.obj.visible = false;
        this.explode(m.obj.position, this.weapon.aoe, this.weapon.damage, 0, 0, true);
        audio.explosion(false);
      }
    }
  }

  private dropGadget(ctx: GameCtx): void {
    const p = ctx.player;
    audio.drop();
    const dist = p.dist - p.halfLength - 1.2;
    const lat = p.lat;
    const pos = this.tmp;
    ctx.track.sample(dist, lat, pos);
    if (this.gadget.id === 'gadget_mine') {
      const m = this.mines.find((x) => !x.active) ?? this.mines.reduce((a, b) => (a.life < b.life ? a : b));
      m.active = true;
      m.dist = dist;
      m.lat = lat;
      m.arm = 0.5;
      m.life = 40;
      m.obj.visible = true;
      m.obj.position.set(pos.x, 0, pos.z);
      ctx.fx.sparkBurst(m.obj.position, null, 6, 0xff4040, 4, 1, 0.3, 0.3);
    } else {
      const o = this.oils.find((x) => !x.active) ?? this.oils.reduce((a, b) => (a.life < b.life ? a : b));
      o.active = true;
      o.dist = dist - 1.5;
      o.lat = lat;
      o.life = OIL_LIFE;
      o.obj.visible = true;
      const h = ctx.track.sample(o.dist, o.lat, pos);
      o.obj.position.set(pos.x, 0, pos.z);
      o.obj.rotation.set(0, h + rand(-0.4, 0.4), 0);
      o.obj.scale.setScalar(0.2);
      for (let i = 0; i < 6; i++) ctx.fx.puff(pos, new THREE.Vector3(rand(-2, 2), rand(0.5, 1.5), rand(-2, 2)), 0.3, 0.4, 0x111111);
    }
  }

  private updateMines(dt: number, ctx: GameCtx): void {
    const t = performance.now() * 0.001;
    for (const m of this.mines) {
      if (!m.active) continue;
      m.life -= dt;
      m.arm -= dt;
      if (m.beacon) m.beacon.visible = Math.sin(t * (m.arm > 0 ? 6 : 18)) > 0;
      if (m.life <= 0 || m.dist < ctx.player.dist - 160) {
        m.active = false;
        m.obj.visible = false;
        continue;
      }
      if (m.arm > 0) continue;
      for (const e of ctx.enemies.list) {
        if (!e.alive) continue;
        if (Math.abs(e.dist - m.dist) < e.def.halfL + 1.0 && Math.abs(e.lat - m.lat) < e.def.halfW + 1.2) {
          m.active = false;
          m.obj.visible = false;
          this.tmp.copy(m.obj.position).setY(0.5);
          this.explode(this.tmp, 6, 100, 0, 0, true);
          audio.explosion(true);
          break;
        }
      }
    }
  }

  private updateOils(dt: number, ctx: GameCtx): void {
    for (const o of this.oils) {
      if (!o.active) continue;
      o.life -= dt;
      const age = OIL_LIFE - o.life;
      const s = age < 0.3 ? 0.2 + (age / 0.3) * 0.8 : o.life < 1 ? Math.max(0.01, o.life) : 1;
      o.obj.scale.setScalar(s);
      if (o.life <= 0 || o.dist < ctx.player.dist - 160) {
        o.active = false;
        o.obj.visible = false;
        continue;
      }
      for (const e of ctx.enemies.list) {
        if (!e.alive || e.spin > 0) continue;
        if (Math.abs(e.dist - o.dist) < 3.2 && Math.abs(e.lat - o.lat) < 2.8 * s + e.def.halfW) {
          ctx.enemies.spinOut(e, ctx);
          ctx.fx.puff(e.worldPos, new THREE.Vector3(0, 2, 0), 0.6, 0.8);
        }
      }
    }
  }

  /**
   * Shared explosion: damages enemies (falloff), chain-ignites barrels, optionally hurts the player.
   */
  explode(pos: THREE.Vector3, radius: number, enemyDamage: number, playerDamage: number, playerRadius: number, chain: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.fx.explosion(pos, Math.max(0.8, radius / 6));
    ctx.shake(Math.min(0.9, radius * 0.06 + 0.15));
    for (const e of ctx.enemies.list) {
      if (!e.alive) continue;
      const d = e.worldPos.distanceTo(pos);
      if (d < radius) {
        ctx.enemies.damage(e, enemyDamage * (1 - (d / radius) * 0.5), ctx);
        e.knock += Math.sign(e.lat - ctx.player.lat || 1) * 8;
      }
    }
    const c = ctx.enemies.chopper;
    if (c.alive && c.aimPos.distanceTo(pos) < radius + 2) ctx.enemies.damage(c, enemyDamage, ctx);
    if (chain) ctx.hazards.chainBarrels(pos, radius);
    ctx.ambient.blast(pos, radius);
    if (playerDamage > 0 && !ctx.player.dead) {
      const dx = ctx.player.renderPos.x - pos.x;
      const dz = ctx.player.renderPos.z - pos.z;
      if (Math.hypot(dx, dz) < playerRadius && ctx.player.renderPos.y < 4) {
        ctx.damagePlayer(playerDamage, 0.7);
        ctx.player.addImpulse(new THREE.Vector3(dx, 0, dz).normalize().multiplyScalar(6).setY(5));
      }
    }
  }

  /** Context is bound once per run so explode() can be called from hazards/enemies. */
  ctx: GameCtx | null = null;
}
