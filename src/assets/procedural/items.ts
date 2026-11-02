import * as THREE from 'three';
import { GeoBuilder, socket } from '../../core/GeoBuilder';
import { C, glowMat } from '../../core/Palette';
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

/** Orange traffic cone with reflective white bands (construction chicanes). */
export function buildCone(): THREE.Group {
  const b = new GeoBuilder();
  b.box(0.62, 0.06, 0.62, C.black, [0, 0.03, 0]);
  b.cyl(0.05, 0.26, 0.85, 8, C.orange, [0, 0.48, 0]);
  b.cyl(0.13, 0.17, 0.12, 8, C.stripeWhite, [0, 0.52, 0]);
  b.cyl(0.08, 0.1, 0.09, 8, C.stripeWhite, [0, 0.74, 0]);
  const g = b.build({ castShadow: true, receiveShadow: false });
  g.name = 'body';
  const root = new THREE.Group();
  root.add(g);
  return root;
}

/**
 * Yellow construction road roller (faces -Z). Children: 'drum' spins about X, 'beacon' blinks.
 * ~2.5 m wide, ~5.2 m long, ~3.1 m tall.
 */
export function buildRoadRoller(): THREE.Group {
  const root = new THREE.Group();
  const yellow = 0xf2b51a;
  const dark = 0x2b2d33;
  const b = new GeoBuilder();
  // Drum yoke (frame around the front drum) with hazard stripes
  for (const sx of [-1, 1]) {
    b.box(0.18, 1.5, 1.9, yellow, [sx * 1.27, 1.05, -1.7]);
    for (let i = 0; i < 4; i++) b.box(0.2, 0.18, 0.5, i % 2 ? yellow : dark, [sx * 1.29, 1.65, -2.4 + i * 0.47], { rot: [0.5, 0, 0] });
  }
  b.box(2.7, 0.22, 1.9, yellow, [0, 1.85, -1.7]);
  b.box(2.6, 0.08, 0.3, dark, [0, 0.5, -2.7]);
  // Chassis + engine body + cab
  b.box(2.2, 0.9, 3.0, yellow, [0, 1.15, 0.9]);
  b.box(2.1, 0.5, 1.3, 0xd99e12, [0, 1.85, 1.6]);
  for (let i = 0; i < 5; i++) b.box(0.06, 0.32, 1.1, dark, [-0.8 + i * 0.4, 1.85, 1.6]);
  b.box(1.5, 0.35, 1.3, dark, [0, 1.75, 0.15]);
  for (const sx of [-1, 1]) for (const sz of [-0.45, 0.75]) b.box(0.08, 1.3, 0.08, dark, [sx * 0.75, 2.55, sz]);
  b.box(1.9, 0.12, 1.7, yellow, [0, 3.2, 0.15]);
  b.box(0.35, 0.5, 0.3, 0x3a3f47, [0, 2.15, 0.35]);
  b.ico(0.16, 0xe0ac85, [0, 2.6, 0.35]);
  b.cyl(0.2, 0.2, 0.06, 8, 0xf2c230, [0, 2.78, 0.35]);
  b.cyl(0.08, 0.1, 1.1, 6, dark, [0.7, 2.6, 2.0]);
  // Rear wheels
  for (const sx of [-1, 1]) {
    b.cyl(0.62, 0.62, 0.55, 10, 0x1d1e22, [sx * 1.0, 0.62, 2.0], { rot: [0, 0, Math.PI / 2] });
    b.cyl(0.3, 0.3, 0.58, 8, yellow, [sx * 1.0, 0.62, 2.0], { rot: [0, 0, Math.PI / 2] });
  }
  const body = b.build();
  body.name = 'body';
  root.add(body);
  // Front steel drum (rolling)
  const drum = new THREE.Group();
  drum.name = 'drum';
  drum.position.set(0, 0.85, -1.7);
  const db = new GeoBuilder();
  db.cyl(0.85, 0.85, 2.3, 14, 0x8d9399, [0, 0, 0], { rot: [0, 0, Math.PI / 2] });
  db.cyl(0.6, 0.6, 2.34, 10, 0x5b6168, [0, 0, 0], { rot: [0, 0, Math.PI / 2] });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    db.box(2.32, 0.06, 0.12, 0x6b7177, [0, Math.sin(a) * 0.86, Math.cos(a) * 0.86], { rot: [-a, 0, 0] });
  }
  drum.add(db.build());
  root.add(drum);
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.22, 8), glowMat(0xff8a1a));
  beacon.position.set(0, 3.38, 0.15);
  beacon.name = 'beacon';
  root.add(beacon);
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


