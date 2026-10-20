import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Primary input is a finger (phones/tablets) — touchscreen laptops with a mouse keep keyboard controls. */
export const IS_TOUCH =
  typeof window !== 'undefined' && navigator.maxTouchPoints > 0 && window.matchMedia('(pointer: coarse)').matches;
export const IS_MOBILE = IS_TOUCH && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent + (navigator.maxTouchPoints > 1 ? ' iPad' : ''));

/** Owns the WebGL renderer, optional bloom composer, resize handling and the RAF loop. */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  readonly lowQuality: boolean;
  private last = 0;
  private running = false;
  private frameCb: (dt: number) => void = () => {};
  private resizeCbs: ((w: number, h: number) => void)[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.lowQuality = IS_MOBILE;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.lowQuality, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.lowQuality ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (!this.lowQuality) {
      this.composer = new EffectComposer(this.renderer);
      this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
      this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.3, 0.55, 0.85);
      this.composer.addPass(this.renderPass);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    this.resize();
  }

  onResize(cb: (w: number, h: number) => void): void {
    this.resizeCbs.push(cb);
    cb(window.innerWidth, window.innerHeight);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.bloom?.resolution.set(w / 2, h / 2);
    this.resizeCbs.forEach((cb) => cb(w, h));
  }

  setBloom(strength: number, threshold: number): void {
    if (!this.bloom) return;
    this.bloom.strength = strength;
    this.bloom.threshold = threshold;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.composer && this.renderPass) {
      this.renderPass.scene = scene;
      this.renderPass.camera = camera;
      this.composer.render();
    } else {
      this.renderer.render(scene, camera);
    }
  }

  start(cb: (dt: number) => void): void {
    this.frameCb = cb;
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (t: number): void => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, Math.max(0, (t - this.last) / 1000));
      this.last = t;
      this.frameCb(dt);
    };
    requestAnimationFrame(loop);
  }
}
