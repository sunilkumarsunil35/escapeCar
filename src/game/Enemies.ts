import * as THREE from 'three';
import { ENEMIES, type EnemyDef, type EnemyKind } from '../data/config';
import { approach, clamp, damp, rand, wrapAngle } from '../core/math';
import { wheelParts, type AssetRegistry } from '../assets/AssetRegistry';
import { audio } from '../core/Audio';
import type { GameCtx } from './types';
import type { TargetRing } from './Effects';

const SEP = 0.6;

export class Enemy {
  active = false;
  hp = 0;
  dist = 0;
  lat = 0;
  speed = 0;
  latVel = 0;
  knock = 0;
  spin = 0;
  spinAngle = 0;
  side = 1;
  seed = Math.random() * 100;
  fireT = 0;
  burstOn = false;
  shotT = 0;
  hitCd = 0;
  pop = 0;
  alt = 0;
  dying = 0;
  heading = 0;
  readonly worldPos = new THREE.Vector3();
  readonly aimPos = new THREE.Vector3();
  readonly def: EnemyDef;
  wheels: { spin: THREE.Object3D; radius: number }[] = [];
  gunArm: THREE.Object3D | null = null;
  muzzle: THREE.Object3D | null = null;
  rotorMain: THREE.Object3D | null = null;
  rotorTail: THREE.Object3D | null = null;
  spotlight: THREE.Object3D | null = null;

  constructor(readonly kind: EnemyKind, readonly obj: THREE.Group) {
    this.def = ENEMIES[kind];
    obj.visible = false;
    for (const n of ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR', 'wheel_F', 'wheel_R']) {
      const s = obj.getObjectByName(n);
      if (s) {
        const p = wheelParts(s);
        this.wheels.push({ spin: p.spin, radius: p.radius });
      }
    }
    this.gunArm = obj.getObjectByName('gun_arm') ?? null;
    this.muzzle = obj.getObjectByName('muzzle') ?? null;
    this.rotorMain = obj.getObjectByName('rotor_main') ?? null;
    this.rotorTail = obj.getObjectByName('rotor_tail') ?? null;
    this.spotlight = obj.getObjectByName('spotlight') ?? null;
  }

  get isChopper(): boolean {
    return this.kind === 'enemy_chopper';
  }

  get alive(): boolean {
    return this.active && this.dying <= 0 && this.hp > 0;
  }
}

interface Strike {
  active: boolean;
  dist: number;
  lat: number;
  t: number;
  ring: TargetRing;
  missile: THREE.Object3D;
  fired: boolean;
  pos: THREE.Vector3;
}

const STRIKE_WINDUP = 2.0;

/** Pooled chasers: Hitman Bikes, Tommy Sedans and the Mafia Chopper boss with laser-ring missile strikes. */
export class EnemyManager {
  readonly root = new THREE.Group();
  readonly list: Enemy[] = [];
  chopper: Enemy;
  private strikes: Strike[] = [];
  private strikeTimer = 3;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(scene: THREE.Scene, assets: AssetRegistry, rings: TargetRing[]) {
    this.root.name = 'enemies';
    scene.add(this.root);
    const make = (kind: EnemyKind): Enemy => {
      const e = new Enemy(kind, assets.instantiate(kind));
      e.obj.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      this.root.add(e.obj);
      return e;
    };
    for (let i = 0; i < 6; i++) this.list.push(make('enemy_bike'));
    for (let i = 0; i < 4; i++) this.list.push(make('enemy_sedan'));
    this.chopper = make('enemy_chopper');
    for (const ring of rings) {
      const missile = assets.instantiate('projectile_missile');
      missile.visible = false;
      this.root.add(missile);
      this.strikes.push({ active: false, dist: 0, lat: 0, t: 0, ring, missile, fired: false, pos: new THREE.Vector3() });
    }
  }

  reset(): void {
    for (const e of [...this.list, this.chopper]) {
      e.active = false;
      e.obj.visible = false;
    }
    for (const s of this.strikes) {
      s.active = false;
      s.missile.visible = false;
    }
    this.strikeTimer = 3;
  }

  get activeCount(): number {
    let n = 0;
    for (const e of this.list) if (e.active) n++;
    return n;
  }

  /** All targetable live enemies (including chopper). */
  *targets(): Generator<Enemy> {
    for (const e of this.list) if (e.alive) yield e;
    if (this.chopper.alive) yield this.chopper;
  }