/**
 * Overhead logging gantry spanning the road: two lattice towers just outside the walls and a
 * truss beam at 9.6 m. Hanging tree loads (buildCraneLoad) slide along it.
 */
export function buildCraneGantry(halfSpan: number): THREE.Group {
  const b = new GeoBuilder();
  const yellow = 0xf2a81a;
  const dark = 0x2b2d33;
  for (const sx of [-1, 1]) {
    const x = sx * (halfSpan + 1.3);
    b.box(2.2, 0.5, 2.6, 0x8d8f94, [x, 0.25, 0]);
    for (const dx of [-0.6, 0.6]) for (const dz of [-0.6, 0.6]) b.box(0.22, 10.2, 0.22, yellow, [x + dx, 5.35, dz]);
    for (let y = 1.2; y < 10; y += 1.6) {
      b.box(1.4, 0.12, 0.12, yellow, [x, y, 0.6]);
      b.box(1.4, 0.12, 0.12, yellow, [x, y, -0.6]);
      b.box(0.12, 0.12, 1.4, yellow, [x + 0.6, y, 0]);
      b.box(0.12, 0.12, 1.4, yellow, [x - 0.6, y, 0]);
    }
    for (let i = 0; i < 6; i++) b.box(0.24, 0.5, 0.24, i % 2 ? yellow : dark, [x, 0.9 + i * 0.5, -0.75]);
  }
  const span = (halfSpan + 1.9) * 2;
  b.box(span, 0.35, 0.3, yellow, [0, 10.4, 0.45]);
  b.box(span, 0.35, 0.3, yellow, [0, 10.4, -0.45]);
  b.box(span, 0.18, 0.18, yellow, [0, 11.3, 0]);
  for (let x = -halfSpan; x <= halfSpan; x += 1.6) {
    b.box(0.1, 1.0, 0.1, yellow, [x, 10.85, 0.42], { rot: [0, 0, 0.6] });
    b.box(0.1, 1.0, 0.1, yellow, [x, 10.85, -0.42], { rot: [0, 0, -0.6] });
  }
  b.box(3.2, 0.9, 0.12, dark, [0, 11.0, -0.62]);
  b.box(2.8, 0.5, 0.14, yellow, [0, 11.0, -0.64]);
  const g = b.build({ castShadow: true });
  g.name = 'crane_gantry';
  const lamps = new THREE.Group();
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.25, 8), glowMat(0xff8a1a));
    lamp.position.set(sx * (halfSpan + 1.3), 10.75, 0);
    lamps.add(lamp);
  }
  lamps.name = 'lamps';
  g.add(lamps);
  return g;
}

/**
 * A trolley with cables carrying a felled pine lying across the road. `width` is how much road
 * the load blocks. The 'swing' child pivots at the trolley so the tree can sway.
 */
export function buildCraneLoad(width: number): THREE.Group {
  const root = new THREE.Group();
  const tb = new GeoBuilder();
  tb.box(1.4, 0.6, 1.4, 0x2b2d33, [0, 10.0, 0]);
  tb.box(1.0, 0.25, 1.0, 0xf2a81a, [0, 9.6, 0]);
  root.add(tb.build());
  const swing = new THREE.Group();
  swing.name = 'swing';
  swing.position.y = 9.5;
  const b = new GeoBuilder();
  const y = 1.9 - 9.5;
  const cx = width * 0.4;
  for (const sx of [-cx, cx]) b.box(0.1, 7.1, 0.1, 0x1d1e22, [sx * 0.5, -3.55, 0], { rot: [0, 0, sx > 0 ? -0.06 : 0.06] });
  for (const sx of [-cx, cx]) b.box(0.1, 0.9, 0.9, 0xd94a2a, [sx, y + 0.1, 0]);
  // Trunk across the road, root plate at one end, branches at the other
  b.cyl(0.38, 0.5, width * 0.78, 8, BARK2, [-width * 0.1, y, 0], { rot: [0, 0, Math.PI / 2] });
  b.cyl(0.62, 0.62, 0.25, 8, 0x4a3220, [-width * 0.5 + 0.12, y, 0], { rot: [0, 0, Math.PI / 2] });
  b.cyl(0.46, 0.46, 0.04, 8, 0xc9a074, [-width * 0.5 - 0.02, y, 0], { rot: [0, 0, Math.PI / 2] });
  for (let i = 0; i < 3; i++) {
    const x = width * 0.12 + i * width * 0.13;
    b.cone(0.95 - i * 0.18, width * 0.24, 7, i % 2 ? 0x2f5d34 : 0x356b3a, [x, y, 0], { rot: [0, 0, -Math.PI / 2] });
  }
  b.box(width * 0.7, 0.18, 0.22, 0x6e4b2c, [-width * 0.12, y + 0.42, 0.25]);
  swing.add(b.build({ castShadow: true }));
  root.add(swing);
  root.name = 'crane_load';
  return root;
}

