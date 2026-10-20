import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { socket, type V3 } from '../core/GeoBuilder';
import { DEG } from '../core/math';
import { CARS } from '../data/config';
import {
  buildSedan, buildTuner, buildTruck, buildBike, buildChopper, buildOilPuddle, buildMine, buildDozer, type WheelStyle,
} from './procedural/vehicles';
import {
  buildTommy, buildRocketPod, buildMissile, buildCash, buildWrench, buildNitro, buildMagnet, buildBarricade, buildBarrel, buildRamp, buildCone,
} from './procedural/items';
import { buildChunkTemplate, buildGarage } from './procedural/environment';
import { buildCivilian, buildPedestrian, TAXI_YELLOW } from './procedural/ambient';

export type Category = 'cars' | 'enemies' | 'weapons' | 'pickups' | 'environment';
export const CATEGORIES: Category[] = ['cars', 'enemies', 'weapons', 'pickups', 'environment'];

export interface AssetConfig {
  url: string | null;
  scale?: number;
  rotationY?: number;
  collider?: V3;
  sockets?: Record<string, V3>;
  length?: number;
  width?: number;
}

export type Manifest = Record<Category, Record<string, AssetConfig>>;

const carSockets = (roofY: number, roofZ: number, frontY: number, frontZ: number, wx: number, wy: number, wz: number): Record<string, V3> => ({
  socket_roof_weapon: [0, roofY, roofZ],
  socket_front_armor: [0, frontY, frontZ],
  wheel_FL: [-wx, wy, -wz],
  wheel_FR: [wx, wy, -wz],
  wheel_RL: [-wx, wy, wz],
  wheel_RR: [wx, wy, wz],
});

/** Built-in fallback manifest (identical to /public/assets/manifest.json) used if the fetch fails. */
export const DEFAULT_MANIFEST: Manifest = {
  cars: {
    car_sedan: { url: null, scale: 1, rotationY: 0, collider: [2.0, 0.8, 4.2], sockets: carSockets(1.62, 0.25, 0.45, -2.15, 0.86, 0.42, 1.3) },
    car_tuner: { url: null, scale: 1, rotationY: 0, collider: [2.0, 0.7, 4.3], sockets: carSockets(1.25, 0.15, 0.38, -2.2, 0.9, 0.36, 1.35) },
    car_truck: { url: null, scale: 1.2, rotationY: 0, collider: [2.4, 1.2, 5.0], sockets: carSockets(1.78, 0.1, 0.5, -2.15, 0.88, 0.48, 1.35) },
  },
  enemies: {
    enemy_bike: { url: null, scale: 1, rotationY: 0, collider: [0.8, 1.2, 2.2] },
    enemy_sedan: {
      url: null, scale: 1, rotationY: 0, collider: [2.0, 0.8, 4.2],
      sockets: { wheel_FL: [-0.86, 0.42, -1.3], wheel_FR: [0.86, 0.42, -1.3], wheel_RL: [-0.86, 0.42, 1.3], wheel_RR: [0.86, 0.42, 1.3] },
    },
    enemy_chopper: { url: null, scale: 1.5, rotationY: 0, collider: [3.0, 1.5, 6.0], sockets: { rotor_main: [0, 1.75, 0.1], rotor_tail: [0.22, 1.25, 4.15] } },
  },
  weapons: {
    weapon_tommy: { url: null, scale: 1, rotationY: 0, sockets: { muzzle_L: [-0.28, 0.27, -1.18], muzzle_R: [0.28, 0.27, -1.18] } },
    weapon_rocket: { url: null, scale: 1, rotationY: 0, sockets: { muzzle_center: [0, 0.42, -0.72] } },
    projectile_missile: { url: null, scale: 0.5, rotationY: 0 },
    gadget_mine: { url: null, scale: 0.8, rotationY: 0 },
    gadget_oil: { url: null, scale: 1, rotationY: 0 },
    upgrade_dozer: { url: null, scale: 1, rotationY: 0 },
  },
  pickups: {
    pickup_cash: { url: null, scale: 0.8, rotationY: 0 },
    powerup_wrench: { url: null, scale: 1, rotationY: 0 },
    powerup_nitro: { url: null, scale: 1, rotationY: 0 },
    powerup_magnet: { url: null, scale: 1, rotationY: 0 },
  },
  environment: {
    road_straight: { url: null, length: 50, width: 20 },
    road_curve: { url: null, length: 50, width: 20 },
    road_highway: { url: null, length: 50, width: 20 },
    obstacle_barricade: { url: null, scale: 1, rotationY: 0, collider: [3.5, 1.0, 0.8] },
    obstacle_barrel: { url: null, scale: 1, rotationY: 0, collider: [0.8, 1.2, 0.8] },
    obstacle_ramp: { url: null, scale: 1, rotationY: 0, collider: [4.0, 1.6, 6.0] },
    obstacle_cone: { url: null, scale: 1, rotationY: 0, collider: [0.6, 0.9, 0.6] },
    env_garage: { url: null, scale: 1, rotationY: 0, sockets: { turntable_center: [0, 0, 0] } },
    traffic_civilian: {
      url: null, scale: 1, rotationY: 0, collider: [2.0, 0.8, 4.2],
      sockets: { wheel_FL: [-0.86, 0.42, -1.3], wheel_FR: [0.86, 0.42, -1.3], wheel_RL: [-0.86, 0.42, 1.3], wheel_RR: [0.86, 0.42, 1.3] },
    },
    npc_pedestrian: { url: null, scale: 1, rotationY: 0 },
  },
};

