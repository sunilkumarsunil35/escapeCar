import * as THREE from 'three';
import { GeoBuilder, socket, type V3 } from '../../core/GeoBuilder';
import { C, glowMat } from '../../core/Palette';

export type WheelStyle = 'whitewall' | 'sport' | 'offroad' | 'armored';
export type SocketMap = Record<string, V3>;

const AXLE_X: V3 = [0, 0, Math.PI / 2];

/** Builds a single low-poly wheel (axle along X). */
export function buildWheel(radius: number, width: number, style: WheelStyle): THREE.Group {
  const b = new GeoBuilder();
  const seg = style === 'offroad' || style === 'armored' ? 9 : 10;
  b.cyl(radius, radius, width, seg, C.tire, [0, 0, 0], { rot: AXLE_X });
  switch (style) {
    case 'whitewall':
      b.cyl(radius * 0.8, radius * 0.8, width + 0.02, seg, C.whitewall, [0, 0, 0], { rot: AXLE_X });
      b.cyl(radius * 0.52, radius * 0.52, width + 0.04, 8, C.chromeDark, [0, 0, 0], { rot: AXLE_X });
      b.cyl(radius * 0.4, radius * 0.4, width + 0.06, 8, C.chrome, [0, 0, 0], { rot: AXLE_X });
      b.cyl(radius * 0.12, radius * 0.12, width + 0.09, 6, C.redDark, [0, 0, 0], { rot: AXLE_X });
      break;
    case 'sport':
      b.cyl(radius * 0.68, radius * 0.68, width + 0.02, 10, C.iron, [0, 0, 0], { rot: AXLE_X });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        b.box(width + 0.04, radius * 0.6, 0.07, C.chrome, [0, Math.sin(a) * radius * 0.3, Math.cos(a) * radius * 0.3], { rot: [-a, 0, 0] });
      }
      b.cyl(radius * 0.16, radius * 0.16, width + 0.07, 6, C.chrome, [0, 0, 0], { rot: AXLE_X });
      break;
    case 'offroad':
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        b.box(width * 0.9, 0.09, radius * 0.38, C.tire, [0, Math.sin(a) * radius, Math.cos(a) * radius], { rot: [-a, 0, 0] });
      }
      b.cyl(radius * 0.55, radius * 0.55, width + 0.03, 8, C.ironLight, [0, 0, 0], { rot: AXLE_X });
      b.cyl(radius * 0.2, radius * 0.2, width + 0.07, 6, C.chromeDark, [0, 0, 0], { rot: AXLE_X });
      break;
    case 'armored':
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        for (const side of [-1, 1]) {
          b.box(0.09, 0.09, 0.09, C.chromeDark, [side * width * 0.32, Math.sin(a) * (radius + 0.02), Math.cos(a) * (radius + 0.02)], { rot: [-a, 0, 0] });
        }
      }
      b.cyl(radius * 0.74, radius * 0.74, width + 0.02, 9, C.ironLight, [0, 0, 0], { rot: AXLE_X });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        b.ico(0.04, C.chrome, [width / 2 + 0.03, Math.sin(a) * radius * 0.5, Math.cos(a) * radius * 0.5]);
        b.ico(0.04, C.chrome, [-width / 2 - 0.03, Math.sin(a) * radius * 0.5, Math.cos(a) * radius * 0.5]);
      }
      b.cyl(radius * 0.25, radius * 0.25, width + 0.07, 6, C.chrome, [0, 0, 0], { rot: AXLE_X });
      break;
  }
  const g = b.build({ castShadow: true, receiveShadow: false });
  g.name = 'wheel_mesh';
  return g;
}

