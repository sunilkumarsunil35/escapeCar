import * as THREE from 'three';
import { GeoBuilder, type V3 } from '../../core/GeoBuilder';
import { C } from '../../core/Palette';
import { mulberry32 } from '../../core/math';
import { ROAD } from '../../data/config';

export type ChunkKind = 'straight' | 'curveL' | 'curveR' | 'highway';
export const CURVE_TURN = Math.PI / 4; // 45° per curved chunk

export function chunkTurn(kind: ChunkKind): number {
  return kind === 'curveL' ? CURVE_TURN : kind === 'curveR' ? -CURVE_TURN : 0;
}

/** Local-frame centerline sample for a chunk that starts at the origin heading -Z. */
export function sampleLocal(s: number, lat: number, turn: number, L: number, out: { x: number; z: number; h: number }): void {
  if (turn === 0) {
    out.x = lat;
    out.z = -s;
    out.h = 0;
    return;
  }
  const k = turn / L;
  const h = k * s;
  out.x = (Math.cos(h) - 1) / k + lat * Math.cos(h);
  out.z = -Math.sin(h) / k - lat * Math.sin(h);
  out.h = h;
}

const tmpS = { x: 0, z: 0, h: 0 };
const tmpQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

function frameAt(s: number, lat: number, turn: number, L: number, extraYaw = 0, y = 0): THREE.Matrix4 {
  sampleLocal(s, lat, turn, L, tmpS);
  tmpQ.setFromAxisAngle(UP, tmpS.h + extraYaw);
  return new THREE.Matrix4().compose(new THREE.Vector3(tmpS.x, y, tmpS.z), tmpQ, new THREE.Vector3(1, 1, 1));
}

/** Lays a flat strip (box segments) between two lateral offsets along the chunk. */
function strip(b: GeoBuilder, turn: number, L: number, latA: number, latB: number, top: number, thick: number, color: number, segs: number): void {
  const k = Math.abs(turn / L);
  const ds = L / segs;
  const latMid = (latA + latB) / 2;
  const width = Math.abs(latB - latA);
  const len = ds * (1 + Math.abs(latMid) * k) + (segs > 1 ? 0.12 : 0);
  for (let i = 0; i < segs; i++) {
    b.frame = frameAt((i + 0.5) * ds, latMid, turn, L);
    b.box(width, thick, len, color, [0, top - thick / 2, 0]);
  }
  b.frame = null;
}

function dashes(b: GeoBuilder, turn: number, L: number, lat: number, color: number, dash = 3, gap = 4, w = 0.18): void {
  for (let s = 1.5; s < L; s += dash + gap) {
    b.frame = frameAt(s + dash / 2, lat, turn, L);
    b.box(w, 0.02, dash, color, [0, 0.01, 0]);
  }
  b.frame = null;
}

function solidLine(b: GeoBuilder, turn: number, L: number, lat: number, color: number, w = 0.2): void {
  strip(b, turn, L, lat - w / 2, lat + w / 2, 0.02, 0.02, color, turn === 0 ? 1 : 10);
}

type Rng = () => number;
const rr = (rng: Rng, a: number, b: number): number => a + rng() * (b - a);
function rpick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

const BRICKS = [C.brick1, C.brick2, C.brick3, C.brick4, C.brick1, C.tan];
const NEONS = [C.neonCyan, C.neonPink, C.neonPurple, C.neonYellow];

/**
 * A city building built in its own frame: width along local X, facade facing local -Z.
 * Includes storefront, awning, window grid, cornice, optional fire escape, neon sign and water tower.
 */