/** Road pothole decal: dark broken asphalt with a chipped rim. */
export function buildPothole(): THREE.Group {
  const b = new GeoBuilder();
  b.ico(1.25, 0x5a5650, [0, -0.02, 0], { scale: [1.15, 0.05, 0.95] });
  b.ico(1.0, 0x1b1a1a, [0, 0.0, 0], { scale: [1.1, 0.05, 0.9] });
  b.ico(0.55, 0x2a2622, [0.25, 0.01, -0.1], { scale: [1, 0.05, 0.8] });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    b.box(0.07, 0.012, 0.7 + (i % 2) * 0.4, 0x2e2c2a, [Math.cos(a) * 1.45, 0.005, Math.sin(a) * 1.2], { rot: [0, -a, 0] });
    b.box(0.2, 0.08, 0.16, 0x6a655d, [Math.cos(a + 0.6) * 1.2, 0.04, Math.sin(a + 0.6) * 1.0]);
  }
  const g = b.build({ receiveShadow: true });
  g.name = 'pothole';
  return g;
}

const BARK2 = 0x5a3c26;


/** The player's amphibious form: a speedboat with the roof gun on the foredeck. Faces -Z. */
export function buildPlayerBoat(): THREE.Group {
  const b = new GeoBuilder();
  const hull = 0xf2efe6;
  b.profile([[-1.15, 0], [-1.3, 0.75], [1.3, 0.75], [1.15, 0]], 4.6, hull, [0, 0, 0.3], { rot: [0, Math.PI / 2, 0] });
  b.box(2.6, 0.75, 1.4, hull, [0, 0.37, -2.4], { scale: [0.55, 1, 1] });
  b.box(2.62, 0.22, 4.7, 0xd62828, [0, 0.62, 0.3]);
  b.box(2.3, 0.08, 4.2, 0x8a6a48, [0, 0.8, 0.4]);
  b.box(2.0, 0.6, 0.12, 0x9ad1f5, [0, 1.15, -0.6], { layer: 'window', rot: [-0.45, 0, 0] });
  b.box(0.8, 0.5, 0.8, 0xf2efe6, [-0.5, 1.05, 0.5]);
  b.box(0.7, 0.9, 0.7, 0x2b2d33, [0, 0.9, 2.85]);
  b.box(0.25, 0.7, 0.25, 0x2b2d33, [0, 0.25, 3.05]);
  b.box(0.9, 0.35, 1.0, 0x3a3f47, [0, 1.0, -1.6]);
  b.box(0.12, 0.12, 1.1, 0x1d1e22, [-0.18, 1.12, -2.3]);
  b.box(0.12, 0.12, 1.1, 0x1d1e22, [0.18, 1.12, -2.3]);
  const g = b.build({ castShadow: true });
  g.name = 'player_boat';
  return g;
}

/** Mafia gunboat: dark speedboat with a pintle machine gun. Faces -Z. */
export function buildGunboat(): THREE.Group {
  const root = new THREE.Group();
  const b = new GeoBuilder();
  const hull = 0x23262c;
  b.profile([[-1.0, 0], [-1.2, 0.8], [1.2, 0.8], [1.0, 0]], 4.4, hull, [0, 0, 0.4], { rot: [0, Math.PI / 2, 0] });
  b.box(2.4, 0.8, 1.4, hull, [0, 0.4, -2.3], { scale: [0.55, 1, 1] });
  b.box(2.42, 0.18, 4.5, 0x8c2a1e, [0, 0.66, 0.4]);
  b.box(2.0, 0.08, 4.0, 0x3a3f47, [0, 0.84, 0.4]);
  b.box(1.8, 0.55, 0.1, 0x0d1118, [0, 1.15, -0.4], { rot: [-0.4, 0, 0] });
  b.box(0.65, 0.85, 0.65, 0x1d1e22, [0, 0.85, 2.9]);
  b.box(0.42, 0.55, 0.4, 0x2b2d33, [0.4, 1.15, 0.6]);
  b.ico(0.17, 0xe0ac85, [0.4, 1.6, 0.6]);
  b.cyl(0.22, 0.22, 0.08, 8, 0x111111, [0.4, 1.75, 0.6]);
  b.box(0.08, 0.6, 0.08, 0x1d1e22, [0, 1.15, -1.2]);
  b.box(0.18, 0.18, 1.2, 0x1d1e22, [0, 1.45, -1.6]);
  root.add(b.build({ castShadow: true }));
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0, 1.45, -2.25);
  root.add(muzzle);
  root.name = 'enemy_boat';
  return root;
}

