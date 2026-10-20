import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CATEGORIES, REQUIRED_SOCKETS, type AssetConfig, type AssetRegistry, type Category } from '../assets/AssetRegistry';
import type { Engine } from '../core/Engine';
import type { V3 } from '../core/GeoBuilder';
import { DEG } from '../core/math';

interface PendingGlb {
  fileName: string;
  base64: string;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

function labelSprite(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = 'rgba(15,23,42,0.75)';
  g.fillRect(0, 8, 256, 48);
  g.font = 'bold 26px Rubik, sans-serif';
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, 10, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(1.2, 0.3, 1);
  s.renderOrder = 30;
  return s;
}

/**
 * Local asset inspector (?admin=true): pick an asset ID, drag-drop a .glb, tune scale / rotationY /
 * collider / socket XYZ live, then "Save to Project" → Vite middleware writes the .glb into
 * /public/assets/models/ and patches /public/assets/manifest.json.
 */
export class AdminPanel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 2000);
  readonly el: HTMLDivElement;
  private controls: OrbitControls;
  private holder = new THREE.Group();
  private display: THREE.Group | null = null;
  private colliderBox: THREE.LineSegments | null = null;
  private markers = new Map<string, THREE.Group>();
  private id = 'car_sedan';
  private cfg: AssetConfig = { url: null };
  private pending: PendingGlb | null = null;
  private showAttachments = true;
  dirty = false;
  active = false;
  onExit: (() => void) | null = null;

  constructor(private engine: Engine, private assets: AssetRegistry, root: HTMLElement) {
    this.scene.background = new THREE.Color(0x1e2230);
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3226, 1.3));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(6, 10, 4);
    sun.castShadow = true;
    this.scene.add(sun);
    const grid = new THREE.GridHelper(40, 40, 0x6b7280, 0x374151);
    this.scene.add(grid);
    const axes = new THREE.AxesHelper(1.5);
    axes.position.y = 0.01;
    this.scene.add(axes);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(20, 32).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.35 }));
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.scene.add(this.holder);
    this.camera.position.set(5, 3.5, 6);
    this.controls = new OrbitControls(this.camera, engine.renderer.domElement);
    this.controls.target.set(0, 0.8, 0);
    this.controls.enableDamping = true;
    this.controls.enabled = false;
    engine.onResize((w, h) => {
      this.camera.aspect = w / h;
      // Shift the projection right so the model is centered in the area not covered by the panel.
      const panel = w > 700 ? Math.min(380, w * 0.92) : 0;
      if (panel) this.camera.setViewOffset(w, h, -panel / 2, 0, w, h);
      else this.camera.clearViewOffset();
      this.camera.updateProjectionMatrix();
    });

    this.el = document.createElement('div');
    this.el.className = 'admin hidden';
    const options = CATEGORIES.map(
      (cat) => `<optgroup label="${cat.toUpperCase()}">${Object.keys(assets.manifest[cat]).map((id) => `<option value="${id}">${id}</option>`).join('')}</optgroup>`,
    ).join('');
    this.el.innerHTML = `
      <div class="a-panel">
        <div class="a-head"><b>ESCAPE CAR · ASSET INSPECTOR</b><button class="a-exit">▶ PLAY GAME</button></div>
        <label class="a-row">Asset ID <select class="a-select">${options}</select></label>
        <div class="a-source"></div>
        <div class="a-drop">Drop a <b>.glb</b> here or <u>click to browse</u><input type="file" accept=".glb,model/gltf-binary" hidden /></div>
        <div class="a-sliders"></div>
        <label class="a-check"><input type="checkbox" class="a-attach" checked /> Preview socket attachments (Tommy guns / dozer)</label>
        <div class="a-buttons">
          <button class="a-save primary">💾 Save to Project</button>
          <button class="a-fit">Auto-fit scale to collider</button>
          <button class="a-revert">Revert to procedural (url = null)</button>
          <button class="a-reset">Discard changes</button>
          <button class="a-copy">Copy JSON</button>
          <button class="a-download">Download manifest.json</button>
        </div>
        <div class="a-msg"></div>
      </div>`;
    root.appendChild(this.el);
    const sel = this.el.querySelector('.a-select') as HTMLSelectElement;
    sel.addEventListener('change', () => this.select(sel.value));
    const drop = this.el.querySelector('.a-drop') as HTMLDivElement;
    const fileInput = drop.querySelector('input') as HTMLInputElement;
    drop.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) void this.loadFile(f);
      fileInput.value = '';
    });
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const f = e.dataTransfer?.files?.[0];
      if (f) void this.loadFile(f);
    });
    // Also accept drops anywhere on the viewport
    window.addEventListener('dragover', (e) => {
      if (this.active) e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      if (!this.active) return;
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f) void this.loadFile(f);
    });
    (this.el.querySelector('.a-exit') as HTMLButtonElement).addEventListener('click', () => this.onExit?.());
    (this.el.querySelector('.a-save') as HTMLButtonElement).addEventListener('click', () => void this.saveToProject());
    (this.el.querySelector('.a-revert') as HTMLButtonElement).addEventListener('click', () => this.revertProcedural());
    (this.el.querySelector('.a-reset') as HTMLButtonElement).addEventListener('click', () => this.select(this.id));
    (this.el.querySelector('.a-fit') as HTMLButtonElement).addEventListener('click', () => this.autoFit());
    (this.el.querySelector('.a-copy') as HTMLButtonElement).addEventListener('click', () => {
      void navigator.clipboard?.writeText(JSON.stringify({ [this.id]: this.cfg }, null, 2));
      this.msg('Config JSON copied to clipboard.');
    });
    (this.el.querySelector('.a-download') as HTMLButtonElement).addEventListener('click', () => this.downloadManifest());
    (this.el.querySelector('.a-attach') as HTMLInputElement).addEventListener('change', (e) => {
      this.showAttachments = (e.target as HTMLInputElement).checked;
      this.rebuild();
    });
  }

  show(v: boolean): void {
    this.active = v;
    this.el.classList.toggle('hidden', !v);
    this.controls.enabled = v;
    if (v) this.select(this.id);
  }

  private get category(): Category {
    return this.assets.categoryOf(this.id) ?? 'cars';
  }

  private select(id: string): void {
    this.id = id;
    this.cfg = JSON.parse(JSON.stringify(this.assets.config(id))) as AssetConfig;
    this.pending = null;
    (this.el.querySelector('.a-select') as HTMLSelectElement).value = id;
    this.buildSliders();
    this.rebuild();
    this.frame();
    this.msg('');
  }

  private socketNames(): string[] {
    const names = new Set<string>([...(REQUIRED_SOCKETS[this.id] ?? []), ...Object.keys(this.cfg.sockets ?? {})]);
    return [...names];
  }

  private buildSliders(): void {
    const box = this.el.querySelector('.a-sliders') as HTMLDivElement;
    const isRoad = this.id.startsWith('road_');
    const rows: string[] = [];
    const slider = (key: string, label: string, min: number, max: number, step: number, value: number): string =>
      `<div class="a-sl"><span>${label}</span><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${value}"/><input type="number" data-k="${key}" step="${step}" value="${value}"/></div>`;
    if (!isRoad) {
      rows.push('<h4>Transform</h4>');
      rows.push(slider('scale', 'Scale', 0.05, 5, 0.01, this.cfg.scale ?? 1));
      rows.push(slider('rotationY', 'Rotation Y°', -180, 180, 1, this.cfg.rotationY ?? 0));
    } else {
      rows.push('<p class="a-note">Road chunks are 20 m wide × 50 m long, facing -Z, pivot at chunk start. Rotation/scale are not applied.</p>');
    }
    if (this.cfg.collider) {
      rows.push('<h4>Collider box (m)</h4>');
      ['X', 'Y', 'Z'].forEach((ax, i) => rows.push(slider(`collider.${i}`, `Collider ${ax}`, 0.1, 12, 0.01, (this.cfg.collider as V3)[i])));
    }
    const sockets = this.socketNames();
    if (sockets.length) {
      rows.push('<h4>Sockets (model space)</h4>');
      const defaults = this.cfg.sockets ?? {};
      for (const name of sockets) {
        const v = defaults[name] ?? [0, 0, 0];
        rows.push(`<div class="a-sock">${name}</div>`);
        ['x', 'y', 'z'].forEach((ax, i) => rows.push(slider(`socket.${name}.${i}`, ax.toUpperCase(), -6, 6, 0.01, v[i])));
      }
    }
    box.innerHTML = rows.join('');
    box.querySelectorAll<HTMLInputElement>('input').forEach((inp) => {
      inp.addEventListener('input', () => {
        const k = inp.dataset.k as string;
        const val = Number(inp.value);
        if (Number.isNaN(val)) return;
        box.querySelectorAll<HTMLInputElement>(`input[data-k="${k}"]`).forEach((o) => {
          if (o !== inp) o.value = String(val);
        });
        this.apply(k, val);
      });
    });
  }

  private apply(key: string, val: number): void {
    if (key === 'scale') this.cfg.scale = val;
    else if (key === 'rotationY') this.cfg.rotationY = val;
    else if (key.startsWith('collider.')) {
      const i = Number(key.split('.')[1]);
      (this.cfg.collider as V3)[i] = val;
    } else if (key.startsWith('socket.')) {
      const [, name, idx] = key.split('.');
      this.cfg.sockets = this.cfg.sockets ?? {};
      const v = (this.cfg.sockets[name] ?? [0, 0, 0]).slice() as V3;
      v[Number(idx)] = val;
      this.cfg.sockets[name] = v;
    }
    this.assets.setConfig(this.id, this.cfg);
    this.dirty = true;
    this.applyLive();
  }

  /** Cheap live update without rebuilding the model. */
  private applyLive(): void {
    if (!this.display) return;
    const inner = this.display.getObjectByName('model');
    if (inner && !this.id.startsWith('road_')) {
      inner.scale.setScalar(this.cfg.scale ?? 1);
      inner.rotation.y = (this.cfg.rotationY ?? 0) * DEG;
    }
    for (const [name, pos] of Object.entries(this.cfg.sockets ?? {})) {
      const node = this.display.getObjectByName(name);
      if (node) {
        node.position.set(pos[0], pos[1], pos[2]);
        if (name.startsWith('wheel_')) node.userData.radius = pos[1];
      }
    }
    this.updateHelpers();
  }

  private rebuild(): void {
    if (this.display) this.holder.remove(this.display);
    this.display = this.assets.instantiate(this.id);
    if (this.showAttachments && this.category === 'cars') {
      const roof = this.display.getObjectByName('socket_roof_weapon');
      if (roof) roof.add(this.assets.instantiate('weapon_tommy'));
      const front = this.display.getObjectByName('socket_front_armor');
      if (front) front.add(this.assets.instantiate('upgrade_dozer'));
    }
    this.holder.add(this.display);
    this.updateHelpers();
    const src = this.el.querySelector('.a-source') as HTMLDivElement;
    const glb = this.assets.hasModel(this.id);
    src.innerHTML = glb
      ? `<span class="tag glb">GLB</span> ${this.pending ? `${this.pending.fileName} <em>(unsaved)</em>` : this.cfg.url ?? ''}`
      : '<span class="tag proc">PROCEDURAL</span> url = null — generated low-poly mesh';
  }

  private updateHelpers(): void {
    if (this.colliderBox) {
      this.scene.remove(this.colliderBox);
      this.colliderBox.geometry.dispose();
      this.colliderBox = null;
    }
    if (this.cfg.collider) {
      const [x, y, z] = this.cfg.collider;
      const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(x, y, z));
      this.colliderBox = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x22d3ee }));
      this.colliderBox.position.y = y / 2;
      this.scene.add(this.colliderBox);
    }
    for (const m of this.markers.values()) m.parent?.remove(m);
    this.markers.clear();
    if (!this.display) return;
    this.display.updateMatrixWorld(true);
    for (const name of this.socketNames()) {
      const node = this.display.getObjectByName(name);
      if (!node) continue;
      const g = new THREE.Group();
      const color = name.startsWith('wheel') ? '#fbbf24' : name.startsWith('muzzle') ? '#f87171' : '#4ade80';
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshBasicMaterial({ color, depthTest: false }));
      dot.renderOrder = 29;
      const axes = new THREE.AxesHelper(0.35);
      (axes.material as THREE.Material).depthTest = false;
      axes.renderOrder = 29;
      const label = labelSprite(name, color);
      label.position.y = 0.3;
      g.add(dot, axes, label);
      node.add(g);
      this.markers.set(name, g);
    }
  }

  private frame(): void {
    if (!this.display) return;
    const box = new THREE.Box3().setFromObject(this.display);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());
    this.controls.target.copy(center);
    const dist = Math.max(3, size * 1.1);
    this.camera.position.copy(center).add(new THREE.Vector3(dist * 0.7, dist * 0.5, dist * 0.8));
    this.camera.far = Math.max(200, dist * 20);
    this.camera.updateProjectionMatrix();
  }

  private async loadFile(file: File): Promise<void> {
    if (!/\.glb$/i.test(file.name)) {
      this.msg('Please drop a binary glTF (.glb) file.', true);
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      const model = await this.assets.parseGlb(buf);
      this.assets.setModel(this.id, model);
      this.pending = { fileName: `${this.id}.glb`, base64: arrayBufferToBase64(buf) };
      this.cfg.url = `/assets/models/${this.id}.glb`;
      this.assets.setConfig(this.id, this.cfg);
      this.dirty = true;
      this.rebuild();
      this.frame();
      const tris = this.countTris(model);
      this.msg(`Loaded ${file.name} (${(buf.byteLength / 1024).toFixed(0)} KB, ${tris.toLocaleString()} tris). Tune, then Save to Project.`);
    } catch (err) {
      this.msg(`Failed to parse GLB: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  private countTris(obj: THREE.Object3D): number {
    let n = 0;
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const g = m.geometry;
        n += g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
      }
    });
    return Math.round(n);
  }

  private autoFit(): void {
    if (!this.cfg.collider || !this.display) {
      this.msg('This asset has no collider to fit to.', true);
      return;
    }
    const inner = this.display.getObjectByName('model');
    if (!inner) return;
    inner.scale.setScalar(1);
    const box = new THREE.Box3().setFromObject(inner);
    const size = box.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.z);
    const target = Math.max(this.cfg.collider[0], this.cfg.collider[2]);
    if (longest <= 0) return;
    const s = Math.round((target / longest) * 100) / 100;
    this.apply('scale', s);
    this.buildSliders();
    this.msg(`Scale set to ${s} to match collider length ${target} m.`);
  }

  private revertProcedural(): void {
    this.assets.setModel(this.id, null);
    this.cfg.url = null;
    this.pending = null;
    this.assets.setConfig(this.id, this.cfg);
    this.dirty = true;
    this.rebuild();
    this.msg('Reverted to procedural mesh (url = null). Save to persist.');
  }

  private async saveToProject(): Promise<void> {
    const body = {
      category: this.category,
      assetId: this.id,
      fileName: this.pending?.fileName,
      base64Glb: this.pending?.base64,
      config: this.cfg,
    };
    this.msg('Saving…');
    try {
      const res = await fetch('/api/save-asset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = (await res.json()) as { status: string; message?: string; config?: AssetConfig };
      if (!res.ok || json.status !== 'saved') throw new Error(json.message ?? `HTTP ${res.status}`);
      if (json.config) {
        this.cfg = json.config;
        this.assets.setConfig(this.id, this.cfg);
      }
      this.pending = null;
      this.rebuild();
      this.msg(`✔ Saved ${this.id} → public/assets/manifest.json${body.base64Glb ? ' + models/' + body.fileName : ''}. Commit it to Git!`);
    } catch (err) {
      this.msg(`Save failed (${err instanceof Error ? err.message : String(err)}). The /api/save-asset middleware only runs under "npm run dev" — use Download manifest.json instead.`, true);
    }
  }

  private downloadManifest(): void {
    const blob = new Blob([JSON.stringify(this.assets.manifest, null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'manifest.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private msg(text: string, error = false): void {
    const m = this.el.querySelector('.a-msg') as HTMLDivElement;
    m.textContent = text;
    m.classList.toggle('error', error);
  }

  update(): void {
    this.controls.update();
  }

  render(): void {
    this.engine.setBloom(0, 1);
    this.engine.renderer.toneMappingExposure = 1;
    this.engine.render(this.scene, this.camera);
  }
}
