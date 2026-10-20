import * as THREE from 'three';
import { rand } from '../core/math';
import { glowMat } from '../core/Palette';

interface Particle {
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  size: number; grow: number;
  gravity: number; drag: number;
  r: number; g: number; b: number;
  rx: number; ry: number; spin: number;
  bounce: boolean;
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpM = new THREE.Matrix4();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpC = new THREE.Color();

type Mode = 'stretch' | 'tumble' | 'fire';

/** Fixed-capacity instanced particle batch with swap-remove (no allocations after boot). */
class ParticleBatch {
  readonly mesh: THREE.InstancedMesh;
  private parts: Particle[] = [];
  private count = 0;

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, private capacity: number, private mode: Mode) {
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    for (let i = 0; i < capacity; i++) {
      this.parts.push({ px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, grow: 0, gravity: 0, drag: 0, r: 1, g: 1, b: 1, rx: 0, ry: 0, spin: 0, bounce: false });
    }
  }

  spawn(p: THREE.Vector3, v: THREE.Vector3, life: number, size: number, color: THREE.Color, opts: { grow?: number; gravity?: number; drag?: number; bounce?: boolean } = {}): void {
    let idx = this.count;
    if (idx >= this.capacity) idx = Math.floor(Math.random() * this.capacity);
    else this.count++;
    const q = this.parts[idx];
    q.px = p.x; q.py = p.y; q.pz = p.z;
    q.vx = v.x; q.vy = v.y; q.vz = v.z;
    q.life = life; q.max = life;
    q.size = size; q.grow = opts.grow ?? 0;
    q.gravity = opts.gravity ?? 0; q.drag = opts.drag ?? 0;
    q.r = color.r; q.g = color.g; q.b = color.b;
    q.rx = Math.random() * 6; q.ry = Math.random() * 6; q.spin = rand(-6, 6);
    q.bounce = opts.bounce ?? false;
  }