function building(b: GeoBuilder, rng: Rng, w: number, h: number, d: number): void {
  const color = rpick(rng, BRICKS);
  const trim = color === C.tan ? C.stoneDark : C.trim;
  const front = -d / 2;
  b.box(w, h, d, color, [0, h / 2, 0]);
  // Storefront
  b.box(w + 0.1, 0.35, d + 0.1, trim, [0, 3.6, 0]);
  b.box(w - 0.6, 2.4, 0.1, 0x262a31, [0, 1.5, front - 0.02]);
  const shopLit = rng() < 0.5;
  b.box(w * 0.38, 1.6, 0.06, 0xffffff, [-w * 0.22, 1.7, front - 0.08], { layer: shopLit ? 'window' : 'lit' });
  b.box(1.1, 2.3, 0.08, C.woodDark, [w * 0.25, 1.15, front - 0.06]);
  if (rng() < 0.65) {
    const aw = rng() < 0.5 ? C.awningTeal : C.awningRed;
    b.box(w * 0.8, 0.12, 1.5, aw, [0, 3.1, front - 0.7], { rot: [0.32, 0, 0] });
    b.box(w * 0.8, 0.35, 0.06, aw, [0, 2.78, front - 1.42]);
  }
  // Window grid
  const floors = Math.floor((h - 4.5) / 3);
  const cols = Math.max(2, Math.floor(w / 2.3));
  const colW = w / cols;
  for (let f = 0; f < floors; f++) {
    const y = 5.6 + f * 3;
    if (y > h - 1.4) break;
    for (let c = 0; c < cols; c++) {
      const x = -w / 2 + colW * (c + 0.5);
      b.box(1.15, 1.75, 0.12, trim, [x, y, front - 0.04]);
      const lit = rng() < 0.42;
      b.box(0.92, 1.5, 0.1, lit ? 0xffffff : C.glassDay, [x, y, front - 0.08], { layer: lit ? 'window' : 'lit' });
      b.box(1.3, 0.1, 0.22, trim, [x, y - 0.9, front - 0.1]);
    }
  }
  // Cornice / parapet
  b.box(w + 0.5, 0.45, d + 0.5, trim, [0, h + 0.1, 0]);
  b.box(w + 0.1, 0.5, d + 0.1, color, [0, h + 0.55, 0]);
  // Fire escape
  if (rng() < 0.5 && floors >= 2) {
    const fx = rpick(rng, [-1, 1]) * (w / 2 - 2.2);
    for (let f = 0; f < floors; f++) {
      const y = 4.6 + f * 3;
      if (y > h - 2) break;
      b.box(3.0, 0.08, 1.1, C.iron, [fx, y, front - 0.6]);
      b.box(3.0, 0.06, 0.06, C.iron, [fx, y + 1.0, front - 1.12]);
      for (const px of [-1.45, 0, 1.45]) b.box(0.05, 1.0, 0.05, C.iron, [fx + px, y + 0.5, front - 1.12]);
      b.box(0.08, 3.3, 0.5, C.iron, [fx + 0.6, y + 1.5, front - 0.6], { rot: [0, 0, 0.62] });
    }
  }
  // Neon blade sign (perpendicular to facade so drivers see it)
  if (rng() < 0.55) {
    const nx = rpick(rng, [-1, 1]) * (w / 2 - 0.6);
    const ny = rr(rng, 5.5, Math.min(h - 3, 10));
    const nh = rr(rng, 3, 5);
    b.box(0.3, nh + 0.3, 1.3, C.iron, [nx, ny, front - 0.75]);
    b.box(0.36, nh, 1.05, rpick(rng, NEONS), [nx, ny, front - 0.75], { layer: 'glow' });
  }
  if (rng() < 0.35) {
    b.box(w * 0.55, 0.5, 0.12, rpick(rng, NEONS), [0, 4.2, front - 0.1], { layer: 'glow' });
  }
  // Water tower
  if (rng() < 0.3 && h > 12) {
    const tx = rr(rng, -w / 4, w / 4);
    for (const lx of [-0.8, 0.8]) for (const lz of [-0.8, 0.8]) b.box(0.12, 2, 0.12, C.iron, [tx + lx, h + 1.8, lz]);
    b.cyl(1.25, 1.25, 2.2, 9, C.wood, [tx, h + 3.9, 0]);
    b.cone(1.4, 1.1, 9, C.woodDark, [tx, h + 5.55, 0]);
  }
}

function streetLight(b: GeoBuilder, side: number): void {
  // Built in a frame at the pole base, local +X pointing away from road for side=+1.
  b.cyl(0.11, 0.14, 7, 6, C.iron, [0, 3.5, 0]);
  b.box(0.3, 0.3, 0.3, C.iron, [0, 0.15, 0]);
  b.box(1.9, 0.12, 0.12, C.iron, [-side * 0.9, 6.95, 0]);
  b.box(0.7, 0.2, 0.42, C.iron, [-side * 1.75, 6.85, 0]);
  b.box(0.55, 0.06, 0.32, C.lampGlow, [-side * 1.75, 6.72, 0], { layer: 'glow' });
  b.add(new THREE.ConeGeometry(3.1, 6.6, 10, 1, true), 0xffd88a, [-side * 1.75, 3.4, 0], { layer: 'night' });
  b.add(new THREE.CircleGeometry(2.9, 10), 0xffc870, [-side * 1.75, 0.03, 0], { layer: 'night', rot: [-Math.PI / 2, 0, 0] });
}

