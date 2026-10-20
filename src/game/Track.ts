import * as THREE from 'three';
import { RAPIER, type PhysicsWorld } from '../core/Physics';
import { ROAD, type Biome } from '../data/config';
import { buildChunkTemplate, chunkTurn, CURVE_TURN, sampleLocal, type ChunkKind } from '../assets/procedural/environment';
import type { AssetRegistry } from '../assets/AssetRegistry';
import { chance, pick } from '../core/math';

const tmpLocal = { x: 0, z: 0, h: 0 };
/** Max deviation of the road heading from the run's start direction (allows 90° corners). */
const MAX_HEADING = Math.PI / 2;

export interface TrackPoint {
  dist: number;
  lat: number;
  heading: number;
  wall: number;
  chunk: Chunk;
}

/** One pooled 50m road segment. Holds pre-cloned visuals for every template and toggles one on. */
export class Chunk {
  kind: ChunkKind = 'straight';
  biome: Biome = 'city';
  startDist = 0;
  turn = 0;
  readonly L = ROAD.chunkLength;
  readonly p0 = new THREE.Vector3();
  h0 = 0;
  wall = ROAD.cityWall;
  readonly group = new THREE.Group();
  readonly visuals = new Map<string, THREE.Object3D>();
  colliders: RAPIER.Collider[] = [];
  index = 0;

  get endDist(): number {
    return this.startDist + this.L;
  }

  /** World position for (s within chunk, lateral offset); returns heading. */
  sample(s: number, lat: number, out: THREE.Vector3): number {
    sampleLocal(s, lat, this.turn, this.L, tmpLocal);
    const c = Math.cos(this.h0);
    const sn = Math.sin(this.h0);
    out.set(this.p0.x + tmpLocal.x * c + tmpLocal.z * sn, out.y, this.p0.z - tmpLocal.x * sn + tmpLocal.z * c);
    return this.h0 + tmpLocal.h;
  }

  /** Projects a world point into (s, lat) for this chunk. */
  project(p: THREE.Vector3, out: { s: number; lat: number }): void {
    const dx = p.x - this.p0.x;
    const dz = p.z - this.p0.z;
    const c = Math.cos(this.h0);
    const sn = Math.sin(this.h0);
    const lx = dx * c - dz * sn;
    const lz = dx * sn + dz * c;
    if (this.turn === 0) {
      out.s = -lz;
      out.lat = lx;
      return;
    }
    const k = this.turn / this.L;
    const a = lx * k + 1;
    const b = -lz * k;
    const h = Math.atan2(b, a);
    out.s = h / k;
    out.lat = (Math.sqrt(a * a + b * b) - 1) / k;
  }
}

/** Endless road made of a ring of 10 recycled chunks with 45° curves and biome switching. */
export class Track {
  readonly root = new THREE.Group();
  chunks: Chunk[] = [];
  private pool: Chunk[] = [];
  private templates = new Map<string, THREE.Object3D>();
  private templateKeys: Record<ChunkKind, string[]> = { straight: [], curveL: [], curveR: [], highway: [] };
  private wallBody: RAPIER.RigidBody;
  biome: Biome = 'city';
  onChunkPlaced: ((c: Chunk, safe: boolean) => void) | null = null;
  private placedCount = 0;
  private lastKind: ChunkKind = 'straight';
  private curveRun = 0;
  private tmpProj = { s: 0, lat: 0 };

  constructor(private physics: PhysicsWorld, assets: AssetRegistry) {
    this.root.name = 'track';
    this.wallBody = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.buildTemplates(assets);
    for (let i = 0; i < ROAD.chunkCount; i++) {
      const c = new Chunk();
      for (const [key, tpl] of this.templates) {
        const v = tpl.clone(true);
        v.visible = false;
        c.visuals.set(key, v);
        c.group.add(v);
      }
      this.root.add(c.group);
      this.pool.push(c);
    }
  }