/** Adds wheel socket hierarchy: socket → steer (Y) → spin (X) → mesh. */
export function attachWheels(root: THREE.Object3D, sockets: SocketMap, style: WheelStyle, width: number, radiusScale = 1): void {
  for (const [name, pos] of Object.entries(sockets)) {
    if (!name.startsWith('wheel_')) continue;
    const s = socket(name, pos);
    const steer = new THREE.Group();
    steer.name = 'steer';
    const spin = new THREE.Group();
    spin.name = 'spin';
    const radius = pos[1] * radiusScale;
    spin.add(buildWheel(radius, width, style));
    steer.add(spin);
    s.add(steer);
    s.userData.radius = radius;
    root.add(s);
  }
}

export function addSockets(root: THREE.Object3D, sockets: SocketMap, skipPrefix = 'wheel_'): void {
  for (const [name, pos] of Object.entries(sockets)) {
    if (name.startsWith(skipPrefix)) continue;
    root.add(socket(name, pos));
  }
}

/** Fender arch profile in (z,y) that wraps a wheel centered at cz with arch radius R. */
function fenderProfile(cz: number, cy: number, R: number, frontExt: number, backExt: number, topY: number, lowY: number): [number, number][] {
  const pts: [number, number][] = [
    [cz - frontExt, lowY + 0.06],
    [cz - frontExt * 0.78, topY - 0.14],
    [cz - R * 0.75, topY],
    [cz + R * 0.55, topY],
    [cz + R * 1.05, topY - 0.14],
    [cz + backExt, lowY + 0.1],
    [cz + backExt, lowY],
  ];
  for (const deg of [10, 45, 90, 135, 170]) {
    const a = (deg * Math.PI) / 180;
    pts.push([cz + Math.cos(a) * R, cy + Math.sin(a) * R]);
  }
  pts.push([cz - frontExt, lowY]);
  return pts;
}

export interface SedanOpts {
  body: number;
  fender?: number;
  glass?: number;
  enemy?: boolean;
}

