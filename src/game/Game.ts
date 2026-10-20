import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { FIXED_DT, PhysicsWorld } from '../core/Physics';
import type { AssetRegistry } from '../assets/AssetRegistry';
import { buildSkyline } from '../assets/procedural/environment';
import type { InputManager, FrameInput } from '../input/Input';
import type { PeerHost } from '../input/PeerHost';
import { HEAT_LEVELS, NEAR_MISS_BONUS, POWERUPS, type HeatDef, type PowerupId } from '../data/config';
import { damp, rand } from '../core/math';
import { audio } from '../core/Audio';
import { Track, type TrackPoint } from './Track';
import { Lighting } from './Lighting';
import { Effects } from './Effects';
import { PlayerCar } from './PlayerCar';
import { EnemyManager, type Enemy } from './Enemies';
import { HazardManager } from './Hazards';
import { Combat } from './Combat';
import { Ambient } from './Ambient';
import { Director } from './Director';
import { CameraRig } from './CameraRig';
import type { GameCtx } from './types';
import type { Loadout } from './Loadout';
import { Hud, stars } from '../ui/Hud';
import { WATER_UNIFORMS } from '../core/Palette';

export interface RunResult {
  time: number;
  maxHeat: number;
  distance: number;
  kills: number;
  cashCollected: number;
  nearMissCash: number;
  distanceBonus: number;
  total: number;
  score: number;
}

type State = 'idle' | 'playing' | 'paused' | 'wrecking';

const NEUTRAL: FrameInput = { steer: 0, drift: false, shoot: false, gadget: false, reverse: false, recenter: false, gadgetPressed: false, source: 'keyboard' };
const WRECK_REAL_SECONDS = 2.0;
const WRECK_TIME_SCALE = 0.2;

/** One endless getaway run: owns the scene and all gameplay systems, implements the shared GameCtx. */
export class Game implements GameCtx {
  readonly scene = new THREE.Scene();
  readonly rig = new CameraRig();
  readonly lighting: Lighting;
  readonly physics = new PhysicsWorld();
  readonly track: Track;
  readonly player: PlayerCar;
  readonly fx: Effects;
  readonly enemies: EnemyManager;
  readonly hazards: HazardManager;
  readonly combat: Combat;
  readonly ambient: Ambient;
  readonly director = new Director();
  readonly hud: Hud;
  private skyline: THREE.Group;
  private headlight: THREE.SpotLight;
  state: State = 'idle';
  private acc = 0;
  private wreckT = 0;
  private runCash = 0;
  private nearMissCash = 0;
  private vibeAcc = 0;
  private lastVibe = 0;
  private tp: TrackPoint;
  private lastInput: FrameInput = NEUTRAL;
  private threatTmp = new THREE.Vector3();
  private debugHeat: boolean;
  onWrecked: ((r: RunResult) => void) | null = null;
  onPauseRequest: (() => void) | null = null;

  constructor(private engine: Engine, private assets: AssetRegistry, private input: InputManager, private host: PeerHost, uiRoot: HTMLElement) {
    this.scene.name = 'run';
    this.lighting = new Lighting(this.scene, engine);
    this.track = new Track(this.physics, assets);
    this.scene.add(this.track.root);
    this.skyline = buildSkyline();
    this.scene.add(this.skyline);
    this.fx = new Effects(this.scene);
    this.player = new PlayerCar(this.physics, assets);
    this.scene.add(this.player.root);
    this.enemies = new EnemyManager(this.scene, assets, this.fx.rings);
    this.hazards = new HazardManager(this.scene, assets, this.physics, this.track);
    this.combat = new Combat(this.scene, assets);
    this.ambient = new Ambient(this.scene, assets, engine.lowQuality);
    this.combat.ctx = this;
    this.hud = new Hud(uiRoot);
    this.hud.onPause = () => this.onPauseRequest?.();
    this.track.onChunkPlaced = (c, safe) => this.hazards.populate(c, safe);
    this.director.onHeatChange = (h) => this.onHeat(h);
    this.headlight = new THREE.SpotLight(0xfff1c8, 0, 55, 0.55, 0.6, 1.0);
    this.headlight.castShadow = false;
    this.scene.add(this.headlight, this.headlight.target);
    this.tp = { dist: 0, lat: 0, heading: 0, wall: 12, chunk: this.track.chunks[0] };
    engine.onResize((w, h) => this.rig.resize(w, h));
    const camTp: TrackPoint = { dist: 0, lat: 0, heading: 0, wall: 12, chunk: this.track.chunks[0] };
    const camPos = new THREE.Vector3();
    this.rig.constrain = (pos) => {
      if (!this.track.chunks.length) return;
      this.track.project(pos, this.player.dist - 8, camTp);
      const limit = camTp.wall - 0.8;
      if (Math.abs(camTp.lat) > limit) {
        this.track.sample(camTp.dist, Math.sign(camTp.lat) * limit, camPos);
        pos.x = camPos.x;
        pos.z = camPos.z;
      }
    };
    this.debugHeat = new URLSearchParams(location.search).has('debug') || new URLSearchParams(location.search).get('admin') === 'true';
    this.player.onSparkTier = (tier) => {
      if (tier === 2) this.hud.toast('ORANGE TURBO READY', 'orange');
      else if (tier === 1) this.hud.toast('BLUE TURBO READY', 'blue');
    };
    this.player.onBoost = (tier) => {
      this.hud.toast(tier >= 2 ? 'ORANGE TURBO!' : 'BLUE TURBO!', tier >= 2 ? 'orange' : 'blue');
      this.rig.shake(tier >= 2 ? 0.25 : 0.12);
    };
  }

