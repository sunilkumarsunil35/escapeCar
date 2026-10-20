import { GyroSteer } from './Gyro';
import { approach } from '../core/math';
import { IS_TOUCH } from '../core/Engine';

/** Doc §2.2 — the 60 FPS WebRTC payload; local inputs are normalized into the same shape. */
export interface ControllerPayload {
  steer: number;
  drift: boolean;
  shoot: boolean;
  gadget: boolean;
  reverse: boolean;
  recenter: boolean;
  /** Fire a banked nitro charge (older controllers simply omit it). */
  nitro?: boolean;
}

export interface FrameInput extends ControllerPayload {
  gadgetPressed: boolean;
  nitroPressed: boolean;
  /** Touch play fires automatically whenever the turret has a lock (one less button for thumbs). */
  autoFire: boolean;
  source: 'keyboard' | 'touch' | 'gyro' | 'remote';
}

export interface RemoteSource {
  readonly connected: boolean;
  latest(): ControllerPayload | null;
}

type TouchMode = 'gyro' | 'buttons';
type TouchKey = 'drift' | 'gadget' | 'nitro' | 'reverse';

/** Merges keyboard, mouse, touch zones, gyroscope and the paired-phone stream into one FrameInput. */
export class InputManager {
  readonly gyro = new GyroSteer();
  remote: RemoteSource | null = null;
  touchMode: TouchMode = 'buttons';
  private keys = new Set<string>();
  private kbSteer = 0;
  private mouseFire = false;
  private touch: Record<TouchKey, boolean> = { drift: false, gadget: false, nitro: false, reverse: false };
  private padSteer = 0;
  private padActive = false;
  private lastGadget = false;
  private lastNitro = false;
  private layer: HTMLDivElement;
  private pad: HTMLDivElement;
  private knob: HTMLDivElement;
  private buttons: Record<'gadget' | 'nitro', HTMLDivElement>;
  enabled = false;

