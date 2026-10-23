import QRCode from 'qrcode';
import { formatCash, formatTime } from '../core/math';
import type { RunResult } from '../game/Game';
import type { LeaderEntry, Settings, ShakeLevel } from '../core/Save';
import type { PeerHost, HostStatus } from '../input/PeerHost';
import { stars } from './Hud';

/** Slide-in game-over summary (doc §6.4). */
export class WreckedScreen {
  readonly el: HTMLDivElement;
  onRetry: (() => void) | null = null;
  onGarage: (() => void) | null = null;
  onName: ((name: string) => void) | null = null;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'overlay wrecked hidden';
    this.el.innerHTML = `
      <div class="w-card">
        <h1>W R E C K E D</h1>
        <div class="w-sub"></div>
        <div class="w-cols">
          <div class="w-earn"></div>
          <div class="w-board"><h3 class="w-board-title">LEADERBOARD</h3><ol class="w-list"></ol>
            <label class="w-name">NAME <input maxlength="14" spellcheck="false" /></label></div>
        </div>
        <div class="w-actions">
          <button class="w-garage">GARAGE <span class="w-dot hidden">• New Upgrade</span></button>
          <button class="w-retry">RUN IT BACK <span>(RETRY)</span></button>
        </div>
      </div>`;
    root.appendChild(this.el);
    (this.el.querySelector('.w-retry') as HTMLButtonElement).addEventListener('click', () => this.onRetry?.());
    (this.el.querySelector('.w-garage') as HTMLButtonElement).addEventListener('click', () => this.onGarage?.());
    const input = this.el.querySelector('.w-name input') as HTMLInputElement;
    input.addEventListener('change', () => this.onName?.(input.value.trim().toUpperCase() || 'YOU'));
  }

  get visible(): boolean {
    return !this.el.classList.contains('hidden');
  }

  show(r: RunResult, opts: { newBest: boolean; upgradeDot: boolean; name: string; global: boolean }): void {
    (this.el.querySelector('.w-sub') as HTMLElement).innerHTML =
      `SURVIVED: <b>${formatTime(r.time)}</b> &nbsp;|&nbsp; MAX HEAT: <b class="stars">${stars(r.maxHeat)}</b>${opts.newBest ? ' &nbsp;<em>NEW BEST!</em>' : ''}`;
    (this.el.querySelector('.w-earn') as HTMLElement).innerHTML = `
      <h3>RUN EARNINGS</h3>
      <div><span>Distance Bonus (${Math.round(r.distance)} m)</span><b>+${formatCash(r.distanceBonus)}</b></div>
      <div><span>Cash Collected</span><b>+${formatCash(r.cashCollected)}</b></div>
      <div><span>Chasers Destroyed</span><b>${r.kills}</b></div>
      <div><span>Near-Miss Bonus</span><b>+${formatCash(r.nearMissCash)}</b></div>
      <div><span>Objectives (${r.objectivesDone})</span><b>+${formatCash(r.objectiveCash)}</b></div>
      <div><span>Combo Payouts (best x${r.bestCombo.toFixed(1)})</span><b>+${formatCash(r.comboCash)}</b></div>
      <div class="total"><span>TOTAL EARNED</span><b>+${formatCash(r.total)}</b></div>
      <div class="score"><span>Score</span><b>${r.score.toLocaleString('en-US')}</b></div>`;
    (this.el.querySelector('.w-board-title') as HTMLElement).textContent = opts.global ? 'GLOBAL LEADERBOARD' : 'LOCAL LEADERBOARD';
    (this.el.querySelector('.w-dot') as HTMLElement).classList.toggle('hidden', !opts.upgradeDot);
    (this.el.querySelector('.w-name input') as HTMLInputElement).value = opts.name;
    (this.el.querySelector('.w-list') as HTMLElement).innerHTML = '<li class="muted">Loading…</li>';
    this.el.classList.remove('hidden');
    this.el.classList.remove('in');
    void this.el.offsetWidth;
    this.el.classList.add('in');
  }

  setBoard(entries: LeaderEntry[], highlight: LeaderEntry | null): void {
    const list = this.el.querySelector('.w-list') as HTMLElement;
    if (!entries.length) {
      list.innerHTML = '<li class="muted">No runs yet</li>';
      return;
    }
    list.innerHTML = entries
      .slice(0, 8)
      .map((e) => {
        const me = highlight && e.date === highlight.date && e.time === highlight.time;
        return `<li class="${me ? 'me' : ''}"><span>${escapeHtml(e.name)}</span><b>${formatTime(e.time)}</b></li>`;
      })
      .join('');
  }

  hide(): void {
    this.el.classList.add('hidden');
  }
}

