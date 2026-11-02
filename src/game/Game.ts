import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { FIXED_DT, PhysicsWorld } from '../core/Physics';
import type { AssetRegistry } from '../assets/AssetRegistry';
import { buildIslandRing, buildMesaRing, buildPineRing, buildSkyline } from '../assets/procedural/environment';
import { buildPlayerBoat } from '../assets/procedural/items';
import { BeachLife } from './Beach';
import type { InputManager, FrameInput } from '../input/Input';
import type { PeerHost } from '../input/PeerHost';
import { BEACH, MODES, NEAR_MISS_BONUS, NITRO_MAX_CHARGES, POWERUPS, heatLevelsFor, type HeatDef, type ModeDef, type ModeId, type PowerupId } from '../data/config';
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
import { Objectives, type GameEvent } from './Objectives';
import { Director } from './Director';
import { CameraRig } from './CameraRig';
import type { FeedbackTier, GameCtx } from './types';
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
  objectivesDone: number;
  objectiveCash: number;
  comboCash: number;
  bestCombo: number;
  /** Extra cash from the location's multiplier (desert +50%, forest +100%). */
  modeBonus: number;
  mode: ModeId;
  squashed: boolean;
  /** How the run ended. */
  cause: WreckReason;
  total: number;
  score: number;
}

type State = 'idle' | 'playing' | 'paused' | 'wrecking';
export type WreckReason = 'crash' | 'squash' | 'fall' | 'sink';

