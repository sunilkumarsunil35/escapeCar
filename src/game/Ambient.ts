import * as THREE from 'three';
import { wheelParts, type AssetRegistry } from '../assets/AssetRegistry';
import { buildBird, CIVILIAN_COLORS } from '../assets/procedural/ambient';
import { approach, chance, clamp, damp, pick, rand, wrapAngle } from '../core/math';
import { ROAD } from '../data/config';
import { audio } from '../core/Audio';
import type { GameCtx } from './types';

interface Civ {
  obj: THREE.Group;
  wheels: { spin: THREE.Object3D; radius: number }[];
  active: boolean;
  dist: number;
  lat: number;
  lane: number;
  speed: number;
  cruise: number;
  knock: number;
  hitCd: number;
  passed: boolean;
  smashed: number;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  pos: THREE.Vector3;
}

interface Ped {
  obj: THREE.Group;
  legs: THREE.Object3D[];
  arms: THREE.Object3D[];
  active: boolean;
  dist: number;
  lat: number;
  dir: number;
  speed: number;
  phase: number;
  baseY: number;
  panic: number;
  hop: number;
  homeLat: number;
}

interface Bird {
  obj: THREE.Group;
  wings: THREE.Object3D[];
  angle: number;
  radius: number;
  height: number;
  speed: number;
  phase: number;
  flock: number;
}

const CIV_HALF_W = 1.0;
const CIV_HALF_L = 2.1;

/**
 * Makes the city feel inhabited: civilian traffic (near-miss bonuses, rammable), sidewalk & beach
 * pedestrians who leap out of the way, and flocks of pigeons / gulls circling overhead.
 */