  spawn(kind: EnemyKind, ctx: GameCtx): boolean {
    const e = this.list.find((x) => !x.active && x.kind === kind);
    if (!e) return false;
    const p = ctx.player;
    const fromAhead = kind === 'enemy_bike' && Math.random() < 0.2;
    let dist = fromAhead ? p.dist + rand(60, 80) : p.dist - rand(38, 58);
    dist = clamp(dist, ctx.track.backDist + 5, ctx.track.frontDist - 10);
    e.active = true;
    e.hp = e.def.hp;
    e.dist = dist;
    const wall = ctx.track.wallAt(dist);
    e.lat = clamp(p.lat + rand(-8, 8), -wall + 2, wall - 2);
    e.speed = fromAhead ? p.vF * 0.6 : p.vF + 6;
    e.latVel = 0;
    e.knock = 0;
    e.spin = 0;
    e.spinAngle = 0;
    e.side = Math.random() < 0.5 ? -1 : 1;
    e.fireT = rand(0.5, 2);
    e.burstOn = false;
    e.dying = 0;
    e.pop = 0;
    e.hitCd = 0;
    e.obj.visible = true;
    e.obj.scale.setScalar(1);
    e.obj.rotation.set(0, 0, 0);
    return true;
  }

  spawnChopper(ctx: GameCtx): void {
    const c = this.chopper;
    if (c.active) return;
    c.active = true;
    c.hp = c.def.hp;
    c.dist = ctx.player.dist + 90;
    c.lat = 0;
    c.alt = 40;
    c.dying = 0;
    c.obj.visible = true;
    c.obj.rotation.set(0, 0, 0);
    this.strikeTimer = 4;
    ctx.toast('⚠ MAFIA CHOPPER INBOUND ⚠', 'danger');
    audio.warning();
  }

  damage(e: Enemy, amount: number, ctx: GameCtx): void {
    if (!e.alive) return;
    e.hp -= amount;
    e.pop = 1;
    if (e.hp <= 0) this.kill(e, ctx);
  }

  kill(e: Enemy, ctx: GameCtx): void {
    if (e.dying > 0 || !e.active) return;
    e.hp = 0;
    if (e.isChopper) {
      e.dying = 1.6;
      audio.explosion(true);
      ctx.fx.explosion(e.worldPos, 1.4, 0x2b302d);
      for (const s of this.strikes) {
        if (s.active) {
          s.active = false;
          ctx.fx.hideRing(s.ring);
          s.missile.visible = false;
        }
      }
    } else {
      e.dying = 0.01;
      audio.explosion(e.kind === 'enemy_sedan');
      this.tmp.copy(e.worldPos).y += 0.8;
      ctx.fx.explosion(this.tmp, e.kind === 'enemy_sedan' ? 1.2 : 0.8, e.kind === 'enemy_bike' ? 0x7a1f2b : 0x1b1c21);
      ctx.shake(e.kind === 'enemy_sedan' ? 0.5 : 0.3);
    }
    ctx.onEnemyKilled(e);
  }

  spinOut(e: Enemy, ctx: GameCtx): void {
    if (!e.alive || e.spin > 0) return;
    if (e.kind === 'enemy_bike') {
      e.knock = Math.sign(e.lat || 1) * 10;
      this.kill(e, ctx);
      return;
    }
    e.spin = 2.5;
    this.damage(e, 30, ctx);
  }

