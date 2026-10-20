import Peer, { type DataConnection } from 'peerjs';
import { GyroSteer } from './Gyro';
import { PEER_PREFIX } from './PeerHost';
import type { ControllerPayload } from './Input';

/**
 * Phone-side QR controller (?room=ABCD): high-contrast touch gamepad + gyro wheel that streams a
 * ControllerPayload to the PC browser every 16 ms over a PeerJS WebRTC DataChannel.
 */
export class ControllerApp {
  private gyro = new GyroSteer();
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private state = { drift: false, shoot: false, gadget: false, recenter: false };
  private gadgetHoldFrames = 0;
  private nitroHoldFrames = 0;
  private recenterFrames = 0;
  private statusEl!: HTMLDivElement;
  private steerFill!: HTMLDivElement;
  private latencyEl!: HTMLDivElement;
  private sendTimer = 0;
  private pingTimer = 0;
  private retryTimer = 0;
  private wakeLock: { release: () => Promise<void> } | null = null;

  constructor(private root: HTMLElement, private room: string) {}

  mount(): void {
    document.body.classList.add('controller-mode');
    this.root.innerHTML = `
      <div class="ctl">
        <div class="ctl-top">
          <button class="ctl-recenter">RE-CENTER STEERING</button>
          <div class="ctl-steer"><div class="ctl-steer-fill"></div><div class="ctl-steer-mid"></div></div>
          <div class="ctl-status">ROOM ${this.room} · CONNECTING…</div>
        </div>
        <div class="ctl-body">
          <div class="ctl-zone ctl-drift">HOLD TO DRIFT<small>LEFT THUMB · BRAKE</small></div>
          <div class="ctl-right">
            <div class="ctl-row">
              <div class="ctl-zone ctl-gadget">GADGET</div>
              <div class="ctl-zone ctl-nitro">NITRO</div>
            </div>
            <div class="ctl-zone ctl-shoot">HOLD TO SHOOT</div>
          </div>
        </div>
        <div class="ctl-latency"></div>
        <div class="ctl-start">
          <div class="ctl-start-title">ESCAPE<span>CAR</span> CONTROLLER</div>
          <p>Hold your phone sideways like a steering wheel.</p>
          <button class="ctl-start-btn">TAP TO CALIBRATE & CONNECT</button>
          <p class="ctl-hint">Room <b>${this.room}</b> · Both thumbs held = reverse</p>
        </div>
      </div>`;
    this.statusEl = this.root.querySelector('.ctl-status') as HTMLDivElement;
    this.steerFill = this.root.querySelector('.ctl-steer-fill') as HTMLDivElement;
    this.latencyEl = this.root.querySelector('.ctl-latency') as HTMLDivElement;
    const start = this.root.querySelector('.ctl-start') as HTMLDivElement;
    (this.root.querySelector('.ctl-start-btn') as HTMLButtonElement).addEventListener('click', async () => {
      await this.enterFullscreen();
      const ok = await this.gyro.enable();
      if (ok) {
        await this.gyro.waitForData();
        this.gyro.calibrate();
      } else {
        this.statusEl.textContent = 'GYRO UNAVAILABLE — enable motion access';
      }
      start.classList.add('hidden');
      this.connect();
      void this.requestWakeLock();
    });
    (this.root.querySelector('.ctl-recenter') as HTMLButtonElement).addEventListener('click', () => {
      this.gyro.calibrate();
      this.recenterFrames = 6;
      navigator.vibrate?.(30);
    });
    this.bindZone('.ctl-drift', 'drift');
    this.bindZone('.ctl-shoot', 'shoot');
    const tap = (sel: string, onTap: () => void): void => {
      const el = this.root.querySelector(sel) as HTMLDivElement;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        onTap();
        el.classList.add('active');
        navigator.vibrate?.(20);
        setTimeout(() => el.classList.remove('active'), 150);
      });
    };
    tap('.ctl-gadget', () => (this.gadgetHoldFrames = 6));
    tap('.ctl-nitro', () => (this.nitroHoldFrames = 6));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.requestWakeLock();
    });
  }

  private bindZone(sel: string, key: 'drift' | 'shoot'): void {
    const el = this.root.querySelector(sel) as HTMLDivElement;
    const pointers = new Set<number>();
    const update = (): void => {
      this.state[key] = pointers.size > 0;
      el.classList.toggle('active', pointers.size > 0);
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pointers.add(e.pointerId);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
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
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private async enterFullscreen(): Promise<void> {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      if (so?.lock) await so.lock('landscape');
    } catch {
      /* iOS Safari has no fullscreen/orientation lock — the rotate hint covers it */
    }
  }

  private async requestWakeLock(): Promise<void> {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
      if (nav.wakeLock && !this.wakeLock) this.wakeLock = await nav.wakeLock.request('screen');
    } catch {
      this.wakeLock = null;
    }
  }

  private connect(): void {
    window.clearTimeout(this.retryTimer);
    this.peer?.destroy();
    this.statusEl.textContent = `ROOM ${this.room} · CONNECTING…`;
    this.statusEl.className = 'ctl-status';
    const peer = new Peer({ debug: 1 });
    this.peer = peer;
    peer.on('open', () => {
      const conn = peer.connect(PEER_PREFIX + this.room, { reliable: false, serialization: 'json' });
      this.conn = conn;
      conn.on('open', () => {
        this.statusEl.textContent = 'STATUS: CONNECTED';
        this.statusEl.className = 'ctl-status ok';
        navigator.vibrate?.([40, 40, 40]);
        this.startStreaming();
      });
      conn.on('data', (data) => {
        const msg = data as { vibrate?: number; pong?: number };
        if (typeof msg.vibrate === 'number') navigator.vibrate?.(msg.vibrate);
        if (typeof msg.pong === 'number') this.latencyEl.textContent = `${Math.round((performance.now() - msg.pong) / 2)} ms`;
      });
      conn.on('close', () => this.scheduleRetry('DISCONNECTED'));
      conn.on('error', () => this.scheduleRetry('CONNECTION ERROR'));
    });
    peer.on('error', (err: Error & { type?: string }) => {
      this.scheduleRetry(err.type === 'peer-unavailable' ? `ROOM ${this.room} NOT FOUND` : 'NETWORK ERROR');
    });
  }

  private scheduleRetry(reason: string): void {
    this.stopStreaming();
    this.statusEl.textContent = `${reason} · RETRYING…`;
    this.statusEl.className = 'ctl-status bad';
    window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => this.connect(), 2000);
  }

  private startStreaming(): void {
    this.stopStreaming();
    this.sendTimer = window.setInterval(() => this.sendFrame(), 16);
    this.pingTimer = window.setInterval(() => {
      if (this.conn?.open) this.conn.send({ ping: performance.now() });
    }, 1000);
  }

  private stopStreaming(): void {
    window.clearInterval(this.sendTimer);
    window.clearInterval(this.pingTimer);
  }

  private sendFrame(): void {
    const steer = this.gyro.steer;
    this.steerFill.style.transform = `translateX(${steer * 50}%)`;
    const payload: ControllerPayload = {
      steer: Math.round(steer * 1000) / 1000,
      drift: this.state.drift,
      shoot: this.state.shoot,
      gadget: this.gadgetHoldFrames > 0,
      nitro: this.nitroHoldFrames > 0,
      reverse: this.state.drift && this.state.shoot,
      recenter: this.recenterFrames > 0,
    };
    if (this.gadgetHoldFrames > 0) this.gadgetHoldFrames--;
    if (this.nitroHoldFrames > 0) this.nitroHoldFrames--;
    if (this.recenterFrames > 0) this.recenterFrames--;
    if (this.conn?.open) this.conn.send(payload);
  }
}