/** Leaping fish (orange or silver), body along -Z. */
export function buildFish(orange: boolean): THREE.Group {
  const b = new GeoBuilder();
  const col = orange ? 0xf28c38 : 0xb8c4cc;
  b.ico(0.32, col, [0, 0, 0], { scale: [0.55, 0.8, 1.6] });
  b.profile([[0, 0], [-0.32, 0.3], [-0.32, -0.3]], 0.05, orange ? 0xd9622b : 0x8d9aa3, [0, 0, 0.62], { rot: [0, Math.PI / 2, 0] });
  b.box(0.04, 0.22, 0.3, orange ? 0xd9622b : 0x8d9aa3, [0, 0.27, 0.05]);
  for (const x of [-0.15, 0.15]) b.ico(0.06, 0x111111, [x, 0.06, -0.36]);
  const g = b.build();
  g.name = 'fish';
  return g;
}

/** Boat Kit power-up: anchor-stamped crate with a life ring. */
export function buildBoatKit(): THREE.Group {
  const b = new GeoBuilder();
  b.box(1.1, 0.8, 0.8, 0x0e7490, [0, 0, 0]);
  b.box(1.14, 0.1, 0.84, 0xf2efe6, [0, 0.25, 0]);
  b.box(1.14, 0.1, 0.84, 0xf2efe6, [0, -0.25, 0]);
  b.box(0.1, 0.42, 0.06, 0xffe066, [0, 0.0, -0.43]);
  b.box(0.36, 0.08, 0.06, 0xffe066, [0, 0.12, -0.43]);
  b.torus(0.16, 0.035, 6, 14, 0xffe066, [0, -0.16, -0.43], { rot: [0, 0, 0] }, Math.PI);
  b.torus(0.42, 0.11, 6, 16, 0xf25f5c, [0, 0.55, 0], { rot: [Math.PI / 2, 0, 0] });
  const g = b.build();
  g.name = 'powerup_boat';
  return g;
}

/**
 * A washed-out section of road: a seawater-filled chasm across the whole road and beach with
 * broken asphalt slabs on both lips. Local frame: X = track lateral, -Z = forward. `halfLen` is
 * half the gap length along the road.
 */
export function buildRoadGap(latMin: number, latMax: number, halfLen: number): THREE.Group {
  const b = new GeoBuilder();
  const w = latMax - latMin;
  const cx = (latMin + latMax) / 2;
  b.box(w, 0.04, halfLen * 2, 0x0b3f57, [cx, 0.03, 0]);
  b.box(w, 0.045, 0.7, 0x111418, [cx, 0.035, -halfLen + 0.35]);
  b.box(w, 0.045, 0.7, 0x111418, [cx, 0.035, halfLen - 0.35]);
  for (let i = 0; i < 9; i++) b.box(rr2(1.2, 3.5), 0.05, rr2(0.3, 0.7), 0xd8f3f7, [latMin + 1 + Math.random() * (w - 2), 0.06, rr2(-halfLen + 1.4, halfLen - 1.4)], { rot: [0, Math.random(), 0] });
  for (const side of [-1, 1]) {
    for (let x = latMin + 0.6; x < latMax - 0.4; x += rr2(1.4, 2.6)) {
      const onRoad = x > -10 && x < 10;
      b.box(rr2(1.2, 2.4), 0.3, rr2(0.6, 1.2), onRoad ? 0x5a5d62 : 0xcdb98a, [x, 0.02, side * (halfLen + 0.15)], { rot: [side * rr2(0.15, 0.4), rr2(-0.3, 0.3), rr2(-0.1, 0.1)] });
      if (onRoad && Math.random() < 0.35) b.box(0.05, 0.05, 0.9, 0x8a4f2e, [x + 0.3, 0.15, side * (halfLen - 0.2)], { rot: [side * 0.6, 0, 0] });
    }
  }
  // Warning signs on the land-side curb
  for (const z of [halfLen + 14, halfLen + 34]) {
    b.box(0.1, 1.8, 0.1, 0x8d8f94, [-11.4, 0.9, z]);
    b.box(1.3, 1.3, 0.06, 0xf2c230, [-11.4, 2.1, z], { rot: [0, 0, Math.PI / 4] });
    b.box(0.16, 0.6, 0.07, 0x1d1e22, [-11.4, 2.15, z]);
  }
  const g = b.build({ receiveShadow: true });
  g.name = 'road_gap';
  return g;
}

const rr2 = (a: number, b: number): number => a + Math.random() * (b - a);