export class Ambient {
  readonly root = new THREE.Group();
  private civs: Civ[] = [];
  private peds: Ped[] = [];
  private birds: Bird[] = [];
  private flocks: { center: THREE.Vector3; dist: number; lat: number }[] = [];
  private civT = 1;
  private tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene, assets: AssetRegistry, lowQuality: boolean) {
    this.root.name = 'ambient';
    scene.add(this.root);
    const civCount = lowQuality ? 5 : 8;
    for (let i = 0; i < civCount; i++) {
      const obj = assets.instantiate('traffic_civilian', { color: CIVILIAN_COLORS[i % CIVILIAN_COLORS.length] });
      obj.visible = false;
      const wheels: Civ['wheels'] = [];
      for (const n of ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR']) {
        const s = obj.getObjectByName(n);
        if (s) {
          const p = wheelParts(s);
          wheels.push({ spin: p.spin, radius: p.radius });
        }
      }
      this.root.add(obj);
      this.civs.push({ obj, wheels, active: false, dist: 0, lat: 0, lane: 0, speed: 0, cruise: 0, knock: 0, hitCd: 0, passed: false, smashed: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3(), pos: new THREE.Vector3() });
    }
    const pedCount = lowQuality ? 12 : 22;
    for (let i = 0; i < pedCount; i++) {
      const obj = assets.instantiate('npc_pedestrian', { seed: i * 1.37 + 0.5 });
      obj.visible = false;
      const legs = ['leg_L', 'leg_R'].map((n) => obj.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
      const arms = ['arm_L', 'arm_R'].map((n) => obj.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
      this.root.add(obj);
      this.peds.push({ obj, legs, arms, active: false, dist: 0, lat: 0, dir: 1, speed: 1.4, phase: Math.random() * 6, baseY: 0.16, panic: 0, hop: 0, homeLat: 0 });
    }
    const birdCount = lowQuality ? 8 : 14;
    for (let f = 0; f < 2; f++) this.flocks.push({ center: new THREE.Vector3(), dist: 0, lat: 0 });
    for (let i = 0; i < birdCount; i++) {
      const obj = buildBird(i % 3 === 0 ? 0xf4f4f0 : 0x8c8f96);
      this.root.add(obj);
      const wings = ['wing_L', 'wing_R'].map((n) => obj.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
      this.birds.push({ obj, wings, angle: Math.random() * Math.PI * 2, radius: rand(6, 16), height: rand(16, 32), speed: rand(0.35, 0.7) * (Math.random() < 0.5 ? -1 : 1), phase: Math.random() * 6, flock: i % 2 });
    }
  }

  reset(): void {
    for (const c of this.civs) {
      c.active = false;
      c.obj.visible = false;
    }
    for (const p of this.peds) {
      p.active = false;
      p.obj.visible = false;
    }
    for (const f of this.flocks) f.dist = -9999;
    this.civT = 1;
  }

  /** Explosion knock-on: nearby civilian cars get flipped away. */
  blast(pos: THREE.Vector3, radius: number): void {
    for (const c of this.civs) {
      if (!c.active || c.smashed > 0) continue;
      if (c.pos.distanceTo(pos) < radius) this.smash(c, this.tmp.copy(c.pos).sub(pos).setY(0).normalize().multiplyScalar(8));
    }
  }

  private smash(c: Civ, push: THREE.Vector3): void {
    c.smashed = 1.6;
    c.vel.copy(push).add(new THREE.Vector3(rand(-2, 2), rand(7, 11), rand(-2, 2)));
    c.spin.set(rand(-5, 5), rand(-4, 4), rand(-6, 6));
  }

  private spawnCiv(ctx: GameCtx): void {
    const c = this.civs.find((x) => !x.active);
    if (!c) return;
    const p = ctx.player;
    const dist = p.dist + rand(110, 170);
    if (dist > ctx.track.frontDist - 10) return;
    const lane = pick(ROAD.lanes);
    if (ctx.hazards.avoidLat(dist - 10, lane, 30) !== null) return;
    for (const o of this.civs) if (o.active && Math.abs(o.dist - dist) < 12 && Math.abs(o.lat - lane) < 3) return;
    c.active = true;
    c.dist = dist;
    c.lane = lane;
    c.lat = lane;
    c.cruise = rand(11, 17);
    c.speed = c.cruise;
    c.knock = 0;
    c.hitCd = 0;
    c.passed = false;
    c.smashed = 0;
    c.obj.visible = true;
    c.obj.rotation.set(0, 0, 0);
  }

  private spawnPed(ctx: GameCtx, ped: Ped, ahead: boolean): void {
    const p = ctx.player;
    const dist = ahead ? p.dist + rand(140, 300) : p.dist + rand(10, 300);
    if (dist > ctx.track.frontDist - 5) return;
    const chunk = ctx.track.chunkAt(dist);
    let lat: number;
    let y: number;
    if (chunk.kind === 'highway') {
      if (chance(0.6)) {
        lat = rand(14, 26);
        y = -0.18;
      } else {
        lat = -rand(26.6, 29.4);
        y = 0.15;
      }
    } else {
      lat = (chance(0.5) ? 1 : -1) * rand(11.0, 13.0);
      y = 0.16;
    }
    ped.active = true;
    ped.dist = dist;
    ped.lat = lat;
    ped.homeLat = lat;
    ped.dir = chance(0.5) ? 1 : -1;
    ped.speed = chance(0.22) ? 0 : rand(1.1, 1.7);
    ped.baseY = y;
    ped.panic = 0;
    ped.hop = 0;
    ped.obj.visible = true;
  }

  update(dt: number, ctx: GameCtx): void {
    const p = ctx.player;
    const t = ctx.time;
    // ---------------- Traffic ----------------
    this.civT -= dt;
    const civCap = Math.min(this.civs.length, 4 + ctx.heat.level);
    if (this.civT <= 0) {
      this.civT = rand(1.0, 2.2);
      let n = 0;
      for (const c of this.civs) if (c.active) n++;
      if (n < civCap) this.spawnCiv(ctx);
    }
    const ang = wrapAngle(p.yaw - p.trackHeading);
    const pLatSpeed = -Math.sin(ang) * p.vF + Math.cos(ang) * p.vL;
    for (const c of this.civs) {
      if (!c.active) continue;
      if (c.smashed > 0) {
        c.smashed -= dt;
        c.vel.y -= 22 * dt;
        c.obj.position.addScaledVector(c.vel, dt);
        c.obj.rotation.x += c.spin.x * dt;
        c.obj.rotation.y += c.spin.y * dt;
        c.obj.rotation.z += c.spin.z * dt;
        if (c.obj.position.y < 0) {
          c.obj.position.y = 0;
          c.vel.y = Math.abs(c.vel.y) * 0.3;
          c.vel.x *= 0.6;
          c.vel.z *= 0.6;
        }
        if (Math.random() < 0.3) ctx.fx.puff(c.obj.position, new THREE.Vector3(0, 2, 0), 0.5, 0.8, 0x555555);
        if (c.smashed <= 0) {
          c.active = false;
          c.obj.visible = false;
        }
        continue;
      }
      if (c.dist < p.dist - 60 || c.dist > ctx.track.frontDist - 2) {
        c.active = false;
        c.obj.visible = false;
        continue;
      }
      c.hitCd = Math.max(0, c.hitCd - dt);
      c.knock = damp(c.knock, 0, 2.5, dt);
      // Lane keeping + hazard avoidance + following distance
      const avoid = ctx.hazards.avoidLat(c.dist, c.lat, 22);
      let targetLat = c.lane;
      if (avoid !== null) {
        let best = c.lane;
        let bestD = Infinity;
        for (const l of ROAD.lanes) {
          const d = Math.abs(l - avoid);
          if (d < bestD) {
            bestD = d;
            best = l;
          }
        }
        c.lane = best;
        targetLat = best;
      }
      let want = c.cruise;
      for (const o of this.civs) {
        if (o === c || !o.active || o.smashed > 0) continue;
        const dd = o.dist - c.dist;
        if (dd > 0 && dd < 12 && Math.abs(o.lat - c.lat) < 2.4) want = Math.min(want, o.speed - 1);
      }
      c.speed = approach(c.speed, Math.max(0, want), 8 * dt);
      c.dist += c.speed * dt;
      c.lat = approach(c.lat, targetLat, 3 * dt) + c.knock * dt;
      const wall = ctx.track.wallAt(c.dist) - 1.2;
      c.lat = clamp(c.lat, -wall, wall);

      // Player contact
      const dd = c.dist - p.dist;
      const dl = c.lat - p.lat;
      const overL = CIV_HALF_L + p.halfLength * 0.92 - Math.abs(dd);
      const overW = CIV_HALF_W + p.halfWidth - Math.abs(dl);
      if (overL > 0 && overW > 0 && !p.dead && p.renderPos.y < 2.6) {
        c.passed = true;
        if (c.hitCd <= 0) {
          c.hitCd = 0.5;
          this.tmp.copy(c.pos).add(p.renderPos).multiplyScalar(0.5).setY(0.9);
          ctx.fx.sparkBurst(this.tmp, null, 10, 0xffc040, 9, 1, 0.5, 0.3);
          audio.hit();
          if (p.ramming || p.stats.dozer) {
            this.smash(c, new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw)).multiplyScalar(p.vF * 0.5));
            ctx.shake(0.25);
          } else {
            ctx.damagePlayer(5, 0.3);
            const side = Math.sign(dl || 1);
            c.knock = side * (8 + Math.abs(pLatSpeed) * 0.5);
            c.speed += 6;
            p.vF *= 0.8;
            const lv = p.body.linvel();
            p.body.setLinvel({ x: lv.x * 0.8, y: lv.y, z: lv.z * 0.8 }, true);
          }
        }
      } else if (!c.passed && dd < -CIV_HALF_L - p.halfLength) {
        c.passed = true;
        if (Math.abs(dl) < CIV_HALF_W + p.halfWidth + 1.6 && !p.dead) ctx.nearMiss();
      }
      // Chasers barging through traffic shove it aside
      for (const e of ctx.enemies.list) {
        if (!e.alive) continue;
        if (Math.abs(e.dist - c.dist) < CIV_HALF_L + e.def.halfL && Math.abs(e.lat - c.lat) < CIV_HALF_W + e.def.halfW) {
          c.knock = Math.sign(c.lat - e.lat || 1) * 6;
          e.speed *= 0.85;
        }
      }
      const heading = ctx.track.sample(c.dist, c.lat, c.pos);
      c.pos.y = 0;
      c.obj.position.copy(c.pos);
      c.obj.rotation.set(0, heading - Math.atan2(c.knock * 0.3, Math.max(5, c.speed)), 0);
      for (const w of c.wheels) w.spin.rotation.x -= (c.speed / w.radius) * dt;
    }

    // ---------------- Pedestrians ----------------
    for (const ped of this.peds) {
      if (!ped.active) {
        this.spawnPed(ctx, ped, false);
        continue;
      }
      if (ped.dist < p.dist - 25 || ped.dist > ctx.track.frontDist - 2) {
        ped.active = false;
        ped.obj.visible = false;
        this.spawnPed(ctx, ped, true);
        continue;
      }
      // Leap away from a car mounting the sidewalk
      const ddp = ped.dist - p.dist;
      const dlp = ped.lat - p.lat;
      if (ped.panic <= 0 && Math.abs(ddp) < 9 && ddp > -2 && Math.abs(dlp) < 3.2) {
        ped.panic = 2.2;
        ped.hop = 1;
        ped.homeLat = ped.lat + Math.sign(dlp || ped.lat || 1) * 2.6;
      }
      let moveSpeed = ped.speed;
      if (ped.panic > 0) {
        ped.panic -= dt;
        moveSpeed = 4.5;
        ped.lat = damp(ped.lat, ped.homeLat, 6, dt);
      }
      ped.hop = Math.max(0, ped.hop - dt * 2.2);
      ped.dist += ped.dir * moveSpeed * dt;
      ped.phase += dt * (moveSpeed > 0 ? moveSpeed * 4.2 : 0);
      const heading = ctx.track.sample(ped.dist, ped.lat, this.tmp);
      ped.obj.position.set(this.tmp.x, ped.baseY + Math.sin(ped.hop * Math.PI) * 0.9 + (moveSpeed > 0 ? Math.abs(Math.sin(ped.phase)) * 0.05 : 0), this.tmp.z);
      ped.obj.rotation.y = heading + (ped.dir > 0 ? 0 : Math.PI) + (ped.speed === 0 && ped.panic <= 0 ? Math.sin(t * 0.5 + ped.phase) * 0.6 + Math.PI / 2 * Math.sign(ped.lat) : 0);
      const swing = moveSpeed > 0 ? Math.sin(ped.phase) * (ped.panic > 0 ? 0.9 : 0.55) : 0;
      if (ped.legs[0]) ped.legs[0].rotation.x = swing;
      if (ped.legs[1]) ped.legs[1].rotation.x = -swing;
      if (ped.arms[0]) ped.arms[0].rotation.x = ped.panic > 0 ? -2.6 : -swing * 0.8;
      if (ped.arms[1]) ped.arms[1].rotation.x = ped.panic > 0 ? -2.6 : swing * 0.8;
    }

    // ---------------- Birds ----------------
    const coastal = ctx.track.chunkAt(p.dist + 40).kind === 'highway';
    for (let f = 0; f < this.flocks.length; f++) {
      const fl = this.flocks[f];
      if (fl.dist < p.dist - 30) {
        fl.dist = p.dist + rand(80, 180);
        fl.lat = coastal ? rand(8, 40) : rand(-14, 14);
      }
      fl.dist += (coastal ? 4 : 2) * dt;
      ctx.track.sample(Math.min(fl.dist, ctx.track.frontDist - 1), fl.lat, fl.center);
    }
    for (const b of this.birds) {
      b.angle += b.speed * dt;
      b.phase += dt * 11;
      const c = this.flocks[b.flock].center;
      b.obj.position.set(c.x + Math.cos(b.angle) * b.radius, b.height + Math.sin(t * 0.7 + b.phase) * 1.2, c.z + Math.sin(b.angle) * b.radius);
      b.obj.rotation.set(0, -b.angle + (b.speed > 0 ? Math.PI : 0), (b.speed > 0 ? 1 : -1) * 0.25);
      const flap = Math.sin(b.phase) * 0.7;
      if (b.wings[0]) b.wings[0].rotation.z = -flap;
      if (b.wings[1]) b.wings[1].rotation.z = flap;
    }
  }
}