/** 1940s chunky getaway sedan — the hero silhouette from every concept piece. */
export function buildSedan(sockets: SocketMap, opts: SedanOpts, wheelStyle: WheelStyle = 'whitewall'): THREE.Group {
  const root = new THREE.Group();
  const b = new GeoBuilder();
  const body = opts.body;
  const fender = opts.fender ?? body;
  const glass = opts.glass ?? 0x1e2633;
  const fz = sockets.wheel_FL?.[2] ?? -1.3;
  const rz = sockets.wheel_RL?.[2] ?? 1.3;
  const wy = sockets.wheel_FL?.[1] ?? 0.42;
  const wx = Math.abs(sockets.wheel_FL?.[0] ?? 0.86);

  // Chassis underside
  b.box(1.3, 0.16, 3.7, C.iron, [0, 0.4, 0]);
  // Main hull: long hood + rounded trunk hump
  b.profile([[-2.0, 0.42], [-2.0, 0.9], [-1.86, 1.0], [-0.6, 1.05], [1.22, 1.05], [1.72, 0.95], [2.04, 0.7], [2.04, 0.42]], 1.42, body);
  // Cabin
  b.profile([[-0.62, 1.02], [-0.32, 1.58], [1.0, 1.6], [1.32, 1.02]], 1.36, body);
  // Roof cap for a slightly domed silhouette
  b.box(1.22, 0.05, 1.18, body, [0, 1.615, 0.34]);
  // Windshield / rear glass / side windows
  b.profile([[-0.645, 1.09], [-0.375, 1.54], [-0.35, 1.54], [-0.62, 1.09]], 1.2, glass);
  b.profile([[1.05, 1.54], [1.3, 1.1], [1.33, 1.1], [1.07, 1.54]], 1.1, glass);
  for (const sx of [-1, 1]) {
    b.box(0.02, 0.34, 0.6, glass, [sx * 0.69, 1.31, -0.02]);
    b.box(0.02, 0.34, 0.5, glass, [sx * 0.69, 1.31, 0.66]);
    // Door handles + seam
    b.box(0.03, 0.03, 0.12, C.chrome, [sx * 0.715, 0.98, 0.18]);
    b.box(0.015, 0.5, 0.02, opts.enemy ? C.ironLight : C.redDark, [sx * 0.712, 0.78, 0.33]);
    // Hood louvers
    for (let i = 0; i < 3; i++) b.box(0.02, 0.05, 0.22, C.iron, [sx * 0.712, 0.86 - i * 0.07, -1.25]);
    // Fenders front & rear
    b.profile(fenderProfile(fz, wy, 0.48, 0.74, 0.86, 1.0, 0.44), 0.38, fender, [sx * wx, 0, 0]);
    b.profile(fenderProfile(rz, wy, 0.48, 0.62, 0.72, 0.98, 0.44), 0.38, fender, [sx * wx, 0, 0]);
    // Running boards
    b.box(0.36, 0.06, 1.25, C.iron, [sx * wx, 0.47, (fz + rz) / 2 + 0.02]);
    // Headlights pods on fenders
    b.cyl(0.16, 0.16, 0.12, 8, C.chrome, [sx * 0.62, 0.95, -1.86], { rot: [Math.PI / 2, 0, 0] });
    b.cyl(0.12, 0.12, 0.06, 8, C.headlight, [sx * 0.62, 0.95, -1.93], { rot: [Math.PI / 2, 0, 0], layer: 'glow' });
    // Tail lights
    b.box(0.1, 0.14, 0.05, C.tailLight, [sx * 0.8, 0.82, 1.75], { layer: 'glow' });
  }
  // Tall chrome grille with slats + hood ornament
  b.box(0.58, 0.52, 0.08, C.chrome, [0, 0.72, -2.03]);
  for (let i = -2; i <= 2; i++) b.box(0.04, 0.44, 0.04, C.iron, [i * 0.1, 0.72, -2.08]);
  b.box(0.06, 0.08, 0.18, C.chrome, [0, 1.04, -1.92]);
  // Bumpers
  b.box(1.95, 0.12, 0.14, C.chrome, [0, 0.46, -2.13]);
  b.box(1.9, 0.12, 0.14, C.chrome, [0, 0.46, 2.12]);
  for (const sx of [-1, 1]) b.box(0.06, 0.14, 0.1, C.chromeDark, [sx * 0.5, 0.52, -2.18]);
  // Trunk handle + license plate + exhaust
  b.box(0.3, 0.04, 0.03, C.chrome, [0, 0.86, 2.02]);
  b.box(0.36, 0.16, 0.02, C.hazardYellow, [0, 0.62, 2.05]);
  b.cyl(0.05, 0.05, 0.25, 6, C.chromeDark, [0.45, 0.38, 2.12], { rot: [Math.PI / 2, 0, 0] });
  if (opts.enemy) {
    // Gangster passengers silhouettes peeking through glass
    for (const sx of [-1, 1]) {
      b.ico(0.13, C.skin, [sx * 0.32, 1.3, 0.05]);
      b.cyl(0.2, 0.2, 0.03, 8, C.black, [sx * 0.32, 1.42, 0.05]);
      b.cyl(0.12, 0.13, 0.12, 8, C.black, [sx * 0.32, 1.48, 0.05]);
    }
  }
  const mesh = b.build({ castShadow: true, receiveShadow: true });
  mesh.name = 'body';
  root.add(mesh);
  attachWheels(root, sockets, wheelStyle, 0.3);
  addSockets(root, sockets);
  addExhaustSocket(root, [0.45, 0.38, 2.25]);
  return root;
}

function addExhaustSocket(root: THREE.Object3D, pos: V3): void {
  if (!root.getObjectByName('exhaust')) root.add(socket('exhaust', pos));
}