  update(dt: number, ctx: GameCtx): void {
    const p = ctx.player;
    const track = ctx.track;
    const pAng = wrapAngle(p.yaw - p.trackHeading);
    const pLatSpeed = -Math.sin(pAng) * p.vF + Math.cos(pAng) * p.vL;

    for (const e of this.list) {
      if (!e.active) continue;
      if (e.dying > 0) {
        e.dying -= dt;
        e.active = false;
        e.obj.visible = false;
        continue;
      }
      // Despawn when hopelessly far
      if (e.dist < p.dist - 140 || e.dist < track.backDist + 1 || e.dist > track.frontDist - 2) {
        e.active = false;
        e.obj.visible = false;
        continue;
      }
      const wall = track.wallAt(e.dist) - 1.0;
      e.hitCd = Math.max(0, e.hitCd - dt);
      e.knock = damp(e.knock, 0, 3, dt);
      if (e.spin > 0) {
        e.spin -= dt;
        e.speed = damp(e.speed, 0, 1.5, dt);
        e.spinAngle += dt * 9 * Math.min(1, e.spin);
        e.latVel = damp(e.latVel, 0, 2, dt);
      } else {
        e.spinAngle = damp(e.spinAngle, Math.round(e.spinAngle / (Math.PI * 2)) * Math.PI * 2, 4, dt);
        const isBike = e.kind === 'enemy_bike';
        // Bikes ride beside the doors; sedans alternate between tailing and surging up alongside / ahead.
        const offset = isBike ? -0.4 + Math.sin(ctx.time * 0.7 + e.seed) * 1.6 : -3 + Math.sin(ctx.time * 0.35 + e.seed) * 9;
        let targetLat = p.lat + e.side * (isBike ? 3.0 : 4.6);
        if (Math.abs(targetLat) > wall - 0.5) {
          e.side *= -1;
          targetLat = p.lat + e.side * (isBike ? 3.0 : 4.6);
        }
        targetLat = clamp(targetLat, -wall + 0.8, wall - 0.8);
        const avoid = ctx.hazards.avoidLat(e.dist, e.lat, 16);
        if (avoid !== null) targetLat = avoid;
        const err = p.dist + offset - e.dist;
        const rubber = err > 25 ? 1.45 : err > 8 ? 1.15 : 1;
        const desired = clamp(p.vF + clamp(err * 1.3, -12, 20), 0, e.def.speed * rubber);
        e.speed = approach(e.speed, desired, 18 * dt);
        e.latVel = approach(e.latVel, clamp((targetLat - e.lat) * 2.4, -7, 7), 22 * dt);
      }
      // Separation between chasers
      for (const o of this.list) {
        if (o === e || !o.active) continue;
        const dd = o.dist - e.dist;
        const dl = o.lat - e.lat;
        if (Math.abs(dd) < o.def.halfL + e.def.halfL + SEP && Math.abs(dl) < o.def.halfW + e.def.halfW + SEP) {
          e.lat -= Math.sign(dl || 1) * dt * 4;
        }
      }
      e.dist += e.speed * dt;
      e.lat += (e.latVel + e.knock) * dt;
      if (Math.abs(e.lat) > wall) {
        if (Math.abs(e.knock) > 7) {
          if (e.kind === 'enemy_bike') this.kill(e, ctx);
          else this.damage(e, 25, ctx);
          e.knock = 0;
        }
        e.lat = clamp(e.lat, -wall, wall);
      }
      if (!e.active) continue;

      // Player contact (side-rams / rear-ends)
      const dd = e.dist - p.dist;
      const dl = e.lat - p.lat;
      const overlapL = e.def.halfL + p.halfLength * 0.92 - Math.abs(dd);
      const overlapW = e.def.halfW + p.halfWidth - Math.abs(dl);
      if (overlapL > 0 && overlapW > 0 && p.renderPos.y < 2.4 && !p.dead) {
        const pushDir = Math.sign(dl || e.side);
        if (overlapW < overlapL) e.lat = p.lat + pushDir * (e.def.halfW + p.halfWidth + 0.05);
        else if (dd > 0) e.dist = p.dist + e.def.halfL + p.halfLength * 0.92 + 0.05;
        else e.dist = p.dist - e.def.halfL - p.halfLength * 0.92 - 0.05;
        if (e.hitCd <= 0) {
          e.hitCd = 0.35;
          const rel = Math.abs(pLatSpeed - e.latVel);
          this.tmp.copy(e.worldPos).add(p.renderPos).multiplyScalar(0.5).setY(0.8);
          ctx.fx.sparkBurst(this.tmp, null, 10, 0xffc040, 9, 1, 0.5, 0.3);
          audio.hit();
          if (p.ramming) {
            e.knock = pushDir * 16;
            this.damage(e, e.kind === 'enemy_bike' ? 999 : 60, ctx);
            ctx.shake(0.25);
          } else {
            e.knock = pushDir * (6 + rel * 1.1);
            this.damage(e, (8 + rel * 3) * p.stats.ramMult, ctx);
            ctx.damagePlayer(e.kind === 'enemy_bike' ? 3 : 6, 0.2);
            const right = this.tmp2.set(Math.cos(p.trackHeading), 0, -Math.sin(p.trackHeading));
            p.addImpulse(right.multiplyScalar(-pushDir * (e.kind === 'enemy_bike' ? 1.5 : 3.5)));
          }
          if (dd > 0 && Math.abs(dl) < e.def.halfW + p.halfWidth - 0.4) e.speed += 6;
        }
      }
      if (!e.alive) continue;

      // Weapons
      this.updateFiring(e, dt, ctx, dd, dl);

      // Visual transform
      e.heading = track.sample(e.dist, e.lat, e.worldPos);
      e.worldPos.y = 0;
      const steerYaw = -Math.atan2(e.latVel + e.knock * 0.4, Math.max(6, e.speed));
      e.obj.position.copy(e.worldPos);
      e.obj.rotation.set(0, e.heading + steerYaw + e.spinAngle, 0);
      if (e.kind === 'enemy_bike') {
        e.obj.rotateZ(clamp(-e.latVel * 0.06, -0.4, 0.4));
        if (e.gunArm) {
          const toRight = p.lat > e.lat ? 1 : -1;
          e.gunArm.scale.x = toRight;
          e.gunArm.position.x = 0.2 * toRight;
          e.gunArm.rotation.z = e.burstOn ? 0 : -0.9 * toRight;
        }
      }
      e.pop = damp(e.pop, 0, 12, dt);
      e.obj.scale.setScalar(1 + e.pop * 0.08);
      for (const w of e.wheels) w.spin.rotation.x -= (e.speed / w.radius) * dt;
      e.aimPos.copy(e.worldPos).y += e.kind === 'enemy_bike' ? 1.2 : 0.9;
    }

    this.updateChopper(dt, ctx);
    this.updateStrikes(dt, ctx);
  }