  clear(): void {
    this.count = 0;
    this.mesh.count = 0;
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      const q = this.parts[i];
      q.life -= dt;
      if (q.life <= 0) {
        this.count--;
        const last = this.parts[this.count];
        this.parts[this.count] = q;
        this.parts[i] = last;
        continue;
      }
      const dragF = Math.max(0, 1 - q.drag * dt);
      q.vx *= dragF; q.vy = q.vy * dragF + q.gravity * dt; q.vz *= dragF;
      q.px += q.vx * dt; q.py += q.vy * dt; q.pz += q.vz * dt;
      if (q.bounce && q.py < 0.1) {
        q.py = 0.1;
        q.vy = Math.abs(q.vy) * 0.35;
        q.vx *= 0.7; q.vz *= 0.7;
      }
      const t = 1 - q.life / q.max;
      tmpP.set(q.px, q.py, q.pz);
      if (this.mode === 'stretch') {
        tmpV.set(q.vx, q.vy, q.vz);
        const speed = tmpV.length();
        if (speed > 0.001) tmpQ.setFromUnitVectors(Z_AXIS, tmpV.multiplyScalar(1 / speed));
        const s = q.size * (1 - t * 0.7);
        tmpS.set(s * 0.35, s * 0.35, s * (1 + speed * 0.07));
        tmpC.setRGB(q.r, q.g, q.b);
      } else {
        q.rx += q.spin * dt; q.ry += q.spin * 0.7 * dt;
        tmpE.set(q.rx, q.ry, 0);
        tmpQ.setFromEuler(tmpE);
        let s: number;
        if (this.mode === 'fire') {
          s = q.size * (1 + q.grow * t) * (1 - t * t);
          // yellow -> orange -> deep red
          tmpC.setRGB(q.r * (1 - t * 0.2), q.g * (1 - t * 0.85), q.b * (1 - t));
        } else {
          s = q.size * (1 + q.grow * t) * (t > 0.7 ? (1 - t) / 0.3 : 1);
          tmpC.setRGB(q.r, q.g, q.b);
        }
        tmpS.set(s, s, s);
      }
      tmpM.compose(tmpP, tmpQ, tmpS);
      this.mesh.setMatrixAt(i, tmpM);
      this.mesh.setColorAt(i, tmpC);
      i++;
    }
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

interface Timed {
  obj: THREE.Object3D;
  life: number;
  max: number;
  active: boolean;
}

export interface TargetRing {
  root: THREE.Group;
  inner: THREE.Mesh;
  laser: THREE.Mesh;
  active: boolean;
}

/** All transient VFX: sparks, puffs, fire, debris, tracers, muzzle flashes, shockwaves, rings, skids. */
export class Effects {
  readonly root = new THREE.Group();
  readonly sparks: ParticleBatch;
  readonly smoke: ParticleBatch;
  readonly fire: ParticleBatch;
  readonly debris: ParticleBatch;
  private tracers: Timed[] = [];
  private flashes: Timed[] = [];
  private shocks: Timed[] = [];
  private skids: THREE.Mesh[] = [];
  private skidIdx = 0;
  readonly rings: TargetRing[] = [];
  readonly reticle: THREE.Group;
  private lights: { light: THREE.PointLight; life: number }[] = [];
  private col = new THREE.Color();
  private v = new THREE.Vector3();
  private p = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.root.name = 'effects';
    scene.add(this.root);
    const sparkGeo = new THREE.OctahedronGeometry(0.5, 0);
    this.sparks = new ParticleBatch(sparkGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), 360, 'stretch');
    this.smoke = new ParticleBatch(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1, color: 0xffffff }), 220, 'tumble');
    this.fire = new ParticleBatch(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshBasicMaterial({ toneMapped: false }), 200, 'fire');
    this.debris = new ParticleBatch(new THREE.BoxGeometry(0.35, 0.2, 0.3), new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9, color: 0xffffff }), 120, 'tumble');
    this.smoke.mesh.castShadow = false;
    this.root.add(this.sparks.mesh, this.smoke.mesh, this.fire.mesh, this.debris.mesh);

    const tracerGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: 0xffd36b, toneMapped: false }));
      m.visible = false;
      this.root.add(m);
      this.tracers.push({ obj: m, life: 0, max: 0.06, active: false });
    }
    const flashGeo = this.makeFlashGeometry();
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(flashGeo, glowMat(0xffd84a, { additive: true }));
      m.visible = false;
      this.root.add(m);
      this.flashes.push({ obj: m, life: 0, max: 0.06, active: false });
    }
    const shockGeo = new THREE.RingGeometry(0.85, 1, 24).rotateX(-Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(shockGeo, new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
      m.visible = false;
      this.root.add(m);
      this.shocks.push({ obj: m, life: 0, max: 0.45, active: false });
    }
    const skidGeo = new THREE.PlaneGeometry(0.32, 0.9).rotateX(-Math.PI / 2);
    const skidMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0c, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    for (let i = 0; i < 160; i++) {
      const m = new THREE.Mesh(skidGeo, skidMat);
      m.visible = false;
      this.root.add(m);
      this.skids.push(m);
    }
    for (let i = 0; i < 3; i++) this.rings.push(this.makeTargetRing());
    this.reticle = this.makeReticle();
    this.root.add(this.reticle);
    for (let i = 0; i < 2; i++) {
      const light = new THREE.PointLight(0xff9a40, 0, 26, 1.6);
      this.root.add(light);
      this.lights.push({ light, life: 0 });
    }
  }

  private makeFlashGeometry(): THREE.BufferGeometry {
    // 3D spiky star: crossed diamond quads + forward cone, so it reads from any camera angle.
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(0.12, 0.35);
      shape.lineTo(0, 0.9);
      shape.lineTo(-0.12, 0.35);
      shape.closePath();
      const g = new THREE.ShapeGeometry(shape);
      g.rotateZ((i / 4) * Math.PI * 2 + Math.PI / 4);
      parts.push(g);
    }
    const fwd = new THREE.ConeGeometry(0.16, 0.9, 6).rotateX(-Math.PI / 2).translate(0, 0, -0.45);
    parts.push(fwd.toNonIndexed());
    const merged = new THREE.BufferGeometry();
    const pos: number[] = [];
    for (const g of parts) {
      const ng = g.index ? g.toNonIndexed() : g;
      const arr = ng.getAttribute('position').array as ArrayLike<number>;
      for (let i = 0; i < arr.length; i++) pos.push(arr[i]);
    }
    merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return merged;
  }

  private makeTargetRing(): TargetRing {
    const root = new THREE.Group();
    const red = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.95, toneMapped: false, depthWrite: false, side: THREE.DoubleSide });
    const outer = new THREE.Mesh(new THREE.RingGeometry(3.7, 4.2, 40).rotateX(-Math.PI / 2), red);
    outer.position.y = 0.06;
    const fillMat = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.28, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const inner = new THREE.Mesh(new THREE.CircleGeometry(4, 40).rotateX(-Math.PI / 2), fillMat);
    inner.position.y = 0.05;
    const cross = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 1.4).rotateX(-Math.PI / 2), red);
      const a = (i / 4) * Math.PI * 2;
      tick.position.set(Math.cos(a) * 3.0, 0.07, Math.sin(a) * 3.0);
      tick.rotation.y = -a + Math.PI / 2;
      cross.add(tick);
    }
    const laserGeo = new THREE.ConeGeometry(1, 1, 16, 1, true).translate(0, -0.5, 0);
    const laser = new THREE.Mesh(laserGeo, new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    laser.frustumCulled = false;
    root.add(outer, inner, cross);
    root.visible = false;
    laser.visible = false;
    this.root.add(root, laser);
    return { root, inner, laser, active: false };
  }

  private makeReticle(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xff2b2b, toneMapped: false, depthTest: false, transparent: true, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.0, 24), mat);
    g.add(ring);
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.55), mat);
      const a = (i / 4) * Math.PI * 2;
      tick.position.set(Math.cos(a) * 1.25, Math.sin(a) * 1.25, 0);
      tick.rotation.z = a + Math.PI / 2;
      g.add(tick);
    }
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.12, 8), mat);
    g.add(dot);
    g.renderOrder = 20;
    g.visible = false;
    return g;
  }

  clear(): void {
    this.sparks.clear();
    this.smoke.clear();
    this.fire.clear();
    this.debris.clear();
    for (const t of [...this.tracers, ...this.flashes, ...this.shocks]) {
      t.active = false;
      t.obj.visible = false;
    }
    for (const s of this.skids) s.visible = false;
    for (const r of this.rings) this.hideRing(r);
    this.reticle.visible = false;
    for (const l of this.lights) {
      l.life = 0;
      l.light.intensity = 0;
    }
  }

  /** Spiky glowing sparks (cyan / orange / yellow). */
  sparkBurst(pos: THREE.Vector3, dir: THREE.Vector3 | null, count: number, color: number, speed = 8, spread = 1, size = 0.5, life = 0.35): void {
    this.col.setHex(color).multiplyScalar(2.2);
    for (let i = 0; i < count; i++) {
      this.v.set(rand(-1, 1), rand(0.2, 1.2), rand(-1, 1)).normalize().multiplyScalar(spread);
      if (dir) this.v.add(dir);
      this.v.normalize().multiplyScalar(speed * rand(0.5, 1.2));
      this.sparks.spawn(pos, this.v, life * rand(0.6, 1.2), size * rand(0.6, 1.3), this.col, { gravity: -14, drag: 1.5 });
    }
  }

  /** White geometric smoke puff. */
  puff(pos: THREE.Vector3, vel: THREE.Vector3, size: number, life = 0.8, color = 0xf2f2f2): void {
    this.col.setHex(color);
    this.smoke.spawn(pos, vel, life, size, this.col, { grow: 1.2, gravity: 1.2, drag: 2.5 });
  }

  flame(pos: THREE.Vector3, vel: THREE.Vector3, size: number, life = 0.35): void {
    this.col.setRGB(2.4, 1.8, 0.6);
    this.fire.spawn(pos, vel, life, size, this.col, { grow: 0.4, gravity: 2, drag: 3 });
  }

  explosion(pos: THREE.Vector3, scale = 1, debrisColor = 0x333333): void {
    for (let i = 0; i < 14 * scale; i++) {
      this.v.set(rand(-1, 1), rand(0.2, 1.5), rand(-1, 1)).normalize().multiplyScalar(rand(3, 9) * scale);
      this.p.copy(pos).add(this.v.clone().multiplyScalar(0.08));
      this.col.setRGB(2.6, 2.0, 0.7);
      this.fire.spawn(this.p, this.v, rand(0.35, 0.7), rand(0.9, 1.8) * scale, this.col, { grow: 0.8, gravity: 3, drag: 3.5 });
    }
    for (let i = 0; i < 10 * scale; i++) {
      this.v.set(rand(-1, 1), rand(0.5, 1.6), rand(-1, 1)).normalize().multiplyScalar(rand(2, 5) * scale);
      this.col.setHex(i % 3 === 0 ? 0x555555 : 0xd8d8d8);
      this.smoke.spawn(pos, this.v, rand(0.9, 1.6), rand(0.8, 1.6) * scale, this.col, { grow: 1.6, gravity: 1.5, drag: 2.2 });
    }
    for (let i = 0; i < 8 * scale; i++) {
      this.v.set(rand(-1, 1), rand(0.8, 2), rand(-1, 1)).normalize().multiplyScalar(rand(6, 12) * scale);
      this.col.setHex(i % 2 ? debrisColor : 0x222222);
      this.debris.spawn(pos, this.v, rand(1.0, 1.8), rand(0.6, 1.3), this.col, { gravity: -22, drag: 0.3, bounce: true });
    }
    this.sparkBurst(pos, null, Math.round(16 * scale), 0xffa030, 14 * scale, 1, 0.7, 0.5);
    this.shockwave(pos, 7 * scale);
    this.light(pos, 6 * scale);
  }

  shockwave(pos: THREE.Vector3, radius: number, color = 0xffc070): void {
    const s = this.shocks.find((x) => !x.active) ?? this.shocks[0];
    s.active = true;
    s.life = s.max;
    s.obj.visible = true;
    s.obj.position.set(pos.x, Math.max(0.1, pos.y - 0.5), pos.z);
    s.obj.userData.radius = radius;
    ((s.obj as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  light(pos: THREE.Vector3, intensity: number): void {
    const l = this.lights.reduce((a, b) => (a.life < b.life ? a : b));
    l.light.position.copy(pos).y += 1.5;
    l.light.intensity = intensity * 8;
    l.life = 0.35;
  }

  tracer(a: THREE.Vector3, b: THREE.Vector3, color = 0xffd36b, width = 0.06): void {
    const t = this.tracers.find((x) => !x.active) ?? this.tracers[0];
    t.active = true;
    t.life = t.max;
    const m = t.obj as THREE.Mesh;
    m.visible = true;
    (m.material as THREE.MeshBasicMaterial).color.setHex(color).multiplyScalar(2);
    m.position.copy(a);
    m.lookAt(b);
    m.scale.set(width, width, Math.max(0.1, a.distanceTo(b)));
  }

  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3, scale = 1): void {
    const f = this.flashes.find((x) => !x.active) ?? this.flashes[0];
    f.active = true;
    f.life = f.max;
    f.obj.visible = true;
    f.obj.position.copy(pos);
    this.p.copy(pos).add(dir);
    f.obj.lookAt(this.p);
    f.obj.rotateZ(Math.random() * Math.PI);
    f.obj.scale.setScalar(scale * rand(0.7, 1.15));
  }

  skid(pos: THREE.Vector3, yaw: number): void {
    const m = this.skids[this.skidIdx];
    this.skidIdx = (this.skidIdx + 1) % this.skids.length;
    m.visible = true;
    m.position.set(pos.x, 0.025, pos.z);
    m.rotation.set(0, yaw, 0);
  }

  showRing(r: TargetRing, pos: THREE.Vector3, progress: number, laserFrom: THREE.Vector3 | null): void {
    r.active = true;
    r.root.visible = true;
    r.root.position.set(pos.x, 0, pos.z);
    r.root.rotation.y += 0.02;
    const s = Math.max(0.05, 1 - progress);
    r.inner.scale.set(s, 1, s);
    const pulse = 0.8 + Math.sin(performance.now() * 0.02) * 0.2;
    (r.inner.material as THREE.MeshBasicMaterial).opacity = 0.18 + progress * 0.3 * pulse;
    if (laserFrom) {
      r.laser.visible = true;
      r.laser.position.copy(laserFrom);
      this.v.set(pos.x, 0.05, pos.z).sub(laserFrom);
      const len = this.v.length();
      r.laser.scale.set(4.0, len, 4.0);
      r.laser.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), this.v.normalize());
    } else {
      r.laser.visible = false;
    }
  }

  hideRing(r: TargetRing): void {
    r.active = false;
    r.root.visible = false;
    r.laser.visible = false;
  }

  setReticle(pos: THREE.Vector3 | null, camera: THREE.Camera, size: number): void {
    if (!pos) {
      this.reticle.visible = false;
      return;
    }
    this.reticle.visible = true;
    this.reticle.position.copy(pos);
    this.reticle.quaternion.copy(camera.quaternion);
    const pulse = 1 + Math.sin(performance.now() * 0.012) * 0.08;
    this.reticle.scale.setScalar(size * pulse);
    this.reticle.rotation.z += 0.0;
  }

  update(dt: number): void {
    this.sparks.update(dt);
    this.smoke.update(dt);
    this.fire.update(dt);
    this.debris.update(dt);
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.life -= dt;
      if (t.life <= 0) {
        t.active = false;
        t.obj.visible = false;
      }
    }
    for (const f of this.flashes) {
      if (!f.active) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.active = false;
        f.obj.visible = false;
      }
    }
    for (const s of this.shocks) {
      if (!s.active) continue;
      s.life -= dt;
      const t = 1 - s.life / s.max;
      const r = (s.obj.userData.radius as number) * (0.2 + t * 0.8);
      s.obj.scale.set(r, 1, r);
      ((s.obj as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 1 - t;
      if (s.life <= 0) {
        s.active = false;
        s.obj.visible = false;
      }
    }
    for (const l of this.lights) {
      if (l.life <= 0) continue;
      l.life -= dt;
      l.light.intensity = Math.max(0, l.light.intensity * (1 - dt * 9));
      if (l.life <= 0) l.light.intensity = 0;
    }
  }
}