function propCluster(b: GeoBuilder, rng: Rng): void {
  const t = rng();
  if (t < 0.3) {
    b.box(1.0, 0.9, 1.0, C.crate, [0, 0.45, 0], { rot: [0, rng(), 0] });
    b.box(0.8, 0.7, 0.8, C.crate, [0.2, 1.25, 0.1], { rot: [0, rng(), 0] });
    b.box(1.02, 0.08, 1.02, C.woodDark, [0, 0.62, 0], { rot: [0, 0, 0] });
  } else if (t < 0.55) {
    b.cyl(0.38, 0.38, 1.0, 9, C.drumGreen, [0, 0.5, 0]);
    b.cyl(0.39, 0.39, 0.06, 9, C.iron, [0, 0.7, 0]);
    b.cyl(0.38, 0.38, 1.0, 9, C.drumGreen, [0.85, 0.5, 0.2]);
  } else if (t < 0.75) {
    b.cyl(0.32, 0.28, 0.9, 8, 0x55606b, [0, 0.45, 0]);
    b.cyl(0.36, 0.36, 0.08, 8, 0x3d454e, [0, 0.93, 0]);
  } else if (t < 0.88) {
    b.cyl(0.16, 0.18, 0.7, 7, 0xc23a2b, [0, 0.35, 0]);
    b.sphere(0.17, 7, 3, 0xc23a2b, [0, 0.7, 0]);
  } else {
    b.box(0.5, 1.2, 0.5, 0x2563a8, [0, 0.6, 0]);
    b.box(0.52, 0.25, 0.52, 0x1e4f86, [0, 1.25, 0]);
  }
}

function cityStreet(b: GeoBuilder, rng: Rng, turn: number, L: number): void {
  const segs = turn === 0 ? 1 : 10;
  strip(b, turn, L, -ROAD.halfWidth, ROAD.halfWidth, 0, 0.3, C.asphalt, segs);
  for (const lat of [-5, 5]) dashes(b, turn, L, lat, C.laneWhite);
  solidLine(b, turn, L, -0.15, C.laneYellow, 0.14);
  solidLine(b, turn, L, 0.15, C.laneYellow, 0.14);
  for (const lat of [-9.5, 9.5]) solidLine(b, turn, L, lat, C.laneWhite, 0.22);
  // Asphalt patches for texture
  for (let i = 0; i < 4; i++) {
    const s = rr(rng, 3, L - 3);
    const lat = rr(rng, -8, 8);
    b.frame = frameAt(s, lat, turn, L);
    b.box(rr(rng, 1.5, 4), 0.01, rr(rng, 1.5, 5), C.asphaltDark, [0, 0.004, 0], { rot: [0, rng(), 0] });
  }
  b.frame = null;
  // Sidewalks + curbs
  for (const side of [-1, 1]) {
    strip(b, turn, L, side * 10.25, side * 13.4, 0.16, 0.5, C.sidewalk, segs);
    strip(b, turn, L, side * 10.0, side * 10.3, 0.18, 0.52, C.curb, segs);
    strip(b, turn, L, side * 13.4, side * 30, 0.02, 0.4, 0x4a4540, segs);
  }
  // Sidewalk joints
  for (const side of [-1, 1]) {
    for (let s = 2.5; s < L; s += 5) {
      b.frame = frameAt(s, side * 11.8, turn, L);
      b.box(3.0, 0.02, 0.06, 0x9e978d, [0, 0.165, 0]);
    }
  }
  b.frame = null;
  // Buildings on both sides
  for (const side of [-1, 1]) {
    let s = rr(rng, -1, 1);
    while (s < L) {
      const w = rr(rng, 8, 13);
      const h = rpick(rng, [9, 12, 15, 18, 21, 24, 27]);
      const d = rr(rng, 9, 13);
      const centerS = s + w / 2;
      if (centerS - w / 2 > L - 1) break;
      const lat = side * (13.6 + d / 2);
      b.frame = frameAt(Math.min(centerS, L), lat, turn, L, side > 0 ? Math.PI / 2 : -Math.PI / 2);
      building(b, rng, w + 0.05, h, d);
      s += w;
    }
    // Background tower behind the block
    if (rng() < 0.4) {
      const tw = rr(rng, 14, 22);
      const th = rr(rng, 45, 85);
      b.frame = frameAt(rr(rng, 10, L - 10), side * rr(rng, 42, 60), turn, L, 0);
      b.box(tw, th, tw, rpick(rng, [C.stone, C.tan, C.stoneDark]), [0, th / 2, 0]);
      b.box(tw * 0.75, th * 0.18, tw * 0.75, C.stone, [0, th + th * 0.09, 0]);
      b.box(tw * 0.45, th * 0.12, tw * 0.45, C.stoneDark, [0, th * 1.24, 0]);
      for (let i = 0; i < 5; i++) {
        b.box(tw * 0.08, th * 0.85, 0.2, 0x47566a, [-tw * 0.4 + i * tw * 0.2, th * 0.5, -tw / 2 - 0.1], { layer: rng() < 0.3 ? 'window' : 'lit' });
      }
    }
  }
  // Street lights alternating sides
  for (const [s, side] of [[12, 1], [37, -1]] as const) {
    b.frame = frameAt(s, side * 11.5, turn, L, 0, 0.16);
    streetLight(b, side);
  }
  // Sidewalk props
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      if (rng() < 0.35) continue;
      b.frame = frameAt(rr(rng, 3, L - 3), side * rr(rng, 12.3, 12.9), turn, L, 0, 0.16);
      propCluster(b, rng);
    }
  }
  b.frame = null;
}

