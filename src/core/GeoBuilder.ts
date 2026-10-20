import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MATS, type Layer } from './Palette';

export type V3 = [number, number, number];

export interface PartOpts {
  rot?: V3;
  scale?: V3 | number;
  layer?: Layer;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();

/**
 * Accumulates low-poly primitives with per-vertex colors and merges them into one geometry per
 * material layer. Every procedural model in the game is built through this, so a whole car or road
 * chunk renders in 1–4 draw calls and shares the global palette materials.
 */
export class GeoBuilder {
  private parts: Record<Layer, THREE.BufferGeometry[]> = { lit: [], glow: [], window: [], night: [] };
  /** Optional parent transform applied to every subsequent part (used to build along curves). */
  frame: THREE.Matrix4 | null = null;

  add(geo: THREE.BufferGeometry, color: number, pos: V3, opts: PartOpts = {}): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    g.deleteAttribute('uv');
    if (g.getAttribute('uv1')) g.deleteAttribute('uv1');
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    tmpE.set(opts.rot?.[0] ?? 0, opts.rot?.[1] ?? 0, opts.rot?.[2] ?? 0);
    tmpQ.setFromEuler(tmpE);
    tmpP.set(pos[0], pos[1], pos[2]);
    const s = opts.scale;
    if (typeof s === 'number') tmpS.set(s, s, s);
    else if (s) tmpS.set(s[0], s[1], s[2]);
    else tmpS.set(1, 1, 1);
    tmpM.compose(tmpP, tmpQ, tmpS);
    if (this.frame) tmpM.premultiply(this.frame);
    g.applyMatrix4(tmpM);
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    tmpC.setHex(color);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = tmpC.r;
      colors[i * 3 + 1] = tmpC.g;
      colors[i * 3 + 2] = tmpC.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts[opts.layer ?? 'lit'].push(g);
    return this;
  }

  box(w: number, h: number, d: number, color: number, pos: V3, opts?: PartOpts): this {
    return this.add(new THREE.BoxGeometry(w, h, d), color, pos, opts);
  }

  /** Cylinder whose axis is Y by default. */
  cyl(rTop: number, rBot: number, h: number, seg: number, color: number, pos: V3, opts?: PartOpts): this {
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg), color, pos, opts);
  }

  cone(r: number, h: number, seg: number, color: number, pos: V3, opts?: PartOpts): this {
    return this.add(new THREE.ConeGeometry(r, h, seg), color, pos, opts);
  }

  ico(r: number, color: number, pos: V3, opts?: PartOpts, detail = 0): this {
    return this.add(new THREE.IcosahedronGeometry(r, detail), color, pos, opts);
  }

  sphere(r: number, wSeg: number, hSeg: number, color: number, pos: V3, opts?: PartOpts): this {
    return this.add(new THREE.SphereGeometry(r, wSeg, hSeg), color, pos, opts);
  }

  plane(w: number, h: number, color: number, pos: V3, opts?: PartOpts): this {
    return this.add(new THREE.PlaneGeometry(w, h), color, pos, opts);
  }

  torus(r: number, tube: number, radialSeg: number, tubularSeg: number, color: number, pos: V3, opts?: PartOpts, arc = Math.PI * 2): this {
    return this.add(new THREE.TorusGeometry(r, tube, radialSeg, tubularSeg, arc), color, pos, opts);
  }

  /**
   * Extrudes a side profile drawn in the (z, y) plane across the X axis (width), centered on x = 0.
   * Points are [z, y] pairs; front of vehicles is -Z.
   */
  profile(points: [number, number][], width: number, color: number, pos: V3 = [0, 0, 0], opts?: PartOpts): this {
    const shape = new THREE.Shape();
    points.forEach(([z, y], i) => (i === 0 ? shape.moveTo(-z, y) : shape.lineTo(-z, y)));
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, steps: 1 });
    geo.rotateY(Math.PI / 2);
    geo.translate(-width / 2, 0, 0);
    return this.add(geo, color, pos, opts);
  }

  /** Extrudes a top-down polygon (x, z) upward by height h. */
  slab(points: [number, number][], h: number, color: number, pos: V3 = [0, 0, 0], opts?: PartOpts): this {
    const shape = new THREE.Shape();
    points.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z)));
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, steps: 1 });
    geo.rotateX(-Math.PI / 2);
    return this.add(geo, color, pos, opts);
  }

  isEmpty(): boolean {
    return (Object.keys(this.parts) as Layer[]).every((k) => this.parts[k].length === 0);
  }

  buildGeometry(layer: Layer): THREE.BufferGeometry | null {
    const list = this.parts[layer];
    if (list.length === 0) return null;
    const merged = mergeGeometries(list, false);
    list.forEach((g) => g.dispose());
    this.parts[layer] = [];
    if (!merged) return null;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }

  build(opts: { castShadow?: boolean; receiveShadow?: boolean; name?: string } = {}): THREE.Group {
    const group = new THREE.Group();
    if (opts.name) group.name = opts.name;
    (['lit', 'window', 'glow', 'night'] as Layer[]).forEach((layer) => {
      const geo = this.buildGeometry(layer);
      if (!geo) return;
      const mesh = new THREE.Mesh(geo, MATS[layer]);
      mesh.name = `layer_${layer}`;
      if (layer === 'lit') {
        mesh.castShadow = opts.castShadow ?? true;
        mesh.receiveShadow = opts.receiveShadow ?? true;
      }
      if (layer === 'night') mesh.renderOrder = 5;
      group.add(mesh);
    });
    return group;
  }
}

/** Creates a named empty socket node. */
export function socket(name: string, pos: V3): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(pos[0], pos[1], pos[2]);
  return o;
}