/** Sockets each asset must expose (used by the admin inspector to list editable sockets). */
export const REQUIRED_SOCKETS: Record<string, string[]> = {
  car_sedan: ['socket_roof_weapon', 'socket_front_armor', 'wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'],
  car_tuner: ['socket_roof_weapon', 'socket_front_armor', 'wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'],
  car_truck: ['socket_roof_weapon', 'socket_front_armor', 'wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'],
  enemy_sedan: ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'],
  traffic_civilian: ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'],
  enemy_chopper: ['rotor_main', 'rotor_tail'],
  weapon_tommy: ['muzzle_L', 'muzzle_R'],
  weapon_rocket: ['muzzle_center'],
  env_garage: ['turntable_center'],
};

export interface InstantiateOpts {
  color?: number;
  /** Variation seed for procedural NPCs (pedestrian outfits). */
  seed?: number;
  wheelStyle?: WheelStyle;
}

function cloneManifest(m: Manifest): Manifest {
  return JSON.parse(JSON.stringify(m)) as Manifest;
}

/**
 * Loads /assets/manifest.json and any referenced .glb models. Every asset with a null URL (or a
 * failed download) falls back to a procedural low-poly builder, so the game boots with zero assets.
 */
export class AssetRegistry {
  manifest: Manifest = cloneManifest(DEFAULT_MANIFEST);
  private models = new Map<string, THREE.Object3D>();
  private loader = new GLTFLoader();
  readonly failed: string[] = [];

