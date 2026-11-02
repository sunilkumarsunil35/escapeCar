import * as THREE from 'three';
import { RAPIER, type PhysicsWorld } from '../core/Physics';
import { MAGNET_RADIUS, PICKUP_CASH_VALUE, POWERUPS, ROAD, type HeatDef, type PowerupId } from '../data/config';
import { chance, clamp, damp, pick, rand } from '../core/math';
import { glowMat } from '../core/Palette';
import type { AssetRegistry } from '../assets/AssetRegistry';
import { buildCraneGantry, buildCraneLoad, buildPothole, rampHullPoints } from '../assets/procedural/items';
import type { Track, Chunk } from './Track';
import type { GameCtx } from './types';
import { audio } from '../core/Audio';

type HazardKind = 'barricade' | 'barrel' | 'ramp' | 'cone' | 'roller' | 'pothole';

type GatePattern = 'single' | 'pair' | 'scissor';

/** A logging gantry across the road whose hanging trees slide sideways (forest mode). */
interface CraneGate {
  active: boolean;
  dist: number;
  pattern: GatePattern;
  t: number;
  omega: number;
  phase: number;
  hitCd: number;
  warned: boolean;
  gantry: THREE.Group;
  big: THREE.Group;
  small: [THREE.Group, THREE.Group];
  pos: THREE.Vector3;
}

/** Half of the drivable corridor the crane loads move in (forest chunks use the city wall). */
const GATE_SPAN = ROAD.cityWall - 0.3;
/** Half-thickness of a hanging tree along the road. */
const LOAD_HALF_T = 0.9;
/** Narrowest gap any pattern can ever leave (see loadsAt), checked by tools/playtest-bot.js. */
export const MIN_GATE_GAP = 4.2;

/**
 * Lateral [center, halfWidth] of each hanging load at time t. Every pattern is built so a gap of at
 * least MIN_GATE_GAP metres always exists somewhere across the road:
 *  - single: one 11 m tree sweeping ±5 m → the wider side gap is never below 6.8 m.
 *  - pair: two 6 m trees moving together with a fixed 5 m gap between them.
 *  - scissor: two 6 m trees moving in opposite directions; the middle gap opens as the edge
 *    gaps close and vice versa, crossing over at 4.2 m.
 */
function loadsAt(g: CraneGate, out: [number, number][]): number {
  const s = Math.sin(g.t * g.omega + g.phase);
  if (g.pattern === 'single') {
    out[0][0] = 5.0 * s;
    out[0][1] = 5.5;
    return 1;
  }
  if (g.pattern === 'pair') {
    const c = 3.8 * s;
    out[0][0] = c - 5.5;
    out[1][0] = c + 5.5;
  } else {
    const k = 2.5 * s;
    out[0][0] = -5.5 + k;
    out[1][0] = 5.5 - k;
  }
  out[0][1] = 3;
  out[1][1] = 3;
  return 2;
}

export interface Hazard {
  kind: HazardKind;
  obj: THREE.Group;
  active: boolean;
  dist: number;
  lat: number;
  halfW: number;
  halfL: number;
  hp: number;
  broken: number;
  passed: boolean;
  fuse: number;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  pos: THREE.Vector3;
  body: RAPIER.RigidBody | null;
}

interface Pickup {
  kind: 'cash' | PowerupId;
  obj: THREE.Group;
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  dist: number;
  value: number;
  life: number;
  airborne: boolean;
  baseY: number;
  ring: THREE.Mesh | null;
}

const NEAR_MISS_PAD = 1.5;

/** Roadblocks, explosive barrel chains, jump ramps (Rapier colliders), cash stacks and power-up crates. */
export class HazardManager {
  readonly root = new THREE.Group();
  private barricades: Hazard[] = [];
  private barrels: Hazard[] = [];
  /** Read-only view for auto-aim (avoids a per-frame generator). */
  get barrelList(): readonly Hazard[] {
    return this.barrels;
  }
  private ramps: Hazard[] = [];
  private rollers: Hazard[] = [];
  /** Road rollers lumber down the lanes (desert mode). */
  rollersEnabled = false;
  private rollerT = 0;
  private potholes: Hazard[] = [];
  private gates: CraneGate[] = [];
  potholesEnabled = false;
  cranesEnabled = false;
  private loadTmp: [number, number][] = [[0, 0], [0, 0]];
  private gateTmp = new THREE.Vector3();
  private cones: Hazard[] = [];
  /** Barricades + barrels, pre-joined so the per-frame loop allocates nothing. */
  private blockers: Hazard[] = [];
  private cash: Pickup[] = [];
  private powerups: Pickup[] = [];
  heat: HeatDef | null = null;
  private tmp = new THREE.Vector3();
  private nearMissCd = 0;

