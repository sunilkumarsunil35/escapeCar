import * as THREE from 'three';
import { GeoBuilder, socket } from '../../core/GeoBuilder';
import { C } from '../../core/Palette';
import type { SocketMap } from './vehicles';

const ALONG_Z: [number, number, number] = [Math.PI / 2, 0, 0];

/** Twin Thompson SMGs with drum mags on a turret mount. Child 'turret' yaws for auto-aim. */
export function buildTommy(sockets: SocketMap): THREE.Group {
  const root = new THREE.Group();
  const base = new GeoBuilder();
  base.cyl(0.18, 0.22, 0.1, 8, C.iron, [0, 0.05, 0]);
  const baseMesh = base.build();
  baseMesh.name = 'mount';
  root.add(baseMesh);

  const turret = new THREE.Group();
  turret.name = 'turret';
  const b = new GeoBuilder();
  b.cyl(0.08, 0.08, 0.18, 6, C.ironLight, [0, 0.16, 0]);
  b.box(0.68, 0.06, 0.1, C.iron, [0, 0.2, -0.08]);
  for (const sx of [-1, 1]) {
    const x = sx * 0.28;
    b.box(0.1, 0.13, 0.5, C.iron, [x, 0.27, -0.1]);
    b.cyl(0.045, 0.045, 0.4, 8, C.ironLight, [x, 0.27, -0.55], { rot: ALONG_Z });
    for (let i = 0; i < 4; i++) b.cyl(0.055, 0.055, 0.025, 8, C.iron, [x, 0.27, -0.42 - i * 0.08], { rot: ALONG_Z });
    b.cyl(0.028, 0.028, 0.42, 6, C.iron, [x, 0.27, -0.96], { rot: ALONG_Z });
    b.cyl(0.035, 0.035, 0.05, 6, C.iron, [x, 0.27, -1.16], { rot: ALONG_Z });
    b.box(0.05, 0.13, 0.05, C.wood, [x, 0.17, -0.42], { rot: [0.25, 0, 0] });
    b.box(0.06, 0.16, 0.06, C.wood, [x, 0.15, 0.08], { rot: [-0.3, 0, 0] });
    b.cyl(0.14, 0.14, 0.09, 10, C.iron, [x, 0.15, -0.14], { rot: [0, 0, Math.PI / 2] });
    b.cyl(0.05, 0.05, 0.1, 6, C.chromeDark, [x, 0.15, -0.14], { rot: [0, 0, Math.PI / 2] });
    b.profile([[0.12, 0.3], [0.12, 0.22], [0.62, 0.12], [0.66, 0.24]], 0.07, C.wood, [x, 0, 0]);
  }
  turret.add(b.build());
  turret.add(socket('muzzle_L', sockets.muzzle_L ?? [-0.28, 0.27, -1.18]));
  turret.add(socket('muzzle_R', sockets.muzzle_R ?? [0.28, 0.27, -1.18]));
  root.add(turret);
  return root;
}

/** Boxy multi-tube rocket pod on a roof bracket. */
export function buildRocketPod(sockets: SocketMap): THREE.Group {
  const root = new THREE.Group();
  const base = new GeoBuilder();
  base.cyl(0.2, 0.24, 0.1, 8, C.iron, [0, 0.05, 0]);
  root.add(base.build());
  const turret = new THREE.Group();
  turret.name = 'turret';
  const b = new GeoBuilder();
  b.box(0.12, 0.2, 0.12, C.ironLight, [0, 0.17, 0]);
  b.box(0.82, 0.48, 0.9, 0x4d5248, [0, 0.42, 0]);
  b.box(0.86, 0.06, 0.94, C.iron, [0, 0.68, 0]);
  b.box(0.86, 0.06, 0.94, C.iron, [0, 0.17, 0]);
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      const x = -0.29 + c * 0.193;
      const y = 0.32 + r * 0.2;
      b.cyl(0.075, 0.075, 0.04, 8, C.chromeDark, [x, y, -0.45], { rot: ALONG_Z });
      b.cyl(0.055, 0.055, 0.05, 8, C.black, [x, y, -0.46], { rot: ALONG_Z });
    }
  }
  b.box(0.06, 0.06, 0.06, 0xff3030, [0.36, 0.72, 0.4], { layer: 'glow' });
  turret.add(b.build());
  turret.add(socket('muzzle_center', sockets.muzzle_center ?? [0, 0.42, -0.72]));
  root.add(turret);
  return root;
}

