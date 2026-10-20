import { formatCash, formatTime } from '../core/math';
import { IS_TOUCH } from '../core/Engine';

/** Heat stars as HTML: filled ★ plus dimmed ★ for the remaining levels (clearer than the ☆ glyph). */
export function stars(level: number, max = 4): string {
  return '<i class="star on">★</i>'.repeat(level) + '<i class="star off">★</i>'.repeat(Math.max(0, max - level));
}

/** In-run HUD: top bar (HP, cash, heat, timer, pause), boss bar, threat chevrons, banners & toasts. */
export class Hud {
  readonly el: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private hpText: HTMLDivElement;
  private cashEl: HTMLDivElement;
  private heatEl: HTMLDivElement;
  private timeEl: HTMLDivElement;
  private bossEl: HTMLDivElement;
  private bossFill: HTMLDivElement;
  private arrows: Record<'left' | 'right' | 'bottom', HTMLDivElement>;
  private banner: HTMLDivElement;
  private toasts: HTMLDivElement;
  private vignette: HTMLDivElement;
  private boostEl: HTMLDivElement;
  private linkEl: HTMLDivElement;
  private hint: HTMLDivElement;
  private gadgetEl: HTMLDivElement;
  private last = { hp: -1, cash: -1, heat: -1, time: -1, boss: -2, gadget: '' };
  private bannerTimer = 0;
  onPause: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud hidden';
    this.el.innerHTML = `
      <div class="hud-top">
        <div class="hud-hp"><div class="hud-hp-fill"></div><div class="hud-hp-text">100</div></div>
        <div class="hud-cash">$0</div>
        <div class="hud-spacer"></div>
        <div class="hud-heat"><span class="hud-heat-stars">★☆☆☆</span><span class="hud-heat-label">HEAT 1</span><span class="hud-time">00:00</span></div>
        <div class="hud-link hidden">📱 PAIRED</div>
        <button class="hud-pause" aria-label="Pause">❚❚</button>
      </div>
      <div class="hud-boss hidden"><div class="hud-boss-label">MAFIA CHOPPER</div><div class="hud-boss-bar"><div class="hud-boss-fill"></div></div></div>
      <div class="hud-banner"></div>
      <div class="hud-toasts"></div>
      <div class="hud-boost"></div>
      <div class="hud-gadget-kb"></div>
      <div class="hud-arrow left">❮❮</div>
      <div class="hud-arrow right">❯❯</div>
      <div class="hud-arrow bottom">︾</div>
      <div class="hud-vignette"></div>
      <div class="hud-hint">${IS_TOUCH ? 'TILT TO STEER · LEFT THUMB DRIFT · RIGHT THUMB FIRE / GADGET' : 'A/D STEER · SPACE HOP+DRIFT · J / CLICK FIRE · E GADGET · S REVERSE · ESC PAUSE'}</div>`;
    root.appendChild(this.el);
    const q = <T extends HTMLElement>(s: string): T => this.el.querySelector(s) as T;
    this.hpFill = q('.hud-hp-fill');
    this.hpText = q('.hud-hp-text');
    this.cashEl = q('.hud-cash');
    this.heatEl = q('.hud-heat');
    this.timeEl = q('.hud-time');
    this.bossEl = q('.hud-boss');
    this.bossFill = q('.hud-boss-fill');
    this.banner = q('.hud-banner');
    this.toasts = q('.hud-toasts');
    this.vignette = q('.hud-vignette');
    this.boostEl = q('.hud-boost');
    this.linkEl = q('.hud-link');
    this.hint = q('.hud-hint');
    this.gadgetEl = q('.hud-gadget-kb');
    this.arrows = { left: q('.hud-arrow.left'), right: q('.hud-arrow.right'), bottom: q('.hud-arrow.bottom') };
    q<HTMLButtonElement>('.hud-pause').addEventListener('click', () => this.onPause?.());
  }

  show(v: boolean): void {
    this.el.classList.toggle('hidden', !v);
    if (v) {
      this.last = { hp: -1, cash: -1, heat: -1, time: -1, boss: -2, gadget: '' };
      this.hint.classList.remove('fade');
      setTimeout(() => this.hint.classList.add('fade'), 7000);
      this.toasts.innerHTML = '';
      this.banner.className = 'hud-banner';
    }
  }

  setLinked(linked: boolean): void {
    this.linkEl.classList.toggle('hidden', !linked);
  }

  update(dt: number, s: { hp: number; maxHp: number; cash: number; heat: number; time: number; boss: number | null; boostTier: number; gadgetText: string }): void {
    const hpPct = Math.round((s.hp / s.maxHp) * 100);
    if (hpPct !== this.last.hp) {
      this.last.hp = hpPct;
      this.hpFill.style.width = `${hpPct}%`;
      const hue = Math.max(0, Math.min(120, hpPct * 1.2));
      this.hpFill.style.background = `linear-gradient(90deg, hsl(${hue},85%,42%), hsl(${hue},90%,55%))`;
      this.hpText.textContent = `${Math.ceil(s.hp)}`;
      this.el.classList.toggle('low-hp', hpPct < 30);
    }
    if (s.cash !== this.last.cash) {
      this.last.cash = s.cash;
      this.cashEl.textContent = formatCash(s.cash);
      this.cashEl.classList.remove('pulse');
      void this.cashEl.offsetWidth;
      this.cashEl.classList.add('pulse');
    }
    if (s.heat !== this.last.heat) {
      this.last.heat = s.heat;
      (this.heatEl.querySelector('.hud-heat-stars') as HTMLElement).innerHTML = stars(s.heat);
      (this.heatEl.querySelector('.hud-heat-label') as HTMLElement).textContent = `HEAT ${s.heat}`;
      this.heatEl.dataset.heat = String(s.heat);
    }
    const sec = Math.floor(s.time);
    if (sec !== this.last.time) {
      this.last.time = sec;
      this.timeEl.textContent = formatTime(s.time);
    }
    const boss = s.boss === null ? -1 : Math.round(s.boss * 100);
    if (boss !== this.last.boss) {
      this.last.boss = boss;
      this.bossEl.classList.toggle('hidden', boss < 0);
      if (boss >= 0) this.bossFill.style.width = `${boss}%`;
    }
    this.boostEl.className = `hud-boost tier${s.boostTier}`;
    if (s.gadgetText !== this.last.gadget) {
      this.last.gadget = s.gadgetText;
      this.gadgetEl.textContent = s.gadgetText;
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
  }

  setThreats(left: boolean, right: boolean, bottom: boolean): void {
    this.arrows.left.classList.toggle('on', left);
    this.arrows.right.classList.toggle('on', right);
    this.arrows.bottom.classList.toggle('on', bottom);
  }

  showBanner(html: string, cls = '', seconds = 2.2): void {
    this.banner.innerHTML = html;
    this.banner.className = `hud-banner show ${cls}`;
    this.bannerTimer = seconds;
  }

  toast(text: string, cls = ''): void {
    const t = document.createElement('div');
    t.className = `hud-toast ${cls}`;
    t.textContent = text;
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 4) this.toasts.firstChild?.remove();
    setTimeout(() => t.remove(), 1600);
  }

  damageFlash(strength: number): void {
    this.vignette.style.opacity = String(Math.min(0.85, 0.3 + strength));
    this.vignette.classList.remove('flash');
    void this.vignette.offsetWidth;
    this.vignette.classList.add('flash');
  }
}
