import { Engine, IS_TOUCH } from './core/Engine';
import { initPhysics } from './core/Physics';
import { SaveStore } from './core/Save';
import { Leaderboard } from './core/Leaderboard';
import { audio } from './core/Audio';
import { AssetRegistry } from './assets/AssetRegistry';
import { InputManager } from './input/Input';
import { PeerHost } from './input/PeerHost';
import { Game, type RunResult } from './game/Game';
import { loadoutFromSave } from './game/Loadout';
import { GarageScene } from './garage/GarageScene';
import { GarageUI } from './ui/GarageUI';
import { CalibratePrompt, PairModal, PauseMenu, WreckedScreen } from './ui/Screens';
import { AdminPanel } from './admin/AdminPanel';
import type { LeaderEntry } from './core/Save';

type Mode = 'boot' | 'garage' | 'run' | 'admin';

function setBoot(pct: number, text: string): void {
  const bar = document.getElementById('boot-progress');
  const status = document.getElementById('boot-status');
  if (bar) bar.style.width = `${Math.round(pct * 100)}%`;
  if (status) status.textContent = text;
}

/** Yields so the boot status can paint; setTimeout (not rAF) so loading also progresses in background tabs. */
const nextFrame = (): Promise<void> => new Promise((r) => setTimeout(r, 16));

async function enterLandscapeFullscreen(): Promise<void> {
  if (!IS_TOUCH) return;
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    if (so?.lock) await so.lock('landscape');
  } catch {
    /* not supported (e.g. iOS Safari) — CSS rotate hint covers portrait */
  }
}

/** Top-level state machine: boot → garage ⇄ run (pause / wrecked / retry), plus ?admin=true inspector. */
export class App {
  private engine: Engine;
  private assets = new AssetRegistry();
  private save = new SaveStore();
  private leaderboard = new Leaderboard(this.save);
  private host = new PeerHost();
  private input!: InputManager;
  private game!: Game;
  private garage!: GarageScene;
  private garageUI!: GarageUI;
  private wrecked!: WreckedScreen;
  private pauseMenu!: PauseMenu;
  private calibrate!: CalibratePrompt;
  private pair!: PairModal;
  private admin: AdminPanel | null = null;
  private mode: Mode = 'boot';
  private uiRoot: HTMLElement;
  private readonly adminEnabled: boolean;

  constructor() {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.uiRoot = document.getElementById('ui-root') as HTMLElement;
    this.engine = new Engine(canvas);
    this.adminEnabled = new URLSearchParams(location.search).get('admin') === 'true';
    audio.setMuted(this.save.data.muted);
  }

  async boot(): Promise<void> {
    setBoot(0.05, 'Starting Rapier physics…');
    await initPhysics();
    setBoot(0.25, 'Loading asset manifest…');
    await this.assets.load((done, total, label) => {
      if (total > 0) setBoot(0.25 + (done / total) * 0.35, `Loading models… ${label}`);
    });
    setBoot(0.6, 'Building the city…');
    await nextFrame();
    this.input = new InputManager(this.uiRoot, this.engine.renderer.domElement);
    this.input.remote = this.host;
    this.buildWorlds();
    setBoot(0.9, 'Warming up the garage…');
    await nextFrame();
    this.buildUi();
    this.bindKeys();
    this.host.onStatus(() => {
      this.game.hud.setLinked(this.host.connected);
      if (this.mode === 'garage') this.garageUI.refresh();
    });
    this.engine.start((dt) => this.frame(dt));
    setBoot(1, 'Ready');
    const bootEl = document.getElementById('boot-screen');
    bootEl?.classList.add('done');
    setTimeout(() => bootEl?.remove(), 700);
    if (this.assets.failed.length) console.warn('[assets] procedural fallbacks used for', this.assets.failed);
    if (this.adminEnabled) this.toAdmin();
    else this.toGarage();
  }

  private buildWorlds(): void {
    this.game = new Game(this.engine, this.assets, this.input, this.host, this.uiRoot);
    this.game.onWrecked = (r) => this.onWrecked(r);
    this.game.onPauseRequest = () => this.togglePause();
    this.garage = new GarageScene(this.engine, this.assets);
  }