/** Chunky white-and-red artillery rocket (points -Z). */
export function buildMissile(): THREE.Group {
  const b = new GeoBuilder();
  b.cyl(0.13, 0.13, 1.1, 8, C.stripeWhite, [0, 0, 0], { rot: ALONG_Z });
  b.cone(0.13, 0.35, 8, C.red, [0, 0, -0.72], { rot: [-Math.PI / 2, 0, 0] });
  b.cyl(0.135, 0.135, 0.12, 8, C.red, [0, 0, -0.25], { rot: ALONG_Z });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.box(0.03, 0.26, 0.28, C.red, [Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0.42], { rot: [0, 0, a + Math.PI / 2] });
  }
  b.cyl(0.09, 0.07, 0.1, 8, C.iron, [0, 0, 0.6], { rot: ALONG_Z });
  const g = b.build({ castShadow: true, receiveShadow: false });
  g.name = 'body';
  const root = new THREE.Group();
  root.add(g);
  return root;
}

export function buildCash(): THREE.Group {
  const b = new GeoBuilder();
  for (let i = 0; i < 4; i++) {
    b.box(0.95, 0.11, 0.48, i % 2 ? C.cashDark : C.cash, [Math.sin(i * 2.1) * 0.04, 0.06 + i * 0.115, Math.cos(i * 1.7) * 0.03], { rot: [0, Math.sin(i) * 0.08, 0] });
  }
  b.box(0.2, 0.48, 0.5, C.band, [0, 0.235, 0]);
  b.box(0.34, 0.012, 0.22, 0xe7f5e3, [0.28, 0.47, 0]);
  const g = b.build({ castShadow: true, receiveShadow: false });
  g.name = 'body';
  const root = new THREE.Group();
  root.add(g);
  return root;
}

export function buildWrench(): THREE.Group {
  const b = new GeoBuilder();
  const green = 0x3ddc6b;
  b.box(0.22, 1.1, 0.14, green, [0, 0.0, 0], { layer: 'glow' });
  b.box(0.27, 0.42, 0.18, 0x1f7a3d, [0, -0.38, 0]);
  b.torus(0.26, 0.09, 5, 8, green, [0, 0.72, 0], { layer: 'glow', rot: [0, 0, Math.PI * 0.75] }, Math.PI * 1.45);
  b.torus(0.2, 0.08, 5, 8, green, [0, -0.72, 0], { layer: 'glow', rot: [0, 0, -Math.PI * 0.25] }, Math.PI * 1.45);
  const g = b.build({ castShadow: true, receiveShadow: false });
  g.name = 'body';
  g.rotation.z = 0.6;
  const root = new THREE.Group();
  root.add(g);
  return root;
}

export function buildNitro(): THREE.Group {
  const b = new GeoBuilder();
  for (const sx of [-1, 1]) {
    b.cyl(0.22, 0.22, 0.95, 10, 0x2f8de4, [sx * 0.25, 0, 0]);
    b.sphere(0.22, 10, 4, 0x2f8de4, [sx * 0.25, 0.47, 0]);
    b.cyl(0.07, 0.07, 0.16, 6, C.chrome, [sx * 0.25, 0.72, 0]);
    b.cyl(0.11, 0.11, 0.06, 8, C.red, [sx * 0.25, 0.8, 0]);
    b.box(0.46, 0.05, 0.05, C.stripeWhite, [sx * 0.25, 0.1, 0.22]);
  }
  b.box(0.56, 0.06, 0.06, C.chrome, [0, 0.72, 0]);
  b.box(0.7, 0.08, 0.5, C.iron, [0, -0.25, 0]);
  const g = b.build({ castShadow: true, receiveShadow: false });
  g.name = 'body';
  const root = new THREE.Group();
  root.add(g);
  return root;
}

export function buildMagnet(): THREE.Group {
  const b = new GeoBuilder();
  b.torus(0.42, 0.16, 6, 10, C.red, [0, 0.15, 0], { rot: [0, 0, 0] }, Math.PI);
  for (const sx of [-1, 1]) {
    b.box(0.32, 0.4, 0.32, C.red, [sx * 0.42, -0.06, 0]);
    b.box(0.33, 0.22, 0.33, C.chrome, [sx * 0.42, -0.37, 0]);
  }
  const g = b.build({ castShadow: true, receiveShadow: false });
  g.name = 'body';
  g.rotation.z = Math.PI;
  g.position.y = 0;
  const root = new THREE.Group();
  root.add(g);
  return root;
}