  // --- GameCtx ---
  get camera(): THREE.PerspectiveCamera {
    return this.rig.camera;
  }
  get heat(): HeatDef {
    return this.director.heat;
  }
  get time(): number {
    return this.director.time;
  }

  damagePlayer(amount: number, shake = 0): void {
    if (this.state !== 'playing' || this.player.dead) return;
    const dmg = this.player.takeDamage(amount);
    this.vibeAcc += dmg;
    const now = performance.now();
    if ((this.vibeAcc >= 3 || shake >= 0.2) && now - this.lastVibe > 140) {
      this.host.vibrate(100);
      if (this.lastInput.source === 'gyro' || this.lastInput.source === 'touch') navigator.vibrate?.(60);
      this.hud.damageFlash(Math.min(0.5, this.vibeAcc / 30 + shake));
      this.vibeAcc = 0;
      this.lastVibe = now;
    }
    if (shake > 0) this.rig.shake(shake);
    if (this.player.hp <= 0) this.wreck();
  }

  onEnemyKilled(e: Enemy): void {
    this.combat.kills++;
    this.hazards.spawnCashBurst(e.worldPos.clone().setY(e.isChopper ? Math.max(2, e.alt) : 1.2), e.def.cash, e.dist);
    this.hud.toast(`${e.def.name.toUpperCase()} DOWN  +${e.def.cash > 0 ? '$' + e.def.cash : ''}`, e.isChopper ? 'gold' : '');
    if (e.isChopper) this.hud.showBanner('CHOPPER <b>DOWN!</b>', 'gold', 2);
  }

  collectCash(value: number): void {
    this.runCash += value;
  }

  applyPowerup(id: PowerupId): void {
    const def = POWERUPS[id];
    if (id === 'powerup_wrench') {
      this.player.heal(0.35);
      for (let i = 0; i < 20; i++) {
        this.fx.sparkBurst(this.player.renderPos.clone().add(new THREE.Vector3(rand(-1, 1), rand(0, 1.5), rand(-1.5, 1.5))), new THREE.Vector3(0, 1, 0), 1, 0x3ddc6b, 5, 0.4, 0.5, 0.6);
      }
    } else if (id === 'powerup_nitro') {
      this.player.nitro = def.duration;
      audio.boost(2);
    } else if (id === 'powerup_magnet') {
      this.player.magnet = def.duration;
    }
    this.hud.showBanner(def.name, id.replace('powerup_', ''), 1.5);
  }

  nearMiss(): void {
    this.nearMissCash += NEAR_MISS_BONUS;
    this.hud.toast(`NEAR MISS +$${NEAR_MISS_BONUS}`, 'gold');
  }

  shake(amount: number): void {
    this.rig.shake(amount);
  }

  toast(text: string, cls = ''): void {
    this.hud.toast(text, cls);
  }

