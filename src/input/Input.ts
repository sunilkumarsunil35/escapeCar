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
}

export interface FrameInput extends ControllerPayload {
  gadgetPressed: boolean;
  source: 'keyboard' | 'touch' | 'gyro' | 'remote';
}

export interface RemoteSource {
  readonly connected: boolean;
  latest(): ControllerPayload | null;
}

type TouchMode = 'gyro' | 'buttons';

/** Merges keyboard, mouse, touch zones, gyroscope and the paired-phone stream into one FrameInput. */
export class InputManager {
  readonly gyro = new GyroSteer();
  remote: RemoteSource | null = null;
  touchMode: TouchMode = 'buttons';
  private keys = new Set<string>();
  private kbSteer = 0;
  private mouseFire = false;
  private touch = { drift: false, fire: false, gadget: false, left: false, right: false };
  private lastGadget = false;
  private layer: HTMLDivElement;
  private gadgetLabel: HTMLDivElement;
  private gadgetBtn: HTMLDivElement;
  private steerBtns: HTMLDivElement;
  private driftZone: HTMLDivElement;
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

    this.layer = document.createElement('div');
    this.layer.className = 'touch-layer hidden';
    this.layer.innerHTML = `
      <div class="tz tz-drift"><span>HOLD<br/>DRIFT / BRAKE</span></div>
      <div class="tz-steer">
        <div class="tz tz-left">◀</div>
        <div class="tz tz-right">▶</div>
      </div>
      <div class="tz tz-gadget"><div class="tz-label">GADGET</div><div class="tz-cd"></div></div>
      <div class="tz tz-fire"><span>FIRE</span></div>`;
    uiRoot.appendChild(this.layer);
    this.driftZone = this.layer.querySelector('.tz-drift') as HTMLDivElement;
    this.steerBtns = this.layer.querySelector('.tz-steer') as HTMLDivElement;
    this.gadgetBtn = this.layer.querySelector('.tz-gadget') as HTMLDivElement;
    this.gadgetLabel = this.layer.querySelector('.tz-cd') as HTMLDivElement;
    this.bindZone(this.driftZone, 'drift');
    this.bindZone(this.layer.querySelector('.tz-fire') as HTMLElement, 'fire');
    this.bindZone(this.gadgetBtn, 'gadget');
    this.bindZone(this.layer.querySelector('.tz-left') as HTMLElement, 'left');
    this.bindZone(this.layer.querySelector('.tz-right') as HTMLElement, 'right');
    this.layer.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private bindZone(el: HTMLElement, key: keyof InputManager['touch']): void {
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

  /** Show/hide on-screen touch controls for an active run. */
  setTouchVisible(visible: boolean): void {
    const show = visible && IS_TOUCH && !(this.remote?.connected ?? false);
    this.layer.classList.toggle('hidden', !show);
    this.layer.classList.toggle('gyro-mode', this.touchMode === 'gyro');
    this.steerBtns.style.display = this.touchMode === 'buttons' ? '' : 'none';
  }

  setGadgetCooldown(remaining: number, ready: boolean): void {
    this.gadgetLabel.textContent = ready ? 'READY' : `${remaining.toFixed(1)}s`;
    this.gadgetBtn.classList.toggle('cooling', !ready);
  }

  resetTransient(): void {
    this.lastGadget = false;
    this.kbSteer = 0;
  }

  poll(dt: number): FrameInput {
    const remote = this.remote?.connected ? this.remote.latest() : null;
    let out: FrameInput;
    if (remote) {
      out = { ...remote, gadgetPressed: false, source: 'remote' };
    } else {
      const k = this.keys;
      const left = k.has('KeyA') || k.has('ArrowLeft');
      const right = k.has('KeyD') || k.has('ArrowRight');
      const target = (right ? 1 : 0) - (left ? 1 : 0);
      this.kbSteer = target === 0 ? approach(this.kbSteer, 0, dt * 6) : approach(this.kbSteer, target, dt * 4.5);
      const kbDrift = k.has('Space') || k.has('ShiftLeft') || k.has('ShiftRight');
      const kbFire = k.has('KeyJ') || k.has('KeyF') || k.has('Enter') || k.has('KeyK') || this.mouseFire;
      const kbGadget = k.has('KeyE') || k.has('KeyQ') || k.has('KeyL');
      const kbReverse = k.has('KeyS') || k.has('ArrowDown');
      let steer = this.kbSteer;
      let source: FrameInput['source'] = 'keyboard';
      if (Math.abs(steer) < 0.01) {
        if (this.touchMode === 'gyro' && this.gyro.active) {
          steer = this.gyro.steer;
          source = 'gyro';
        } else if (this.touch.left || this.touch.right) {
          steer = (this.touch.right ? 1 : 0) - (this.touch.left ? 1 : 0);
          source = 'touch';
        }
      }
      const drift = kbDrift || this.touch.drift;
      const shoot = kbFire || this.touch.fire;
      out = {
        steer,
        drift,
        shoot,
        gadget: kbGadget || this.touch.gadget,
        reverse: kbReverse || (this.touch.drift && this.touch.fire),
        recenter: false,
        gadgetPressed: false,
        source,
      };
    }
    out.gadgetPressed = out.gadget && !this.lastGadget;
    this.lastGadget = out.gadget;
    return out;
  }

  isKeyDown(code: string): boolean {
    return this.keys.has(code);
  }
}