/** Retro wide-body street tuner coupe with rear wing. */
export function buildTuner(sockets: SocketMap, color: number, wheelStyle: WheelStyle = 'sport'): THREE.Group {
  const root = new THREE.Group();
  const b = new GeoBuilder();
  const glass = 0x1b2230;
  const fz = sockets.wheel_FL?.[2] ?? -1.35;
  const rz = sockets.wheel_RL?.[2] ?? 1.35;
  const wx = Math.abs(sockets.wheel_FL?.[0] ?? 0.9);
  b.box(1.4, 0.14, 3.9, C.iron, [0, 0.3, 0]);
  b.profile([[-2.18, 0.3], [-2.18, 0.6], [-1.65, 0.78], [-0.55, 0.86], [1.7, 0.9], [2.15, 0.86], [2.15, 0.32]], 1.66, color);
  b.profile([[-0.55, 0.84], [0.02, 1.22], [0.85, 1.24], [1.78, 0.88]], 1.38, color);
  b.profile([[-0.58, 0.9], [-0.03, 1.19], [0.0, 1.19], [-0.53, 0.9]], 1.24, glass);
  b.profile([[0.9, 1.21], [1.66, 0.92], [1.7, 0.92], [0.94, 1.21]], 1.18, glass);
  for (const sx of [-1, 1]) {
    b.box(0.02, 0.24, 0.75, glass, [sx * 0.7, 1.03, 0.35]);
    // Box flares
    b.box(0.34, 0.22, 1.05, color, [sx * wx, 0.7, fz], { rot: [0, 0, 0] });
    b.box(0.36, 0.24, 1.1, color, [sx * wx, 0.72, rz]);
    // Side skirt + stripe
    b.box(0.08, 0.12, 1.5, C.iron, [sx * 0.84, 0.36, 0]);
    b.box(0.02, 0.08, 3.6, C.stripeWhite, [sx * 0.835, 0.66, 0]);
    // Angular headlights + tail strip
    b.box(0.36, 0.08, 0.05, C.headlight, [sx * 0.55, 0.66, -2.2], { layer: 'glow' });
    b.box(0.32, 0.07, 0.05, C.tailLight, [sx * 0.55, 0.74, 2.17], { layer: 'glow' });
    // Spoiler struts
    b.box(0.06, 0.32, 0.1, C.iron, [sx * 0.6, 1.04, 1.95]);
  }
  b.box(1.85, 0.06, 0.42, C.iron, [0, 1.22, 2.0]);
  for (const sx of [-1, 1]) b.box(0.05, 0.2, 0.46, C.iron, [sx * 0.93, 1.18, 2.0]);
  b.box(0.5, 0.09, 0.7, C.iron, [0, 0.9, -1.0]); // hood scoop
  b.box(1.7, 0.12, 0.18, C.iron, [0, 0.36, -2.18]); // splitter
  b.box(0.7, 0.14, 0.05, C.iron, [0, 0.5, -2.2]); // grille
  b.cyl(0.07, 0.07, 0.2, 6, C.chrome, [-0.5, 0.36, 2.2], { rot: [Math.PI / 2, 0, 0] });
  b.cyl(0.07, 0.07, 0.2, 6, C.chrome, [0.5, 0.36, 2.2], { rot: [Math.PI / 2, 0, 0] });
  const mesh = b.build();
  mesh.name = 'body';
  root.add(mesh);
  attachWheels(root, sockets, wheelStyle, 0.36);
  addSockets(root, sockets);
  addExhaustSocket(root, [0.5, 0.36, 2.32]);
  return root;
}