function palm(b: GeoBuilder, rng: Rng, x: number, z: number, y = 0): void {
  const h = rr(rng, 6, 9);
  const lean = rr(rng, -0.25, 0.25);
  const segs = 5;
  let px = x;
  let py = y;
  for (let i = 0; i < segs; i++) {
    const segH = h / segs;
    const tilt = lean * (i / segs) * 1.6;
    b.cyl(0.18 - i * 0.015, 0.22 - i * 0.015, segH + 0.1, 6, i % 2 ? C.palmTrunk : 0x7a5c3a, [px, py + segH / 2, z], { rot: [0, 0, -tilt] });
    px += Math.sin(tilt) * segH;
    py += Math.cos(tilt) * segH;
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rng();
    const len = rr(rng, 2.4, 3.2);
    b.box(len, 0.08, 0.7, i % 2 ? C.palmLeaf : C.palmLeafDark, [px + Math.cos(a) * len * 0.45, py - 0.35, z + Math.sin(a) * len * 0.45], { rot: [0, -a, -0.45] });
  }
  b.ico(0.18, C.woodDark, [px + 0.15, py - 0.2, z]);
  b.ico(0.18, C.woodDark, [px - 0.12, py - 0.25, z + 0.1]);
}

function roundTree(b: GeoBuilder, rng: Rng, pos: V3): void {
  const h = rr(rng, 2.2, 3.2);
  b.cyl(0.18, 0.24, h, 6, C.woodDark, [pos[0], pos[1] + h / 2, pos[2]]);
  b.ico(rr(rng, 1.4, 2.0), C.grass, [pos[0], pos[1] + h + 0.8, pos[2]]);
  b.ico(rr(rng, 0.9, 1.3), 0x7cbd5a, [pos[0] + 0.6, pos[1] + h + 1.6, pos[2] - 0.3]);
}

