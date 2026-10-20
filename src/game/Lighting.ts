import * as THREE from 'three';
import { LIGHTING_PRESETS, type LightingPreset, type PresetId } from '../data/config';
import { MATS } from '../core/Palette';
import { SKYLINE_MATS } from '../assets/procedural/environment';
import type { Engine } from '../core/Engine';

interface SkylineLook {
  color: number;
  emissive: number;
  windows: number;
}

const SKYLINE: Record<PresetId, SkylineLook> = {
  preset_morning: { color: 0x9aa6b4, emissive: 0x5f7387, windows: 0x000000 },
  preset_midday: { color: 0x9db3c8, emissive: 0x6687a6, windows: 0x000000 },
  preset_sunset: { color: 0x7a4a3a, emissive: 0x6b3a2a, windows: 0x8a5a20 },
  preset_night: { color: 0x0b1020, emissive: 0x111a30, windows: 0xffc860 },
};

interface Snapshot {
  sky: THREE.Color;
  fog: THREE.Color;
  amb: THREE.Color;
  sun: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  window: THREE.Color;
  skyColor: THREE.Color;
  skyEmissive: THREE.Color;
  skyWindows: THREE.Color;
  ambInt: number;
  sunInt: number;
  hemiInt: number;
  fogNear: number;
  fogFar: number;
  bloom: number;
  bloomThreshold: number;
  nightFx: number;
  headlights: number;
  exposure: number;
  sunDir: THREE.Vector3;
}

function snapshotOf(p: LightingPreset, id: PresetId): Snapshot {
  const sk = SKYLINE[id];
  return {
    sky: new THREE.Color(p.sky),
    fog: new THREE.Color(p.fog),
    amb: new THREE.Color(p.amb),
    sun: new THREE.Color(p.sun),
    hemiSky: new THREE.Color(p.hemiSky),
    hemiGround: new THREE.Color(p.hemiGround),
    window: new THREE.Color(p.windowTint),
    skyColor: new THREE.Color(sk.color),
    skyEmissive: new THREE.Color(sk.emissive),
    skyWindows: new THREE.Color(sk.windows),
    ambInt: p.ambInt,
    sunInt: p.sunInt,
    hemiInt: p.hemiInt,
    fogNear: p.fogNear,
    fogFar: p.fogFar,
    bloom: p.bloom,
    bloomThreshold: p.bloomThreshold,
    nightFx: p.nightFx,
    headlights: p.headlights,
    exposure: p.exposure,
    sunDir: new THREE.Vector3(...p.sunPos).normalize(),
  };
}

function lerpSnap(out: Snapshot, a: Snapshot, b: Snapshot, t: number): void {
  out.sky.lerpColors(a.sky, b.sky, t);
  out.fog.lerpColors(a.fog, b.fog, t);
  out.amb.lerpColors(a.amb, b.amb, t);
  out.sun.lerpColors(a.sun, b.sun, t);
  out.hemiSky.lerpColors(a.hemiSky, b.hemiSky, t);
  out.hemiGround.lerpColors(a.hemiGround, b.hemiGround, t);
  out.window.lerpColors(a.window, b.window, t);
  out.skyColor.lerpColors(a.skyColor, b.skyColor, t);
  out.skyEmissive.lerpColors(a.skyEmissive, b.skyEmissive, t);
  out.skyWindows.lerpColors(a.skyWindows, b.skyWindows, t);
  const n = (k: 'ambInt' | 'sunInt' | 'hemiInt' | 'fogNear' | 'fogFar' | 'bloom' | 'bloomThreshold' | 'nightFx' | 'headlights' | 'exposure'): void => {
    out[k] = a[k] + (b[k] - a[k]) * t;
  };
  n('ambInt'); n('sunInt'); n('hemiInt'); n('fogNear'); n('fogFar'); n('bloom'); n('bloomThreshold'); n('nightFx'); n('headlights'); n('exposure');
  out.sunDir.lerpVectors(a.sunDir, b.sunDir, t).normalize();
}

/** The 4 time-of-day presets (doc §3.1) with smooth cross-fades, gradient sky dome, sun disc & stars. */
export class Lighting {
  readonly ambient = new THREE.AmbientLight(0xffffff, 1);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
  readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  readonly fog = new THREE.Fog(0xffffff, 60, 500);
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private stars: THREE.Points;
  private sunDisc: THREE.Mesh;
  private from: Snapshot;
  private to: Snapshot;
  private cur: Snapshot;
  private t = 1;
  private duration = 4;
  presetId: PresetId = 'preset_morning';