/** Heavy armored mafia truck — boxy reinforced cabin and fat off-road wheels. */
export function buildTruck(sockets: SocketMap, color: number, wheelStyle: WheelStyle = 'offroad'): THREE.Group {
  const root = new THREE.Group();
  const b = new GeoBuilder();
  const plate = 0x2e362b;
  const glass = 0x141a22;
  const fz = sockets.wheel_FL?.[2] ?? -1.35;
  const rz = sockets.wheel_RL?.[2] ?? 1.35;
  const wx = Math.abs(sockets.wheel_FL?.[0] ?? 0.88);
  b.box(1.4, 0.2, 3.9, C.iron, [0, 0.5, 0]);
  b.box(1.7, 0.6, 4.1, color, [0, 0.85, 0]);
  b.profile([[-0.78, 1.15], [-0.6, 1.75], [0.78, 1.75], [0.78, 1.15]], 1.62, color);
  b.box(1.66, 0.42, 1.25, plate, [0, 1.36, 1.38]);
  b.box(1.58, 0.06, 1.25, C.iron, [0, 1.58, 1.38]);
  // Armored slit windows
  b.profile([[-0.8, 1.42], [-0.68, 1.66], [-0.65, 1.66], [-0.77, 1.42]], 1.4, glass);
  for (const sx of [-1, 1]) {
    b.box(0.02, 0.16, 0.9, glass, [sx * 0.815, 1.52, 0.0]);
    // Riveted side armor plates
    b.box(0.05, 0.5, 3.4, plate, [sx * 0.86, 0.86, 0]);
    for (let i = 0; i < 6; i++) b.ico(0.035, C.chromeDark, [sx * 0.89, 1.04, -1.5 + i * 0.6]);
    // Massive fenders
    b.box(0.46, 0.14, 1.3, plate, [sx * wx, 1.12, fz]);
    b.box(0.46, 0.14, 1.3, plate, [sx * wx, 1.12, rz]);
    b.box(0.12, 0.12, 0.05, C.headlight, [sx * 0.6, 1.0, -2.08], { layer: 'glow' });
    b.box(0.12, 0.16, 0.05, C.tailLight, [sx * 0.72, 0.95, 2.07], { layer: 'glow' });
    // Mirrors
    b.box(0.2, 0.14, 0.05, C.iron, [sx * 0.95, 1.55, -0.65]);
  }
  // Bull bar grille
  b.box(1.5, 0.56, 0.08, C.iron, [0, 0.9, -2.08]);
  for (let i = -3; i <= 3; i++) b.box(0.05, 0.62, 0.06, C.ironLight, [i * 0.2, 0.9, -2.15]);
  b.box(1.9, 0.14, 0.2, C.iron, [0, 0.55, -2.2]);
  b.box(1.9, 0.14, 0.2, C.iron, [0, 0.55, 2.15]);
  // Roof rack rails
  for (const sx of [-1, 1]) b.box(0.05, 0.06, 1.2, C.iron, [sx * 0.7, 1.79, 0]);
  b.cyl(0.07, 0.07, 0.6, 6, C.iron, [0.85, 1.4, 1.95]);
  const mesh = b.build();
  mesh.name = 'body';
  root.add(mesh);
  attachWheels(root, sockets, wheelStyle, 0.42);
  addSockets(root, sockets);
  addExhaustSocket(root, [0.85, 1.75, 1.95]);
  return root;
}