  private buildTemplates(assets: AssetRegistry): void {
    const add = (kind: ChunkKind, key: string, obj: THREE.Object3D): void => {
      this.templates.set(key, obj);
      this.templateKeys[kind].push(key);
    };
    if (assets.hasModel('road_straight')) add('straight', 'straight_glb', assets.instantiate('road_straight'));
    else [11, 12, 13].forEach((seed) => add('straight', `straight_${seed}`, buildChunkTemplate('straight', seed)));
    if (assets.hasModel('road_curve')) {
      add('curveL', 'curveL_glb', assets.instantiate('road_curve'));
      const mirrored = assets.instantiate('road_curve');
      mirrored.scale.x = -1;
      add('curveR', 'curveR_glb', mirrored);
    } else {
      [21, 22].forEach((seed) => add('curveL', `curveL_${seed}`, buildChunkTemplate('curveL', seed)));
      [31, 32].forEach((seed) => add('curveR', `curveR_${seed}`, buildChunkTemplate('curveR', seed)));
    }
    if (assets.hasModel('road_highway')) add('highway', 'highway_glb', assets.instantiate('road_highway'));
    else [41, 42, 43].forEach((seed) => add('highway', `highway_${seed}`, buildChunkTemplate('highway', seed)));
  }

  reset(): void {
    for (const c of this.chunks) this.clearColliders(c);
    this.chunks = [];
    this.placedCount = 0;
    this.lastKind = 'straight';
    this.curveRun = 0;
    this.biome = 'city';
    let p0 = new THREE.Vector3(0, 0, ROAD.chunkLength * ROAD.chunksBehind);
    let h0 = 0;
    let startDist = -ROAD.chunkLength * ROAD.chunksBehind;
    for (let i = 0; i < this.pool.length; i++) {
      const c = this.pool[i];
      const kind: ChunkKind = i < 5 ? 'straight' : this.chooseKind(h0);
      this.place(c, kind, p0, h0, startDist, i < 5);
      const end = new THREE.Vector3();
      const h = c.sample(c.L, 0, end);
      p0 = end;
      h0 = h;
      startDist += c.L;
    }
  }

  private chooseKind(h: number): ChunkKind {
    if (this.biome === 'coastal') {
      this.lastKind = 'highway';
      return 'highway';
    }
    // Heading stays within ±90° of the start direction: back-to-back curves make 90° corners,
    // opposite curves make S-bends. Straights get rarer so the run reads like a street circuit.
    const eps = 0.01;
    const limit = MAX_HEADING + eps;
    const canL = h + CURVE_TURN <= limit;
    const canR = h - CURVE_TURN >= -limit;
    const last = this.lastKind;
    let kind: ChunkKind;
    if (this.curveRun >= 3 || ((last === 'curveL' || last === 'curveR') && chance(0.35))) kind = 'straight';
    else if (last === 'curveL' && canL && chance(0.4)) kind = 'curveL';
    else if (last === 'curveR' && canR && chance(0.4)) kind = 'curveR';
    else if (last === 'curveL' && canR && chance(0.45)) kind = 'curveR';
    else if (last === 'curveR' && canL && chance(0.45)) kind = 'curveL';
    else if (Math.abs(h) > MAX_HEADING - eps && chance(0.6)) kind = h > 0 ? 'curveR' : 'curveL';
    else if (chance(0.42)) kind = 'straight';
    else {
      const opts: ChunkKind[] = [];
      if (canL) opts.push('curveL');
      if (canR) opts.push('curveR');
      kind = opts.length ? pick(opts) : 'straight';
    }
    this.lastKind = kind;
    this.curveRun = kind === 'straight' ? 0 : this.curveRun + 1;
    return kind;
  }

  private place(c: Chunk, kind: ChunkKind, p0: THREE.Vector3, h0: number, startDist: number, safe: boolean): void {
    c.kind = kind;
    c.biome = kind === 'highway' ? 'coastal' : 'city';
    c.turn = chunkTurn(kind);
    c.p0.copy(p0);
    c.p0.y = 0;
    c.h0 = h0;
    c.startDist = startDist;
    c.wall = kind === 'highway' ? ROAD.coastalWall : ROAD.cityWall;
    c.index = this.placedCount++;
    c.group.position.copy(c.p0);
    c.group.rotation.set(0, h0, 0);
    const keys = this.templateKeys[kind];
    const chosen = keys[c.index % keys.length];
    for (const [key, v] of c.visuals) v.visible = key === chosen;
    this.buildColliders(c);
    this.chunks.push(c);
    this.onChunkPlaced?.(c, safe);
  }

