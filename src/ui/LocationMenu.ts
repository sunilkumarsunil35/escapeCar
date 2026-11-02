import { MODES, MODE_ORDER, type ModeId } from '../data/config';
import { formatTime } from '../core/math';
import type { SaveStore } from '../core/Save';
import { audio } from '../core/Audio';

/** Shared perspective road used by every wallpaper (vanishing point at 160,92). */
const road = (asphalt: string, line: string, centre: string): string => `
  <polygon points="146,92 174,92 300,180 20,180" fill="${asphalt}"/>
  <polygon points="159,92 161,92 168,180 152,180" fill="${centre}" opacity="0.9"/>
  ${[0, 1, 2, 3].map((i) => {
    const y0 = 98 + i * 20, y1 = y0 + 10, k0 = (y0 - 92) / 88, k1 = (y1 - 92) / 88;
    return `<polygon points="${153 - 60 * k0},${y0} ${154 - 58 * k0},${y0} ${154 - 58 * k1},${y1} ${152 - 61 * k1},${y1}" fill="${line}"/>
            <polygon points="${167 + 58 * k0},${y0} ${168 + 60 * k0},${y0} ${169 + 61 * k1},${y1} ${167 + 58 * k1},${y1}" fill="${line}"/>`;
  }).join('')}`;

/** Mini wallpapers: each one shows the location's look and its signature traps. */
const ART: Record<ModeId, string> = {
  city: `
    <defs><linearGradient id="skC" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fb4e6"/><stop offset="1" stop-color="#f6c99a"/></linearGradient></defs>
    <rect width="320" height="180" fill="url(#skC)"/>
    ${[[0, 40, 46], [44, 28, 30], [76, 56, 34], [112, 36, 22], [190, 44, 26], [218, 60, 38], [258, 34, 30], [290, 50, 30]].map(([x, top, w]) =>
      `<rect x="${x}" y="${top}" width="${w}" height="${110 - top}" fill="#9c4a35"/>` +
      Array.from({ length: Math.floor((96 - top) / 12) }, (_, r) => `<rect x="${x + 5}" y="${top + 6 + r * 12}" width="${w - 10}" height="5" fill="#ffd27a" opacity="0.55"/>`).join('')).join('')}
    <rect y="104" width="320" height="76" fill="#6d6a66"/>
    ${road('#3d3f44', '#f2efe6', '#e8c53a')}
    <g transform="translate(70,128)"><rect width="56" height="12" fill="#f2efe6"/>${[0, 1, 2, 3].map((i) => `<rect x="${i * 14}" width="7" height="12" fill="#e2552c"/>`).join('')}<rect x="4" y="12" width="4" height="10" fill="#333"/><rect x="48" y="12" width="4" height="10" fill="#333"/></g>
    <g transform="translate(206,140)">${[0, 16, 32].map((x) => `<rect x="${x}" width="13" height="18" rx="2" fill="#c62828"/><rect x="${x}" y="5" width="13" height="3" fill="#ffb300"/>`).join('')}</g>
    <g transform="translate(150,104)"><rect width="22" height="11" rx="2" fill="#f2c230"/><rect x="4" y="-5" width="14" height="6" fill="#f2c230"/><rect x="6" y="-4" width="10" height="4" fill="#2b3440"/></g>`,
  desert: `
    <defs><linearGradient id="skD" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d8fd6"/><stop offset="1" stop-color="#f2d7a6"/></linearGradient></defs>
    <rect width="320" height="180" fill="url(#skD)"/>
    <circle cx="262" cy="30" r="16" fill="#fff4cf"/>
    <polygon points="0,96 14,58 70,54 84,96" fill="#b5603a"/><polygon points="14,58 70,54 66,64 18,66" fill="#8f4a30"/>
    <polygon points="200,96 214,66 266,62 286,96" fill="#c4714a"/><polygon points="236,96 250,40 300,38 320,96" fill="#a65434"/>
    <rect y="94" width="320" height="86" fill="#dcb57c"/>
    ${road('#5c5852', '#f2ecdc', '#e0b93a')}
    ${[[30, 120, 1.2], [282, 132, 1.4], [100, 100, 0.6]].map(([x, y, s]) => `<g transform="translate(${x},${y}) scale(${s})"><rect x="-4" y="-30" width="8" height="30" rx="4" fill="#4f7d3a"/><rect x="-14" y="-20" width="6" height="12" rx="3" fill="#4f7d3a"/><rect x="-14" y="-11" width="12" height="5" fill="#4f7d3a"/><rect x="8" y="-24" width="6" height="12" rx="3" fill="#4f7d3a"/><rect x="2" y="-15" width="12" height="5" fill="#4f7d3a"/></g>`).join('')}
    <g transform="translate(176,112)">
      <rect x="0" y="22" width="56" height="26" fill="#f2b51a"/><rect x="10" y="4" width="34" height="20" fill="#2b2d33"/><rect x="6" y="0" width="42" height="5" fill="#f2b51a"/>
      <circle cx="28" cy="52" r="16" fill="#8d9399" stroke="#5b6168" stroke-width="4"/>
      <rect x="-2" y="40" width="6" height="18" fill="#f2b51a"/><rect x="52" y="40" width="6" height="18" fill="#f2b51a"/>
      <circle cx="27" cy="-3" r="4" fill="#ff8a1a"/><circle cx="27" cy="-3" r="9" fill="#ff8a1a" opacity="0.3"/>
    </g>`,
  forest: `
    <defs><linearGradient id="skF" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#86a9b8"/><stop offset="1" stop-color="#c3d3c6"/></linearGradient></defs>
    <rect width="320" height="180" fill="url(#skF)"/>
    ${Array.from({ length: 16 }, (_, i) => { const x = i * 21 - 4, h = 34 + ((i * 37) % 22); return `<polygon points="${x},96 ${x + 11},${96 - h} ${x + 22},96" fill="#5f7f69" opacity="0.8"/>`; }).join('')}
    <rect y="94" width="320" height="86" fill="#3f6b33"/>
    ${[[8, 66], [40, 80], [262, 72], [292, 60]].map(([x, h]) => `<g><rect x="${x + 10}" y="${180 - 30}" width="5" height="30" fill="#5a3c26"/><polygon points="${x},${180 - 22} ${x + 12},${180 - 22 - h} ${x + 25},${180 - 22}" fill="#2f5d34"/><polygon points="${x + 3},${180 - 38} ${x + 12},${180 - 30 - h} ${x + 22},${180 - 38}" fill="#356b3a"/></g>`).join('')}
    ${road('#46484b', '#dfe3e0', '#e8c53a')}
    <ellipse cx="120" cy="160" rx="16" ry="5" fill="#1b1a1a" stroke="#5a5650" stroke-width="2"/>
    <ellipse cx="196" cy="126" rx="9" ry="3" fill="#1b1a1a" stroke="#5a5650" stroke-width="1.5"/>
    <g>
      <rect x="62" y="34" width="8" height="78" fill="#f2a81a"/><rect x="250" y="34" width="8" height="78" fill="#f2a81a"/>
      <rect x="56" y="28" width="208" height="9" fill="#f2a81a"/>
      ${Array.from({ length: 13 }, (_, i) => `<line x1="${62 + i * 15}" y1="28" x2="${70 + i * 15}" y2="37" stroke="#b97a0e" stroke-width="2"/>`).join('')}
      <circle cx="66" cy="24" r="4" fill="#ff8a1a"/><circle cx="254" cy="24" r="4" fill="#ff8a1a"/>
      <rect x="96" y="37" width="12" height="6" fill="#2b2d33"/><line x1="96" y1="43" x2="88" y2="84" stroke="#1d1e22"/><line x1="108" y1="43" x2="116" y2="84" stroke="#1d1e22"/>
      <rect x="74" y="84" width="58" height="9" rx="4" fill="#5a3c26"/><polygon points="122,80 146,88 122,96" fill="#2f5d34"/>
      <rect x="198" y="37" width="12" height="6" fill="#2b2d33"/><line x1="198" y1="43" x2="190" y2="84" stroke="#1d1e22"/><line x1="210" y1="43" x2="218" y2="84" stroke="#1d1e22"/>
      <rect x="176" y="84" width="58" height="9" rx="4" fill="#5a3c26"/><polygon points="176,80 152,88 176,96" fill="#356b3a"/>
      <path d="M160 150 L160 104" stroke="#7CFC8A" stroke-width="3" stroke-dasharray="5 4"/><polygon points="153,108 160,96 167,108" fill="#7CFC8A"/>
    </g>`,
};