/** Vintage street motorcycle with suited hitman rider; the gun arm is a separate node to mirror per side. */
export function buildBike(): THREE.Group {
  const root = new THREE.Group();
  const b = new GeoBuilder();
  const frame = 0x7a1f2b;
  // Frame / tank / seat / engine
  b.box(0.12, 0.12, 1.2, C.iron, [0, 0.48, 0.0], { rot: [0.1, 0, 0] });
  b.profile([[-0.55, 0.78], [-0.35, 0.98], [0.15, 0.95], [0.25, 0.78]], 0.32, frame);
  b.box(0.3, 0.1, 0.55, C.black, [0, 0.92, 0.45]);
  b.box(0.28, 0.3, 0.4, C.chromeDark, [0, 0.52, -0.05]);
  b.box(0.04, 0.3, 0.4, C.chrome, [0.15, 0.52, -0.05]);
  b.cyl(0.05, 0.06, 0.9, 6, C.chrome, [0.18, 0.38, 0.5], { rot: [Math.PI / 2 - 0.1, 0, 0] });
  // Front fork & bars & headlight
  b.box(0.06, 0.7, 0.06, C.chrome, [0.1, 0.62, -0.68], { rot: [-0.35, 0, 0] });
  b.box(0.06, 0.7, 0.06, C.chrome, [-0.1, 0.62, -0.68], { rot: [-0.35, 0, 0] });
  b.box(0.7, 0.05, 0.05, C.chrome, [0, 1.05, -0.55]);
  b.cyl(0.1, 0.1, 0.08, 8, C.headlight, [0, 0.9, -0.82], { rot: [Math.PI / 2, 0, 0], layer: 'glow' });
  b.box(0.12, 0.08, 0.04, C.tailLight, [0, 0.8, 0.78], { layer: 'glow' });
  // Fenders
  b.box(0.18, 0.04, 0.5, frame, [0, 0.72, -0.8], { rot: [0.3, 0, 0] });
  b.box(0.2, 0.04, 0.6, frame, [0, 0.74, 0.82], { rot: [-0.35, 0, 0] });
  // Rider: legs, torso, head, fedora
  for (const sx of [-1, 1]) {
    b.box(0.13, 0.13, 0.5, C.suit, [sx * 0.18, 0.92, 0.12], { rot: [0.2, 0, 0] });
    b.box(0.12, 0.42, 0.13, C.suit, [sx * 0.2, 0.68, -0.15], { rot: [0.3, 0, 0] });
    b.box(0.12, 0.06, 0.2, C.black, [sx * 0.2, 0.47, -0.22]);
  }
  b.box(0.44, 0.58, 0.28, C.suit, [0, 1.3, 0.18], { rot: [-0.35, 0, 0] });
  b.box(0.1, 0.22, 0.03, C.stripeWhite, [0, 1.42, 0.0], { rot: [-0.35, 0, 0] });
  b.box(0.12, 0.38, 0.12, C.suit, [-0.2, 1.22, -0.18], { rot: [-1.0, 0, 0.1] });
  b.ico(0.14, C.skin, [0, 1.68, 0.0]);
  b.cyl(0.24, 0.24, 0.03, 8, C.black, [0, 1.8, 0.0]);
  b.cyl(0.13, 0.15, 0.14, 8, C.black, [0, 1.88, 0.0]);
  const mesh = b.build();
  mesh.name = 'body';
  root.add(mesh);

  // Gun arm (pivot at right shoulder, extends toward +X; scale.x=-1 mirrors to the left side)
  const arm = new THREE.Group();
  arm.name = 'gun_arm';
  arm.position.set(0.2, 1.45, 0.1);
  const ab = new GeoBuilder();
  ab.box(0.5, 0.11, 0.11, C.suit, [0.25, 0, 0]);
  ab.box(0.06, 0.08, 0.08, C.skin, [0.52, 0, 0]);
  ab.box(0.18, 0.06, 0.05, C.iron, [0.62, 0.03, 0]);
  ab.box(0.05, 0.1, 0.05, C.iron, [0.55, -0.05, 0]);
  arm.add(ab.build());
  const muzzle = socket('muzzle', [0.73, 0.03, 0]);
  arm.add(muzzle);
  root.add(arm);

  for (const [name, z] of [['wheel_F', -0.78], ['wheel_R', 0.78]] as const) {
    const s = socket(name, [0, 0.34, z]);
    const spin = new THREE.Group();
    spin.name = 'spin';
    const wb = new GeoBuilder();
    wb.cyl(0.34, 0.34, 0.12, 12, C.tire, [0, 0, 0], { rot: AXLE_X });
    wb.cyl(0.25, 0.25, 0.14, 12, C.chromeDark, [0, 0, 0], { rot: AXLE_X });
    wb.cyl(0.08, 0.08, 0.17, 6, C.chrome, [0, 0, 0], { rot: AXLE_X });
    spin.add(wb.build({ castShadow: true, receiveShadow: false }));
    s.add(spin);
    s.userData.radius = 0.34;
    root.add(s);
  }
  return root;
}