  private buildUi(): void {
    this.garageUI = new GarageUI(this.uiRoot, this.save, () => (this.host.connected ? 'PHONE PAIRED ✔' : 'PAIR PHONE (QR)'), this.adminEnabled);
    this.garageUI.onPlay = () => void this.requestRun();
    this.garageUI.onPair = () => this.pair.open();
    this.garageUI.onLoadout = (l) => this.garage.setLoadout(l);
    this.garageUI.onPreview = (kind, id, tier) => this.garage.setPreview(kind, id, tier);
    this.garageUI.onAdmin = () => this.toAdmin();

    this.wrecked = new WreckedScreen(this.uiRoot);
    this.wrecked.onRetry = () => this.beginRun();
    this.wrecked.onGarage = () => this.toGarage();
    this.wrecked.onName = (name) => {
      this.save.data.playerName = name;
      const last = this.save.data.leaderboard.reduce<LeaderEntry | null>((a, b) => (!a || b.date > a.date ? b : a), null);
      if (last) last.name = name;
      this.save.save();
    };

    this.pauseMenu = new PauseMenu(this.uiRoot);
    this.pauseMenu.onResume = () => this.togglePause();
    this.pauseMenu.onCalibrate = () => void this.calibrateGyro(true);
    this.pauseMenu.onQuit = () => {
      this.pauseMenu.show(false, false);
      this.toGarage();
    };

    this.calibrate = new CalibratePrompt(this.uiRoot);
    this.calibrate.onGyro = () => void this.calibrateGyro(false);
    this.calibrate.onButtons = () => {
      this.input.touchMode = 'buttons';
      this.calibrate.show(false);
      this.beginRun();
    };
    this.calibrate.onCancel = () => this.calibrate.show(false);

    this.pair = new PairModal(this.uiRoot, this.host);
    this.pair.onClose = () => this.garageUI.refresh();
  }

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (this.mode === 'run') {
        if (e.code === 'Escape' || e.code === 'KeyP') this.togglePause();
        if (this.wrecked.visible && (e.code === 'Enter' || e.code === 'KeyR')) this.beginRun();
        if (this.wrecked.visible && e.code === 'KeyG') this.toGarage();
      } else if (this.mode === 'garage' && e.code === 'Enter' && this.pair.el.classList.contains('hidden')) {
        audio.unlock();
        void this.requestRun();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.mode === 'run' && this.game.state === 'playing') this.togglePause();
    });
  }

  /** Dev helper: advance the simulation by n frames of dt seconds (used by automated playtests). */
  debugStep(n: number, dt = 1 / 60): void {
    for (let i = 0; i < n; i++) this.frame(dt);
  }

  /** Dev helper: inspect live run state. */
  debugState(): Record<string, unknown> {
    const p = this.game.player;
    return {
      mode: this.mode, state: this.game.state, time: this.game.director.time, heat: this.game.director.heat.level,
      hp: p.hp, speed: p.speed, vF: p.vF, dist: p.dist, lat: p.lat, y: p.pos.y, grounded: p.grounded,
      drift: { ...p.drift }, boost: { ...p.boost }, enemies: this.game.enemies.activeCount, chopper: this.game.enemies.chopper.active,
      target: this.game.combat.target?.kind ?? null, kills: this.game.combat.kills,
    };
  }

  private frame(dt: number): void {
    switch (this.mode) {
      case 'garage':
        this.garage.update(dt);
        this.garage.render();
        break;
      case 'run':
        this.game.update(dt);
        if (this.game.state === 'idle') this.game.render();
        break;
      case 'admin':
        this.admin?.update();
        this.admin?.render();
        break;
      default:
        break;
    }
  }

  private toGarage(): void {
    this.game.stop();
    this.wrecked.hide();
    this.pauseMenu.show(false, false);
    this.mode = 'garage';
    this.garage.active = true;
    this.admin?.show(false);
    this.garageUI.show(true);
  }

  private toAdmin(): void {
    if (!this.admin) {
      this.admin = new AdminPanel(this.engine, this.assets, this.uiRoot);
      this.admin.onExit = () => {
        if (this.admin?.dirty) {
          // Rebuild worlds so templates/pools pick up the newly tuned or swapped models.
          this.game.dispose();
          this.buildWorlds();
          this.admin.dirty = false;
        }
        this.toGarage();
      };
    }
    this.game.stop();
    this.garageUI.show(false);
    this.wrecked.hide();
    this.garage.active = false;
    this.mode = 'admin';
    this.admin.show(true);
  }

  /** Mobile direct play needs a tap to grant & calibrate the gyroscope first (iOS permission). */
  private async requestRun(): Promise<void> {
    audio.unlock();
    if (IS_TOUCH && !this.host.connected) {
      if (this.input.gyro.active && this.input.touchMode === 'gyro') {
        this.input.gyro.calibrate();
        this.beginRun();
        return;
      }
      this.calibrate.show(true);
      return;
    }
    this.beginRun();
  }

  private async calibrateGyro(fromPause: boolean): Promise<void> {
    audio.unlock();
    const ok = await this.input.gyro.enable();
    if (ok && (await this.input.gyro.waitForData(800))) {
      this.input.gyro.calibrate();
      this.input.touchMode = 'gyro';
      if (fromPause) {
        this.game.toast('GYRO CENTERED');
        return;
      }
      this.calibrate.show(false);
      this.beginRun();
      return;
    }
    if (fromPause) {
      this.game.toast('MOTION SENSORS UNAVAILABLE', 'danger');
      return;
    }
    this.input.touchMode = 'buttons';
    this.calibrate.show(true, 'Motion sensors unavailable or denied — using on-screen steering.');
    setTimeout(() => {
      this.calibrate.show(false);
      this.beginRun();
    }, 1400);
  }

  private beginRun(): void {
    audio.unlock();
    void enterLandscapeFullscreen();
    this.wrecked.hide();
    this.pauseMenu.show(false, false);
    this.garageUI.show(false);
    this.garage.active = false;
    this.mode = 'run';
    this.game.start(loadoutFromSave(this.save.data));
  }

  private togglePause(): void {
    if (this.mode !== 'run') return;
    if (this.game.state === 'playing') {
      this.game.pause();
      this.pauseMenu.show(true, IS_TOUCH && this.input.touchMode === 'gyro');
    } else if (this.game.state === 'paused') {
      this.pauseMenu.show(false, false);
      this.game.resume();
    }
  }

  private onWrecked(r: RunResult): void {
    const d = this.save.data;
    const newBest = r.time > d.bestTime;
    d.cash += r.total;
    d.bestTime = Math.max(d.bestTime, r.time);
    d.bestScore = Math.max(d.bestScore, r.score);
    d.totalRuns++;
    this.save.save();
    const entry: LeaderEntry = { name: d.playerName, time: r.time, score: r.score, date: Date.now() };
    this.wrecked.show(r, { newBest, upgradeDot: this.garageUI.hasAffordableUpgrade(), name: d.playerName, global: this.leaderboard.isGlobal });
    void this.leaderboard
      .submit(entry)
      .then(() => this.leaderboard.top(100))
      .then((list) => this.wrecked.setBoard(list, entry));
  }
}