/** Orange-and-white striped wooden street barricade (3.5m wide). */
export function buildBarricade(): THREE.Group {
  const b = new GeoBuilder();
  const w = 3.5;
  for (const sx of [-1, 1]) {
    b.box(0.08, 1.1, 0.08, C.stripeWhite, [sx * (w / 2 - 0.25), 0.55, -0.22], { rot: [0.3, 0, 0] });
    b.box(0.08, 1.1, 0.08, C.stripeWhite, [sx * (w / 2 - 0.25), 0.55, 0.22], { rot: [-0.3, 0, 0] });
    b.box(0.1, 0.06, 0.6, C.iron, [sx * (w / 2 - 0.25), 0.04, 0]);
  }
  const segs = 7;
  for (const y of [0.88, 0.55]) {
    for (let i = 0; i < segs; i++) {
      const x = -w / 2 + (i + 0.5) * (w / segs);
      b.box(w / segs, 0.22, 0.06, i % 2 === 0 ? C.orange : C.stripeWhite, [x, y, 0]);
    }
  }
  b.box(0.12, 0.12, 0.12, 0xffb020, [w / 2 - 0.3, 1.08, 0], { layer: 'glow' });
  const g = b.build();
  g.name = 'body';
  const root = new THREE.Group();
  root.add(g);
  return root;
}

/** Bright red explosive fuel drum with hazard stripe. */
export function buildBarrel(): THREE.Group {
  const b = new GeoBuilder();
  b.cyl(0.4, 0.4, 1.15, 10, 0xc92a1f, [0, 0.575, 0]);
  b.cyl(0.42, 0.42, 0.06, 10, 0x8e1c14, [0, 0.3, 0]);
  b.cyl(0.42, 0.42, 0.06, 10, 0x8e1c14, [0, 0.85, 0]);
  b.cyl(0.41, 0.41, 0.16, 10, C.hazardYellow, [0, 0.575, 0]);
  b.cyl(0.36, 0.36, 0.03, 10, 0x7a1810, [0, 1.16, 0]);
  b.cyl(0.06, 0.06, 0.05, 6, C.chromeDark, [0.18, 1.18, 0.1]);
  const g = b.build();
  g.name = 'body';
  const root = new THREE.Group();
  root.add(g);
  return root;
}

export const RAMP_SIZE = { width: 4, length: 6, height: 1.6 };

/** Yellow-and-black striped wooden construction jump ramp; rises toward -Z. */
export function buildRamp(): THREE.Group {
  const { width, length, height } = RAMP_SIZE;
  const b = new GeoBuilder();
  const half = length / 2;
  b.profile([[half, 0], [-half, height], [-half, 0]], width, C.wood);
  const slope = Math.atan2(height, length);
  const segs = 8;
  for (let i = 0; i < segs; i++) {
    const t = (i + 0.5) / segs;
    const z = half - t * length;
    const y = t * height + 0.03;
    for (const sx of [-1, 1]) {
      b.box(0.5, 0.04, length / segs + 0.01, i % 2 === 0 ? C.hazardYellow : C.black, [sx * (width / 2 - 0.25), y, z], { rot: [slope, 0, 0] });
    }
    b.box(width - 1.0, 0.03, length / segs - 0.04, C.woodDark, [0, y - 0.005, z], { rot: [slope, 0, 0] });
  }
  for (const sx of [-1, 1]) {
    b.box(0.14, height, 0.14, C.woodDark, [sx * (width / 2 - 0.1), height / 2, -half + 0.1]);
    b.box(0.12, 0.12, length * 0.75, C.woodDark, [sx * (width / 2 + 0.02), height * 0.35, -half * 0.25], { rot: [slope * 0.9, 0, 0] });
    b.box(0.1, height * 0.9, 0.1, C.woodDark, [sx * (width / 2 + 0.03), height * 0.45, -half * 0.35], { rot: [0.5, 0, 0] });
  }
  b.box(width, 0.12, 0.12, C.hazardYellow, [0, height - 0.04, -half + 0.05]);
  const g = b.build();
  g.name = 'body';
  const root = new THREE.Group();
  root.add(g);
  return root;
}

/** Convex-hull point cloud matching the ramp wedge, for the Rapier collider. */
export function rampHullPoints(): Float32Array {
  const { width, length, height } = RAMP_SIZE;
  const hw = width / 2;
  const hl = length / 2;
  return new Float32Array([
    -hw, 0, hl, hw, 0, hl,
    -hw, 0, -hl, hw, 0, -hl,
    -hw, height, -hl, hw, height, -hl,
  ]);
}
