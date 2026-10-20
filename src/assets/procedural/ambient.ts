import * as THREE from 'three';
import { GeoBuilder } from '../../core/GeoBuilder';
import { C } from '../../core/Palette';
import { buildSedan, type SocketMap } from './vehicles';

/** Civilian 1940s car; yellow ones get a taxi roof sign and checker band. */
export function buildCivilian(sockets: SocketMap, color: number): THREE.Group {
  const root = buildSedan(sockets, { body: color, glass: 0x2a3444 }, 'whitewall');
  if (color === TAXI_YELLOW) {
    const b = new GeoBuilder();
    b.box(0.62, 0.22, 0.3, C.black, [0, 1.74, 0.3]);
    b.box(0.56, 0.16, 0.32, 0xfff3c4, [0, 1.75, 0.3], { layer: 'glow' });
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 8; i++) {
        b.box(0.02, 0.1, 0.24, i % 2 ? C.black : C.stripeWhite, [sx * 0.722, 0.9, -0.85 + i * 0.24]);
      }
    }
    const extra = b.build();
    extra.name = 'taxi_parts';
    root.add(extra);
  }
  return root;
}

export const TAXI_YELLOW = 0xf2c230;
export const CIVILIAN_COLORS = [TAXI_YELLOW, TAXI_YELLOW, 0xe8dcc0, 0x4e7a5a, 0x3d5a80, 0x8a3b52, 0xd98c3a, 0x6d7f8c];

const SHIRTS = [0xd94f3d, 0x3d7dd9, 0xe8c547, 0x55a35a, 0xf2efe6, 0x8e5bb5, 0x2f3542, 0xd97a2b];
const PANTS = [0x2b2d42, 0x4a4e69, 0x5c4033, 0x1d3557, 0x3a3a3a];
const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
const HATS = [0x2b2b2b, 0x6b4f2a, 0x1d3557, 0x8a1c1c];

/**
 * Low-poly pedestrian (1.75 m) with separately animated legs/arms ('leg_L', 'leg_R', 'arm_L', 'arm_R').
 * Faces -Z like every other model.
 */
export function buildPedestrian(seed: number): THREE.Group {
  const pickC = (arr: number[], k: number): number => arr[Math.abs(Math.floor(seed * 9973 + k * 31)) % arr.length];
  const shirt = pickC(SHIRTS, 1);
  const pants = pickC(PANTS, 2);
  const skin = pickC(SKINS, 3);
  const root = new THREE.Group();
  const b = new GeoBuilder();
  b.box(0.44, 0.58, 0.26, shirt, [0, 1.18, 0]);
  b.box(0.42, 0.14, 0.25, pants, [0, 0.86, 0]);
  b.ico(0.15, skin, [0, 1.62, 0]);
  if (seed % 2 < 1) {
    b.cyl(0.22, 0.22, 0.03, 8, pickC(HATS, 4), [0, 1.74, 0]);
    b.cyl(0.13, 0.15, 0.13, 8, pickC(HATS, 4), [0, 1.81, 0]);
  } else {
    b.box(0.3, 0.12, 0.3, pickC([0x2b1d14, 0x5a3a1f, 0xd8b26a, 0x111111], 5), [0, 1.73, 0.02]);
  }
  const torso = b.build({ castShadow: true, receiveShadow: false });
  root.add(torso);
  const limb = (name: string, x: number, y: number, h: number, w: number, color: number, foot: number | null): void => {
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.set(x, y, 0);
    const lb = new GeoBuilder();
    lb.box(w, h, w, color, [0, -h / 2, 0]);
    if (foot !== null) lb.box(w + 0.02, 0.07, w + 0.1, foot, [0, -h + 0.035, -0.04]);
    pivot.add(lb.build({ castShadow: true, receiveShadow: false }));
    root.add(pivot);
  };
  limb('leg_L', -0.11, 0.82, 0.8, 0.14, pants, 0x1a1a1a);
  limb('leg_R', 0.11, 0.82, 0.8, 0.14, pants, 0x1a1a1a);
  limb('arm_L', -0.28, 1.43, 0.58, 0.11, shirt, null);
  limb('arm_R', 0.28, 1.43, 0.58, 0.11, shirt, null);
  return root;
}

/** Simple gull / pigeon with two flapping wing nodes ('wing_L', 'wing_R'). */
export function buildBird(color: number): THREE.Group {
  const root = new THREE.Group();
  const body = new GeoBuilder();
  body.box(0.18, 0.16, 0.5, color, [0, 0, 0]);
  body.cone(0.06, 0.16, 4, 0xf2a43a, [0, 0, -0.32], { rot: [-Math.PI / 2, 0, 0] });
  root.add(body.build({ castShadow: false, receiveShadow: false }));
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.name = side < 0 ? 'wing_L' : 'wing_R';
    const wb = new GeoBuilder();
    wb.box(0.6, 0.03, 0.26, color, [side * 0.3, 0, 0]);
    wb.box(0.12, 0.035, 0.2, 0x333333, [side * 0.58, 0, 0.02]);
    pivot.add(wb.build({ castShadow: false, receiveShadow: false }));
    root.add(pivot);
  }
  return root;
}
