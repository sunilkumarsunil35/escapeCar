import * as THREE from 'three';
import type { AssetRegistry } from '../assets/AssetRegistry';
import { buildWheel } from '../assets/procedural/vehicles';
import { GARAGE_PRESET } from '../data/config';
import { damp } from '../core/math';
import { buildLoadoutModel, type Loadout } from '../game/Loadout';
import type { Engine } from '../core/Engine';

export type PreviewKind = 'weapon' | 'armor' | 'tires' | 'gadget' | 'engine' | null;

/** Main-menu brick garage: rotating turntable car with live socket attachments and floating previews. */
export class GarageScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
  private turntable: THREE.Object3D;
  private center: THREE.Object3D;
  private car: THREE.Group | null = null;
  private preview = new THREE.Group();
  private previewItem: THREE.Object3D | null = null;
  private outline: THREE.LineSegments | null = null;
  private dust: THREE.Points;
  private spin = 0;
  private dragging = false;
  private dragX = 0;
  private dragVel = 0;
  private lookAt = new THREE.Vector3(-0.4, 1.0, 0);
  private time = 0;
  private narrow = false;
  private short = false;

  constructor(private engine: Engine, private assets: AssetRegistry) {
    this.scene.name = 'garage';
    this.scene.background = new THREE.Color(GARAGE_PRESET.bg);
    this.scene.fog = new THREE.Fog(GARAGE_PRESET.bg, 18, 40);
    const room = assets.instantiate('env_garage');
    this.scene.add(room);
    this.turntable = room.getObjectByName('turntable') ?? room;
    this.center = room.getObjectByName('turntable_center') ?? this.turntable;

    this.scene.add(new THREE.AmbientLight(GARAGE_PRESET.amb, GARAGE_PRESET.ambInt * 1.6));
    this.scene.add(new THREE.HemisphereLight(0xffd6a0, 0x3a2a20, 0.6));
    const sun = new THREE.DirectionalLight(0xffcf8a, 2.6);
    sun.position.set(-14, 12, 2);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -8; sc.right = 8; sc.top = 8; sc.bottom = -8; sc.near = 1; sc.far = 40;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);
    for (const [x, z] of [[3.5, 4], [-3, -3]] as const) {
      const spot = new THREE.SpotLight(GARAGE_PRESET.spot, GARAGE_PRESET.spotInt * 45, 25, 0.5, 0.7, 1.6);
      spot.position.set(x, 9, z);
      spot.target.position.set(0, 0.5, 0);
      this.scene.add(spot, spot.target);
    }
    const fill = new THREE.PointLight(0xffb060, 8, 14, 1.5);
    fill.position.set(4, 3, 6);
    this.scene.add(fill);

    const dustGeo = new THREE.BufferGeometry();
    const pts: number[] = [];
    for (let i = 0; i < 260; i++) pts.push(-10 + Math.random() * 12, Math.random() * 9, -9 + Math.random() * 18);
    dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xffe0b0, size: 0.05, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scene.add(this.dust);

    this.preview.position.set(-1.9, 3.0, 1.2);
    this.scene.add(this.preview);

    engine.onResize((w, h) => {
      this.camera.aspect = w / h;
      this.narrow = w / h < 1.3;
      this.short = h < 500;
      this.camera.fov = this.narrow ? 62 : 46;
      this.camera.updateProjectionMatrix();
    });
    this.bindDrag();
  }

  private bindDrag(): void {
    const canvas = this.engine.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      this.dragging = true;
      this.dragX = e.clientX;
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.dragX;
      this.dragX = e.clientX;
      this.dragVel = dx * 0.01;
      this.spin += this.dragVel;
    });
    window.addEventListener('pointerup', () => (this.dragging = false));
  }

  active = false;

  setLoadout(l: Loadout): void {
    if (this.car) this.center.remove(this.car);
    this.car = buildLoadoutModel(this.assets, l);
    this.car.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.center.add(this.car);
  }

  /** Floating "hologram" preview of the item being browsed, with a dashed selection box. */
  setPreview(kind: PreviewKind, id: string | null, tiresTier = 0): void {
    if (this.previewItem) this.preview.remove(this.previewItem);
    if (this.outline) {
      this.preview.remove(this.outline);
      this.outline.geometry.dispose();
    }
    this.previewItem = null;
    this.outline = null;
    if (!kind || !id) return;
    let obj: THREE.Object3D;
    if (kind === 'tires') {
      obj = buildWheel(0.55, 0.42, tiresTier >= 2 ? 'armored' : tiresTier === 1 ? 'sport' : 'whitewall');
      obj.rotation.y = Math.PI / 2;
    } else if (kind === 'engine') {
      obj = this.buildEngineBlock(tiresTier);
    } else {
      obj = this.assets.instantiate(id);
      if (kind === 'weapon') obj.scale.setScalar(1.3);
      if (kind === 'gadget') obj.scale.setScalar(id === 'gadget_oil' ? 0.45 : 1.6);
    }
    const wrap = new THREE.Group();
    wrap.add(obj);
    const box = new THREE.Box3().setFromObject(wrap);
    const center = box.getCenter(new THREE.Vector3());
    obj.position.sub(center);
    const size = box.getSize(new THREE.Vector3()).multiplyScalar(1.15).addScalar(0.15);
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z));
    const line = new THREE.LineSegments(edges, new THREE.LineDashedMaterial({ color: 0xe8f4ff, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.85 }));
    line.computeLineDistances();
    this.outline = line;
    this.previewItem = wrap;
    this.preview.add(wrap, line);
  }

  private buildEngineBlock(tier: number): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: tier >= 2 ? 0xb8bec6 : tier === 1 ? 0xb3261e : 0x5b6168, flatShading: true, metalness: 0.4, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2d33, flatShading: true });
    const block = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 1.3), mat);
    g.add(block);
    const cyls = tier >= 2 ? 6 : tier === 1 ? 4 : 3;
    for (let i = 0; i < cyls; i++) {
      for (const sx of [-1, 1]) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.35, 8), dark);
        c.position.set(sx * 0.35, 0.42, -0.5 + (i / Math.max(1, cyls - 1)) * 1.0);
        c.rotation.z = sx * 0.4;
        g.add(c);
      }
    }
    if (tier >= 1) {
      const blower = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.8), new THREE.MeshStandardMaterial({ color: 0xd7dde3, flatShading: true, metalness: 0.7, roughness: 0.3 }));
      blower.position.y = 0.6;
      g.add(blower);
    }
    if (tier >= 2) {
      for (const sx of [-1, 1]) {
        const turbo = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.08, 6, 10), new THREE.MeshStandardMaterial({ color: 0xf28c28, flatShading: true }));
        turbo.position.set(sx * 0.62, 0.1, 0.3);
        turbo.rotation.y = Math.PI / 2;
        g.add(turbo);
      }
    }
    return g;
  }

  update(dt: number): void {
    this.time += dt;
    if (!this.dragging) {
      this.dragVel = damp(this.dragVel, 0, 3, dt);
      this.spin += this.dragVel + dt * 0.32;
    }
    this.turntable.rotation.y = this.spin;
    if (this.previewItem) {
      this.previewItem.rotation.y += dt * 0.8;
      this.preview.position.y = 3.0 + Math.sin(this.time * 1.6) * 0.12;
    }
    const pos = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + dt * 0.08;
      if (y > 9) y = 0;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(this.time * 0.3 + i) * dt * 0.02);
    }
    pos.needsUpdate = true;
    const camPos = this.narrow ? new THREE.Vector3(4.6, 3.6, 10.5) : this.short ? new THREE.Vector3(6.2, 3.4, 10.2) : new THREE.Vector3(5.4, 3.2, 8.6);
    camPos.x += Math.sin(this.time * 0.15) * 0.3;
    this.camera.position.lerp(camPos, 1 - Math.exp(-3 * dt));
    // Short landscape phones: aim lower so the car sits above the bottom menu bar.
    this.lookAt.set(this.narrow ? 0 : -1.2, this.short ? 0.2 : 1.15, 0);
    this.camera.lookAt(this.lookAt);
  }

  render(): void {
    this.engine.setBloom(0.35, 0.82);
    this.engine.renderer.toneMappingExposure = 1.05;
    this.engine.render(this.scene, this.camera);
  }
}