function coastalHighway(b: GeoBuilder, rng: Rng, L: number, variant: number): void {
  // Main carriageway
  strip(b, 0, L, -10.2, 10.2, 0, 0.3, C.asphalt, 1);
  for (const lat of [-5, 0, 5]) dashes(b, 0, L, lat, C.laneWhite, 3.5, 5, 0.22);
  for (const lat of [-9.6, 9.6]) solidLine(b, 0, L, lat, C.laneWhite, 0.24);
  // Left jersey barrier + opposite lanes + city edge
  for (let s = 0; s < L; s += 10) {
    b.frame = frameAt(s + 5, -10.65, 0, L);
    b.box(0.5, 0.95, 10.02, C.concrete, [0, 0.47, 0]);
    b.box(0.9, 0.25, 10.02, C.concrete, [0, 0.12, 0]);
  }
  b.frame = null;
  strip(b, 0, L, -26, -11.1, 0, 0.3, C.asphalt, 1);
  for (const lat of [-16, -21]) dashes(b, 0, L, lat, C.laneWhite, 3.5, 5, 0.22);
  strip(b, 0, L, -30, -26, 0.15, 0.4, C.sidewalk, 1);
  strip(b, 0, L, -60, -30, 0.05, 0.4, C.grass, 1);
  for (let i = 0; i < 4; i++) roundTree(b, rng, [-rr(rng, 31, 36), 0.05, -rr(rng, 2, L - 2)]);
  let s = 0;
  while (s < L) {
    const w = rr(rng, 10, 16);
    const h = rpick(rng, [10, 13, 16, 22, 30]);
    const d = rr(rng, 10, 14);
    b.frame = frameAt(Math.min(s + w / 2, L), -(38 + d / 2), 0, L, -Math.PI / 2);
    building(b, rng, w, h, d);
    s += w + rr(rng, 1, 5);
  }
  // Tall highway lamps on the median
  for (const ls of [5, 30]) {
    b.frame = frameAt(ls, -10.65, 0, L, 0, 0.9);
    b.cyl(0.1, 0.13, 8, 6, C.ironLight, [0, 4, 0]);
    b.box(2.4, 0.12, 0.14, C.ironLight, [1.1, 8.0, 0]);
    b.box(0.7, 0.18, 0.36, C.ironLight, [2.2, 7.9, 0]);
    b.box(0.55, 0.05, 0.3, C.lampGlow, [2.2, 7.78, 0], { layer: 'glow' });
    b.add(new THREE.ConeGeometry(3.4, 8.4, 10, 1, true), 0xffd88a, [2.2, 3.8, 0], { layer: 'night' });
  }
  b.frame = null;
  // Right guardrail
  for (let p = 0; p <= L; p += 4) b.box(0.14, 0.85, 0.14, C.ironLight, [10.75, 0.42, -p]);
  b.box(0.08, 0.32, L + 0.05, 0xb9bec4, [10.68, 0.68, -L / 2]);
  b.box(0.1, 0.06, L + 0.05, 0x8d9399, [10.66, 0.86, -L / 2]);
  // Beach, rocks, palms
  strip(b, 0, L, 11.0, 13.0, -0.05, 0.4, C.sandDark, 1);
  strip(b, 0, L, 13.0, 34, -0.18, 0.4, C.sand, 1);
  for (let i = 0; i < 3; i++) {
    const z = -rr(rng, 3, L - 3);
    b.ico(rr(rng, 0.6, 1.4), 0x8c8f93, [rr(rng, 14, 30), -0.1, z], { scale: [1.3, 0.7, 1] });
  }
  for (let i = 0; i < 3; i++) palm(b, rng, rr(rng, 13.5, 19), -rr(rng, 4, L - 4), -0.18);
  // Ocean
  b.box(380, 0.2, L + 0.05, C.ocean, [34 + 190, -0.75, -L / 2]);
  for (let i = 0; i < 9; i++) {
    b.box(rr(rng, 4, 14), 0.02, rr(rng, 0.4, 1.2), C.oceanLight, [rr(rng, 40, 300), -0.64, -rr(rng, 2, L - 2)]);
  }
  b.box(2.5, 0.02, L + 0.05, 0xdff3ff, [35.2, -0.63, -L / 2]);
  if (rng() < 0.6) {
    const bx = rr(rng, 70, 200);
    const bz = -rr(rng, 10, L - 10);
    b.box(3.2, 0.6, 1.0, C.stripeWhite, [bx, -0.35, bz]);
    b.profile([[0, 0], [0, 4.2], [-2.2, 0.2]], 0.06, C.stripeWhite, [bx, -0.05, bz + 0.6], { rot: [0, Math.PI / 2, 0] });
    b.profile([[0, 0], [0, 3.0], [1.3, 0.2]], 0.06, C.red, [bx, -0.05, bz + 0.5], { rot: [0, Math.PI / 2, 0] });
  }
  // Overhead sign gantry on one variant
  if (variant === 0) {
    const gz = -L * 0.5;
    for (const gx of [-11.4, 11.4]) b.box(0.4, 7.5, 0.4, C.ironLight, [gx, 3.75, gz]);
    b.box(23.2, 0.5, 0.6, C.ironLight, [0, 7.3, gz]);
    for (const [sx, w] of [[-4.5, 5], [3.5, 5]] as const) {
      b.box(w, 2.2, 0.15, C.signGreen, [sx, 6.0, gz - 0.35]);
      b.box(w - 0.3, 0.12, 0.17, C.stripeWhite, [sx, 6.7, gz - 0.36]);
      b.box(0.5, 0.7, 0.17, C.stripeWhite, [sx, 5.6, gz - 0.36]);
    }
  }
}

/** Builds the visual template for a chunk in local space (start at origin, heading -Z). */
export function buildChunkTemplate(kind: ChunkKind, seed: number): THREE.Group {
  const rng = mulberry32(seed);
  const b = new GeoBuilder();
  const L = ROAD.chunkLength;
  if (kind === 'highway') coastalHighway(b, rng, L, seed % 3);
  else cityStreet(b, rng, chunkTurn(kind), L);
  const g = b.build({ castShadow: true, receiveShadow: true });
  g.name = `chunk_${kind}`;
  return g;
}