  private clearColliders(c: Chunk): void {
    for (const col of c.colliders) this.physics.world.removeCollider(col, false);
    c.colliders = [];
  }

  private buildColliders(c: Chunk): void {
    this.clearColliders(c);
    const segs = c.turn === 0 ? 1 : 8;
    const ds = c.L / segs;
    const a = new THREE.Vector3();
    const q = new THREE.Quaternion();
    for (const side of [-1, 1]) {
      const lat = side * (c.wall + 0.5);
      for (let i = 0; i < segs; i++) {
        const h = c.sample((i + 0.5) * ds, lat, a);
        const len = ds * (1 + Math.abs(lat * (c.turn / c.L))) + 0.4;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h);
        const desc = RAPIER.ColliderDesc.cuboid(0.5, 2.5, len / 2)
          .setTranslation(a.x, 1.5, a.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setFriction(0)
          .setRestitution(0.1);
        c.colliders.push(this.physics.world.createCollider(desc, this.wallBody));
      }
    }
  }

  /** Recycles chunks that fell behind the player to the front of the road. */
  update(playerDist: number): void {
    while (this.chunks.length && playerDist - this.chunks[0].startDist > ROAD.chunkLength * (ROAD.chunksBehind + 1)) {
      const old = this.chunks.shift() as Chunk;
      this.clearColliders(old);
      const last = this.chunks[this.chunks.length - 1];
      const end = new THREE.Vector3();
      const h = last.sample(last.L, 0, end);
      this.place(old, this.chooseKind(h), end, h, last.endDist, false);
    }
  }

  get frontDist(): number {
    return this.chunks.length ? this.chunks[this.chunks.length - 1].endDist : 0;
  }

  get backDist(): number {
    return this.chunks.length ? this.chunks[0].startDist : 0;
  }

  chunkAt(dist: number): Chunk {
    const first = this.chunks[0];
    const idx = Math.floor((dist - first.startDist) / ROAD.chunkLength);
    return this.chunks[Math.max(0, Math.min(this.chunks.length - 1, idx))];
  }

  /** World position at track distance + lateral offset; returns heading (y untouched). */
  sample(dist: number, lat: number, out: THREE.Vector3): number {
    const c = this.chunkAt(dist);
    const s = Math.max(0, Math.min(c.L, dist - c.startDist));
    return c.sample(s, lat, out);
  }

  /** Projects a world position onto the track using a distance hint. */
  project(p: THREE.Vector3, hintDist: number, out: TrackPoint): TrackPoint {
    let c = this.chunkAt(hintDist);
    for (let iter = 0; iter < 4; iter++) {
      c.project(p, this.tmpProj);
      const idx = this.chunks.indexOf(c);
      if (this.tmpProj.s < 0 && idx > 0) c = this.chunks[idx - 1];
      else if (this.tmpProj.s > c.L && idx < this.chunks.length - 1) c = this.chunks[idx + 1];
      else break;
    }
    c.project(p, this.tmpProj);
    out.dist = c.startDist + this.tmpProj.s;
    out.lat = this.tmpProj.lat;
    out.heading = c.h0 + (c.turn / c.L) * Math.max(0, Math.min(c.L, this.tmpProj.s));
    out.wall = c.wall;
    out.chunk = c;
    return out;
  }

  headingAt(dist: number): number {
    const c = this.chunkAt(dist);
    const s = Math.max(0, Math.min(c.L, dist - c.startDist));
    return c.h0 + (c.turn / c.L) * s;
  }

  wallAt(dist: number): number {
    return this.chunkAt(dist).wall;
  }
}