export class PauseMenu {
  readonly el: HTMLDivElement;
  onResume: (() => void) | null = null;
  onCalibrate: (() => void) | null = null;
  onQuit: (() => void) | null = null;
  onSettings: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'overlay pause hidden';
    this.el.innerHTML = `
      <div class="p-card">
        <h1>PAUSED</h1>
        <button class="p-resume">RESUME</button>
        <button class="p-cal">TAP TO CALIBRATE GYRO</button>
        <button class="p-settings">SETTINGS</button>
        <button class="p-quit">QUIT TO GARAGE</button>
        <p class="p-keys">A/D steer · SPACE hop+drift · J/click fire · E gadget · W nitro · S reverse</p>
      </div>`;
    root.appendChild(this.el);
    (this.el.querySelector('.p-resume') as HTMLButtonElement).addEventListener('click', () => this.onResume?.());
    (this.el.querySelector('.p-cal') as HTMLButtonElement).addEventListener('click', () => this.onCalibrate?.());
    (this.el.querySelector('.p-quit') as HTMLButtonElement).addEventListener('click', () => this.onQuit?.());
    (this.el.querySelector('.p-settings') as HTMLButtonElement).addEventListener('click', () => this.onSettings?.());
  }

  show(v: boolean, showCalibrate: boolean): void {
    this.el.classList.toggle('hidden', !v);
    (this.el.querySelector('.p-cal') as HTMLElement).style.display = showCalibrate ? '' : 'none';
  }

  get visible(): boolean {
    return !this.el.classList.contains('hidden');
  }
}

/** Mobile pre-run prompt: iOS needs a user tap to grant DeviceOrientation, which also calibrates 0°. */
export class CalibratePrompt {
  readonly el: HTMLDivElement;
  onGyro: (() => void) | null = null;
  onButtons: (() => void) | null = null;
  onCancel: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'overlay calibrate hidden';
    this.el.innerHTML = `
      <div class="c-card">
        <div class="c-phone">📱</div>
        <h2>Hold your phone like a steering wheel</h2>
        <p>Auto-gas is on. Tilt to steer (±30°). Left thumb = hop & drift, right thumb = fire / nitro / gadget.</p>
        <button class="c-go">TAP TO CALIBRATE & START</button>
        <button class="c-buttons">Use on-screen steering instead</button>
        <button class="c-cancel">Back</button>
        <p class="c-msg"></p>
      </div>`;
    root.appendChild(this.el);
    (this.el.querySelector('.c-go') as HTMLButtonElement).addEventListener('click', () => this.onGyro?.());
    (this.el.querySelector('.c-buttons') as HTMLButtonElement).addEventListener('click', () => this.onButtons?.());
    (this.el.querySelector('.c-cancel') as HTMLButtonElement).addEventListener('click', () => this.onCancel?.());
  }

  show(v: boolean, msg = ''): void {
    this.el.classList.toggle('hidden', !v);
    (this.el.querySelector('.c-msg') as HTMLElement).textContent = msg;
  }
}

/** QR pairing modal: shows room code + QR for https://host/?room=ABCD and live connection status. */
export class PairModal {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private unsub: (() => void) | null = null;
  onClose: (() => void) | null = null;

  constructor(root: HTMLElement, private host: PeerHost) {
    this.el = document.createElement('div');
    this.el.className = 'overlay pair hidden';
    this.el.innerHTML = `
      <div class="q-card">
        <h2>PAIR PHONE AS STEERING WHEEL</h2>
        <div class="q-body">
          <canvas class="q-code" width="220" height="220"></canvas>
          <div class="q-info">
            <div class="q-room">ROOM <b>····</b></div>
            <ol>
              <li>Scan the QR code with your phone camera.</li>
              <li>Tap <b>CALIBRATE & CONNECT</b>, hold the phone sideways.</li>
              <li>Tilt to steer · left half drift · right half shoot.</li>
            </ol>
            <a class="q-url" target="_blank" rel="noopener"></a>
            <div class="q-status">Opening room…</div>
            <p class="q-note"></p>
          </div>
        </div>
        <div class="q-actions"><button class="q-new">NEW ROOM</button><button class="q-close">DONE</button></div>
      </div>`;
    root.appendChild(this.el);
    this.canvas = this.el.querySelector('.q-code') as HTMLCanvasElement;
    (this.el.querySelector('.q-close') as HTMLButtonElement).addEventListener('click', () => this.close());
    (this.el.querySelector('.q-new') as HTMLButtonElement).addEventListener('click', () => {
      this.host.close();
      this.host.open();
    });
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
  }

