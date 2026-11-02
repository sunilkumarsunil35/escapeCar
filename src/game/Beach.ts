import * as THREE from 'three';
import { BEACH } from '../data/config';
import { buildFish } from '../assets/procedural/items';
import { clamp, rand } from '../core/math';
import { audio } from '../core/Audio';
import type { GameCtx } from './types';

interface Fish {
  obj: THREE.Group;
  active: boolean;
  dist: number;
  lat: number;
  dir: number;
  t: number;
  dur: number;
  h: number;
  hit: boolean;
  pos: THREE.Vector3;
}

/**
 * Beach-mode sea life and patrols: fish leap out of the surf (and slap the player's boat for
 * damage), and Mafia gunboats are called in whenever the player is near or on the water.
 */
export class BeachLife {
  readonly root = new THREE.Group();
  enabled = false;
  private fish: Fish[] = [];
  private fishT = 0;
  private boatT = 0;
  private toldBoats = false;

  constructor(scene: THREE.Scene) {
    this.root.name = 'beach_life';
    scene.add(this.root);
    for (let i = 0; i < 16; i++) {
      const obj = buildFish(i % 3 === 0);
      obj.visible = false;
      this.root.add(obj);
      this.fish.push({ obj, active: false, dist: 0, lat: 0, dir: 1, t: 0, dur: 1, h: 2, hit: false, pos: new THREE.Vector3() });
    }
  }

  reset(): void {
    for (const f of this.fish) {
      f.active = false;
      f.obj.visible = false;
    }
    this.fishT = 1;
    this.boatT = 6;
    this.toldBoats = false;
  }

  update(dt: number, ctx: GameCtx): void {
    if (!this.enabled) return;
    const p = ctx.player;
    this.fishT -= dt;
    if (this.fishT <= 0) {
      this.fishT = p.boatMode ? rand(0.22, 0.4) : rand(0.7, 1.3);
      this.spawnFish(ctx, p.boatMode && Math.random() < 0.6);
    }
    for (const f of this.fish) if (f.active) this.updateFish(f, dt, ctx);

    // Gunboats: one patrols from Heat 2 (or as soon as you head for the sand), more while you're a boat.
    this.boatT -= dt;
    const lvl = ctx.heat.level;
    const want = p.boatMode ? (lvl >= 3 ? 3 : 2) : p.lat > BEACH.sandFrom || lvl >= 2 ? 1 : 0;
    let n = 0;
    for (const e of ctx.enemies.list) if (e.active && e.kind === 'enemy_boat') n++;
    if (n < want && this.boatT <= 0 && !p.dead && ctx.enemies.spawnBoat(ctx)) {
      this.boatT = rand(3, 5);
      if (!this.toldBoats) {
        this.toldBoats = true;
        ctx.toast('⚠ MAFIA GUNBOATS OFFSHORE!', 'danger');
      }
    }
  }

  private spawnFish(ctx: GameCtx, inPath: boolean): void {
    const f = this.fish.find((x) => !x.active);
    if (!f) return;
    const p = ctx.player;
    f.dist = Math.min(p.dist + (inPath ? rand(22, 40) : rand(12, 90)), ctx.track.frontDist - 5);
    f.lat = inPath ? clamp(p.lat + rand(-2, 2), BEACH.waterFrom + 1.5, BEACH.seaWall - 1) : rand(BEACH.waterFrom + 2, BEACH.seaWall + 30);
    f.dir = Math.random() < 0.5 ? -1 : 1;
    f.t = 0;
    f.dur = rand(0.9, 1.3);
    f.h = rand(1.3, 2.3);
    f.hit = false;
    f.active = true;
    f.obj.visible = true;
  }

  private updateFish(f: Fish, dt: number, ctx: GameCtx): void {
    const p = ctx.player;
    const first = f.t === 0;
    f.t += dt;
    const k = f.t / f.dur;
    if (k >= 1 || f.dist < ctx.track.backDist + 2) {
      f.active = false;
      f.obj.visible = false;
      if (k >= 1) ctx.fx.puff(f.pos.clone().setY(-0.1), new THREE.Vector3(0, 1.6, 0), 0.4, 0.4, 0xffffff);
      return;
    }
    const lat = f.lat + f.dir * k * 1.8;
    const heading = ctx.track.sample(f.dist, lat, f.pos);
    f.pos.y = -0.35 + Math.sin(k * Math.PI) * f.h;
    f.obj.position.copy(f.pos);
    f.obj.rotation.set(0, heading + (f.dir * Math.PI) / 2, 0);
    f.obj.rotateX(Math.cos(k * Math.PI) * 0.9);
    if (first) ctx.fx.puff(f.pos.clone().setY(-0.1), new THREE.Vector3(0, 2, 0), 0.4, 0.4, 0xffffff);
    if (!f.hit && p.boatMode && !p.dead && Math.abs(f.dist - p.dist) < p.halfLength + 0.5 && Math.abs(lat - p.lat) < p.halfWidth + 0.6 && f.pos.y > -0.1 && f.pos.y < 2.0) {
      f.hit = true;
      f.dir *= -1;
      ctx.damagePlayer(8, 0.35);
      ctx.fx.puff(f.pos.clone(), new THREE.Vector3(0, 2, 0), 0.5, 0.5, 0xffffff);
      ctx.toast('FISH SLAP! −8 HP');
      audio.hit();
    }
  }
}