  constructor(uiRoot: HTMLElement, private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && this.enabled) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseFire = false;
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseFire = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseFire = false;
    });

    // Touch layout: left thumb = one big slide-to-steer pad (drift zone in gyro mode),
    // right thumb = DRIFT + NITRO + GADGET. The roof gun auto-fires on lock.
    this.layer = document.createElement('div');
    this.layer.className = 'touch-layer hidden';
    this.layer.innerHTML = `
      <div class="tz tz-pad"><div class="tz-pad-track"><span>◀</span><span>SLIDE TO STEER</span><span>▶</span></div><div class="tz-knob"></div></div>
      <div class="tz tz-gyro-drift"><span>HOLD · DRIFT / BRAKE</span></div>
      <div class="tz tz-rev">REV</div>
      <div class="tz tz-drift"><span>DRIFT</span></div>
      <div class="tz tz-nitro"><div class="tz-fill"></div><span>NITRO</span><b class="tz-sub"></b></div>
      <div class="tz tz-gadget"><div class="tz-fill"></div><span>GADGET</span><b class="tz-sub"></b></div>
      <div class="tz-auto">AUTO-FIRE ON LOCK</div>`;
    uiRoot.appendChild(this.layer);
    this.pad = this.layer.querySelector('.tz-pad') as HTMLDivElement;
    this.knob = this.layer.querySelector('.tz-knob') as HTMLDivElement;
    this.buttons = {
      gadget: this.layer.querySelector('.tz-gadget') as HTMLDivElement,
      nitro: this.layer.querySelector('.tz-nitro') as HTMLDivElement,
    };
    this.bindPad();
    this.bindZone(this.layer.querySelector('.tz-drift') as HTMLElement, 'drift');
    this.bindZone(this.layer.querySelector('.tz-gyro-drift') as HTMLElement, 'drift');
    this.bindZone(this.layer.querySelector('.tz-rev') as HTMLElement, 'reverse');
    this.bindZone(this.buttons.gadget, 'gadget');
    this.bindZone(this.buttons.nitro, 'nitro');
    this.layer.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Analog steering from the finger's x within the pad; sliding across it never "misses" a button. */
  private bindPad(): void {
    const pointers = new Map<number, number>();
    const update = (): void => {
      this.padActive = pointers.size > 0;
      if (!this.padActive) {
        this.padSteer = 0;
      } else {
        const r = this.pad.getBoundingClientRect();
        const x = [...pointers.values()].pop() as number;
        const v = Math.max(-1, Math.min(1, (x - (r.left + r.width / 2)) / (r.width * 0.3)));
        const dz = 0.1;
        this.padSteer = Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz);
      }
      this.pad.classList.toggle('active', this.padActive);
      this.knob.style.left = `${50 + this.padSteer * 32}%`;
    };
    this.pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pointers.set(e.pointerId, e.clientX);
      try {
        this.pad.setPointerCapture(e.pointerId);
      } catch {
        /* capture unsupported for this pointer type */
      }
      update();
    });
    this.pad.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, e.clientX);
      update();
    });
    const up = (e: PointerEvent): void => {
      pointers.delete(e.pointerId);
      update();
    };
    this.pad.addEventListener('pointerup', up);
    this.pad.addEventListener('pointercancel', up);
    this.pad.addEventListener('lostpointercapture', up);
  }

  private bindZone(el: HTMLElement, key: TouchKey): void {
    const pointers = new Set<number>();
    const update = (): void => {
      this.touch[key] = pointers.size > 0;
      el.classList.toggle('active', pointers.size > 0);
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pointers.add(e.pointerId);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* capture unsupported for this pointer type */
      }
      update();
    });
    const up = (e: PointerEvent): void => {
      pointers.delete(e.pointerId);
      update();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  get touchVisible(): boolean {
    return !this.layer.classList.contains('hidden');
  }

  /** Show/hide on-screen touch controls for an active run. */
  setTouchVisible(visible: boolean): void {
    const show = visible && IS_TOUCH && !(this.remote?.connected ?? false);
    this.layer.classList.toggle('hidden', !show);
    this.layer.classList.toggle('gyro-mode', this.touchMode === 'gyro');
  }

  /** Radial cooldown fill + label on the touch GADGET / NITRO buttons. */
  setButtonState(which: 'gadget' | 'nitro', fill: number, label: string, ready: boolean): void {
    const btn = this.buttons[which];
    (btn.querySelector('.tz-fill') as HTMLElement).style.setProperty('--p', String(Math.max(0, Math.min(1, fill))));
    (btn.querySelector('.tz-sub') as HTMLElement).textContent = label;
    btn.classList.toggle('cooling', !ready);
  }

  resetTransient(): void {
    this.lastGadget = false;
    this.lastNitro = false;
    this.kbSteer = 0;
  }

  poll(dt: number): FrameInput {
    const remote = this.remote?.connected ? this.remote.latest() : null;
    let out: FrameInput;
    if (remote) {
      out = { ...remote, nitro: Boolean(remote.nitro), gadgetPressed: false, nitroPressed: false, autoFire: false, source: 'remote' };
    } else {
      const k = this.keys;
      const left = k.has('KeyA') || k.has('ArrowLeft');
      const right = k.has('KeyD') || k.has('ArrowRight');
      const target = (right ? 1 : 0) - (left ? 1 : 0);
      // Snappy keyboard steering: full lock in ~0.12 s, instant direction flips, fast re-centre.
      if (target !== 0 && this.kbSteer * target < 0) this.kbSteer = 0;
      this.kbSteer = target === 0 ? approach(this.kbSteer, 0, dt * 10) : approach(this.kbSteer, target, dt * 8);
      const kbDrift = k.has('Space') || k.has('ShiftLeft') || k.has('ShiftRight');
      const kbFire = k.has('KeyJ') || k.has('KeyF') || k.has('Enter') || k.has('KeyK') || this.mouseFire;
      const kbGadget = k.has('KeyE') || k.has('KeyQ') || k.has('KeyL');
      const kbNitro = k.has('KeyW') || k.has('ArrowUp') || k.has('KeyN');
      const kbReverse = k.has('KeyS') || k.has('ArrowDown');
      const touching = this.touchVisible;
      let steer = this.kbSteer;
      let source: FrameInput['source'] = touching ? 'touch' : 'keyboard';
      if (Math.abs(steer) < 0.01) {
        if (this.touchMode === 'gyro' && this.gyro.active) {
          steer = this.gyro.steer;
          source = 'gyro';
        } else if (this.padActive) {
          steer = this.padSteer;
          source = 'touch';
        }
      }
      out = {
        steer,
        drift: kbDrift || this.touch.drift,
        shoot: kbFire,
        gadget: kbGadget || this.touch.gadget,
        nitro: kbNitro || this.touch.nitro,
        reverse: kbReverse || this.touch.reverse,
        recenter: false,
        gadgetPressed: false,
        nitroPressed: false,
        autoFire: touching,
        source,
      };
    }
    out.gadgetPressed = out.gadget && !this.lastGadget;
    this.lastGadget = out.gadget;
    out.nitroPressed = Boolean(out.nitro) && !this.lastNitro;
    this.lastNitro = Boolean(out.nitro);
    return out;
  }

  isKeyDown(code: string): boolean {
    return this.keys.has(code);
  }
}