/** Distant art-deco skyline silhouettes; materials are tinted by the lighting system. */
export const SKYLINE_MATS = {
  body: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: false }),
  windows: new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false, color: 0x000000 }),
};

export function buildSkyline(seed = 7): THREE.Group {
  const rng = mulberry32(seed);
  const b = new GeoBuilder();
  const count = 46;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rr(rng, -0.04, 0.04);
    const r = rr(rng, 250, 330);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const w = rr(rng, 16, 34);
    const h = rr(rng, 55, 170);
    const tone = rpick(rng, [C.skyline, C.skylineDark, 0xa49d92, 0xc4beb3]);
    b.frame = new THREE.Matrix4().makeRotationY(-a + Math.PI / 2).setPosition(x, 0, z);
    b.box(w, h, w, tone, [0, h / 2, 0]);
    let tw = w;
    let ty = h;
    const steps = Math.floor(rr(rng, 1, 4));
    for (let sIdx = 0; sIdx < steps; sIdx++) {
      tw *= 0.72;
      const sh = h * rr(rng, 0.08, 0.16);
      b.box(tw, sh, tw, tone, [0, ty + sh / 2, 0]);
      ty += sh;
    }
    if (rng() < 0.45) b.cone(tw * 0.28, h * 0.22, 4, tone, [0, ty + h * 0.11, 0], { rot: [0, Math.PI / 4, 0] });
    const cols = Math.floor(w / 4);
    for (let c = 0; c < cols; c++) {
      for (let f = 0; f < 6; f++) {
        if (rng() < 0.55) continue;
        b.box(1.6, 2.2, 0.3, 0xffd27a, [-w / 2 + 2 + c * 4, h * (0.15 + f * 0.13), -w / 2 - 0.2], { layer: 'window' });
      }
    }
  }
  b.frame = null;
  const group = new THREE.Group();
  group.name = 'skyline';
  const body = b.buildGeometry('lit');
  if (body) group.add(new THREE.Mesh(body, SKYLINE_MATS.body));
  const win = b.buildGeometry('window');
  if (win) group.add(new THREE.Mesh(win, SKYLINE_MATS.windows));
  return group;
}