  private updateFiring(e: Enemy, dt: number, ctx: GameCtx, dd: number, dl: number): void {
    const p = ctx.player;
    if (p.dead || e.spin > 0) {
      e.burstOn = false;
      return;
    }
    const inRange = e.kind === 'enemy_bike'
      ? Math.abs(dd) < 7 && Math.abs(dl) < e.def.range
      : Math.abs(dd) < e.def.range && Math.abs(dl) < 14;
    e.fireT -= dt;
    if (e.fireT <= 0) {
      e.burstOn = !e.burstOn && inRange;
      e.fireT = e.burstOn ? (e.kind === 'enemy_bike' ? 0.8 : 1.2) : e.kind === 'enemy_bike' ? rand(0.7, 1.3) : rand(1.4, 2.4);
    }
    if (!e.burstOn || !inRange) return;
    ctx.damagePlayer(e.def.dps * dt, 0);
    e.shotT -= dt;
    if (e.shotT <= 0) {
      e.shotT = e.kind === 'enemy_bike' ? 0.16 : 0.09;
      const from = this.tmp;
      if (e.muzzle) e.muzzle.getWorldPosition(from);
      else from.copy(e.worldPos).add(this.tmp2.set(Math.cos(e.heading) * Math.sign(-dl || 1) * 1.0, 1.25, -Math.sin(e.heading) * Math.sign(-dl || 1) * 1.0));
      const to = this.tmp2.copy(p.renderPos).add(new THREE.Vector3(rand(-0.8, 0.8), rand(0.2, 0.9), rand(-1.2, 1.2)));
      const dir = to.clone().sub(from).normalize();
      ctx.fx.muzzleFlash(from, dir, e.kind === 'enemy_bike' ? 0.6 : 0.8);
      ctx.fx.tracer(from, to, 0xffa040, 0.05);
      if (Math.random() < 0.35) ctx.fx.sparkBurst(to, null, 2, 0xffd060, 5, 1, 0.3, 0.2);
      audio.enemyGun();
    }
  }