  async load(onProgress?: (done: number, total: number, label: string) => void): Promise<void> {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}assets/manifest.json`, { cache: 'no-cache' });
      if (res.ok) {
        const fetched = (await res.json()) as Partial<Manifest>;
        for (const cat of CATEGORIES) {
          this.manifest[cat] = { ...this.manifest[cat], ...(fetched[cat] ?? {}) };
        }
      }
    } catch (err) {
      console.warn('[assets] manifest.json unavailable, using built-in defaults', err);
    }
    const jobs: { id: string; url: string }[] = [];
    for (const cat of CATEGORIES) {
      for (const [id, cfg] of Object.entries(this.manifest[cat])) if (cfg.url) jobs.push({ id, url: cfg.url });
    }
    let done = 0;
    onProgress?.(0, jobs.length, 'manifest');
    await Promise.all(
      jobs.map(async ({ id, url }) => {
        try {
          const resolved = url.startsWith('/') ? `${import.meta.env.BASE_URL}${url.slice(1)}` : url;
          const gltf = await this.loader.loadAsync(resolved);
          this.prepareModel(gltf.scene);
          this.models.set(id, gltf.scene);
        } catch (err) {
          console.warn(`[assets] failed to load ${id} from ${url}; using procedural fallback`, err);
          this.failed.push(id);
        }
        done++;
        onProgress?.(done, jobs.length, id);
      }),
    );
  }

  /** Parses an in-memory GLB (admin drag & drop). */
  async parseGlb(buffer: ArrayBuffer): Promise<THREE.Object3D> {
    const gltf = await this.loader.parseAsync(buffer, '');
    this.prepareModel(gltf.scene);
    return gltf.scene;
  }

  private prepareModel(obj: THREE.Object3D): void {
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }

  categoryOf(id: string): Category | null {
    for (const cat of CATEGORIES) if (this.manifest[cat][id]) return cat;
    for (const cat of CATEGORIES) if (DEFAULT_MANIFEST[cat][id]) return cat;
    return null;
  }

  config(id: string): AssetConfig {
    const cat = this.categoryOf(id);
    if (!cat) return { url: null, scale: 1, rotationY: 0 };
    const def = DEFAULT_MANIFEST[cat][id];
    const cfg = this.manifest[cat][id] ?? def;
    return { ...def, ...cfg, sockets: { ...(def?.sockets ?? {}), ...(cfg.sockets ?? {}) } };
  }

  setConfig(id: string, cfg: AssetConfig): void {
    const cat = this.categoryOf(id);
    if (cat) this.manifest[cat][id] = cfg;
  }

  setModel(id: string, model: THREE.Object3D | null): void {
    if (model) this.models.set(id, model);
    else this.models.delete(id);
  }

  hasModel(id: string): boolean {
    return this.models.has(id);
  }

  allIds(): { id: string; category: Category }[] {
    const out: { id: string; category: Category }[] = [];
    for (const cat of CATEGORIES) for (const id of Object.keys(this.manifest[cat])) out.push({ id, category: cat });
    return out;
  }

  /**
   * Returns root → 'model' (scale/rotationY applied) → mesh + named sockets.
   * root.userData.collider holds the collider box in world units.
   */
  instantiate(id: string, opts: InstantiateOpts = {}): THREE.Group {
    const cfg = this.config(id);
    const root = new THREE.Group();
    root.name = id;
    const inner = new THREE.Group();
    inner.name = 'model';
    inner.scale.setScalar(cfg.scale ?? 1);
    inner.rotation.y = (cfg.rotationY ?? 0) * DEG;
    root.add(inner);
    const sockets = cfg.sockets ?? {};
    const model = this.models.get(id);
    if (model) {
      const clone = model.clone(true);
      inner.add(clone);
      clone.updateMatrixWorld(true);
      for (const [name, pos] of Object.entries(sockets)) {
        const node = clone.getObjectByName(name);
        if (node) {
          inner.attach(node);
          node.position.set(pos[0], pos[1], pos[2]);
          if (name.startsWith('wheel_')) {
            node.rotation.order = 'YXZ';
            node.userData.radius = pos[1];
          }
        } else {
          const s = socket(name, pos);
          if (name.startsWith('wheel_')) s.userData.radius = pos[1];
          inner.add(s);
        }
      }
    } else {
      inner.add(this.buildProcedural(id, sockets, opts));
    }
    root.userData.collider = cfg.collider ?? null;
    root.userData.assetId = id;
    return root;
  }

  private buildProcedural(id: string, sockets: Record<string, V3>, opts: InstantiateOpts): THREE.Object3D {
    switch (id) {
      case 'car_sedan':
        return buildSedan(sockets, { body: opts.color ?? CARS.car_sedan.color }, opts.wheelStyle ?? 'whitewall');
      case 'car_tuner':
        return buildTuner(sockets, opts.color ?? CARS.car_tuner.color, opts.wheelStyle ?? 'sport');
      case 'car_truck':
        return buildTruck(sockets, opts.color ?? CARS.car_truck.color, opts.wheelStyle ?? 'offroad');
      case 'enemy_sedan':
        return buildSedan(sockets, { body: 0x1b1c21, fender: 0x141519, glass: 0x0d1118, enemy: true }, 'whitewall');
      case 'enemy_bike':
        return buildBike();
      case 'enemy_chopper':
        return buildChopper(sockets);
      case 'weapon_tommy':
        return buildTommy(sockets);
      case 'weapon_rocket':
        return buildRocketPod(sockets);
      case 'projectile_missile':
        return buildMissile();
      case 'gadget_mine':
        return buildMine();
      case 'gadget_oil':
        return buildOilPuddle();
      case 'upgrade_dozer':
        return buildDozer();
      case 'pickup_cash':
        return buildCash();
      case 'powerup_wrench':
        return buildWrench();
      case 'powerup_nitro':
        return buildNitro();
      case 'powerup_magnet':
        return buildMagnet();
      case 'obstacle_barricade':
        return buildBarricade();
      case 'obstacle_barrel':
        return buildBarrel();
      case 'obstacle_ramp':
        return buildRamp();
      case 'obstacle_cone':
        return buildCone();
      case 'road_straight':
        return buildChunkTemplate('straight', 101);
      case 'road_curve':
        return buildChunkTemplate('curveL', 201);
      case 'road_highway':
        return buildChunkTemplate('highway', 301);
      case 'env_garage':
        return buildGarage();
      case 'traffic_civilian':
        return buildCivilian(sockets, opts.color ?? TAXI_YELLOW);
      case 'npc_pedestrian':
        return buildPedestrian(opts.seed ?? 1);
      default: {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xff00ff, flatShading: true })));
        return g;
      }
    }
  }
}

/** Helper: locate wheel parts (works for procedural socket→steer→spin and single-node GLB wheels). */
export function wheelParts(socketNode: THREE.Object3D): { steer: THREE.Object3D; spin: THREE.Object3D; radius: number } {
  const steer = socketNode.getObjectByName('steer') ?? socketNode;
  const spin = socketNode.getObjectByName('spin') ?? socketNode;
  return { steer, spin, radius: (socketNode.userData.radius as number | undefined) ?? 0.4 };
}