/** Sunlit brick warehouse garage with a central turntable (child 'turntable' rotates). */
export function buildGarage(): THREE.Group {
  const rng = mulberry32(1940);
  const b = new GeoBuilder();
  const W = 12; // half extents
  const H = 11;
  const mortar = 0x7d4a38;
  // Floor
  b.box(W * 2, 0.2, W * 2, 0x7b6e5f, [0, -0.1, 0]);
  for (let i = 0; i < 10; i++) b.box(rr(rng, 1, 4), 0.01, rr(rng, 1, 4), 0x6c6052, [rr(rng, -10, 10), 0.005, rr(rng, -10, 10)], { rot: [0, rng(), 0] });
  // Walls (mortar base + brick courses)
  const walls: { pos: V3; rotY: number; len: number }[] = [
    { pos: [0, 0, -W], rotY: 0, len: W * 2 },
    { pos: [-W, 0, 0], rotY: Math.PI / 2, len: W * 2 },
    { pos: [W, 0, 0], rotY: -Math.PI / 2, len: W * 2 },
  ];
  const windowsOn: Record<number, number[]> = { 0: [3.5], 1: [-6, 0, 6] };
  walls.forEach((wall, wi) => {
    b.frame = new THREE.Matrix4().makeRotationY(wall.rotY).setPosition(wall.pos[0], 0, wall.pos[2]);
    b.box(wall.len, H, 0.4, mortar, [0, H / 2, -0.2]);
    const wins = windowsOn[wi] ?? [];
    for (let row = 0; row < H / 0.32; row++) {
      const y = 0.16 + row * 0.32;
      let x = -wall.len / 2 + (row % 2 ? 0.35 : 0);
      while (x < wall.len / 2) {
        const bw = rr(rng, 0.62, 0.78);
        const inWindow = wins.some((wx) => Math.abs(x + bw / 2 - wx) < 2.5) && y > 3.2 && y < 8.6;
        if (!inWindow) {
          b.box(Math.min(bw - 0.05, wall.len / 2 - x), 0.27, 0.08, rpick(rng, [C.brick1, C.brick2, C.brick3, 0xa95a3e]), [x + bw / 2, y, 0.02]);
        }
        x += bw;
      }
    }
    // Industrial windows: glowing panes + iron mullions
    for (const wx of wins) {
      b.box(5.0, 5.4, 0.1, 0xfff1d0, [wx, 5.9, 0.0], { layer: 'glow' });
      for (let c = 0; c <= 6; c++) b.box(0.08, 5.4, 0.16, C.iron, [wx - 2.5 + c * (5 / 6), 5.9, 0.05]);
      for (let r = 0; r <= 6; r++) b.box(5.0, 0.08, 0.16, C.iron, [wx, 3.2 + r * 0.9, 0.05]);
      b.box(5.4, 0.25, 0.4, 0x6b4a3a, [wx, 3.05, 0.15]);
    }
    // Pilasters
    for (let p = -W + 0.5; p <= W - 0.5; p += 6) b.box(0.6, H, 0.5, C.brick4, [p, H / 2, 0.15]);
  });
  b.frame = null;
  // Roof trusses
  for (let z = -10; z <= 10; z += 5) {
    b.box(W * 2, 0.35, 0.3, C.iron, [0, H - 0.4, z]);
    for (let i = -3; i <= 3; i++) b.box(0.15, 2.2, 0.15, C.iron, [i * 3.2, H - 1.2, z], { rot: [0, 0, i % 2 ? 0.6 : -0.6] });
    b.box(W * 2, 0.2, 0.25, C.iron, [0, H - 2.3, z]);
  }
  b.box(W * 2, 0.4, W * 2, 0x3a2f28, [0, H + 0.2, 0]);
  // Hanging chains with hooks
  for (const [cx, cz, len] of [[-3.5, -2, 6], [5, -4, 5], [6.5, 2, 6.5]] as const) {
    for (let i = 0; i < len / 0.22; i++) b.box(0.06, 0.18, i % 2 ? 0.06 : 0.12, C.ironLight, [cx, H - 2.3 - i * 0.22, cz]);
    b.torus(0.18, 0.04, 4, 8, C.ironLight, [cx, H - 2.5 - len, cz], { rot: [0, Math.PI / 2, 0] }, Math.PI * 1.4);
  }
  // Mezzanine on the right side with railing and stairs
  b.box(5, 0.3, 14, 0x4a4038, [W - 2.5, 5.0, -4]);
  for (let z = -11; z <= 3; z += 2) b.box(0.25, 5, 0.25, C.iron, [W - 5, 2.5, z]);
  b.box(0.08, 0.08, 14, C.iron, [W - 5, 6.1, -4]);
  for (let z = -11; z <= 3; z += 1) b.box(0.05, 1.0, 0.05, C.iron, [W - 5, 5.6, z]);
  for (let i = 0; i < 12; i++) b.box(1.6, 0.12, 0.4, C.iron, [W - 6.0, 0.4 * i + 0.2, 4.0 + i * 0.4]);
  // Workbench + tools on the left
  b.box(3.6, 0.15, 1.2, C.wood, [-W + 1.2, 1.0, 4.5]);
  for (const dz of [-1.6, 1.6]) for (const dx of [-0.5, 0.5]) b.box(0.12, 1.0, 0.12, C.woodDark, [-W + 1.2 + dx, 0.5, 4.5 + dz]);
  b.box(0.6, 0.3, 0.4, 0x3d4a5c, [-W + 1.2, 1.25, 3.7]);
  b.box(0.08, 0.5, 0.08, 0x9aa3ad, [-W + 1.0, 1.3, 5.2], { rot: [0, 0, 0.4] });
  // Shelving unit with boxes
  for (let lvl = 0; lvl < 4; lvl++) {
    b.box(1.0, 0.08, 3.4, C.iron, [-W + 0.8, 0.4 + lvl * 0.95, -2.5]);
    for (let i = 0; i < 3; i++) {
      if (rng() < 0.3) continue;
      b.box(0.7, rr(rng, 0.4, 0.7), 0.8, rpick(rng, [C.crate, 0xb08458, 0x8a6a4a]), [-W + 0.8, 0.75 + lvl * 0.95, -3.6 + i * 1.1]);
    }
  }
  for (const dz of [-4.2, -0.8]) b.box(0.08, 3.8, 0.08, C.iron, [-W + 0.35, 1.9, dz]);
  // Fluorescent wall lamp
  b.box(3.2, 0.12, 0.25, C.iron, [-W + 0.4, 4.3, -2.5], { rot: [0, Math.PI / 2, 0] });
  b.box(3.0, 0.06, 0.12, 0xfff8e5, [-W + 0.45, 4.22, -2.5], { rot: [0, Math.PI / 2, 0], layer: 'glow' });
  // Red tool chest
  b.box(1.4, 1.1, 0.7, 0xb3261e, [W - 3.5, 0.55, -10.8]);
  for (let i = 0; i < 4; i++) b.box(1.3, 0.02, 0.02, C.chrome, [W - 3.5, 0.3 + i * 0.22, -10.44]);
  // Oil drums & tire stacks & crates around
  for (const [dx, dz, col] of [[-9.5, 9, C.drumGreen], [-8.6, 9.6, 0xd4a017], [9.6, 7.5, 0xb3261e], [10.4, 8.3, C.drumGreen], [9.8, -1.5, 0xd4a017]] as const) {
    b.cyl(0.42, 0.42, 1.2, 10, col, [dx, 0.6, dz]);
    b.cyl(0.43, 0.43, 0.06, 10, C.iron, [dx, 0.85, dz]);
    b.box(0.2, 0.26, 0.02, C.black, [dx, 0.6, dz - 0.42]);
  }
  for (const [tx, tz, n] of [[8.5, -6, 4], [-9.5, 6.8, 3], [10.2, 3, 2]] as const) {
    for (let i = 0; i < n; i++) b.torus(0.48, 0.2, 6, 10, C.tire, [tx, 0.2 + i * 0.4, tz], { rot: [Math.PI / 2, 0, 0] });
  }
  for (const [cx, cz, s] of [[-9, -8.5, 1.3], [-7.8, -9.4, 1.0], [9.5, 10.2, 1.4], [-10, 10.3, 1.2]] as const) {
    b.box(s, s, s, C.crate, [cx, s / 2, cz], { rot: [0, rng() * 0.6, 0] });
    b.box(s * 1.02, 0.1, s * 1.02, C.woodDark, [cx, s * 0.55, cz], { rot: [0, 0, 0] });
  }
  // Roll-up door on the back wall (right)
  b.box(4.5, 5, 0.15, 0x6f6a63, [-5.5, 2.5, -W + 0.3]);
  for (let i = 0; i < 12; i++) b.box(4.5, 0.05, 0.2, 0x55514b, [-5.5, 0.3 + i * 0.4, -W + 0.32]);
  // Sun patches on floor (additive)
  for (const [px, pz] of [[-3, -4], [-3, 2.5], [-3, 8]] as const) {
    b.box(5.5, 0.02, 3.8, 0xffcf80, [px, 0.03, pz], { layer: 'night', rot: [0, 0.35, 0] });
  }
  // Turntable base (static ring)
  b.cyl(4.4, 4.6, 0.22, 24, 0x4a4540, [0, 0.11, 0]);
  b.torus(4.35, 0.08, 4, 32, 0x8a8278, [0, 0.22, 0], { rot: [Math.PI / 2, 0, 0] });
  const room = b.build({ castShadow: false, receiveShadow: true });
  room.name = 'garage_room';
  // The garage owns its additive layer so the in-game night-FX opacity never affects it.
  const sunPatches = room.getObjectByName('layer_night') as THREE.Mesh | undefined;
  if (sunPatches) {
    const m = (sunPatches.material as THREE.MeshBasicMaterial).clone();
    m.opacity = 0.32;
    sunPatches.material = m;
  }

  const root = new THREE.Group();
  root.add(room);
  const turntable = new THREE.Group();
  turntable.name = 'turntable';
  const tb = new GeoBuilder();
  tb.cyl(4.1, 4.1, 0.12, 24, 0x6e6a64, [0, 0.28, 0]);
  for (let i = 0; i < 70; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * 3.9;
    tb.box(0.22, 0.02, 0.06, 0x8a857d, [Math.cos(a) * r, 0.345, Math.sin(a) * r], { rot: [0, rng() * Math.PI, 0] });
  }
  tb.torus(3.0, 0.04, 4, 32, 0x5a564f, [0, 0.35, 0], { rot: [Math.PI / 2, 0, 0] });
  const tt = tb.build({ castShadow: false, receiveShadow: true });
  turntable.add(tt);
  const center = new THREE.Object3D();
  center.name = 'turntable_center';
  center.position.set(0, 0.34, 0);
  turntable.add(center);
  root.add(turntable);

  // Volumetric window light shafts
  const shaftMat = new THREE.MeshBasicMaterial({
    color: 0xffd9a0,
    transparent: true,
    opacity: 0.07,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  for (const pz of [-6, 0, 6]) {
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(14, 4.6, 3.4), shaftMat);
    shaft.position.set(-6.2, 4.6, pz + 0.6);
    shaft.rotation.set(0, 0.35, -0.55);
    shaft.name = 'light_shaft';
    root.add(shaft);
  }
  return root;
}
