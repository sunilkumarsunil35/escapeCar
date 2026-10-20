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
  /** Joystick pulled back: slow down (and creep into reverse once stopped). */
  brake: boolean;
  source: 'keyboard' | 'touch' | 'gyro' | 'remote';
}

export interface RemoteSource {
  readonly connected: boolean;
  latest(): ControllerPayload | null;
}

type TouchMode = 'gyro' | 'buttons';
type TouchKey = 'drift' | 'fire' | 'gadget' | 'nitro' | 'reverse';

/** Merges keyboard, mouse, touch zones, gyroscope and the paired-phone stream into one FrameInput. */
export class InputManager {
  readonly gyro = new GyroSteer();
  remote: RemoteSource | null = null;
  touchMode: TouchMode = 'buttons';
  private keys = new Set<string>();
  private kbSteer = 0;
  private mouseFire = false;
  private touch: Record<TouchKey, boolean> = { drift: false, fire: false, gadget: false, nitro: false, reverse: false };
  private stick = { active: false, x: 0, y: 0 };
  private lastGadget = false;
  private lastNitro = false;
  private layer: HTMLDivElement;
  private stickZone: HTMLDivElement;
  private stickBase: HTMLDivElement;
  private stickKnob: HTMLDivElement;
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

    // Touch layout: left thumb = floating virtual joystick (left/right steer, up = nitro,
    // down = slow down); in gyro mode the left half is the drift zone instead.
    // Right thumb = FIRE (hold, targeting is automatic) + DRIFT + GADGET (+ NITRO in gyro mode).
    this.layer = document.createElement('div');
    this.layer.className = 'touch-layer hidden';
    this.layer.innerHTML = `
      <div class="tz tz-stick"><div class="tz-stick-base"><i class="up">NITRO</i><i class="down">SLOW</i><div class="tz-stick-knob"></div></div></div>
      <div class="tz tz-gyro-drift"><span>HOLD · DRIFT / BRAKE</span></div>
      <div class="tz tz-fire"><span>FIRE</span></div>
      <div class="tz tz-drift"><span>DRIFT</span></div>
      <div class="tz tz-nitro"><div class="tz-fill"></div><span>NITRO</span><b class="tz-sub"></b></div>
      <div class="tz tz-gadget"><div class="tz-fill"></div><span>GADGET</span><b class="tz-sub"></b></div>
`;
    uiRoot.appendChild(this.layer);
    this.stickZone = this.layer.querySelector('.tz-stick') as HTMLDivElement;
    this.stickBase = this.layer.querySelector('.tz-stick-base') as HTMLDivElement;
    this.stickKnob = this.layer.querySelector('.tz-stick-knob') as HTMLDivElement;
    this.buttons = {
      gadget: this.layer.querySelector('.tz-gadget') as HTMLDivElement,
      nitro: this.layer.querySelector('.tz-nitro') as HTMLDivElement,
    };
    this.bindStick();
    this.bindZone(this.layer.querySelector('.tz-fire') as HTMLElement, 'fire');
    this.bindZone(this.layer.querySelector('.tz-drift') as HTMLElement, 'drift');
    this.bindZone(this.layer.querySelector('.tz-gyro-drift') as HTMLElement, 'drift');
    this.bindZone(this.buttons.gadget, 'gadget');
    this.bindZone(this.buttons.nitro, 'nitro');
    this.layer.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /**
   * Floating joystick: it centres wherever the left thumb lands, so there is no small target to
   * miss. X steers (analog), pushing up fires nitro, pulling back slows down.
   */
  private bindStick(): void {
    const RADIUS = 56;
    let id: number | null = null;
    let cx = 0;
    let cy = 0;
    const rest = (): void => {
      this.stick.active = false;
      this.stick.x = 0;
      this.stick.y = 0;
      this.stickBase.style.left = '';
      this.stickBase.style.top = '';
      this.stickKnob.style.transform = 'translate(-50%, -50%)';
      this.stickZone.classList.remove('active', 'up', 'down');
    };
    const move = (x: number, y: number): void => {
      let dx = x - cx;
      let dy = y - cy;
      const len = Math.hypot(dx, dy);
      if (len > RADIUS) {
        dx = (dx / len) * RADIUS;
        dy = (dy / len) * RADIUS;
      }
      this.stick.x = dx / RADIUS;
      this.stick.y = dy / RADIUS;
      this.stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      this.stickZone.classList.toggle('up', this.stick.y < -0.6);
      this.stickZone.classList.toggle('down', this.stick.y > 0.55);
    };
    this.stickZone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (id !== null) return;
      id = e.pointerId;
      const r = this.stickZone.getBoundingClientRect();
      cx = Math.max(r.left + RADIUS + 8, Math.min(r.right - RADIUS - 8, e.clientX));
      cy = Math.max(r.top + RADIUS + 8, Math.min(r.bottom - RADIUS - 8, e.clientY));
      this.stickBase.style.left = `${cx - r.left}px`;
      this.stickBase.style.top = `${cy - r.top}px`;
      this.stick.active = true;
      this.stickZone.classList.add('active');
      try {
        this.stickZone.setPointerCapture(e.pointerId);
      } catch {
        /* capture unsupported for this pointer type */
      }
      move(e.clientX, e.clientY);
    });
    this.stickZone.addEventListener('pointermove', (e) => {
      if (e.pointerId === id) move(e.clientX, e.clientY);
    });
    const up = (e: PointerEvent): void => {
      if (e.pointerId !== id) return;
      id = null;
      rest();
    };
    this.stickZone.addEventListener('pointerup', up);
    this.stickZone.addEventListener('pointercancel', up);
    this.stickZone.addEventListener('lostpointercapture', up);
    rest();
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
      out = { ...remote, nitro: Boolean(remote.nitro), gadgetPressed: false, nitroPressed: false, brake: false, source: 'remote' };
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
        } else if (this.stick.active) {
          const dz = 0.14;
          const x = this.stick.x;
          steer = Math.abs(x) < dz ? 0 : (x - Math.sign(x) * dz) / (1 - dz);
          source = 'touch';
        }
      }
      out = {
        steer,
        drift: kbDrift || this.touch.drift,
        shoot: kbFire || this.touch.fire,
        gadget: kbGadget || this.touch.gadget,
        nitro: kbNitro || this.touch.nitro || (this.stick.active && this.stick.y < -0.6),
        reverse: kbReverse || this.touch.reverse,
        recenter: false,
        gadgetPressed: false,
        nitroPressed: false,
        brake: this.stick.active && this.stick.y > 0.55,
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