  // --- Run lifecycle ---
  start(loadout: Loadout): void {
    this.fx.clear();
    this.enemies.reset();
    this.hazards.reset();
    this.ambient.reset();
    this.director.reset();
    this.hazards.heat = HEAT_LEVELS[0];
    this.track.reset();
    this.player.spawn(loadout);
    this.player.rampHandles = new Set(this.hazards.rampHandles());
    this.combat.reset(loadout);
    this.runCash = 0;
    this.nearMissCash = 0;
    this.vibeAcc = 0;
    this.acc = 0;
    this.player.dist = 0;
    this.player.lat = 0;
    this.player.trackHeading = 0;
    this.lighting.setPreset(HEAT_LEVELS[0].preset, true);
    this.track.biome = HEAT_LEVELS[0].biome;
    this.rig.reset(this.player);
    this.state = 'playing';
    this.input.resetTransient();
    this.input.setTouchVisible(true);
    this.hud.show(true);
    this.hud.setLinked(this.host.connected);
    this.hud.showBanner('ESCAPE!', 'start', 1.4);
    audio.startEngine();
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    audio.stopEngine();
    this.input.setTouchVisible(false);
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    audio.startEngine();
    this.input.resetTransient();
    this.input.setTouchVisible(true);
  }

  stop(): void {
    this.state = 'idle';
    audio.stopEngine();
    this.hud.show(false);
    this.input.setTouchVisible(false);
    this.fx.clear();
  }

  private onHeat(h: HeatDef): void {
    this.lighting.setPreset(h.preset, false, 5);
    this.track.biome = h.biome;
    this.hazards.heat = h;
    this.hud.showBanner(`HEAT ${h.level} <span>${stars(h.level)}</span>`, `heat heat${h.level}`, 2.6);
    audio.warning();
  }

  private wreck(): void {
    if (this.state !== 'playing') return;
    this.state = 'wrecking';
    this.wreckT = WRECK_REAL_SECONDS;
    this.player.dead = true;
    this.combat.target = null;
    this.fx.setReticle(null, this.camera, 1);
    this.input.setTouchVisible(false);
    this.player.addImpulse(new THREE.Vector3(0, 9, 0));
    const p = this.player.renderPos.clone().setY(1);
    this.fx.explosion(p, 2.2, 0x8c2a1e);
    this.rig.shake(1.2);
    this.host.vibrate(400);
    navigator.vibrate?.(300);
    audio.wreck();
    audio.stopEngine();
    this.hud.showBanner('W R E C K E D', 'wrecked', 3);
  }

  private result(): RunResult {
    const distanceBonus = Math.floor(Math.max(0, this.player.dist) / 10);
    const total = distanceBonus + this.runCash + this.nearMissCash;
    return {
      time: this.director.time,
      maxHeat: this.director.maxHeat,
      distance: this.player.dist,
      kills: this.combat.kills,
      cashCollected: this.runCash,
      nearMissCash: this.nearMissCash,
      distanceBonus,
      total,
      score: Math.round(this.director.time * 10 + this.combat.kills * 50 + total),
    };
  }

  update(dt: number): void {
    if (this.state === 'idle') return;
    const input = this.input.poll(dt);
    this.lastInput = input;
    if (this.state === 'paused') {
      this.render();
      return;
    }
    if (this.debugHeat) {
      for (let i = 1; i <= 4; i++) if (this.input.isKeyDown(`Digit${i}`)) this.director.skipTo(i);
    }
    const wrecking = this.state === 'wrecking';
    const sdt = dt * (wrecking ? WRECK_TIME_SCALE : 1);
    const carInput = this.player.dead ? NEUTRAL : input;

    // Fixed-step physics with interpolation
    this.acc += sdt;
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < 5) {
      this.player.fixedUpdate(FIXED_DT, carInput);
      this.physics.followGround(this.player.pos.x, this.player.pos.z);
      this.physics.step();
      this.player.postStep();
      this.acc -= FIXED_DT;
      steps++;
    }
    if (steps === 5) this.acc = 0;
    const alpha = this.acc / FIXED_DT;

    this.track.project(this.player.pos, this.player.dist, this.tp);
    this.player.dist = this.tp.dist;
    this.player.lat = this.tp.lat;
    this.player.trackHeading = this.tp.heading;
    this.player.wall = this.tp.wall;
    const scraping = Math.abs(this.tp.lat) > this.tp.wall - this.player.lateralExtent() - 0.35;
    this.player.scraping = scraping;
    if (scraping && this.state === 'playing') audio.scrape();
    if (Math.abs(this.tp.lat) > this.tp.wall + 3) {
      // Safety net: never let the car escape the road corridor.
      const pos = new THREE.Vector3();
      this.track.sample(this.tp.dist, Math.sign(this.tp.lat) * (this.tp.wall - 2), pos);
      this.player.teleportTo(pos.x, pos.z, this.tp.heading);
    }
    this.track.update(this.player.dist);