  constructor(scene: THREE.Scene, assets: AssetRegistry, private physics: PhysicsWorld, private track: Track) {
    this.root.name = 'hazards';
    scene.add(this.root);
    const mk = (kind: HazardKind, id: string, halfW: number, halfL: number): Hazard => {
      const obj = assets.instantiate(id);
      obj.visible = false;
      this.root.add(obj);
      return { kind, obj, active: false, dist: 0, lat: 0, halfW, halfL, hp: 10, broken: 0, passed: false, fuse: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3(), pos: new THREE.Vector3(), body: null };
    };
    const bc = assets.config('obstacle_barricade').collider ?? [3.5, 1, 0.8];
    const br = assets.config('obstacle_barrel').collider ?? [0.8, 1.2, 0.8];
    for (let i = 0; i < 16; i++) this.barricades.push(mk('barricade', 'obstacle_barricade', bc[0] / 2, bc[2] / 2));
    for (let i = 0; i < 18; i++) this.barrels.push(mk('barrel', 'obstacle_barrel', br[0] / 2, br[2] / 2));
    const cc = assets.config('obstacle_cone').collider ?? [0.6, 0.9, 0.6];
    for (let i = 0; i < 44; i++) this.cones.push(mk('cone', 'obstacle_cone', cc[0] / 2, cc[2] / 2));
    this.blockers = [...this.barricades, ...this.barrels, ...this.cones];
    const rc = assets.config('obstacle_roller').collider ?? [2.6, 3.1, 5.2];
    for (let i = 0; i < 4; i++) this.rollers.push(mk('roller', 'obstacle_roller', rc[0] / 2, rc[2] / 2));
    for (let i = 0; i < 24; i++) {
      const obj = buildPothole();
      obj.visible = false;
      this.root.add(obj);
      this.potholes.push({ kind: 'pothole', obj, active: false, dist: 0, lat: 0, halfW: 1.25, halfL: 1.1, hp: 1, broken: 0, passed: false, fuse: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3(), pos: new THREE.Vector3(), body: null });
    }
    for (let i = 0; i < 3; i++) {
      const gantry = buildCraneGantry(ROAD.cityWall);
      const big = buildCraneLoad(11);
      const small: [THREE.Group, THREE.Group] = [buildCraneLoad(6), buildCraneLoad(6)];
      for (const o of [gantry, big, ...small]) {
        o.visible = false;
        this.root.add(o);
      }
      this.gates.push({ active: false, dist: 0, pattern: 'single', t: 0, omega: 1.5, phase: 0, hitCd: 0, warned: false, gantry, big, small, pos: new THREE.Vector3() });
    }
    for (let i = 0; i < 8; i++) {
      const h = mk('ramp', 'obstacle_ramp', 2, 3);
      h.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -60, 0));
      const hull = RAPIER.ColliderDesc.convexHull(rampHullPoints());
      if (hull) physics.world.createCollider(hull.setFriction(0), h.body);
      this.ramps.push(h);
    }
    for (let i = 0; i < 28; i++) this.cash.push(this.mkPickup('cash', assets.instantiate('pickup_cash'), null));
    const ringGeo = new THREE.TorusGeometry(1.1, 0.07, 4, 24).rotateX(Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const kind = (['powerup_wrench', 'powerup_nitro', 'powerup_magnet'] as PowerupId[])[i % 3];
      const ring = new THREE.Mesh(ringGeo, glowMat(POWERUPS[kind].color));
      this.powerups.push(this.mkPickup(kind, assets.instantiate(kind), ring));
    }
  }

  private mkPickup(kind: Pickup['kind'], obj: THREE.Group, ring: THREE.Mesh | null): Pickup {
    obj.visible = false;
    this.root.add(obj);
    if (ring) {
      ring.visible = false;
      this.root.add(ring);
    }
    return { kind, obj, active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), dist: 0, value: 0, life: 0, airborne: false, baseY: 0.6, ring };
  }

  /** Ramp collider handles (so the car's suspension rays know when it's launching). */
  rampHandles(): number[] {
    const out: number[] = [];
    for (const r of this.ramps) {
      if (!r.body) continue;
      for (let i = 0; i < r.body.numColliders(); i++) out.push(r.body.collider(i).handle);
    }
    return out;
  }

  reset(): void {
    for (const h of [...this.barricades, ...this.barrels, ...this.ramps, ...this.cones, ...this.rollers, ...this.potholes]) this.deactivate(h);
    for (const g of this.gates) this.hideGate(g);
    for (const p of [...this.cash, ...this.powerups]) this.hidePickup(p);
  }

  private deactivate(h: Hazard): void {
    h.active = false;
    h.obj.visible = false;
    h.broken = 0;
    h.fuse = 0;
    if (h.body) h.body.setTranslation({ x: 0, y: -60, z: 0 }, false);
  }

  private hidePickup(p: Pickup): void {
    p.active = false;
    p.obj.visible = false;
    if (p.ring) p.ring.visible = false;
  }

  private placeHazard(list: Hazard[], dist: number, lat: number): Hazard | null {
    const h = list.find((x) => !x.active);
    if (!h) return null;
    h.active = true;
    h.dist = dist;
    h.lat = lat;
    h.hp = 10;
    h.broken = 0;
    h.fuse = 0;
    h.passed = false;
    const heading = this.track.sample(dist, lat, h.pos);
    h.pos.y = 0;
    h.obj.position.copy(h.pos);
    h.obj.rotation.set(0, heading, 0);
    h.obj.visible = true;
    if (h.body) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
      h.body.setTranslation({ x: h.pos.x, y: 0, z: h.pos.z }, true);
      h.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    }
    return h;
  }

  private placeCash(dist: number, lat: number, y = 0.6): void {
    const p = this.cash.find((x) => !x.active);
    if (!p) return;
    p.active = true;
    p.dist = dist;
    p.value = PICKUP_CASH_VALUE;
    p.life = 999;
    p.airborne = false;
    p.baseY = y;
    this.track.sample(dist, lat, p.pos);
    p.pos.y = y;
    p.obj.position.copy(p.pos);
    p.obj.visible = true;
  }

  private placePowerup(dist: number, lat: number, heat: number): void {
    const weights: PowerupId[] = heat >= 3
      ? ['powerup_wrench', 'powerup_wrench', 'powerup_wrench', 'powerup_nitro', 'powerup_magnet']
      : heat === 2 ? ['powerup_wrench', 'powerup_wrench', 'powerup_nitro', 'powerup_magnet'] : ['powerup_wrench', 'powerup_nitro', 'powerup_magnet'];
    const want = pick(weights);
    const p = this.powerups.find((x) => !x.active && x.kind === want) ?? this.powerups.find((x) => !x.active);
    if (!p) return;
    p.active = true;
    p.dist = dist;
    p.life = 999;
    p.baseY = 1.3;
    this.track.sample(dist, lat, p.pos);
    p.pos.y = 1.3;
    p.obj.position.copy(p.pos);
    p.obj.visible = true;
    if (p.ring) {
      p.ring.visible = true;
      p.ring.position.copy(p.pos).y = 0.25;
    }
  }

  private barricadeRow(dist: number, wall: number): void {
    const half = ROAD.halfWidth;
    const gapCenter = pick([-6.5, -3.5, 0, 3.5, 6.5]);
    const gapHalf = 3.0;
    const w = this.barricades[0].halfW * 2;
    for (let x = -half + w / 2; x - w / 2 < gapCenter - gapHalf; x += w) {
      this.placeHazard(this.barricades, dist, Math.min(x, gapCenter - gapHalf - w / 2));
    }
    for (let x = half - w / 2; x + w / 2 > gapCenter + gapHalf; x -= w) {
      this.placeHazard(this.barricades, dist, Math.max(x, gapCenter + gapHalf + w / 2));
    }
    // A pair of explosive barrels flanking the gap for chain reactions
    if (chance(0.7)) {
      this.placeHazard(this.barrels, dist + 1.4, clamp(gapCenter - gapHalf - 0.7, -wall + 1, wall - 1));
      this.placeHazard(this.barrels, dist + 1.4, clamp(gapCenter + gapHalf + 0.7, -wall + 1, wall - 1));
    }
  }

  /** Populates a freshly recycled road chunk with hazards & pickups for the current heat. */
  populate(c: Chunk, safe: boolean): void {
    // Road rollers trundle toward the player in a random lane (any chunk, including curves).
    if (!safe && this.rollersEnabled && c.startDist > 350 && Math.random() < 0.25) {
      const r = this.placeHazard(this.rollers, c.startDist + rand(10, 40), pick(ROAD.lanes));
      if (r) r.obj.rotation.y += Math.PI;
    }
    if (!safe && this.cranesEnabled && c.startDist > 250 && Math.random() < 0.42 && this.placeGate(c.startDist + 25)) {
      // A crane gets the chunk to itself so nothing else can plug its gaps.
      return;
    }
    if (!safe && this.potholesEnabled && c.startDist > 150) {
      const n = 1 + Math.floor(Math.random() * 3);
      const lanes = [...ROAD.lanes].sort(() => Math.random() - 0.5);
      for (let i = 0; i < n; i++) {
        const h = this.placeHazard(this.potholes, c.startDist + 6 + i * 14 + rand(0, 6), lanes[i] + rand(-1, 1));
        if (h) h.obj.rotation.y += rand(0, Math.PI);
      }
    }
    if (safe) {
      if (c.index >= 2) for (let i = 0; i < 4; i++) this.placeCash(c.startDist + 15 + i * 5, 2.5);
      return;
    }
    const heat = this.heat;
    if (!heat) return;
    const s0 = c.startDist;
    const straight = c.turn === 0;
    const lane = pick(ROAD.lanes);
    const r = Math.random();
    if (straight && r >= 0.34 && r < 0.46) {
      this.chicane(s0);
      return;
    }
    if (straight && heat.ramps && r < 0.34) {
      // Jump ramps (often a pair) with a cash arc in the air; later heats park a roadblock behind them.
      const lanes = chance(0.4) ? [lane, ROAD.lanes[(ROAD.lanes.indexOf(lane) + 2) % 4]] : [lane];
      for (const l of lanes) {
        this.placeHazard(this.ramps, s0 + 8, l);
        for (let i = 0; i < 4; i++) this.placeCash(s0 + 18 + i * 5, l, 2.4 + Math.sin((i / 3) * Math.PI) * 1.4);
      }
      if (heat.barricades && chance(0.6)) this.barricadeRow(s0 + 30, c.wall);
      else if (heat.barrels && chance(0.5)) for (let i = 0; i < 3; i++) this.placeHazard(this.barrels, s0 + 27, lane + (i - 1) * 1.0);
      return;
    }
    if (r < 0.5 || !straight) {
      const l = pick(ROAD.lanes);
      for (let i = 0; i < 5; i++) this.placeCash(s0 + 10 + i * 5, l);
      if (!straight && chance(0.25)) this.placePowerup(s0 + 40, pick(ROAD.lanes), heat.level);
      return;
    }
    if (r < 0.64 && heat.barrels) {
      const baseLat = pick([-6, -2, 2, 6]);
      const n = 3 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) this.placeHazard(this.barrels, s0 + 22 + rand(-1.5, 1.5), baseLat + (i - n / 2) * 1.0);
      this.placeCash(s0 + 36, -baseLat * 0.5);
      return;
    }
    if (r < 0.72 && heat.ramps) {
      this.placeHazard(this.ramps, s0 + 8, lane);
      for (let i = 0; i < 4; i++) this.placeCash(s0 + 18 + i * 5, lane, 2.4 + Math.sin((i / 3) * Math.PI) * 1.4);
      if (heat.barricades) this.barricadeRow(s0 + 30, c.wall);
      else if (heat.barrels) for (let i = 0; i < 3; i++) this.placeHazard(this.barrels, s0 + 26, lane + (i - 1) * 1.0);
      return;
    }
    if (r < 0.84 && heat.barricades) {
      this.barricadeRow(s0 + 25, c.wall);
      return;
    }
    if (r < 0.94) {
      this.placePowerup(s0 + 25, lane, heat.level);
      return;
    }
    for (let i = 0; i < 5; i++) this.placeCash(s0 + 8 + i * 6, ROAD.lanes[i % 4]);
  }

  /**
   * Construction zone: cones close the left two lanes, then the right two, forcing an S-weave.
   * A barricade inside each closure marks the road works.
   */
  private chicane(s0: number): void {
    const first = Math.random() < 0.5 ? -1 : 1;
    const closure = (side: number, sStart: number): void => {
      const outer = side * 9.6;
      const inner = side * 0.4;
      const taper = 6;
      const len = 10;
      for (let s = 0; s <= taper; s += 2) this.placeHazard(this.cones, s0 + sStart + s, outer + (inner - outer) * (s / taper));
      for (let s = taper + 2.2; s <= taper + len; s += 2.2) this.placeHazard(this.cones, s0 + sStart + s, inner);
      for (let s = 0; s <= 4; s += 2) this.placeHazard(this.cones, s0 + sStart + taper + len + 2 + s, inner + (outer - inner) * (s / 4));
      this.placeHazard(this.barricades, s0 + sStart + 9, side * 5);
    };
    closure(first, 4);
    closure(-first, 27);
    this.placeCash(s0 + 22, -first * 2.5);
    this.placeCash(s0 + 45, first * 2.5);
  }

  private placeGate(dist: number): boolean {
    const g = this.gates.find((x) => !x.active);
    if (!g) return false;
    const lvl = this.heat?.level ?? 1;
    g.active = true;
    g.dist = dist;
    g.pattern = pick<GatePattern>(['single', 'pair', 'scissor']);
    g.t = 0;
    g.omega = rand(1.25, 1.75) * (1 + 0.07 * (lvl - 1));
    g.phase = rand(0, Math.PI * 2);
    g.hitCd = 0;
    g.warned = false;
    g.gantry.visible = true;
    g.big.visible = g.pattern === 'single';
    for (const o of g.small) o.visible = g.pattern !== 'single';
    return true;
  }

  private hideGate(g: CraneGate): void {
    g.active = false;
    g.gantry.visible = false;
    g.big.visible = false;
    for (const o of g.small) o.visible = false;
  }

  /** Free intervals across the road for a gate `ahead` seconds from now. */
  gateGaps(g: CraneGate, ahead: number): [number, number][] {
    const t0 = g.t;
    g.t += ahead;
    const n = loadsAt(g, this.loadTmp);
    g.t = t0;
    const loads = this.loadTmp.slice(0, n).map(([c, hw]) => [c - hw, c + hw] as [number, number]).sort((a, b) => a[0] - b[0]);
    const gaps: [number, number][] = [];
    let cursor = -GATE_SPAN;
    for (const [a, b] of loads) {
      if (a > cursor) gaps.push([cursor, a]);
      cursor = Math.max(cursor, b);
    }
    if (cursor < GATE_SPAN) gaps.push([cursor, GATE_SPAN]);
    return gaps;
  }

  /** Steering target inside the widest reachable gap, or null when already safely inside one. */
  private gateGapTarget(g: CraneGate, lat: number, ahead: number): number | null {
    const gaps = this.gateGaps(g, ahead).filter(([a, b]) => b - a > 3.4);
    if (!gaps.length) return null;
    let best = gaps[0];
    let bestScore = Infinity;
    for (const gp of gaps) {
      const mid = (gp[0] + gp[1]) / 2;
      const score = Math.abs(mid - lat) - (gp[1] - gp[0]) * 0.6;
      if (score < bestScore) {
        bestScore = score;
        best = gp;
      }
    }
    return (best[0] + best[1]) / 2;
  }

  /** Read-only view of active crane gates for tooling (gap verification). */
  get gateList(): readonly CraneGate[] {
    return this.gates;
  }

  /**
   * Forest crane gates: hanging trees slide across the road on a gantry. A tree hit costs a big
   * chunk of HP and most of your speed; chasers and traffic get swatted aside.
   */
  private updateGates(dt: number, ctx: GameCtx): void {
    const p = ctx.player;
    for (const g of this.gates) {
      if (!g.active) continue;
      if (g.dist < p.dist - 50 || g.dist < this.track.backDist + 2) {
        this.hideGate(g);
        continue;
      }
      const prevS = Math.sin(g.t * g.omega + g.phase);
      g.t += dt;
      g.hitCd = Math.max(0, g.hitCd - dt);
      const heading = this.track.sample(g.dist, 0, g.pos);
      g.gantry.position.set(g.pos.x, 0, g.pos.z);
      g.gantry.rotation.set(0, heading, 0);
      const lamps = g.gantry.getObjectByName('lamps');
      if (lamps) lamps.visible = Math.sin(g.t * 8) > 0;
      const n = loadsAt(g, this.loadTmp);
      const sway = (Math.sin(g.t * g.omega + g.phase) - prevS) / Math.max(dt, 1e-4);
      const objs = g.pattern === 'single' ? [g.big] : g.small;
      for (let i = 0; i < n; i++) {
        const [c, hw] = this.loadTmp[i];
        const o = objs[i];
        this.track.sample(g.dist, c, this.gateTmp);
        o.position.set(this.gateTmp.x, 0, this.gateTmp.z);
        o.rotation.set(0, heading, 0);
        const swing = o.getObjectByName('swing');
        const dir = g.pattern === 'scissor' && i === 0 ? 1 : g.pattern === 'scissor' ? -1 : 1;
        if (swing) swing.rotation.z = damp(swing.rotation.z, -sway * dir * 0.05, 4, dt);
        // Player
        if (!p.dead && g.hitCd <= 0 && p.renderPos.y < 3.6 && Math.abs(g.dist - p.dist) < LOAD_HALF_T + p.halfLength * 0.85 && Math.abs(c - p.lat) < hw + p.halfWidth - 0.25) {
          g.hitCd = 1.4;
          ctx.damagePlayer(40, 0.9);
          ctx.feedback('large', this.gateTmp.clone().setY(1.8));
          p.vF *= 0.35;
          const lv = p.body.linvel();
          p.body.setLinvel({ x: lv.x * 0.35, y: lv.y, z: lv.z * 0.35 }, true);
          for (let k = 0; k < 10; k++) ctx.fx.puff(p.renderPos.clone().setY(1.8), new THREE.Vector3(rand(-4, 4), rand(1, 4), rand(-4, 4)), 0.5, 0.9, k % 2 ? 0x3d7340 : 0x6e4b2c);
          ctx.toast('TIMBER! −40 HP', 'warn');
          audio.hit();
        }
        // Chasers
        for (const e of ctx.enemies.list) {
          if (e.alive && Math.abs(g.dist - e.dist) < LOAD_HALF_T + e.def.halfL && Math.abs(c - e.lat) < hw + e.def.halfW) ctx.enemies.damage(e, 260 * dt, ctx);
        }
        // Traffic gets swatted out of the way so it can never plug a gap
        for (const cv of ctx.ambient.civList) {
          if (cv.active && cv.smashed <= 0 && Math.abs(g.dist - cv.dist) < LOAD_HALF_T + 2.2 && Math.abs(c - cv.lat) < hw + 1.0) {
            this.track.sample(cv.dist, cv.lat, this.gateTmp);
            ctx.ambient.blast(this.gateTmp, 1.5);
          }
        }
      }
      const ahead = g.dist - p.dist;
      if (!g.warned && ahead > 0 && ahead < 130 && !p.dead) {
        g.warned = true;
        ctx.toast('⚠ CRANE AHEAD — FIND THE GAP!', 'warn');
        audio.warning();
      }
    }
  }

  /** Potholes jolt the car: damage, lost speed and a hop. Jump over them to stay clean. */
  private updatePotholes(ctx: GameCtx, playerLow: boolean): void {
    const p = ctx.player;
    for (const h of this.potholes) {
      if (!h.active) continue;
      if (h.dist < p.dist - 40) {
        this.deactivate(h);
        continue;
      }
      if (h.passed || p.dead || !playerLow) continue;
      if (Math.abs(h.dist - p.dist) < h.halfL + p.halfLength * 0.6 && Math.abs(h.lat - p.lat) < h.halfW + p.halfWidth - 0.35) {
        h.passed = true;
        ctx.damagePlayer(7, 0.4);
        p.vF *= 0.72;
        const lv = p.body.linvel();
        p.body.setLinvel({ x: lv.x * 0.72, y: Math.max(lv.y, 0) + 3, z: lv.z * 0.72 }, true);
        ctx.fx.puff(p.renderPos.clone().setY(0.3), new THREE.Vector3(0, 1.5, 0), 0.6, 0.6, 0x55524c);
        ctx.toast('POTHOLE! −7 HP');
        audio.hop();
      }
    }
  }

  /**
   * Road rollers drive toward the player at walking pace with a spinning drum and a blinking
   * beacon. Touching one (unless airborne over it) flattens the car — instant game over.
   * Chasers that hit one are flattened too.
   */
  private updateRollers(dt: number, ctx: GameCtx, playerLow: boolean): void {
    const p = ctx.player;
    this.rollerT += dt;
    for (const h of this.rollers) {
      if (!h.active) continue;
      if (h.dist < p.dist - 40 || h.dist < this.track.backDist + 2) {
        this.deactivate(h);
        continue;
      }
      if (!p.dead) h.dist -= 3.2 * dt;
      const heading = this.track.sample(h.dist, h.lat, h.pos);
      h.pos.y = 0;
      h.obj.position.copy(h.pos);
      h.obj.rotation.set(0, heading + Math.PI, 0);
      const drum = h.obj.getObjectByName('drum');
      if (drum && !p.dead) drum.rotation.x -= (3.2 / 0.85) * dt;
      const beacon = h.obj.getObjectByName('beacon');
      if (beacon) beacon.visible = Math.sin(this.rollerT * 9 + h.dist) > -0.2;
      const ahead = h.dist - p.dist;
      if (h.passed === false && ahead > 0 && ahead < 110 && !p.dead) {
        h.passed = true;
        ctx.toast('⚠ ROAD ROLLER AHEAD!', 'warn');
        audio.warning();
      }
      if (!p.dead && playerLow && Math.abs(h.dist - p.dist) < h.halfL + p.halfLength * 0.8 && Math.abs(h.lat - p.lat) < h.halfW + p.halfWidth - 0.35) {
        ctx.squashPlayer();
      }
      for (const e of ctx.enemies.list) {
        if (e.alive && Math.abs(h.dist - e.dist) < h.halfL + e.def.halfL && Math.abs(h.lat - e.lat) < h.halfW + e.def.halfW) ctx.enemies.kill(e, ctx);
      }
    }
  }

  /** Steering hint for AI: returns a lateral target that avoids blockers ahead, or null. */
  avoidLat(dist: number, lat: number, look: number): number | null {
    // Crane gates: aim for the gap that will be open when we arrive (~31 m/s).
    for (const g of this.gates) {
      if (!g.active) continue;
      const dd = g.dist - dist;
      if (dd < -LOAD_HALF_T - 2 || dd > look + 45) continue;
      const target = this.gateGapTarget(g, lat, Math.max(0, dd) / 31);
      if (target !== null) return target;
    }
    for (const h of this.rollers) {
      if (!h.active) continue;
      const dd = h.dist - dist;
      // Rollers are slow and huge: plan the dodge early, always toward the side with more road.
      if (dd > -h.halfL && dd < look + 50 && Math.abs(h.lat - lat) < h.halfW + 3.4) return h.lat + (h.lat > 0 ? -1 : 1) * (h.halfW + 3.2);
    }
    // Barricade rows: steer for the actual gap instead of dodging one piece into its neighbour.
    let rowDist = Infinity;
    for (const h of this.barricades) {
      if (!h.active || h.broken > 0) continue;
      const dd = h.dist - dist;
      if (dd > 0 && dd < look && h.dist < rowDist) rowDist = h.dist;
    }
    if (rowDist < Infinity) {
      const covered: [number, number][] = [];
      for (const h of this.barricades) {
        if (h.active && h.broken === 0 && Math.abs(h.dist - rowDist) < 2.5) covered.push([h.lat - h.halfW - 1.1, h.lat + h.halfW + 1.1]);
      }
      const blocked = covered.some(([a, b]) => lat > a && lat < b);
      if (blocked) {
        covered.sort((x, y) => x[0] - y[0]);
        const half = ROAD.halfWidth;
        const gaps: number[] = [];
        let cursor = -half;
        for (const [a, b] of covered) {
          if (a - cursor > 0.4) gaps.push((cursor + a) / 2);
          cursor = Math.max(cursor, b);
        }
        if (half - cursor > 0.4) gaps.push((cursor + half) / 2);
        if (gaps.length) return gaps.reduce((best, g) => (Math.abs(g - lat) < Math.abs(best - lat) ? g : best));
      }
    }
    for (const h of this.potholes) {
      if (!h.active || h.passed) continue;
      const dd = h.dist - dist;
      if (dd > 0 && dd < look && Math.abs(h.lat - lat) < h.halfW + 1.3) return h.lat + (h.lat > lat ? -1 : 1) * (h.halfW + 1.8);
    }
    for (const h of this.cones) {
      if (!h.active || h.broken > 0) continue;
      const dd = h.dist - dist;
      if (dd > 0 && dd < look && Math.abs(h.lat - lat) < 1.6) return h.lat + (h.lat > lat ? -2.4 : 2.4);
    }
    for (const h of this.barricades) {
      if (!h.active || h.broken > 0) continue;
      const dd = h.dist - dist;
      if (dd > 0 && dd < look && Math.abs(h.lat - lat) < h.halfW + 1.4) {
        const gapSide = h.lat > lat ? -1 : 1;
        return h.lat + gapSide * (h.halfW + 2.2);
      }
    }
    for (const h of this.barrels) {
      if (!h.active || h.broken > 0) continue;
      const dd = h.dist - dist;
      if (dd > 0 && dd < look * 0.7 && Math.abs(h.lat - lat) < 1.8) return h.lat + (h.lat > lat ? -2.5 : 2.5);
    }
    for (const h of this.ramps) {
      if (!h.active) continue;
      const dd = h.dist - dist;
      if (dd > -h.halfL && dd < look && Math.abs(h.lat - lat) < h.halfW + 1.4) return h.lat + (h.lat > lat ? -1 : 1) * (h.halfW + 2.4);
    }
    return null;
  }

  /** Live barrels the roof gun may target. */
  *targetableBarrels(): Generator<Hazard> {
    for (const b of this.barrels) if (b.active && b.broken === 0 && b.fuse === 0) yield b;
  }

  shootBarrel(b: Hazard, dmg: number, ctx: GameCtx): void {
    if (!b.active || b.broken > 0 || b.fuse > 0) return;
    b.hp -= dmg;
    if (b.hp <= 0) this.igniteBarrel(b, 0.01);
    else ctx.fx.sparkBurst(this.tmp.copy(b.pos).setY(0.8), null, 4, 0xffd060, 5, 1, 0.3, 0.2);
  }

  igniteBarrel(b: Hazard, delay: number): void {
    if (!b.active || b.broken > 0 || b.fuse > 0) return;
    b.fuse = delay;
  }

  /** Called by explosions so barrels within range chain-detonate. */
  chainBarrels(pos: THREE.Vector3, radius: number): void {
    for (const b of this.barrels) {
      if (!b.active || b.broken > 0 || b.fuse > 0) continue;
      if (b.pos.distanceTo(pos) < radius) this.igniteBarrel(b, rand(0.12, 0.25));
    }
  }

  /** Breaks a barricade / barrel visually: flies off with spin then hides. */
  private smash(h: Hazard, push: THREE.Vector3): void {
    h.broken = 1.2;
    h.vel.copy(push).add(new THREE.Vector3(rand(-3, 3), rand(6, 10), rand(-3, 3)));
    h.spin.set(rand(-8, 8), rand(-8, 8), rand(-8, 8));
  }

  spawnCashBurst(pos: THREE.Vector3, total: number, dist: number): void {
    const stacks = Math.max(1, Math.min(6, Math.round(total / 50)));
    const each = Math.round(total / stacks);
    for (let i = 0; i < stacks; i++) {
      const p = this.cash.find((x) => !x.active);
      if (!p) return;
      p.active = true;
      p.value = each;
      p.dist = dist;
      p.life = 20;
      p.airborne = true;
      p.baseY = 0.6;
      p.pos.copy(pos).setY(Math.max(1, pos.y));
      p.vel.set(rand(-5, 5), rand(6, 11), rand(-5, 5));
      p.obj.position.copy(p.pos);
      p.obj.visible = true;
    }
  }

  update(dt: number, ctx: GameCtx): void {
    const p = ctx.player;
    const playerLow = p.renderPos.y - 0.72 < 1.0;
    this.nearMissCd = Math.max(0, this.nearMissCd - dt);
    const t = performance.now() * 0.001;

    for (const h of this.blockers) {
      if (!h.active) continue;
      if (h.broken > 0) {
        h.broken -= dt;
        h.vel.y -= 25 * dt;
        h.obj.position.addScaledVector(h.vel, dt);
        h.obj.rotation.x += h.spin.x * dt;
        h.obj.rotation.y += h.spin.y * dt;
        h.obj.rotation.z += h.spin.z * dt;
        if (h.broken <= 0 || h.obj.position.y < -3) this.deactivate(h);
        continue;
      }
      if (h.dist < p.dist - 40) {
        this.deactivate(h);
        continue;
      }
      if (h.kind === 'cone') {
        // Traffic & chasers clip cones too
        for (const c of ctx.ambient.civList) {
          if (!c.active || c.smashed > 0) continue;
          if (Math.abs(c.dist - h.dist) < 2.2 && Math.abs(c.lat - h.lat) < 1.2) {
            this.smash(h, new THREE.Vector3(0, 0, 0));
            break;
          }
        }
        if (h.broken > 0) continue;
      }
      if (h.kind === 'barrel' && h.fuse > 0) {
        h.fuse -= dt;
        if (h.fuse <= 0) {
          h.fuse = 0;
          h.broken = 0.01;
          h.obj.visible = false;
          this.tmp.copy(h.pos).setY(0.6);
          ctx.combat.explode(this.tmp, 10, 120, 25, 6, true);
          ctx.reportEvent('barrel');
          audio.explosion(true);
        }
        continue;
      }
      // Player collision (track-space AABB, cleared if airborne over it)
      const dd = h.dist - p.dist;
      const dl = h.lat - p.lat;
      if (playerLow && !p.dead && Math.abs(dd) < h.halfL + p.halfLength * 0.9 && Math.abs(dl) < h.halfW + p.halfWidth - 0.15) {
        const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw)).multiplyScalar(p.vF * 0.6);
        if (h.kind === 'cone') {
          this.smash(h, fwd.multiplyScalar(0.7));
          p.vF *= 0.97;
          if (Math.random() < 0.5) audio.scrape();
        } else if (h.kind === 'barricade') {
          audio.hit();
          this.smash(h, fwd);
          ctx.fx.sparkBurst(this.tmp.copy(h.pos).setY(0.8), null, 12, 0xffb040, 10, 1, 0.5, 0.35);
          ctx.fx.puff(this.tmp, new THREE.Vector3(0, 2, 0), 0.8, 0.8, 0xe0d0b0);
          if (p.stats.dozer || p.ramming) {
            ctx.shake(0.15);
          } else {
            ctx.damagePlayer(20, 0.5);
            p.vF *= 0.55;
            const lv = p.body.linvel();
            p.body.setLinvel({ x: lv.x * 0.55, y: lv.y, z: lv.z * 0.55 }, true);
          }
        } else {
          this.igniteBarrel(h, 0.01);
        }
        h.passed = true;
        continue;
      }
      // Enemy collisions
      for (const e of ctx.enemies.list) {
        if (!e.alive) continue;
        if (Math.abs(h.dist - e.dist) < h.halfL + e.def.halfL && Math.abs(h.lat - e.lat) < h.halfW + e.def.halfW) {
          if (h.kind === 'cone') {
            this.smash(h, new THREE.Vector3(0, 0, 0));
          } else if (h.kind === 'barricade') {
            this.smash(h, new THREE.Vector3(0, 0, 0));
            ctx.enemies.damage(e, 25, ctx);
            e.speed *= 0.5;
          } else {
            this.igniteBarrel(h, 0.01);
          }
          break;
        }
      }
      // Near-miss bonus
      if (h.kind !== 'cone' && !h.passed && dd < -h.halfL - p.halfLength) {
        h.passed = true;
        if (Math.abs(dl) < h.halfW + p.halfWidth + NEAR_MISS_PAD && this.nearMissCd <= 0 && !p.dead) {
          this.nearMissCd = 0.6;
          ctx.nearMiss();
        }
      }
    }
    this.updateRollers(dt, ctx, playerLow);
    this.updateGates(dt, ctx);
    this.updatePotholes(ctx, playerLow);
    for (const r of this.ramps) {
      if (r.active && r.dist < p.dist - 40) this.deactivate(r);
    }

    // Pickups
    const magnet = p.magnet > 0;
    for (const c of this.cash) {
      if (!c.active) continue;
      c.life -= dt;
      if (c.life <= 0 || c.dist < p.dist - 50) {
        this.hidePickup(c);
        continue;
      }
      if (c.airborne) {
        c.vel.y -= 22 * dt;
        c.pos.addScaledVector(c.vel, dt);
        if (c.pos.y <= c.baseY && c.vel.y < 0) {
          c.pos.y = c.baseY;
          c.airborne = false;
        }
      }
      const dx = p.renderPos.x - c.pos.x;
      const dz = p.renderPos.z - c.pos.z;
      const d2 = dx * dx + dz * dz;
      if (magnet && d2 < MAGNET_RADIUS * MAGNET_RADIUS) {
        this.tmp.set(dx, p.renderPos.y + 0.4 - c.pos.y, dz).normalize().multiplyScalar(38 * dt);
        c.pos.add(this.tmp);
        c.airborne = false;
      }
      const y = c.airborne ? c.pos.y : c.pos.y + Math.sin(t * 3 + c.dist) * 0.12;
      c.obj.position.set(c.pos.x, y, c.pos.z);
      c.obj.rotation.y += dt * 2.5;
      if (c.airborne) c.obj.rotation.x += dt * 6;
      else c.obj.rotation.x = 0;
      if (d2 < 2.6 * 2.6 && Math.abs(p.renderPos.y - c.pos.y) < 2.6 && !p.dead) {
        this.hidePickup(c);
        ctx.collectCash(c.value);
        ctx.fx.sparkBurst(c.obj.position, null, 6, 0x6dff7a, 5, 1, 0.35, 0.3);
        audio.pickup();
      }
    }
    for (const pu of this.powerups) {
      if (!pu.active) continue;
      if (pu.dist < p.dist - 40) {
        this.hidePickup(pu);
        continue;
      }
      pu.obj.position.set(pu.pos.x, pu.baseY + Math.sin(t * 2.5) * 0.25, pu.pos.z);
      pu.obj.rotation.y += dt * 2;
      if (pu.ring) {
        pu.ring.rotation.y -= dt;
        pu.ring.scale.setScalar(1 + Math.sin(t * 4) * 0.08);
      }
      const dx = p.renderPos.x - pu.pos.x;
      const dz = p.renderPos.z - pu.pos.z;
      if (dx * dx + dz * dz < 2.8 * 2.8 && !p.dead) {
        this.hidePickup(pu);
        ctx.applyPowerup(pu.kind as PowerupId);
        ctx.fx.sparkBurst(pu.pos, null, 18, POWERUPS[pu.kind as PowerupId].color, 9, 1, 0.5, 0.5);
        audio.powerup();
      }
    }
  }
}