  constructor(private scene: THREE.Scene, private engine: Engine) {
    scene.add(this.ambient, this.hemi, this.sun, this.sun.target);
    scene.fog = this.fog;
    const low = engine.lowQuality;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
    const cam = this.sun.shadow.camera;
    cam.left = -38;
    cam.right = 38;
    cam.top = 38;
    cam.bottom = -38;
    cam.near = 1;
    cam.far = 220;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color() },
        horizon: { value: new THREE.Color() },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vDir;
        void main(){ float h = clamp(vDir.y, 0.0, 1.0); vec3 c = mix(horizon, top, pow(h, 0.55)); gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 12), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    const starGeo = new THREE.BufferGeometry();
    const pos: number[] = [];
    for (let i = 0; i < 600; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.random() * 0.9 + 0.08;
      pos.push(Math.cos(u) * Math.cos(v) * 850, Math.sin(v) * 850, Math.sin(u) * Math.cos(v) * 850);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    this.sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(38, 20),
      new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0, fog: false, toneMapped: false, depthWrite: false }),
    );
    this.sunDisc.frustumCulled = false;
    scene.add(this.sunDisc);

    this.from = snapshotOf(LIGHTING_PRESETS.preset_morning, 'preset_morning');
    this.to = snapshotOf(LIGHTING_PRESETS.preset_morning, 'preset_morning');
    this.cur = snapshotOf(LIGHTING_PRESETS.preset_morning, 'preset_morning');
    this.apply();
  }

  setPreset(id: PresetId, instant = false, duration = 4): void {
    if (id === this.presetId && !instant) return;
    this.presetId = id;
    this.from = this.cloneSnap(this.cur);
    this.to = snapshotOf(LIGHTING_PRESETS[id], id);
    this.duration = duration;
    this.t = instant ? 1 : 0;
    if (instant) {
      this.cur = this.cloneSnap(this.to);
      this.apply();
    }
  }

  private cloneSnap(s: Snapshot): Snapshot {
    return {
      ...s,
      sky: s.sky.clone(), fog: s.fog.clone(), amb: s.amb.clone(), sun: s.sun.clone(), hemiSky: s.hemiSky.clone(), hemiGround: s.hemiGround.clone(),
      window: s.window.clone(), skyColor: s.skyColor.clone(), skyEmissive: s.skyEmissive.clone(), skyWindows: s.skyWindows.clone(), sunDir: s.sunDir.clone(),
    };
  }

  get headlightLevel(): number {
    return this.cur.headlights;
  }

  get nightLevel(): number {
    return this.cur.nightFx;
  }

  update(dt: number, focus: THREE.Vector3, camera: THREE.Camera): void {
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.duration);
      const e = this.t * this.t * (3 - 2 * this.t);
      lerpSnap(this.cur, this.from, this.to, e);
      this.apply();
    }
    this.sun.position.copy(focus).addScaledVector(this.cur.sunDir, 100);
    this.sun.target.position.copy(focus);
    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    const sunHorizon = new THREE.Vector3(this.cur.sunDir.x, Math.max(0.05, Math.min(this.cur.sunDir.y, 0.35)), this.cur.sunDir.z).normalize();
    this.sunDisc.position.copy(camera.position).addScaledVector(sunHorizon, 800);
    this.sunDisc.lookAt(camera.position);
  }

  private apply(): void {
    const c = this.cur;
    this.skyMat.uniforms.top.value.copy(c.sky);
    this.skyMat.uniforms.horizon.value.copy(c.fog);
    this.fog.color.copy(c.fog);
    this.fog.near = c.fogNear;
    this.fog.far = c.fogFar;
    this.scene.background = c.fog;
    this.ambient.color.copy(c.amb);
    this.ambient.intensity = c.ambInt;
    this.sun.color.copy(c.sun);
    this.sun.intensity = c.sunInt;
    this.hemi.color.copy(c.hemiSky);
    this.hemi.groundColor.copy(c.hemiGround);
    this.hemi.intensity = c.hemiInt;
    MATS.window.color.copy(c.window);
    MATS.night.opacity = c.nightFx * 0.085;
    MATS.night.visible = c.nightFx > 0.01;
    SKYLINE_MATS.body.color.copy(c.skyColor);
    SKYLINE_MATS.body.emissive.copy(c.skyEmissive);
    SKYLINE_MATS.windows.color.copy(c.skyWindows);
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, c.nightFx - 0.4) * 1.4;
    const sunMat = this.sunDisc.material as THREE.MeshBasicMaterial;
    const sunsetness = this.presetId === 'preset_sunset' ? 1 : 0;
    sunMat.opacity = Math.max(0, 1 - c.nightFx * 1.2) * (0.35 + 0.65 * sunsetness);
    sunMat.color.setHex(sunsetness ? 0xffd27a : 0xfffbe8);
    this.engine.setBloom(c.bloom, c.bloomThreshold);
    this.engine.renderer.toneMappingExposure = c.exposure;
  }
}