    if (!wrecking) this.director.update(sdt, this);
    WATER_UNIFORMS.uTime.value += sdt;
    this.enemies.update(sdt, this);
    this.hazards.update(sdt, this);
    this.ambient.update(sdt, this);
    this.combat.update(sdt, wrecking ? NEUTRAL : input, this);
    this.player.updateVisual(alpha, sdt, this.fx);
    this.fx.update(sdt);
    this.rig.update(this.player, wrecking ? dt : sdt, wrecking);
    this.lighting.update(sdt, this.player.renderPos, this.camera);
    this.skyline.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.updateHeadlight();
    this.updateThreats();

    const boss = this.enemies.chopper.alive ? this.enemies.chopper.hp / this.enemies.chopper.def.hp : null;
    this.hud.update(dt, {
      hp: this.player.hp,
      maxHp: this.player.stats.maxHp,
      cash: this.runCash + this.nearMissCash,
      heat: this.director.heat.level,
      time: this.director.time,
      boss,
      boostTier: this.player.drift.active ? this.player.drift.tier : 0,
      gadgetText: this.combat.gadgetReady ? `${this.combat.gadget.name.toUpperCase()} · READY` : `${this.combat.gadget.name.toUpperCase()} · ${this.combat.gadgetCd.toFixed(1)}s`,
    });
    this.input.setGadgetCooldown(this.combat.gadgetCd, this.combat.gadgetReady);
    audio.setEngine(Math.min(1.4, this.player.speed / 30), this.player.boosting);

    if (wrecking) {
      this.wreckT -= dt;
      this.player.model.rotation.z = damp(this.player.model.rotation.z, 2.7, 1.5, sdt * 5);
      if (Math.random() < 0.5) this.fx.flame(this.player.renderPos.clone().add(new THREE.Vector3(rand(-0.8, 0.8), 0.6, rand(-1, 1))), new THREE.Vector3(0, 3, 0), 0.9, 0.6);
      if (Math.random() < 0.3) this.fx.puff(this.player.renderPos.clone().setY(1.5), new THREE.Vector3(rand(-1, 1), 3, rand(-1, 1)), 1.0, 1.4, 0x333333);
      if (this.wreckT <= 0) {
        this.state = 'idle';
        this.hud.show(false);
        this.onWrecked?.(this.result());
      }
    }
    this.render();
  }

  private updateHeadlight(): void {
    const lvl = this.lighting.headlightLevel;
    this.headlight.intensity = lvl * 60;
    if (lvl <= 0.01) return;
    const p = this.player.renderPos;
    const fx = -Math.sin(this.player.yaw);
    const fz = -Math.cos(this.player.yaw);
    this.headlight.position.set(p.x + fx * 2.2, p.y + 0.6, p.z + fz * 2.2);
    this.headlight.target.position.set(p.x + fx * 20, 0, p.z + fz * 20);
  }

  private updateThreats(): void {
    let left = false;
    let right = false;
    let bottom = false;
    const p = this.player;
    if (this.state === 'playing') {
      for (const e of this.enemies.list) {
        if (!e.alive) continue;
        const dd = e.dist - p.dist;
        if (dd > 6 || dd < -22 || Math.abs(e.lat - p.lat) > 12) continue;
        this.threatTmp.copy(e.worldPos).setY(0.8).project(this.camera);
        const offscreen = this.threatTmp.z > 1 || Math.abs(this.threatTmp.x) > 0.95 || this.threatTmp.y < -0.95;
        if (!offscreen) continue;
        if (Math.abs(e.lat - p.lat) > 2.2 && dd > -8) {
          if (e.lat < p.lat) left = true;
          else right = true;
        } else bottom = true;
      }
    }
    this.hud.setThreats(left, right, bottom);
  }

  render(): void {
    this.engine.render(this.scene, this.camera);
  }

  /** Releases DOM + physics so the app can rebuild the world after admin asset edits. */
  dispose(): void {
    this.stop();
    this.hud.el.remove();
    this.physics.world.free();
  }
}
