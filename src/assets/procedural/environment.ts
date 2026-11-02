import * as THREE from 'three';
import { GeoBuilder, type V3 } from '../../core/GeoBuilder';
import { C } from '../../core/Palette';
import { mulberry32 } from '../../core/math';
import { ROAD } from '../../data/config';

export type ChunkKind = 'straight' | 'curveL' | 'curveR' | 'highway' | 'desert' | 'desertL' | 'desertR' | 'forest' | 'forestL' | 'forestR';
export const CURVE_TURN = Math.PI / 4; // 45° per curved chunk

export function chunkTurn(kind: ChunkKind): number {
  return kind === 'curveL' || kind === 'desertL' || kind === 'forestL' ? CURVE_TURN : kind === 'curveR' || kind === 'desertR' || kind === 'forestR' ? -CURVE_TURN : 0;
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

const PAINTED = [0xe6d5b8, 0x8fa98a, 0x7d95b0, 0xd9a57a, 0xc9b79c];
const SIGNS = [0x1d3557, 0x7b2d26, 0x264653, 0x3a0ca3, 0x2b2d42, 0x6a040f];

/**
 * A city building built in its own frame: width along local X, facade facing local -Z.
 * Plinth, storefront with sign board + awning, pilastered window grid with sills, AC units and
 * flower boxes, side windows, cornice, setback tower, fire escape, neon blade sign and rooftop
 * clutter (water tower, AC units, chimneys, antennas, billboards).
 */
function building(b: GeoBuilder, rng: Rng, w: number, h: number, d: number): void {
  const painted = rng() < 0.28;
  const color = painted ? rpick(rng, PAINTED) : rpick(rng, BRICKS);
  const trim = color === C.tan || painted ? C.stoneDark : C.trim;
  const front = -d / 2;
  b.box(w, h, d, color, [0, h / 2, 0]);
  b.box(w + 0.12, 0.6, d + 0.12, painted ? 0x8c7f6c : 0x6b3a2c, [0, 0.3, 0]);
  // Storefront: dark frame, display windows, door, sign board with glowing letters, striped awning
  b.box(w + 0.1, 0.35, d + 0.1, trim, [0, 3.6, 0]);
  b.box(w - 0.6, 2.4, 0.1, 0x262a31, [0, 1.5, front - 0.02]);
  b.box(w * 0.38, 1.6, 0.06, 0xffffff, [-w * 0.22, 1.7, front - 0.08], { layer: rng() < 0.55 ? 'window' : 'lit' });
  b.box(w * 0.2, 1.6, 0.06, 0xffffff, [w * 0.05, 1.7, front - 0.08], { layer: rng() < 0.5 ? 'window' : 'lit' });
  b.box(1.1, 2.3, 0.08, C.woodDark, [w * 0.3, 1.15, front - 0.06]);
  b.box(0.08, 0.08, 0.1, C.chrome, [w * 0.3 - 0.35, 1.15, front - 0.12]);
  if (rng() < 0.75) {
    const sw = Math.min(w * 0.7, 7);
    b.box(sw, 0.6, 0.14, rpick(rng, SIGNS), [0, 4.15, front - 0.12]);
    const letters = Math.floor(sw / 0.7);
    const letterColor = rpick(rng, [0xfff1c4, C.neonYellow, C.neonCyan, C.neonPink]);
    for (let i = 0; i < letters; i++) {
      if (rng() < 0.15) continue;
      b.box(0.36, rr(rng, 0.28, 0.4), 0.04, letterColor, [-sw / 2 + 0.45 + i * 0.7, 4.15, front - 0.2], { layer: 'glow' });
    }
  }
  if (rng() < 0.7) {
    const aw = rpick(rng, [C.awningTeal, C.awningRed, 0x3d5a80, 0x6a994e]);
    const aw2 = rng() < 0.5 ? C.stripeWhite : aw;
    const n = Math.floor((w * 0.8) / 0.6);
    for (let i = 0; i < n; i++) {
      b.box(0.6, 0.1, 1.5, i % 2 ? aw2 : aw, [-w * 0.4 + 0.3 + i * 0.6, 3.1, front - 0.7], { rot: [0.32, 0, 0] });
    }
    b.box(w * 0.8, 0.35, 0.06, aw, [0, 2.78, front - 1.42]);
  }
  // Window grid with pilasters and string courses
  const floors = Math.floor((h - 4.5) / 3);
  const cols = Math.max(2, Math.floor(w / 2.3));
  const colW = w / cols;
  for (let c = 0; c <= cols; c++) {
    b.box(0.2, h - 3.9, 0.14, trim, [-w / 2 + colW * c, 3.9 + (h - 3.9) / 2, front - 0.05]);
  }
  for (let f = 0; f < floors; f++) {
    const y = 5.6 + f * 3;
    if (y > h - 1.4) break;
    if (f % 2 === 1) b.box(w + 0.06, 0.16, 0.18, trim, [0, y - 1.5, front - 0.06]);
    for (let c = 0; c < cols; c++) {
      const x = -w / 2 + colW * (c + 0.5);
      b.box(1.15, 1.75, 0.12, trim, [x, y, front - 0.04]);
      const lit = rng() < 0.42;
      b.box(0.92, 1.5, 0.1, lit ? 0xffffff : C.glassDay, [x, y, front - 0.08], { layer: lit ? 'window' : 'lit' });
      b.box(0.06, 1.5, 0.11, trim, [x, y, front - 0.09]);
      if (lit && rng() < 0.35) b.box(0.92, 0.5, 0.11, rpick(rng, [0x9b2c2c, 0x2f6f73, 0xc9a227]), [x, y + 0.5, front - 0.095]);
      b.box(1.3, 0.1, 0.22, trim, [x, y - 0.9, front - 0.1]);
      b.box(1.25, 0.14, 0.14, trim, [x, y + 0.92, front - 0.08]);
      const extra = rng();
      if (extra < 0.12) {
        b.box(0.7, 0.45, 0.45, 0xa7adb3, [x, y - 0.65, front - 0.3]);
        b.box(0.5, 0.3, 0.02, 0x6b7177, [x, y - 0.65, front - 0.53]);
      } else if (extra < 0.22) {
        b.box(1.0, 0.22, 0.3, C.woodDark, [x, y - 0.75, front - 0.25]);
        for (let k = 0; k < 4; k++) b.ico(0.11, rpick(rng, [0xe63946, 0xff8fab, 0xffd166, 0x6a994e]), [x - 0.36 + k * 0.24, y - 0.56, front - 0.27]);
      }
    }
    // Side windows (visible on curves)
    for (const sx of [-1, 1]) {
      for (let k = 0; k < Math.min(3, Math.floor(d / 3)); k++) {
        const z = front + 1.6 + k * 2.6;
        const sl = rng() < 0.35;
        b.box(0.1, 1.5, 0.9, sl ? 0xffffff : C.glassDay, [sx * (w / 2 + 0.04), y, z], { layer: sl ? 'window' : 'lit' });
      }
    }
  }
  // Cornice / parapet with brackets
  b.box(w + 0.5, 0.45, d + 0.5, trim, [0, h + 0.1, 0]);
  b.box(w + 0.1, 0.5, d + 0.1, color, [0, h + 0.55, 0]);
  for (let c = 0; c < cols; c++) b.box(0.2, 0.3, 0.3, trim, [-w / 2 + colW * (c + 0.5), h - 0.25, front - 0.15]);
  let roofY = h + 0.8;
  // Setback tower on tall buildings
  if (h >= 21 && rng() < 0.45) {
    const tw = w * 0.62;
    const td = d * 0.6;
    const th = rr(rng, 6, 14);
    b.box(tw, th, td, color, [0, roofY + th / 2, 0.6]);
    for (let f = 0; f < Math.floor(th / 3); f++) {
      for (let c = 0; c < Math.max(2, Math.floor(tw / 2.3)); c++) {
        const lit = rng() < 0.4;
        b.box(0.85, 1.4, 0.08, lit ? 0xffffff : C.glassDay, [-tw / 2 + 1.2 + c * 2.3, roofY + 1.6 + f * 3, 0.6 - td / 2 - 0.05], { layer: lit ? 'window' : 'lit' });
      }
    }
    b.box(tw + 0.4, 0.35, td + 0.4, trim, [0, roofY + th, 0.6]);
    roofY += th + 0.2;
  }
  // Rooftop clutter
  for (let i = 0; i < 1 + Math.floor(rng() * 3); i++) {
    b.box(rr(rng, 0.8, 1.6), rr(rng, 0.6, 1.0), rr(rng, 0.8, 1.4), rpick(rng, [0x9aa3ad, 0x7c848c, 0xb8bec4]), [rr(rng, -w / 3, w / 3), h + 1.1, rr(rng, -d / 4, d / 3)]);
  }
  if (rng() < 0.5) b.box(0.6, 1.6, 0.6, rpick(rng, [C.brick4, C.brick2]), [rr(rng, -w / 3, w / 3), h + 1.6, d / 3]);
  if (rng() < 0.35) {
    const ax = rr(rng, -w / 3, w / 3);
    b.cyl(0.04, 0.06, 4, 5, C.iron, [ax, roofY + 2, 0]);
    b.box(1.2, 0.05, 0.05, C.iron, [ax, roofY + 3.2, 0]);
    b.box(0.12, 0.12, 0.12, 0xff3030, [ax, roofY + 4.05, 0], { layer: 'glow' });
  }
  // Rooftop billboard facing the street
  if (rng() < 0.22 && h < 22) {
    const bw = Math.min(w - 1, rr(rng, 5, 8));
    const by = h + 3.2;
    for (const px of [-bw / 3, bw / 3]) b.box(0.18, 3.2, 0.18, C.iron, [px, h + 1.6, front + 1.4]);
    b.box(bw + 0.3, 2.6, 0.2, 0xf1ece0, [0, by, front + 1.25]);
    const ad = rpick(rng, [[0xe63946, 0xffd166, 0x1d3557], [0x2a9d8f, 0xe9c46a, 0x264653], [0xf72585, 0x4cc9f0, 0x3a0ca3]]);
    b.box(bw, 1.2, 0.05, ad[0], [0, by + 0.55, front + 1.13]);
    b.box(bw * 0.6, 0.8, 0.05, ad[1], [-bw * 0.18, by - 0.5, front + 1.13]);
    b.box(bw * 0.3, 0.8, 0.05, ad[2], [bw * 0.32, by - 0.5, front + 1.13]);
    for (let i = 0; i < 3; i++) b.box(0.25, 0.12, 0.25, C.lampGlow, [-bw / 3 + i * (bw / 3), by + 1.45, front + 0.9], { layer: 'glow' });
  }
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
  // Water tower
  if (rng() < 0.3 && h > 12) {
    const tx = rr(rng, -w / 4, w / 4);
    for (const lx of [-0.8, 0.8]) for (const lz of [-0.8, 0.8]) b.box(0.12, 2, 0.12, C.iron, [tx + lx, h + 1.8, lz]);
    b.cyl(1.25, 1.25, 2.2, 9, C.wood, [tx, h + 3.9, 0]);
    b.cone(1.4, 1.1, 9, C.woodDark, [tx, h + 5.55, 0]);
  }
}

/** Simple back-row block: fills the gaps behind the street facades so the city never looks hollow. */
function backBlock(b: GeoBuilder, rng: Rng, w: number, h: number, d: number): void {
  const color = rpick(rng, [...BRICKS, ...PAINTED, C.stone]);
  b.box(w, h, d, color, [0, h / 2, 0]);
  b.box(w + 0.4, 0.4, d + 0.4, C.trim, [0, h, 0]);
  const cols = Math.max(2, Math.floor(w / 2.6));
  for (let f = 0; f < Math.floor((h - 3) / 3.2); f++) {
    for (let c = 0; c < cols; c++) {
      const lit = rng() < 0.38;
      b.box(1.0, 1.4, 0.08, lit ? 0xffffff : C.glassDay, [-w / 2 + (w / cols) * (c + 0.5), 3.2 + f * 3.2, -d / 2 - 0.04], { layer: lit ? 'window' : 'lit' });
    }
  }
  if (rng() < 0.3) {
    const tx = rr(rng, -w / 4, w / 4);
    b.cyl(1.0, 1.0, 1.8, 8, C.wood, [tx, h + 2.6, 0]);
    b.cone(1.1, 0.9, 8, C.woodDark, [tx, h + 3.95, 0]);
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
  if (t < 0.16) {
    b.box(1.0, 0.9, 1.0, C.crate, [0, 0.45, 0], { rot: [0, rng(), 0] });
    b.box(0.8, 0.7, 0.8, C.crate, [0.2, 1.25, 0.1], { rot: [0, rng(), 0] });
    b.box(1.02, 0.08, 1.02, C.woodDark, [0, 0.62, 0]);
  } else if (t < 0.28) {
    b.cyl(0.38, 0.38, 1.0, 9, C.drumGreen, [0, 0.5, 0]);
    b.cyl(0.39, 0.39, 0.06, 9, C.iron, [0, 0.7, 0]);
    b.cyl(0.38, 0.38, 1.0, 9, C.drumGreen, [0.85, 0.5, 0.2]);
  } else if (t < 0.4) {
    // Trash can
    b.cyl(0.32, 0.28, 0.9, 8, 0x55606b, [0, 0.45, 0]);
    b.cyl(0.36, 0.36, 0.08, 8, 0x3d454e, [0, 0.93, 0]);
  } else if (t < 0.5) {
    // Fire hydrant
    b.cyl(0.16, 0.18, 0.7, 7, 0xc23a2b, [0, 0.35, 0]);
    b.sphere(0.17, 7, 3, 0xc23a2b, [0, 0.7, 0]);
    b.cyl(0.06, 0.06, 0.4, 5, 0xc23a2b, [0, 0.45, 0], { rot: [0, 0, Math.PI / 2] });
  } else if (t < 0.6) {
    // Mailbox
    b.box(0.5, 1.0, 0.5, 0x2563a8, [0, 0.6, 0]);
    b.cyl(0.25, 0.25, 0.5, 8, 0x1e4f86, [0, 1.1, 0], { rot: [Math.PI / 2, 0, 0] });
  } else if (t < 0.72) {
    // Bench
    b.box(1.8, 0.08, 0.5, C.wood, [0, 0.48, 0]);
    b.box(1.8, 0.45, 0.07, C.wood, [0, 0.78, 0.24], { rot: [-0.15, 0, 0] });
    for (const x of [-0.75, 0.75]) b.box(0.08, 0.48, 0.5, C.iron, [x, 0.24, 0]);
  } else if (t < 0.82) {
    // Phone booth
    b.box(0.95, 2.3, 0.95, 0x8a1c1c, [0, 1.15, 0]);
    b.box(0.75, 1.5, 0.05, 0xffffff, [0, 1.25, -0.48], { layer: 'window' });
    b.box(1.0, 0.18, 1.0, 0x6a1414, [0, 2.38, 0]);
    b.box(0.6, 0.14, 0.04, 0xfff1c4, [0, 2.15, -0.5], { layer: 'glow' });
  } else if (t < 0.9) {
    // Newspaper stand
    b.box(1.2, 1.1, 0.7, 0x2f6f73, [0, 0.55, 0]);
    b.box(1.0, 0.5, 0.05, 0xf2efe6, [0, 0.8, -0.36]);
    b.box(1.3, 0.1, 0.8, 0x24575a, [0, 1.15, 0]);
  } else {
    // Street clock
    b.cyl(0.08, 0.1, 3.0, 6, C.iron, [0, 1.5, 0]);
    b.cyl(0.42, 0.42, 0.18, 12, C.iron, [0, 3.2, 0], { rot: [Math.PI / 2, 0, 0] });
    b.cyl(0.36, 0.36, 0.2, 12, 0xfff8e5, [0, 3.2, 0], { rot: [Math.PI / 2, 0, 0], layer: 'window' });
  }
}

/** Sidewalk tree in a square planter. */
function streetTree(b: GeoBuilder, rng: Rng): void {
  b.box(1.3, 0.35, 1.3, 0x8a8278, [0, 0.17, 0]);
  b.box(1.1, 0.05, 1.1, 0x4a3b2a, [0, 0.36, 0]);
  const h = rr(rng, 2.4, 3.2);
  b.cyl(0.13, 0.17, h, 6, C.woodDark, [0, h / 2 + 0.35, 0]);
  b.ico(rr(rng, 1.3, 1.7), rpick(rng, [C.grass, 0x5d9a43, 0x77b255]), [0, h + 1.1, 0]);
  b.ico(rr(rng, 0.8, 1.1), 0x86c062, [0.5, h + 1.8, -0.2]);
}

/** Traffic light at a crosswalk; side = +1 right curb, -1 left curb. */
function trafficLight(b: GeoBuilder, side: number): void {
  b.cyl(0.1, 0.12, 5.4, 6, C.iron, [0, 2.7, 0]);
  b.box(3.4, 0.12, 0.12, C.iron, [-side * 1.6, 5.3, 0]);
  b.box(0.45, 1.25, 0.4, 0x1f2124, [-side * 3.1, 4.75, 0]);
  // Lamps face +Z, i.e. toward the approaching player.
  b.box(0.26, 0.26, 0.05, 0xff3030, [-side * 3.1, 5.15, 0.22], { layer: 'glow' });
  b.box(0.26, 0.26, 0.05, 0x553c10, [-side * 3.1, 4.75, 0.22]);
  b.box(0.26, 0.26, 0.05, 0x103d1c, [-side * 3.1, 4.35, 0.22]);
}

function cityStreet(b: GeoBuilder, rng: Rng, turn: number, L: number): void {
  const segs = turn === 0 ? 1 : 10;
  strip(b, turn, L, -ROAD.halfWidth, ROAD.halfWidth, 0, 0.3, C.asphalt, segs);
  for (const lat of [-5, 5]) dashes(b, turn, L, lat, C.laneWhite);
  solidLine(b, turn, L, -0.15, C.laneYellow, 0.14);
  solidLine(b, turn, L, 0.15, C.laneYellow, 0.14);
  for (const lat of [-9.5, 9.5]) solidLine(b, turn, L, lat, C.laneWhite, 0.22);
  // Asphalt patches, cracks and manholes for texture
  for (let i = 0; i < 6; i++) {
    b.frame = frameAt(rr(rng, 3, L - 3), rr(rng, -8, 8), turn, L);
    b.box(rr(rng, 1.5, 4), 0.01, rr(rng, 1.5, 5), C.asphaltDark, [0, 0.004, 0], { rot: [0, rng(), 0] });
  }
  for (let i = 0; i < 2; i++) {
    b.frame = frameAt(rr(rng, 5, L - 5), rpick(rng, [-7.5, -2.5, 2.5, 7.5]), turn, L);
    b.cyl(0.55, 0.55, 0.03, 10, 0x55575c, [0, 0.012, 0]);
  }
  b.frame = null;
  // Crosswalk with traffic lights on some straight blocks
  const crossing = turn === 0 && rng() < 0.35;
  if (crossing) {
    for (let x = -9; x <= 9; x += 1.2) b.box(0.7, 0.02, 3.0, C.laneWhite, [x, 0.012, -4]);
    b.box(19.5, 0.02, 0.35, C.laneWhite, [0, 0.012, -6.2]);
    b.frame = frameAt(2, 10.8, turn, L, 0, 0.16);
    trafficLight(b, 1);
    b.frame = frameAt(6, -10.8, turn, L, 0, 0.16);
    trafficLight(b, -1);
    b.frame = null;
  }
  // Sidewalks + curbs + back ground
  for (const side of [-1, 1]) {
    strip(b, turn, L, side * 10.25, side * 13.4, 0.16, 0.5, C.sidewalk, segs);
    strip(b, turn, L, side * 10.0, side * 10.3, 0.18, 0.52, C.curb, segs);
    strip(b, turn, L, side * 13.4, side * 70, 0.02, 0.4, 0x4a4540, segs);
  }
  for (const side of [-1, 1]) {
    for (let s = 2.5; s < L; s += 5) {
      b.frame = frameAt(s, side * 11.8, turn, L);
      b.box(3.0, 0.02, 0.06, 0x9e978d, [0, 0.165, 0]);
    }
  }
  b.frame = null;
  // Street facades on both sides
  for (const side of [-1, 1]) {
    let s = rr(rng, -1, 1);
    while (s < L) {
      const w = rr(rng, 8, 13);
      const h = rpick(rng, [9, 12, 15, 18, 21, 24, 27, 30]);
      const d = rr(rng, 9, 13);
      const centerS = s + w / 2;
      if (centerS - w / 2 > L - 1) break;
      const lat = side * (13.6 + d / 2);
      b.frame = frameAt(Math.min(centerS, L), lat, turn, L, side > 0 ? Math.PI / 2 : -Math.PI / 2);
      building(b, rng, w + 0.05, h, d);
      s += w;
    }
    // Back row so gaps between roofs show more city, not void (no shadow casting: far from the road)
    b.defaultLayer = 'far';
    let bs = rr(rng, -2, 4);
    while (bs < L) {
      const w = rr(rng, 10, 16);
      const h = rr(rng, 22, 42);
      b.frame = frameAt(Math.min(bs + w / 2, L), side * rr(rng, 31, 36), turn, L, side > 0 ? Math.PI / 2 : -Math.PI / 2);
      backBlock(b, rng, w, h, rr(rng, 8, 12));
      bs += w + rr(rng, 0, 3);
    }
    // Art-deco towers behind the blocks
    const towers = rng() < 0.75 ? (rng() < 0.4 ? 2 : 1) : 0;
    for (let k = 0; k < towers; k++) {
      const tw = rr(rng, 14, 22);
      const th = rr(rng, 50, 95);
      b.frame = frameAt(rr(rng, 8, L - 8), side * rr(rng, 46, 64), turn, L, 0);
      b.box(tw, th, tw, rpick(rng, [C.stone, C.tan, C.stoneDark]), [0, th / 2, 0]);
      b.box(tw * 0.75, th * 0.18, tw * 0.75, C.stone, [0, th + th * 0.09, 0]);
      b.box(tw * 0.45, th * 0.12, tw * 0.45, C.stoneDark, [0, th * 1.24, 0]);
      if (rng() < 0.5) b.cone(tw * 0.15, th * 0.2, 4, C.stone, [0, th * 1.4, 0], { rot: [0, Math.PI / 4, 0] });
      for (let i = 0; i < 5; i++) {
        for (const face of [-1, 1]) {
          b.box(tw * 0.08, th * 0.85, 0.2, 0x47566a, [-tw * 0.4 + i * tw * 0.2, th * 0.5, face * (tw / 2 + 0.1)], { layer: rng() < 0.3 ? 'window' : 'lit' });
        }
      }
    }
  }
  b.defaultLayer = 'lit';
  // Street lights alternating sides
  for (const [s, side] of [[12, 1], [37, -1]] as const) {
    b.frame = frameAt(s, side * 11.5, turn, L, 0, 0.16);
    streetLight(b, side);
  }
  // Sidewalk trees and props (kept near the facades)
  for (const side of [-1, 1]) {
    for (const s of [6, 27, 44]) {
      if (rng() < 0.35) continue;
      b.frame = frameAt(s + rr(rng, -2, 2), side * 12.9, turn, L, 0, 0.16);
      streetTree(b, rng);
    }
    for (let i = 0; i < 4; i++) {
      if (rng() < 0.3) continue;
      b.frame = frameAt(rr(rng, 3, L - 3), side * rr(rng, 12.4, 13.0), turn, L, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0.16);
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
  b.defaultLayer = 'far';
  let s = 0;
  while (s < L) {
    const w = rr(rng, 10, 16);
    const h = rpick(rng, [10, 13, 16, 22, 30]);
    const d = rr(rng, 10, 14);
    b.frame = frameAt(Math.min(s + w / 2, L), -(38 + d / 2), 0, L, -Math.PI / 2);
    building(b, rng, w, h, d);
    s += w + rr(rng, 1, 5);
  }
  b.defaultLayer = 'lit';
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
  // Beach: dry sand, wet sand, rocks, palms, umbrellas, towels
  strip(b, 0, L, 11.0, 13.0, -0.05, 0.4, C.sandDark, 1);
  strip(b, 0, L, 13.0, 31, -0.18, 0.4, C.sand, 1);
  strip(b, 0, L, 31, 34.6, -0.24, 0.4, 0xcdb27d, 1);
  for (let i = 0; i < 4; i++) {
    const z = -rr(rng, 3, L - 3);
    b.ico(rr(rng, 0.6, 1.4), 0x8c8f93, [rr(rng, 14, 30), -0.1, z], { scale: [1.3, 0.7, 1] });
  }
  for (let i = 0; i < 5; i++) palm(b, rng, rr(rng, 13.5, 22), -rr(rng, 3, L - 3), -0.18);
  const UMBRELLA = [[0xe63946, C.stripeWhite], [0x2a9d8f, 0xf1faee], [0xf4a261, 0x264653], [0x457b9d, 0xffd166]] as const;
  for (let i = 0; i < 4; i++) {
    const ux = rr(rng, 18, 29);
    const uz = -rr(rng, 4, L - 4);
    const [c1, c2] = rpick(rng, UMBRELLA);
    b.cyl(0.05, 0.05, 2.4, 5, C.stripeWhite, [ux, 1.0, uz], { rot: [0, 0, 0.12] });
    for (let k = 0; k < 8; k++) {
      b.add(new THREE.ConeGeometry(1.5, 0.6, 8, 1, true, (k / 8) * Math.PI * 2, Math.PI / 4), k % 2 ? c1 : c2, [ux + 0.14, 2.35, uz]);
    }
    b.box(0.9, 0.04, 1.9, rpick(rng, [0xffd166, 0xef476f, 0x06d6a0, 0x118ab2]), [ux + 1.3, -0.16, uz + 0.4], { rot: [0, rng(), 0] });
  }
  if (rng() < 0.5) b.sphere(0.3, 8, 5, 0xff5d8f, [rr(rng, 20, 28), 0.1, -rr(rng, 5, L - 5)]);
  if (variant === 1) {
    // Lifeguard tower
    const lx = 26;
    const lz = -L * 0.45;
    for (const ox of [-0.9, 0.9]) for (const oz of [-0.9, 0.9]) b.box(0.14, 2.6, 0.14, C.stripeWhite, [lx + ox, 1.1, lz + oz]);
    b.box(2.4, 1.5, 2.2, 0xd62828, [lx, 3.1, lz]);
    b.box(2.0, 0.6, 0.06, 0x9ad1f5, [lx, 3.3, lz - 1.12], { layer: 'window' });
    b.profile([[-1.4, 0], [0, 0.7], [1.4, 0]], 2.8, C.stripeWhite, [lx, 3.85, lz], { rot: [0, Math.PI / 2, 0] });
    b.box(0.12, 2.8, 0.6, C.stripeWhite, [lx - 0.6, 0.9, lz + 1.6], { rot: [0.6, 0, 0] });
  }
  if (variant === 2) {
    // Wooden pier into the sea
    const pz = -L * 0.55;
    b.box(70, 0.25, 3.2, C.wood, [34 + 30, 0.45, pz]);
    for (let x = 0; x < 62; x += 6) for (const oz of [-1.4, 1.4]) b.box(0.3, 2.4, 0.3, C.woodDark, [36 + x, -0.6, pz + oz]);
    for (const oz of [-1.55, 1.55]) b.box(70, 0.12, 0.1, C.woodDark, [34 + 30, 1.4, pz + oz]);
  }
  // Ocean: faceted animated water bands (shallow turquoise -> deep blue), foam line and whitecaps
  const oceanBand = (x0: number, x1: number, color: number, y: number): void => {
    const w = x1 - x0;
    b.add(new THREE.PlaneGeometry(w, L + 0.05, Math.max(2, Math.ceil(w / 4.5)), 12), color, [(x0 + x1) / 2, y, -L / 2], { rot: [-Math.PI / 2, 0, 0], layer: 'water' });
  };
  oceanBand(34, 36.6, 0xf4fbff, -0.5);
  oceanBand(36.6, 56, 0x35c4cf, -0.56);
  oceanBand(56, 130, 0x1e96cf, -0.6);
  oceanBand(130, 420, 0x15629f, -0.62);
  for (let i = 0; i < 16; i++) {
    const wx = rr(rng, 45, 320);
    b.add(new THREE.PlaneGeometry(rr(rng, 2, 7), rr(rng, 0.4, 1.0)), 0xffffff, [wx, -0.5, -rr(rng, 2, L - 2)], { rot: [-Math.PI / 2, 0, rr(rng, -0.3, 0.3)], layer: 'water' });
  }
  for (let i = 0; i < (rng() < 0.7 ? 2 : 1); i++) {
    const bx = rr(rng, 70, 230);
    const bz = -rr(rng, 10, L - 10);
    if (rng() < 0.6) {
      b.box(3.2, 0.6, 1.0, C.stripeWhite, [bx, -0.35, bz]);
      b.profile([[0, 0], [0, 4.2], [-2.2, 0.2]], 0.06, C.stripeWhite, [bx, -0.05, bz + 0.6], { rot: [0, Math.PI / 2, 0] });
      b.profile([[0, 0], [0, 3.0], [1.3, 0.2]], 0.06, C.red, [bx, -0.05, bz + 0.5], { rot: [0, Math.PI / 2, 0] });
    } else {
      b.profile([[-2.2, 0], [-2.6, 0.7], [2.2, 0.7], [2.2, 0]], 1.4, C.stripeWhite, [bx, -0.55, bz], { rot: [0, rng() * 3, 0] });
      b.box(1.0, 0.6, 1.0, 0x1d3557, [bx, 0.45, bz]);
    }
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

const SAND = [0xdcb57c, 0xd2a86e, 0xe4c38d, 0xc99c62];
const ROCK = [0xb5603a, 0xa65434, 0xc4714a, 0x8f4a30];

function saguaro(b: GeoBuilder, rng: Rng): void {
  const h = rr(rng, 2.6, 4.6);
  const green = rpick(rng, [0x4f7d3a, 0x5b8a42, 0x466f33]);
  b.cyl(0.26, 0.3, h, 7, green, [0, h / 2, 0]);
  b.sphere(0.26, 7, 3, green, [0, h, 0]);
  const arms = rng() < 0.3 ? 0 : rng() < 0.6 ? 1 : 2;
  for (let i = 0; i < arms; i++) {
    const side = i === 0 ? 1 : -1;
    const ay = rr(rng, h * 0.35, h * 0.6);
    const up = rr(rng, 0.8, 1.6);
    b.cyl(0.17, 0.17, 0.75, 6, green, [side * 0.5, ay, 0], { rot: [0, 0, Math.PI / 2] });
    b.cyl(0.17, 0.17, up, 6, green, [side * 0.85, ay + up / 2, 0]);
    b.sphere(0.17, 6, 3, green, [side * 0.85, ay + up, 0]);
  }
}

function mesa(b: GeoBuilder, rng: Rng, w: number, h: number, d: number): void {
  let y = 0;
  let cw = w;
  let cd = d;
  const layers = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < layers; i++) {
    const lh = (h / layers) * rr(rng, 0.8, 1.2);
    b.box(cw, lh, cd, ROCK[i % ROCK.length], [rr(rng, -0.4, 0.4), y + lh / 2, rr(rng, -0.4, 0.4)]);
    y += lh;
    cw *= rr(rng, 0.86, 0.97);
    cd *= rr(rng, 0.86, 0.97);
  }
  b.box(cw * 1.02, 0.4, cd * 1.02, 0x7e3f28, [0, y + 0.2, 0]);
}

/** Sun-bleached desert highway: cracked asphalt, gravel shoulders, dunes, cacti, mesas, poles. */
function desertRoad(b: GeoBuilder, rng: Rng, turn: number, L: number, variant: number): void {
  const segs = turn === 0 ? 1 : 10;
  strip(b, turn, L, -ROAD.halfWidth, ROAD.halfWidth, 0, 0.3, 0x5c5852, segs);
  for (const lat of [-5, 5]) dashes(b, turn, L, lat, 0xe9e4d6, 3, 6, 0.18);
  solidLine(b, turn, L, -0.15, 0xe0b93a, 0.13);
  solidLine(b, turn, L, 0.15, 0xe0b93a, 0.13);
  for (const lat of [-9.5, 9.5]) solidLine(b, turn, L, lat, 0xe9e4d6, 0.2);
  // Cracks and sand drifts on the asphalt
  for (let i = 0; i < 10; i++) {
    b.frame = frameAt(rr(rng, 2, L - 2), rr(rng, -9, 9), turn, L);
    b.box(rr(rng, 0.05, 0.09), 0.012, rr(rng, 1.2, 4), 0x3b3834, [0, 0.006, 0], { rot: [0, rr(rng, -0.8, 0.8), 0] });
  }
  for (let i = 0; i < 3; i++) {
    b.frame = frameAt(rr(rng, 3, L - 3), (rng() < 0.5 ? -1 : 1) * rr(rng, 7, 9.6), turn, L);
    b.box(rr(rng, 1.5, 3), 0.02, rr(rng, 2, 5), 0xc9a36c, [0, 0.01, 0], { rot: [0, rng(), 0] });
  }
  b.frame = null;
  // Gravel shoulders + open desert floor
  for (const side of [-1, 1]) {
    strip(b, turn, L, side * 10.0, side * 12.0, -0.02, 0.3, 0xa89a86, segs);
    strip(b, turn, L, side * 12.0, side * 90, -0.06, 0.3, SAND[0], segs);
  }
  // Reflector posts (glow at night)
  for (const side of [-1, 1]) {
    for (let s = 5; s < L; s += 12.5) {
      b.frame = frameAt(s, side * 11.0, turn, L, 0, -0.02);
      b.box(0.1, 1.0, 0.1, 0xf4f1e8, [0, 0.5, 0]);
      b.box(0.11, 0.14, 0.04, side > 0 ? 0xff5a2a : 0xffd23f, [0, 0.85, -0.06], { layer: 'glow' });
    }
  }
  // Dunes, rocks, shrubs, cacti
  b.defaultLayer = 'far';
  for (let i = 0; i < 6; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    b.frame = frameAt(rr(rng, 0, L), side * rr(rng, 24, 75), turn, L);
    b.ico(rr(rng, 6, 15), rpick(rng, SAND), [0, -1.2, 0], { scale: [1.6, 0.28, 1] });
  }
  b.defaultLayer = 'lit';
  for (let i = 0; i < 7; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    b.frame = frameAt(rr(rng, 1, L - 1), side * rr(rng, 13.5, 40), turn, L, rng() * 6, -0.06);
    const t = rng();
    if (t < 0.45) saguaro(b, rng);
    else if (t < 0.75) b.ico(rr(rng, 0.5, 1.4), rpick(rng, [0x9b8b7a, 0xa0603e, 0x8a7a68]), [0, 0.2, 0], { scale: [1.3, 0.75, 1] });
    else b.ico(rr(rng, 0.35, 0.6), rpick(rng, [0x6f7a3c, 0x7d7a45, 0x5f6a34]), [0, 0.25, 0], { scale: [1.4, 0.7, 1.2] });
  }
  // Big mesa landmark sometimes
  if (rng() < 0.45) {
    b.defaultLayer = 'far';
    const side = rng() < 0.5 ? -1 : 1;
    b.frame = frameAt(rr(rng, 5, L - 5), side * rr(rng, 55, 85), turn, L, rng() * 6);
    mesa(b, rng, rr(rng, 18, 34), rr(rng, 14, 30), rr(rng, 14, 26));
    b.defaultLayer = 'lit';
  }
  // Telephone poles with wires along the right side
  for (const s of [0, 25]) {
    b.frame = frameAt(s + 2, 13.2, turn, L, 0, -0.06);
    b.cyl(0.11, 0.14, 7.5, 6, 0x6b4a2e, [0, 3.75, 0]);
    b.box(1.8, 0.12, 0.12, 0x6b4a2e, [0, 7.0, 0]);
    for (const x of [-0.75, 0.75]) b.box(0.08, 0.14, 0.08, 0xd8e4ee, [x, 7.12, 0]);
  }
  if (turn === 0) {
    for (const x of [13.2 - 0.75, 13.2 + 0.75]) b.box(0.025, 0.025, 25, 0x2a2a2a, [x, 7.05, -14.5]);
    for (const x of [13.2 - 0.75, 13.2 + 0.75]) b.box(0.025, 0.025, 25, 0x2a2a2a, [x, 7.05, -39.5]);
  }
  // Variant set pieces
  if (variant === 0 && turn === 0) {
    // Abandoned gas station
    b.frame = frameAt(25, -20, turn, L, -Math.PI / 2, -0.06);
    b.box(8, 3.4, 6, 0xd8c7a6, [0, 1.7, 2]);
    b.box(8.4, 0.3, 6.4, 0xb0412e, [0, 3.5, 2]);
    b.box(3.2, 1.6, 0.08, 0x2b3440, [-1.5, 1.6, -1.02]);
    b.box(1.1, 2.3, 0.08, 0x5e3b22, [2.4, 1.15, -1.02]);
    b.box(9, 0.35, 5, 0xb0412e, [0, 4.4, -4.5]);
    for (const x of [-3.8, 3.8]) b.box(0.25, 4.3, 0.25, 0xe6e0d2, [x, 2.15, -6.5]);
    for (const x of [-1.6, 1.6]) {
      b.box(0.7, 1.5, 0.5, 0xc8402c, [x, 0.75, -4.5]);
      b.box(0.5, 0.3, 0.05, 0xfff1c4, [x, 1.2, -4.76], { layer: 'glow' });
    }
    b.box(2.6, 0.9, 0.2, 0xf2c230, [0, 5.1, -4.5]);
    b.box(2.2, 0.5, 0.22, 0xc8402c, [0, 5.1, -4.5], { layer: 'glow' });
  } else if (variant === 1) {
    // Rusted wreck + bleached signboard
    b.frame = frameAt(30, 17, turn, L, 0.7, -0.06);
    b.box(1.8, 0.9, 4, 0x8a4f2e, [0, 0.6, 0], { rot: [0, 0, 0.12] });
    b.box(1.5, 0.6, 2, 0x6f3e24, [0, 1.3, 0.3], { rot: [0, 0, 0.12] });
    b.frame = frameAt(12, -15, turn, L, Math.PI / 2, -0.06);
    for (const x of [-2, 2]) b.box(0.2, 4, 0.2, 0x6b4a2e, [x, 2, 0]);
    b.box(5, 2.2, 0.15, 0xe8dcc0, [0, 3.6, 0]);
    b.box(4.4, 0.5, 0.17, 0xb0412e, [0, 4.1, 0]);
    b.box(3, 0.35, 0.17, 0x2b3440, [0, 3.3, 0]);
  }
  b.frame = null;
}

/** Distant mesas ringing the desert horizon (replaces the city skyline in desert mode). */
export function buildMesaRing(seed = 21): THREE.Group {
  const rng = mulberry32(seed);
  const b = new GeoBuilder();
  const count = 34;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rr(rng, -0.05, 0.05);
    const r = rr(rng, 240, 320);
    b.frame = new THREE.Matrix4().makeRotationY(-a).setPosition(Math.cos(a) * r, 0, Math.sin(a) * r);
    mesa(b, rng, rr(rng, 30, 70), rr(rng, 22, 60), rr(rng, 25, 50));
  }
  b.frame = null;
  const group = new THREE.Group();
  group.name = 'mesa_ring';
  const body = b.buildGeometry('lit');
  if (body) group.add(new THREE.Mesh(body, SKYLINE_MATS.body));
  return group;
}

const PINE = [0x2f5d34, 0x356b3a, 0x29522f, 0x3d7340, 0x24482a];
const GRASS = [0x3f6b33, 0x46753a, 0x395f2f];
const BARK = 0x5a3c26;

function pine(b: GeoBuilder, rng: Rng, scale = 1): void {
  const h = rr(rng, 7, 13) * scale;
  const green = rpick(rng, PINE);
  b.cyl(0.22 * scale, 0.32 * scale, h * 0.35, 6, BARK, [0, h * 0.175, 0]);
  const tiers = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const r = (2.1 - t * 1.5) * scale * rr(rng, 0.9, 1.1);
    b.cone(r, h * 0.38, 7, i % 2 ? green : rpick(rng, PINE), [0, h * (0.28 + t * 0.55) + h * 0.19, 0], { rot: [0, rng() * 3, 0] });
  }
}

function fallenLog(b: GeoBuilder, rng: Rng): void {
  const len = rr(rng, 3, 6);
  b.cyl(0.35, 0.4, len, 7, BARK, [0, 0.35, 0], { rot: [0, 0, Math.PI / 2] });
  b.cyl(0.3, 0.3, 0.05, 7, 0xc9a074, [len / 2 + 0.01, 0.35, 0], { rot: [0, 0, Math.PI / 2] });
  b.ico(0.4, 0x4f7a3a, [rr(rng, -1, 1), 0.65, 0.1], { scale: [1.4, 0.4, 1] });
}

/** Misty pine-forest logging road: dark asphalt, dirt shoulders, dense pines, logs, ferns, timber yard. */
function forestRoad(b: GeoBuilder, rng: Rng, turn: number, L: number, variant: number): void {
  const segs = turn === 0 ? 1 : 10;
  strip(b, turn, L, -ROAD.halfWidth, ROAD.halfWidth, 0, 0.3, 0x46484b, segs);
  for (const lat of [-5, 5]) dashes(b, turn, L, lat, 0xdfe3e0, 3, 6, 0.16);
  dashes(b, turn, L, 0, 0xe8c53a, 4, 4, 0.16);
  for (const lat of [-9.6, 9.6]) solidLine(b, turn, L, lat, 0xdfe3e0, 0.2);
  // Patched asphalt, mud and pine needles
  for (let i = 0; i < 6; i++) {
    b.frame = frameAt(rr(rng, 2, L - 2), rr(rng, -9, 9), turn, L);
    b.box(rr(rng, 1.2, 2.6), 0.012, rr(rng, 1.2, 3), rpick(rng, [0x3a3c3e, 0x515356, 0x4a4036]), [0, 0.006, 0], { rot: [0, rng(), 0] });
  }
  b.frame = null;
  for (const side of [-1, 1]) {
    strip(b, turn, L, side * 10.0, side * 12.6, -0.02, 0.3, 0x6b5a40, segs);
    strip(b, turn, L, side * 12.6, side * 90, -0.06, 0.3, GRASS[0], segs);
  }
  // Wooden guard rail
  for (const side of [-1, 1]) {
    for (let s = 2; s < L; s += 5) {
      b.frame = frameAt(s, side * 12.9, turn, L, 0, -0.02);
      b.box(0.22, 1.0, 0.22, 0x6e4b2c, [0, 0.5, 0]);
      b.box(0.08, 0.12, 0.05, side > 0 ? 0xff5a2a : 0xffd23f, [-side * 0.12, 0.8, 0], { layer: 'glow' });
    }
    b.frame = null;
    strip(b, turn, L, side * 12.8, side * 13.0, 0.85, 0.22, 0x7a5532, segs);
  }
  // Dense pines (near ones cast shadows, far ones go on the cheap layer)
  for (let i = 0; i < 30; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    const far = i >= 16;
    b.defaultLayer = far ? 'far' : 'lit';
    b.frame = frameAt(rr(rng, 0, L), side * (far ? rr(rng, 30, 80) : rr(rng, 14.5, 30)), turn, L, rng() * 6, -0.06);
    pine(b, rng, far ? rr(rng, 1.2, 1.7) : rr(rng, 0.8, 1.2));
  }
  b.defaultLayer = 'lit';
  for (let i = 0; i < 9; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    b.frame = frameAt(rr(rng, 1, L - 1), side * rr(rng, 13.6, 26), turn, L, rng() * 6, -0.06);
    const t = rng();
    if (t < 0.35) b.ico(rr(rng, 0.4, 0.8), rpick(rng, [0x4f7a3a, 0x5b8a42, 0x3f6b33]), [0, 0.3, 0], { scale: [1.5, 0.6, 1.3] });
    else if (t < 0.6) b.ico(rr(rng, 0.6, 1.3), rpick(rng, [0x7d8078, 0x6a6e66]), [0, 0.25, 0], { scale: [1.3, 0.7, 1] });
    else if (t < 0.8) fallenLog(b, rng);
    else {
      b.cyl(0.45, 0.5, 0.6, 8, BARK, [0, 0.3, 0]);
      b.cyl(0.42, 0.42, 0.04, 8, 0xc9a074, [0, 0.61, 0]);
    }
  }
  if (variant === 0 && turn === 0) {
    // Timber yard: stacked logs + sawmill shed
    b.frame = frameAt(22, -19, turn, L, Math.PI / 2, -0.06);
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 5 - row; i++) b.cyl(0.42, 0.42, 7, 8, row % 2 ? 0x6e4b2c : BARK, [-1.7 + i * 0.85 + row * 0.42, 0.42 + row * 0.74, 0], { rot: [Math.PI / 2, 0, 0] });
    }
    b.frame = frameAt(36, -22, turn, L, Math.PI / 2, -0.06);
    b.box(9, 4, 6, 0x7a5a3a, [0, 2, 0]);
    b.box(9.6, 0.3, 3.6, 0x5b3a2c, [0, 4.6, 1.6], { rot: [0.45, 0, 0] });
    b.box(9.6, 0.3, 3.6, 0x5b3a2c, [0, 4.6, -1.6], { rot: [-0.45, 0, 0] });
    b.box(3, 2.6, 0.08, 0x2b2622, [0, 1.3, -3.02]);
    b.box(2.2, 0.6, 0.1, 0xe8c53a, [0, 3.4, -3.05], { layer: 'glow' });
  } else if (variant === 1) {
    // Ranger lookout tower
    b.frame = frameAt(28, 20, turn, L, 0, -0.06);
    for (const x of [-1.4, 1.4]) for (const z of [-1.4, 1.4]) b.box(0.25, 9, 0.25, 0x6e4b2c, [x, 4.5, z]);
    b.box(4, 0.25, 4, 0x7a5532, [0, 9, 0]);
    b.box(4, 1.1, 0.12, 0x7a5532, [0, 9.6, -2]);
    b.box(4.4, 0.25, 4.4, 0x8a3a2a, [0, 11.2, 0]);
    for (const x of [-1.9, 1.9]) for (const z of [-1.9, 1.9]) b.box(0.15, 2, 0.15, 0x6e4b2c, [x, 10.1, z]);
    b.box(0.5, 0.3, 0.3, 0xffd27a, [0, 10.3, 0], { layer: 'glow' });
  }
  b.frame = null;
}

/** Distant pine ridges ringing the forest horizon (replaces the skyline in forest mode). */
export function buildPineRing(seed = 31): THREE.Group {
  const rng = mulberry32(seed);
  const b = new GeoBuilder();
  const count = 70;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rr(rng, -0.04, 0.04);
    const r = rr(rng, 230, 300);
    b.frame = new THREE.Matrix4().makeRotationY(-a).setPosition(Math.cos(a) * r, 0, Math.sin(a) * r);
    b.ico(rr(rng, 30, 55), PINE[i % PINE.length], [0, -10, 0], { scale: [1.6, 0.55, 1] });
    for (let k = 0; k < 3; k++) b.cone(rr(rng, 6, 10), rr(rng, 26, 46), 6, PINE[(i + k) % PINE.length], [rr(rng, -18, 18), rr(rng, 14, 26), rr(rng, -8, 8)]);
  }
  b.frame = null;
  const group = new THREE.Group();
  group.name = 'pine_ring';
  const body = b.buildGeometry('lit');
  if (body) group.add(new THREE.Mesh(body, SKYLINE_MATS.body));
  return group;
}

/** Builds the visual template for a chunk in local space (start at origin, heading -Z). */
export function buildChunkTemplate(kind: ChunkKind, seed: number): THREE.Group {
  const rng = mulberry32(seed);
  const b = new GeoBuilder();
  const L = ROAD.chunkLength;
  if (kind === 'highway') coastalHighway(b, rng, L, seed % 3);
  else if (kind === 'desert' || kind === 'desertL' || kind === 'desertR') desertRoad(b, rng, chunkTurn(kind), L, seed % 3);
  else if (kind === 'forest' || kind === 'forestL' || kind === 'forestR') forestRoad(b, rng, chunkTurn(kind), L, seed % 3);
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