/** Black attack helicopter with missile pods, nose spotlight and spinning rotors. */
export function buildChopper(sockets: SocketMap): THREE.Group {
  const root = new THREE.Group();
  const b = new GeoBuilder();
  const hull = 0x2b302d;
  const hullLight = 0x3b423d;
  const glass = 0x1a2430;
  b.profile([[-2.0, 0.6], [-1.92, 1.05], [-1.35, 1.45], [0.2, 1.58], [0.95, 1.38], [1.15, 0.95], [0.85, 0.45], [-1.35, 0.38]], 1.32, hull);
  b.profile([[-1.97, 0.95], [-1.4, 1.42], [-0.6, 1.5], [-0.6, 1.0]], 1.34, glass);
  b.box(1.0, 0.25, 1.4, hullLight, [0, 1.62, 0.1]);
  // Tail boom + fins
  b.cyl(0.18, 0.34, 3.4, 7, hull, [0, 1.2, 2.65], { rot: [Math.PI / 2, 0, 0] });
  b.box(0.08, 0.95, 0.6, hull, [0, 1.6, 4.25], { rot: [-0.25, 0, 0] });
  b.box(1.3, 0.06, 0.4, hull, [0, 1.22, 3.85]);
  b.box(0.06, 0.14, 0.05, C.tailLight, [0, 2.05, 4.42], { layer: 'glow' });
  for (const sx of [-1, 1]) {
    // Skids
    b.box(0.07, 0.07, 2.6, C.iron, [sx * 0.7, 0.02, -0.1]);
    b.box(0.06, 0.4, 0.06, C.iron, [sx * 0.6, 0.22, -0.7], { rot: [0, 0, sx * 0.3] });
    b.box(0.06, 0.4, 0.06, C.iron, [sx * 0.6, 0.22, 0.5], { rot: [0, 0, sx * 0.3] });
    // Stub wings + missile pods
    b.box(0.8, 0.07, 0.45, hull, [sx * 0.95, 0.85, 0.15]);
    b.cyl(0.17, 0.17, 0.9, 8, C.iron, [sx * 1.3, 0.72, 0.1], { rot: [Math.PI / 2, 0, 0] });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      b.cyl(0.04, 0.04, 0.05, 6, C.redDark, [sx * 1.3 + Math.cos(a) * 0.08, 0.72 + Math.sin(a) * 0.08, -0.36], { rot: [Math.PI / 2, 0, 0] });
    }
    b.box(0.06, 0.06, 0.06, sx < 0 ? 0xff3030 : 0x30ff60, [sx * 0.68, 1.0, -0.5], { layer: 'glow' });
  }
  // Nose spotlight
  b.cyl(0.14, 0.18, 0.18, 8, C.iron, [0, 0.48, -1.8], { rot: [Math.PI / 2 + 0.6, 0, 0] });
  b.cyl(0.12, 0.12, 0.04, 8, 0xff3b3b, [0, 0.43, -1.88], { rot: [Math.PI / 2 + 0.6, 0, 0], layer: 'glow' });
  const mesh = b.build();
  mesh.name = 'body';
  root.add(mesh);

  const mainPos = sockets.rotor_main ?? [0, 1.75, 0.1];
  const rotorMain = socket('rotor_main', mainPos);
  const rb = new GeoBuilder();
  rb.cyl(0.12, 0.12, 0.25, 6, C.iron, [0, 0.05, 0]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    rb.box(0.22, 0.03, 3.6, C.black, [Math.sin(a) * 1.8, 0.16, Math.cos(a) * 1.8], { rot: [0, a, 0] });
  }
  rotorMain.add(rb.build({ castShadow: true, receiveShadow: false }));
  root.add(rotorMain);

  const tailPos = sockets.rotor_tail ?? [0.22, 1.25, 4.15];
  const rotorTail = socket('rotor_tail', tailPos);
  const tb = new GeoBuilder();
  tb.box(0.03, 1.1, 0.12, C.black, [0, 0, 0]);
  tb.box(0.03, 0.12, 1.1, C.black, [0, 0, 0]);
  rotorTail.add(tb.build({ castShadow: false, receiveShadow: false }));
  root.add(rotorTail);
  root.add(socket('spotlight', [0, 0.4, -1.95]));
  for (const [name, pos] of Object.entries(sockets)) {
    if (name !== 'rotor_main' && name !== 'rotor_tail') root.add(socket(name, pos));
  }
  return root;
}