/** Full-screen "choose location" picker with mini-wallpaper cards (opened from the garage). */
export class LocationMenu {
  readonly el: HTMLDivElement;
  onChange: (() => void) | null = null;

  constructor(root: HTMLElement, private save: SaveStore) {
    this.el = document.createElement('div');
    this.el.className = 'loc-menu hidden';
    this.el.innerHTML = `
      <div class="loc-panel">
        <div class="loc-head"><h2>CHOOSE LOCATION</h2><button class="loc-close" title="Close">✕</button></div>
        <div class="loc-cards"></div>
      </div>`;
    root.appendChild(this.el);
    this.el.querySelector('.loc-close')!.addEventListener('click', () => this.show(false));
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.show(false);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.visible) this.show(false);
    });
  }

  get visible(): boolean {
    return !this.el.classList.contains('hidden');
  }

  show(on: boolean): void {
    this.el.classList.toggle('hidden', !on);
    if (on) this.render();
  }

  private render(): void {
    const d = this.save.data;
    const cards = this.el.querySelector('.loc-cards') as HTMLElement;
    cards.innerHTML = MODE_ORDER.map((id) => {
      const m = MODES[id];
      const skulls = '💀'.repeat(m.difficulty) + '<i>' + '💀'.repeat(3 - m.difficulty) + '</i>';
      return `
        <button class="loc-card loc-${id}${d.mode === id ? ' sel' : ''}" data-id="${id}">
          <svg class="loc-art" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${ART[id]}</svg>
          ${d.mode === id ? '<span class="loc-ribbon">SELECTED</span>' : ''}
          <span class="loc-cash">${m.cashMult}x $</span>
          <div class="loc-body">
            <div class="loc-name">${m.name.toUpperCase()}</div>
            <div class="loc-diff">${skulls}<span>BEST ${formatTime(d.bestTimes[id] ?? 0)}</span></div>
            <ul class="loc-traps">${m.traps.map((t) => `<li>${t}</li>`).join('')}</ul>
          </div>
        </button>`;
    }).join('');
    cards.querySelectorAll<HTMLButtonElement>('.loc-card').forEach((b) =>
      b.addEventListener('click', () => {
        audio.unlock();
        audio.click();
        this.save.data.mode = b.dataset.id as ModeId;
        this.save.save();
        this.show(false);
        this.onChange?.();
      }),
    );
  }
}