const NEUTRAL: FrameInput = { steer: 0, drift: false, shoot: false, gadget: false, reverse: false, recenter: false, gadgetPressed: false, nitroPressed: false, brake: false, source: 'keyboard' };
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
  readonly objectives = new Objectives();
  readonly hud: Hud;
  private skyline: THREE.Group;
  private mesas: THREE.Group;
  private pines: THREE.Group;
  mode: ModeDef = MODES.city;
  private headlight: THREE.SpotLight;
  state: State = 'idle';
  private acc = 0;
  private wreckT = 0;
  private wreckReason: WreckReason = 'crash';
  private islands: THREE.Group;
  private boat: THREE.Group;
  private beach: BeachLife;
  /** Beach mode: banked Boat Kits (max 1) and the running boat timer. */
  boatKits = 0;
  private boatT = 0;
  private boatWarned = false;
  private boatPop = 0;
  private lastWaterWarn = -99;
  private boatBadge: HTMLDivElement;
  private runCash = 0;
  private nearMissCash = 0;
  private vibeAcc = 0;
  private bikeStreak = 0;
  /** Real-time seconds left in a hit-stop freeze. */
  private hitStopT = 0;
  private hitStopCooldown = 0;
  /** Accessibility: skip full-screen flashes. */
  reduceFlashing = false;
  private popTmp = new THREE.Vector3();
  private lastBikeKill = -99;
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
    this.mesas = buildMesaRing();
    this.mesas.visible = false;
    this.scene.add(this.mesas);
    this.islands = buildIslandRing();
    this.islands.visible = false;
    this.scene.add(this.islands);
    this.beach = new BeachLife(this.scene);
    this.pines = buildPineRing();
    this.pines.visible = false;
    this.scene.add(this.pines);
    this.fx = new Effects(this.scene);
    this.player = new PlayerCar(this.physics, assets);
    this.scene.add(this.player.root);
    this.enemies = new EnemyManager(this.scene, assets, this.fx.rings);
    this.hazards = new HazardManager(this.scene, assets, this.physics, this.track);
    this.combat = new Combat(this.scene, assets);
    this.ambient = new Ambient(this.scene, assets, engine.lowQuality);
    this.combat.ctx = this;
    this.hud = new Hud(uiRoot);
    this.boat = buildPlayerBoat();
    this.boat.visible = false;
    this.player.root.add(this.boat);
    this.boatBadge = document.createElement('div');
    this.boatBadge.className = 'boat-badge hidden';
    uiRoot.appendChild(this.boatBadge);
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
      // Stay clear of the wall line (and the coastal median barrier that sits just inside it).
      const limit = (camTp.lat > 0 && camTp.chunk.seaWall > 0 ? camTp.chunk.seaWall : camTp.wall) - 1.6;
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
    this.objectives.onPayout = (_cash, label, cls) => this.hud.toast(label, cls);
    this.objectives.onBanner = (html, cls) => this.hud.showBanner(html, cls, 2.2);
    this.player.onBoost = (tier, source) => {
      this.reportEvent(source === 'ramp' ? 'ramp_jump' : tier >= 2 ? 'turbo_orange' : 'turbo_blue');
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
    if (dmg > 0) this.objectives.damage(dmg);
    this.vibeAcc += dmg;
    const now = performance.now();
    if ((this.vibeAcc >= 3 || shake >= 0.2) && now - this.lastVibe > 140) {
      this.host.vibrate(100);
      if (this.lastInput.source === 'gyro' || this.lastInput.source === 'touch') navigator.vibrate?.(60);
      this.hud.damageFlash(Math.min(0.5, this.vibeAcc / 30 + shake));
      this.vibeAcc = 0;
      this.lastVibe = now;
    }
    if (dmg >= 15) this.feedback('medium');
    else if (shake > 0) this.rig.shake(shake);
    if (this.player.hp <= 0) this.wreck();
  }

  reportEvent(type: GameEvent, amount = 1): void {
    if (this.state !== 'playing') return;
    this.objectives.event(type, amount);
  }

  onEnemyKilled(e: Enemy): void {
    this.popAt(e.worldPos, e.isChopper ? 4 : 2, `+$${e.def.cash}`, e.isChopper ? 'big' : e.kind === 'enemy_sedan' ? 'mid' : '');
    this.reportEvent(e.isChopper ? 'kill_chopper' : e.kind === 'enemy_sedan' ? 'kill_sedan' : 'kill_bike');
    this.combat.kills++;
    this.hazards.spawnCashBurst(e.worldPos.clone().setY(e.isChopper ? Math.max(2, e.alt) : 1.2), e.def.cash, e.dist);
    // Kill feed: bikes are frequent, so they're grouped into a short streak instead of one toast each.
    if (e.kind === 'enemy_bike') {
      this.bikeStreak = this.time - this.lastBikeKill < 2.5 ? this.bikeStreak + 1 : 1;
      this.lastBikeKill = this.time;
      if (this.bikeStreak === 1 || this.bikeStreak % 3 === 0) this.hud.toast(this.bikeStreak > 1 ? `BIKE STREAK x${this.bikeStreak}` : 'HITMAN BIKE DOWN', this.bikeStreak > 1 ? 'gold' : '');
    } else {
      this.hud.toast(`${e.def.name.toUpperCase()} DOWN  +$${e.def.cash}`, e.isChopper ? 'gold' : '');
    }
    if (e.isChopper) this.hud.showBanner('CHOPPER <b>DOWN!</b>', 'gold', 2);
  }

  collectCash(value: number): void {
    this.runCash += value;
    this.popAt(this.player.renderPos, 2.6, `+$${value}`, 'cash');
    this.reportEvent('cash', value);
  }

  applyPowerup(id: PowerupId): void {
    const def = POWERUPS[id];
    if (id === 'powerup_wrench') {
      this.player.heal(0.35);
      for (let i = 0; i < 20; i++) {
        this.fx.sparkBurst(this.player.renderPos.clone().add(new THREE.Vector3(rand(-1, 1), rand(0, 1.5), rand(-1.5, 1.5))), new THREE.Vector3(0, 1, 0), 1, 0x3ddc6b, 5, 0.4, 0.5, 0.6);
      }
    } else if (id === 'powerup_nitro') {
      // Nitro is banked as a charge and fired on demand (W / ↑ / NITRO button).
      if (this.player.nitroCharges < NITRO_MAX_CHARGES) {
        this.player.nitroCharges++;
        this.hud.showBanner(`+1 NITRO <span>${'●'.repeat(this.player.nitroCharges)}</span>`, 'nitro', 1.5);
      } else {
        this.player.nitro = def.duration;
        this.hud.showBanner('NITRO FULL · AUTO-BOOST!', 'nitro', 1.5);
        audio.boost(2);
      }
      return;
    } else if (id === 'powerup_boat') {
      if (this.boatKits < 1) {
        this.boatKits = 1;
        this.hud.showBanner('⚓ BOAT KIT READY', 'nitro', 1.6);
        this.toast('Steer onto the beach and into the sea to become a boat (12 s)');
      } else {
        this.collectCash(150);
        this.hud.showBanner('BOAT KIT +$150', 'nitro', 1.3);
      }
      return;
    } else if (id === 'powerup_magnet') {
      this.player.magnet = def.duration;
    }
    this.hud.showBanner(def.name, id.replace('powerup_', ''), 1.5);
  }

  /** Weapon reload, gadget cooldown and nitro charges → HUD chips and touch buttons. */
  private updateLoadoutHud(): void {
    const c = this.combat;
    const p = this.player;
    const w = c.weapon;
    const wFill = 1 - Math.max(0, c.fireCd) / w.interval;
    const wReady = c.fireCd <= 0;
    const wText = w.kind === 'hitscan' ? (c.target ? 'LOCKED' : 'READY') : wReady ? (c.target ? 'LOCKED' : 'READY') : `RELOAD ${c.fireCd.toFixed(1)}s`;
    this.hud.setChip('weapon', w.name.replace(/^Twin /, '').toUpperCase(), w.kind === 'hitscan' ? 1 : wFill, wText, w.kind === 'hitscan' || wReady);
    const gFill = 1 - c.gadgetCd / c.gadget.cooldown;
    const gText = c.gadgetReady ? 'READY' : `${c.gadgetCd.toFixed(1)}s`;
    this.hud.setChip('gadget', c.gadget.name.toUpperCase(), gFill, gText, c.gadgetReady);
    const pips = '●'.repeat(p.nitroCharges) + '○'.repeat(Math.max(0, NITRO_MAX_CHARGES - p.nitroCharges));
    const nActive = p.nitro > 0;
    const nFill = nActive ? p.nitro / POWERUPS.powerup_nitro.duration : p.nitroCharges > 0 ? 1 : 0;
    this.hud.setChip('nitro', 'NITRO', nFill, nActive ? 'BOOSTING' : pips, nActive || p.nitroCharges > 0);
    this.input.setButtonState('gadget', gFill, gText, c.gadgetReady);
    this.input.setButtonState('nitro', nFill, nActive ? 'BOOST' : pips, nActive || p.nitroCharges > 0);
  }

  private fireNitro(): void {
    const p = this.player;
    if (p.dead || p.nitro > 0 || p.nitroCharges <= 0) return;
    p.nitroCharges--;
    p.nitro = POWERUPS.powerup_nitro.duration;
    audio.boost(2);
    this.rig.shake(0.3);
    this.hud.showBanner('NITRO!', 'nitro', 1.2);
  }

  nearMiss(): void {
    this.nearMissCash += NEAR_MISS_BONUS;
    this.popAt(this.player.renderPos, 2.2, `NEAR MISS +$${NEAR_MISS_BONUS}`, 'gold');
    this.reportEvent('near_miss');
    this.hud.toast(`NEAR MISS +$${NEAR_MISS_BONUS}`, 'gold');
  }

  shake(amount: number): void {
    this.rig.shake(amount);
  }

  /**
   * Importance tiers keep juice proportional (game-feel): small = light shake; blast = shake only
   * (explosions chain, so they never freeze the game); medium = shake + short slow-hit;
   * large = big shake + longer slow-hit + white flash.
   */
  feedback(tier: FeedbackTier, _at?: THREE.Vector3): void {
    if (tier === 'small') this.rig.shake(0.15);
    else if (tier === 'blast') this.rig.shake(0.28);
    else if (tier === 'medium') {
      this.rig.shake(0.3);
      this.hitStop(0.05);
    } else {
      this.rig.shake(0.6);
      this.hitStop(0.1);
      audio.duckMusic(0.4, 0.6);
      this.flash(0.35);
    }
  }

  /**
   * Slow-hit: game time runs at 25% for `seconds` of real time. A cooldown stops back-to-back
   * events (kill streaks, chain reactions) from stacking into a stuttering series of freezes.
   */
  hitStop(seconds: number): void {
    if (this.hitStopCooldown > 0) return;
    this.hitStopT = Math.max(this.hitStopT, seconds);
    this.hitStopCooldown = seconds + 0.6;
  }

  private flash(strength: number): void {
    if (!this.reduceFlashing) this.hud.whiteFlash(strength);
  }

  /** Floating "+$" number above a world position. */
  private popAt(pos: THREE.Vector3, lift: number, text: string, cls: string): void {
    const v = this.popTmp.copy(pos);
    v.y += lift;
    v.project(this.camera);
    if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) return;
    this.hud.pop(text, (v.x * 0.5 + 0.5) * window.innerWidth, (-v.y * 0.5 + 0.5) * window.innerHeight, cls);
  }

  toast(text: string, cls = ''): void {
    this.hud.toast(text, cls);
  }

  // --- Run lifecycle ---
  start(loadout: Loadout, modeId: ModeId = 'city'): void {
    this.mode = MODES[modeId] ?? MODES.city;
    const levels = heatLevelsFor(this.mode);
    this.fx.clear();
    this.enemies.reset();
    this.hazards.reset();
    this.hazards.rollersEnabled = this.mode.rollers;
    this.hazards.potholesEnabled = this.mode.potholes;
    this.hazards.cranesEnabled = this.mode.cranes;
    this.hazards.beachEnabled = this.mode.beach;
    this.beach.enabled = this.mode.beach;
    this.beach.reset();
    this.boatKits = 0;
    this.boatT = 0;
    this.boat.visible = false;
    this.lastWaterWarn = -99;
    this.ambient.reset();
    this.director.reset(levels);
    this.objectives.reset();
    this.hazards.heat = levels[0];
    this.track.reset(levels[0].biome);
    const biome = levels[0].biome;
    this.skyline.visible = biome === 'city' || biome === 'coastal';
    this.mesas.visible = biome === 'desert';
    this.pines.visible = biome === 'forest';
    this.islands.visible = biome === 'beach';
    this.boatBadge.classList.toggle('hidden', !this.mode.beach);
    this.player.spawn(loadout);
    this.player.rampHandles = new Set(this.hazards.rampHandles());
    this.combat.reset(loadout);
    this.runCash = 0;
    this.nearMissCash = 0;
    this.vibeAcc = 0;
    this.hitStopT = 0;
    this.hitStopCooldown = 0;
    this.acc = 0;
    this.player.dist = 0;
    this.player.lat = 0;
    this.player.trackHeading = 0;
    this.lighting.setPreset(levels[0].preset, true);
    this.track.biome = levels[0].biome;
    this.rig.reset(this.player);
    this.state = 'playing';
    this.input.resetTransient();
    this.input.setTouchVisible(true);
    this.hud.show(true);
    this.hud.setLinked(this.host.connected);
    this.hud.showBanner(this.mode.id === 'city' ? 'ESCAPE!' : `${this.mode.name.toUpperCase()}!`, 'start', 1.4);
    const hint = this.mode.rollers ? 'Watch out for ROAD ROLLERS — jump them or dodge!' : this.mode.cranes ? 'Cranes swing trees across the road — find the gap! Mind the potholes.' : '';
    if (hint) setTimeout(() => this.state === 'playing' && this.toast(hint, 'warn'), 1600);
    audio.startEngine();
    audio.setMusicIntensity(1);
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    audio.stopEngine();
    audio.setMusicIntensity(0.5);
    this.input.setTouchVisible(false);
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    audio.startEngine();
    audio.setMusicIntensity(this.director.heat.level);
    this.input.resetTransient();
    this.input.setTouchVisible(true);
  }

  stop(): void {
    this.state = 'idle';
    audio.stopEngine();
    this.hud.show(false);
    this.boatBadge.classList.add('hidden');
    this.input.setTouchVisible(false);
    this.fx.clear();
  }

  private onHeat(h: HeatDef): void {
    audio.setMusicIntensity(h.level);
    this.lighting.setPreset(h.preset, false, 5);
    this.track.biome = h.biome;
    this.hazards.heat = h;
    this.hud.showBanner(`HEAT ${h.level} <span>${stars(h.level)}</span>`, `heat heat${h.level}`, 2.6);
    audio.warning();
  }

  /** Run over by a road roller: the car is flattened like a pancake and the run ends immediately. */
  /**
   * Beach mode amphibious logic. Entering the sea spends a banked Boat Kit and turns the car into
   * a boat for BEACH.boatTime seconds; driving back out turns it into a car again. Reaching the
   * water without a kit (or still being at sea when the timer runs out) sinks the car.
   */
  private updateBoatMode(dt: number): void {
    const p = this.player;
    if (!p.boatMode) {
      if (p.lat > BEACH.waterFrom + 0.4) {
        if (this.boatKits > 0) this.enterBoat();
        else this.wreck('sink');
      } else if (p.lat > BEACH.sandFrom + 3 && this.boatKits === 0 && this.time - this.lastWaterWarn > 5) {
        this.lastWaterWarn = this.time;
        this.toast('⚠ NO BOAT KIT — THE SEA WILL SINK YOU!', 'danger');
      }
      return;
    }
    this.boatT -= dt;
    if (p.lat < BEACH.waterFrom - 1.0) this.exitBoat();
    else if (this.boatT <= 0) this.wreck('sink');
    else if (this.boatT < 4 && !this.boatWarned) {
      this.boatWarned = true;
      this.toast('⚓ BOAT KIT RUNNING OUT — GET TO THE ROAD!', 'danger');
      audio.warning();
    }
  }

  private enterBoat(): void {
    const p = this.player;
    this.boatKits--;
    p.boatMode = true;
    this.boatT = BEACH.boatTime;
    this.boatWarned = false;
    this.boatPop = 1;
    this.splashAt(p.renderPos);
    audio.splash();
    audio.powerup();
    this.hud.showBanner('⚓ BOAT MODE!', 'nitro', 1.4);
  }

  private exitBoat(): void {
    const p = this.player;
    p.boatMode = false;
    this.boatT = 0;
    this.boatPop = 1;
    this.splashAt(p.renderPos);
    audio.splash();
    this.hud.showBanner('BACK ON WHEELS', 'nitro', 1.2);
  }

  private splashAt(at: THREE.Vector3): void {
    for (let i = 0; i < 14; i++) this.fx.puff(at.clone().setY(0).add(new THREE.Vector3(rand(-1.5, 1.5), 0, rand(-2, 2))), new THREE.Vector3(rand(-3, 3), rand(2, 5), rand(-3, 3)), 0.6, 0.7, i % 2 ? 0xffffff : 0x9fe3f0);
  }

  /** Swaps car/boat models, bobs the boat, sprays a wake and keeps the Boat Kit badge current. */
  private updateBoatVisual(dt: number): void {
    const p = this.player;
    const boat = p.boatMode;
    this.boat.visible = boat;
    if (!p.stuck) p.model.visible = !boat;
    this.boatPop = damp(this.boatPop, 0, 6, dt);
    if (boat) {
      const t = this.director.time;
      this.boat.position.set(0, -0.62 + Math.sin(t * 3.1) * 0.06, 0);
      this.boat.rotation.set(Math.sin(t * 2.2) * 0.03, 0, Math.sin(t * 2.7) * 0.04);
      this.boat.scale.setScalar(1 + this.boatPop * 0.25);
      if (p.speed > 6 && Math.random() < 0.6) {
        const back = new THREE.Vector3(Math.sin(p.yaw) * 2.8, -0.1, Math.cos(p.yaw) * 2.8).add(p.renderPos).setY(-0.1);
        this.fx.puff(back, new THREE.Vector3(rand(-1.5, 1.5), 1.5, rand(-1.5, 1.5)), 0.5, 0.6, 0xffffff);
      }
    } else p.model.scale.setScalar(p.squashed ? p.model.scale.x : 1 + this.boatPop * 0.2);
    if (this.state !== 'playing') return;
    const b = this.boatBadge;
    const low = boat && this.boatT < 4;
    b.className = `boat-badge ${boat ? (low ? 'active low' : 'active') : this.boatKits > 0 ? 'ready' : 'none'}`;
    b.textContent = boat ? `⚓ BOAT ${Math.ceil(this.boatT)}s — back to the road!` : this.boatKits > 0 ? '⚓ BOAT KIT READY — steer into the sea' : '⚓ NO BOAT KIT — stay out of the water';
  }

  fallPlayer(): void {
    if (this.state !== 'playing') return;
    this.player.hp = 0;
    this.wreck('fall');
  }

  squashPlayer(): void {
    if (this.state !== 'playing') return;
    this.player.squashed = true;
    this.player.hp = 0;
    this.wreck('squash');
  }

  private wreck(reason: WreckReason = 'crash'): void {
    if (this.state !== 'playing') return;
    this.state = 'wrecking';
    this.wreckT = WRECK_REAL_SECONDS;
    this.player.dead = true;
    this.wreckReason = reason;
    this.objectives.finish();
    this.combat.target = null;
    this.fx.setReticle(null, this.camera, 1);
    this.input.setTouchVisible(false);
    if (reason === 'fall' || reason === 'sink') {
      const pl = this.player;
      pl.stuck = true;
      pl.boatMode = false;
      this.boat.visible = false;
      pl.model.visible = true;
      const p = pl.renderPos.clone().setY(0);
      for (let i = 0; i < 16; i++) this.fx.puff(p.clone().add(new THREE.Vector3(rand(-1.5, 1.5), 0, rand(-2, 2))), new THREE.Vector3(rand(-3, 3), rand(3, 7), rand(-3, 3)), 0.7, 0.9, i % 2 ? 0xffffff : 0x9fe3f0);
      this.rig.shake(0.5);
      this.host.vibrate(450);
      navigator.vibrate?.(350);
      audio.splash();
      audio.stopEngine();
      audio.setMusicIntensity(0.5);
      this.boatBadge.classList.add('hidden');
      this.hud.showBanner(reason === 'fall' ? 'F E L L &nbsp; I N !' : 'S U N K !', 'wrecked', 3);
      return;
    }
    if (reason === 'squash') {
      const p = this.player.renderPos.clone().setY(0.4);
      for (let i = 0; i < 8; i++) this.fx.puff(p.clone().add(new THREE.Vector3(rand(-1.8, 1.8), 0, rand(-2.2, 2.2))), new THREE.Vector3(rand(-5, 5), rand(0.3, 1.2), rand(-5, 5)), 0.55, 0.8, 0xc9a777);
      this.rig.shake(0.7);
      this.flash(0.25);
      this.host.vibrate(500);
      navigator.vibrate?.(400);
      audio.squash();
      audio.stopEngine();
      audio.setMusicIntensity(0.5);
      this.hud.showBanner('S Q U A S H E D !', 'wrecked', 3);
      return;
    }
    this.player.addImpulse(new THREE.Vector3(0, 9, 0));
    const p = this.player.renderPos.clone().setY(1);
    this.fx.explosion(p, 2.2, 0x8c2a1e);
    this.rig.shake(1.2);
    this.flash(0.5);
    this.host.vibrate(400);
    navigator.vibrate?.(300);
    audio.wreck();
    audio.stopEngine();
    audio.setMusicIntensity(0.5);
    this.hud.showBanner('W R E C K E D', 'wrecked', 3);
  }

  private result(): RunResult {
    const distanceBonus = Math.floor(Math.max(0, this.player.dist) / 10);
    const o = this.objectives;
    const base = distanceBonus + this.runCash + this.nearMissCash + o.objectiveCash + o.comboCash;
    const modeBonus = Math.round(base * (this.mode.cashMult - 1));
    const total = base + modeBonus;
    return {
      time: this.director.time,
      maxHeat: this.director.maxHeat,
      distance: this.player.dist,
      kills: this.combat.kills,
      cashCollected: this.runCash,
      nearMissCash: this.nearMissCash,
      distanceBonus,
      objectivesDone: o.completed,
      objectiveCash: o.objectiveCash,
      comboCash: o.comboCash,
      bestCombo: o.bestMult,
      modeBonus,
      mode: this.mode.id,
      squashed: this.wreckReason === 'squash',
      cause: this.wreckReason,
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
    const frozen = this.hitStopT > 0;
    if (frozen) this.hitStopT -= dt;
    if (this.hitStopCooldown > 0) this.hitStopCooldown -= dt;
    const sdt = dt * (wrecking ? WRECK_TIME_SCALE : 1) * (frozen ? 0.25 : 1);
    const carInput = this.player.dead ? NEUTRAL : input;
    if (input.nitroPressed && this.state === 'playing') this.fireNitro();

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
    // Beach chunks keep the land-side wall but open the sea side out to the far sea wall.
    const sideWall = this.tp.lat > 0 && this.tp.chunk.seaWall > 0 ? this.tp.chunk.seaWall : this.tp.wall;
    this.player.wall = sideWall;
    const scraping = Math.abs(this.tp.lat) > sideWall - this.player.lateralExtent() - 0.35;
    this.player.scraping = scraping;
    if (scraping && this.state === 'playing') audio.scrape();
    if (Math.abs(this.tp.lat) > sideWall + 3) {
      // Safety net: never let the car escape the road corridor.
      const pos = new THREE.Vector3();
      this.track.sample(this.tp.dist, Math.sign(this.tp.lat) * (sideWall - 2), pos);
      this.player.teleportTo(pos.x, pos.z, this.tp.heading);
    }
    this.track.update(this.player.dist);
    if (this.mode.beach && this.state === 'playing') this.updateBoatMode(sdt);

    if (!wrecking) {
      this.director.update(sdt, this);
      this.objectives.update(sdt, this.director.heat.level);
    }
    WATER_UNIFORMS.uTime.value += sdt;
    this.enemies.update(sdt, this);
    this.hazards.update(sdt, this);
    this.ambient.update(sdt, this);
    this.beach.update(sdt, this);
    this.combat.update(sdt, wrecking ? NEUTRAL : input, this);
    this.player.updateVisual(alpha, sdt, this.fx);
    if (this.mode.beach) this.updateBoatVisual(dt);
    this.fx.update(sdt);
    this.rig.update(this.player, wrecking ? dt : sdt, wrecking, dt);
    this.lighting.update(sdt, this.player.renderPos, this.camera);
    this.skyline.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.mesas.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.pines.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.islands.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.updateHeadlight();
    this.updateThreats();

    const boss = this.enemies.chopper.alive ? this.enemies.chopper.hp / this.enemies.chopper.def.hp : null;
    this.hud.update(dt, {
      hp: this.player.hp,
      maxHp: this.player.stats.maxHp,
      cash: this.runCash + this.nearMissCash + this.objectives.objectiveCash + this.objectives.comboCash,
      heat: this.director.heat.level,
      time: this.director.time,
      boss,
      boostTier: this.player.drift.active ? this.player.drift.tier : 0,
    });
    this.updateLoadoutHud();
    this.hud.setObjective(this.objectives.objectiveView());
    this.hud.setCombo(this.objectives.comboView());
    audio.setEngine(Math.min(1.4, this.player.speed / 30), this.player.boosting);

    if (wrecking) {
      this.wreckT -= dt;
      if (this.wreckReason === 'fall' || this.wreckReason === 'sink') {
        const pl = this.player;
        const fall = this.wreckReason === 'fall';
        pl.sink = damp(pl.sink, fall ? 3.4 : 1.7, fall ? 2.2 : 1.2, dt);
        pl.sinkTilt = damp(pl.sinkTilt, fall ? -0.85 : -0.25, fall ? 3 : 1.5, dt);
        if (Math.random() < 0.3) this.fx.puff(pl.renderPos.clone().setY(-0.1).add(new THREE.Vector3(rand(-1, 1), 0, rand(-1.5, 1.5))), new THREE.Vector3(0, 1.4, 0), 0.3, 0.6, 0xe0f7fb);
      } else if (this.wreckReason === 'squash') {
        if (Math.random() < 0.15) this.fx.puff(this.player.renderPos.clone().setY(0.3), new THREE.Vector3(rand(-1, 1), 0.8, rand(-1, 1)), 0.8, 1.2, 0xc9a777);
      } else {
      this.player.model.rotation.z = damp(this.player.model.rotation.z, 2.7, 1.5, sdt * 5);
      if (Math.random() < 0.5) this.fx.flame(this.player.renderPos.clone().add(new THREE.Vector3(rand(-0.8, 0.8), 0.6, rand(-1, 1))), new THREE.Vector3(0, 3, 0), 0.9, 0.6);
      if (Math.random() < 0.3) this.fx.puff(this.player.renderPos.clone().setY(1.5), new THREE.Vector3(rand(-1, 1), 3, rand(-1, 1)), 1.0, 1.4, 0x333333);
      }
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

  /**
   * Compiles every shader the run can need (explosions, tracers, missiles, mines, rings…) during
   * the loading screen, so the first blast of a session doesn't hitch while the GPU compiles.
   */
  prewarm(): void {
    const hidden: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    this.engine.renderer.compile(this.scene, this.camera);
    for (const o of hidden) o.visible = false;
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