/** Glossy black oil puddle decal (irregular low-poly blob). */
export function buildOilPuddle(): THREE.Group {
  const root = new THREE.Group();
  const pts: [number, number][] = [];
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 2.1 + Math.sin(i * 2.7) * 0.45 + Math.cos(i * 1.3) * 0.3;
    pts.push([Math.cos(a) * r, Math.sin(a) * r * 1.25]);
  }
  const shape = new THREE.Shape();
  pts.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z)));
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x07080b, roughness: 0.12, metalness: 0.55, flatShading: true, polygonOffset: true, polygonOffsetFactor: -2 });
  const puddle = new THREE.Mesh(geo, mat);
  puddle.position.y = 0.03;
  puddle.receiveShadow = true;
  puddle.name = 'body';
  root.add(puddle);
  for (let i = 0; i < 4; i++) {
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.25 + i * 0.05, 7), mat);
    d.rotation.x = -Math.PI / 2;
    d.position.set(Math.cos(i * 1.9) * 3.0, 0.031, Math.sin(i * 1.9) * 3.2);
    root.add(d);
  }
  return root;
}

/** Circular landmine with a glowing red beacon (child 'beacon' blinks). */
export function buildMine(): THREE.Group {
  const root = new THREE.Group();
  const b = new GeoBuilder();
  b.cyl(0.5, 0.56, 0.14, 10, C.iron, [0, 0.07, 0]);
  b.cyl(0.38, 0.45, 0.08, 10, C.ironLight, [0, 0.18, 0]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.box(0.08, 0.05, 0.08, C.hazardYellow, [Math.cos(a) * 0.48, 0.12, Math.sin(a) * 0.48]);
  }
  const mesh = b.build();
  mesh.name = 'body';
  root.add(mesh);
  const beacon = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 0), glowMat(0xff2020));
  beacon.position.y = 0.27;
  beacon.name = 'beacon';
  root.add(beacon);
  return root;
}

/** V-shaped heavy steel dozer blade for socket_front_armor. */
export function buildDozer(): THREE.Group {
  const b = new GeoBuilder();
  const steel = 0x8d9399;
  const edge = 0x5b6168;
  for (const sx of [-1, 1]) {
    b.box(1.12, 0.72, 0.1, steel, [sx * 0.52, 0.18, -0.42], { rot: [0.15, sx * 0.3, 0] });
    b.box(1.12, 0.08, 0.16, edge, [sx * 0.52, 0.55, -0.4], { rot: [0.15, sx * 0.3, 0] });
    b.box(1.12, 0.08, 0.14, edge, [sx * 0.52, -0.16, -0.48], { rot: [0.15, sx * 0.3, 0] });
    b.box(0.12, 0.12, 0.65, C.iron, [sx * 0.45, 0.1, -0.05]);
    for (let i = 0; i < 3; i++) b.ico(0.04, C.chrome, [sx * (0.2 + i * 0.32), 0.3, -0.52 + i * 0.09]);
  }
  b.box(0.16, 0.76, 0.18, edge, [0, 0.18, -0.62]);
  const g = b.build();
  g.name = 'body';
  const root = new THREE.Group();
  root.add(g);
  return root;
}