  open(): void {
    this.el.classList.remove('hidden');
    this.unsub?.();
    this.unsub = this.host.onStatus((s) => this.render(s));
    this.host.open();
    this.render(this.host.status);
    const isLocal = /^(localhost|127\.|\[::1\])/.test(location.hostname);
    (this.el.querySelector('.q-note') as HTMLElement).textContent = isLocal
      ? 'Tip: open this page via your LAN IP (vite --host prints it) so your phone can reach it. iOS gyro needs HTTPS — use npm run dev:https.'
      : location.protocol !== 'https:' ? 'Tip: iOS requires HTTPS for motion sensors (npm run dev:https).' : '';
  }

  close(): void {
    this.el.classList.add('hidden');
    this.unsub?.();
    this.unsub = null;
    this.onClose?.();
  }

  private render(s: HostStatus): void {
    const status = this.el.querySelector('.q-status') as HTMLElement;
    const labels: Record<HostStatus, string> = {
      idle: 'Idle',
      opening: 'Opening room…',
      waiting: 'Waiting for phone…',
      connected: '✔ PHONE CONNECTED — close this and hit ESCAPE!',
      error: `Error: ${this.host.error || 'signaling server unreachable'}`,
    };
    status.textContent = labels[s];
    status.className = `q-status ${s}`;
    if (this.host.room) {
      (this.el.querySelector('.q-room b') as HTMLElement).textContent = this.host.room;
      const url = this.host.controllerUrl;
      const a = this.el.querySelector('.q-url') as HTMLAnchorElement;
      a.href = url;
      a.textContent = url;
      void QRCode.toCanvas(this.canvas, url, { width: 220, margin: 1, color: { dark: '#1c1917', light: '#fdf6e9' } });
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** Audio + accessibility settings (music/SFX buses, screen shake level, reduce flashing). */
export class SettingsPanel {
  readonly el: HTMLDivElement;
  onChange: ((s: Settings) => void) | null = null;
  private value: Settings = { music: 0.5, sfx: 0.8, shake: 'full', reduceFlashing: false };

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'overlay settings hidden';
    this.el.innerHTML = `
      <div class="p-card s-card">
        <h1>SETTINGS</h1>
        <label class="s-row">MUSIC <input type="range" min="0" max="1" step="0.05" data-k="music" /></label>
        <label class="s-row">SOUND FX <input type="range" min="0" max="1" step="0.05" data-k="sfx" /></label>
        <div class="s-row">SCREEN SHAKE
          <div class="s-seg">${(['full', 'reduced', 'off'] as ShakeLevel[]).map((v) => `<button data-shake="${v}">${v.toUpperCase()}</button>`).join('')}</div>
        </div>
        <label class="s-row s-check"><input type="checkbox" data-k="reduceFlashing" /> REDUCE FLASHING</label>
        <p class="p-keys">Gamepad: left stick steer · RT/A fire · RB/B drift · X gadget · Y/LB nitro · LT slow · Start pause</p>
        <button class="s-close">DONE</button>
      </div>`;
    root.appendChild(this.el);
    this.el.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) =>
      inp.addEventListener('input', () => {
        (this.value as unknown as Record<string, number>)[inp.dataset.k as string] = Number(inp.value);
        this.emit();
      }),
    );
    (this.el.querySelector('input[type=checkbox]') as HTMLInputElement).addEventListener('change', (e) => {
      this.value.reduceFlashing = (e.target as HTMLInputElement).checked;
      this.emit();
    });
    this.el.querySelectorAll<HTMLButtonElement>('[data-shake]').forEach((b) =>
      b.addEventListener('click', () => {
        this.value.shake = b.dataset.shake as ShakeLevel;
        this.sync();
        this.emit();
      }),
    );
    (this.el.querySelector('.s-close') as HTMLButtonElement).addEventListener('click', () => this.show(false));
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.show(false);
    });
  }

  private emit(): void {
    this.onChange?.({ ...this.value });
  }

  private sync(): void {
    (this.el.querySelector('[data-k=music]') as HTMLInputElement).value = String(this.value.music);
    (this.el.querySelector('[data-k=sfx]') as HTMLInputElement).value = String(this.value.sfx);
    (this.el.querySelector('[data-k=reduceFlashing]') as HTMLInputElement).checked = this.value.reduceFlashing;
    this.el.querySelectorAll<HTMLButtonElement>('[data-shake]').forEach((b) => b.classList.toggle('on', b.dataset.shake === this.value.shake));
  }

  open(current: Settings): void {
    this.value = { ...current };
    this.sync();
    this.show(true);
  }

  show(v: boolean): void {
    this.el.classList.toggle('hidden', !v);
  }

  get visible(): boolean {
    return !this.el.classList.contains('hidden');
  }
}