  private updateChopper(dt: number, ctx: GameCtx): void {
    const c = this.chopper;
    if (!c.active) return;
    const p = ctx.player;
    if (c.dying > 0) {
      c.dying -= dt;
      c.alt = Math.max(0.5, c.alt - dt * 9);
      c.dist += p.vF * 0.5 * dt;
      c.obj.rotation.y += dt * 6;
      c.obj.rotation.z = Math.sin(ctx.time * 8) * 0.3;
      c.heading = ctx.track.sample(c.dist, c.lat, c.worldPos);
      c.worldPos.y = c.alt;
      c.obj.position.copy(c.worldPos);
      if (Math.random() < 0.6) ctx.fx.flame(c.worldPos, new THREE.Vector3(rand(-2, 2), 3, rand(-2, 2)), 1.2, 0.5);
      if (c.dying <= 0 || c.alt <= 0.6) {
        ctx.fx.explosion(c.worldPos, 2.2, 0x2b302d);
        audio.explosion(true);
        ctx.shake(0.8);
        c.active = false;
        c.obj.visible = false;
      }
      return;
    }
    const targetDist = p.dist + 24 + Math.sin(ctx.time * 0.3) * 7;
    c.dist = damp(c.dist, targetDist, 0.9, dt);
    c.dist = Math.min(c.dist, ctx.track.frontDist - 5);
    c.lat = Math.sin(ctx.time * 0.45) * 6;
    c.alt = damp(c.alt, 13 + Math.sin(ctx.time * 1.1) * 0.7, 0.8, dt);
    c.heading = ctx.track.sample(c.dist, c.lat, c.worldPos);
    c.worldPos.y = c.alt;
    c.obj.position.copy(c.worldPos);
    const toPlayer = Math.atan2(-(p.renderPos.x - c.worldPos.x), -(p.renderPos.z - c.worldPos.z));
    c.obj.rotation.set(0, toPlayer, 0);
    c.obj.rotateX(-0.12);
    c.obj.rotateZ(Math.sin(ctx.time * 0.45 + 1) * 0.12);
    if (c.rotorMain) c.rotorMain.rotation.y += dt * 28;
    if (c.rotorTail) c.rotorTail.rotation.x += dt * 40;
    c.pop = damp(c.pop, 0, 12, dt);
    c.obj.scale.setScalar(1 + c.pop * 0.05);
    c.aimPos.copy(c.worldPos).y += 1.2;
    // Strike scheduling
    this.strikeTimer -= dt;
    if (this.strikeTimer <= 0 && c.alt < 20 && !p.dead) {
      const s = this.strikes.find((x) => !x.active);
      if (s) {
        const ang = wrapAngle(p.yaw - p.trackHeading);
        const latSpeed = -Math.sin(ang) * p.vF + Math.cos(ang) * p.vL;
        s.active = true;
        s.t = 0;
        s.fired = false;
        s.dist = p.dist + Math.max(10, p.vF * STRIKE_WINDUP * 0.95);
        const wall = ctx.track.wallAt(s.dist) - 2;
        s.lat = clamp(p.lat + latSpeed * 1.2, -wall, wall);
        audio.lockOn();
        this.strikeTimer = rand(2.6, 4.2) * (c.hp < c.def.hp * 0.5 ? 0.75 : 1);
      }
    }
  }

  private updateStrikes(dt: number, ctx: GameCtx): void {
    const c = this.chopper;
    for (const s of this.strikes) {
      if (!s.active) continue;
      s.t += dt;
      ctx.track.sample(s.dist, s.lat, s.pos);
      s.pos.y = 0;
      const from = c.spotlight && c.alive ? c.spotlight.getWorldPosition(this.tmp) : null;
      ctx.fx.showRing(s.ring, s.pos, Math.min(1, s.t / STRIKE_WINDUP), from && s.t < STRIKE_WINDUP - 0.2 ? from : null);
      if (!s.fired && s.t > STRIKE_WINDUP - 0.3) {
        s.fired = true;
        s.missile.visible = true;
        if (from) s.missile.position.copy(from);
        else s.missile.position.copy(s.pos).y += 15;
        audio.rocket();
      }
      if (s.fired && s.missile.visible) {
        const k = Math.min(1, (s.t - (STRIKE_WINDUP - 0.3)) / 0.3);
        const start = this.tmp2.copy(s.missile.position);
        s.missile.position.lerpVectors(start, s.pos, k);
        this.tmp.copy(s.pos).sub(start);
        if (this.tmp.lengthSq() > 0.01) s.missile.lookAt(this.tmp.add(s.missile.position));
        ctx.fx.puff(s.missile.position, new THREE.Vector3(0, 1, 0), 0.4, 0.5);
      }
      if (s.t >= STRIKE_WINDUP) {
        s.active = false;
        s.missile.visible = false;
        ctx.fx.hideRing(s.ring);
        ctx.combat.explode(s.pos, 4.5, 80, 35, 4.5, false);
      }
    }
  }
}
