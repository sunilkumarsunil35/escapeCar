import {
  CARS, CAR_ORDER, GADGETS, GADGET_ORDER, UPGRADES, WEAPONS, WEAPON_ORDER, type CarId, type GadgetId, type UpgradeCategory, type WeaponId,
} from '../data/config';
import { formatCash, formatTime } from '../core/math';
import type { SaveStore } from '../core/Save';
import { computeStats, loadoutFromSave, type Loadout } from '../game/Loadout';
import type { PreviewKind } from '../garage/GarageScene';
import { audio } from '../core/Audio';

type Tab = 'car' | UpgradeCategory | 'weapon' | 'gadget';
const TABS: { id: Tab; label: string }[] = [
  { id: 'car', label: 'CAR' },
  { id: 'engine', label: 'ENGINE' },
  { id: 'tires', label: 'TIRES' },
  { id: 'armor', label: 'ARMOR' },
  { id: 'weapon', label: 'ROOF GUN' },
  { id: 'gadget', label: 'GADGET' },
];

interface Item {
  key: string;
  name: string;
  desc: string;
  cost: number;
  owned: boolean;
  equipped: boolean;
  locked: boolean;
}

/** Garage & main menu overlay (doc §6.3): cash, best time, car selector + stats, upgrade tabs, PLAY. */
export class GarageUI {
  readonly el: HTMLDivElement;
  private tab: Tab = 'car';
  private sel: Record<Tab, number> = { car: 0, engine: 0, tires: 0, armor: 0, weapon: 0, gadget: 0 };
  onPlay: (() => void) | null = null;
  onPair: (() => void) | null = null;
  onLoadout: ((l: Loadout) => void) | null = null;
  onPreview: ((kind: PreviewKind, id: string | null, tier: number) => void) | null = null;
  onAdmin: (() => void) | null = null;
  onSettings: (() => void) | null = null;

  constructor(root: HTMLElement, private save: SaveStore, private pairedLabel: () => string, showAdmin: boolean) {
    this.el = document.createElement('div');
    this.el.className = 'garage hidden';
    this.el.innerHTML = `
      <div class="g-top">
        <div class="g-logo">ESCAPE<span>CAR</span></div>
        <div class="g-stat"><label>CASH</label><b class="g-cash">$0</b></div>
        <div class="g-stat"><label>BEST TIME</label><b class="g-best">00:00</b></div>
        <div class="g-top-spacer"></div>
        ${showAdmin ? '<button class="g-btn g-admin">⚙ ADMIN</button>' : ''}
        <button class="g-btn g-settings" title="Settings">⚙</button>
        <button class="g-btn g-mute" title="Sound">🔊</button>
        <button class="g-btn g-pair">PAIR PHONE (QR)</button>
      </div>
      <div class="g-left">
        <div class="g-carsel"><button class="g-arrow g-prev">‹</button><div class="g-carname"></div><button class="g-arrow g-next">›</button></div>
        <div class="g-bars">
          <div class="g-bar"><label>SPEED</label><div><i class="b-speed"></i></div></div>
          <div class="g-bar"><label>ARMOR</label><div><i class="b-armor"></i></div></div>
          <div class="g-bar"><label>BOOST</label><div><i class="b-boost"></i></div></div>
        </div>
        <div class="g-trait"></div>
        <div class="g-loadout"></div>
      </div>
      <div class="g-bottom">
        <div class="g-tabs">${TABS.map((t) => `<button class="g-tab" data-tab="${t.id}">${t.label}</button>`).join('')}</div>
        <div class="g-items"></div>
        <div class="g-actions">
          <div class="g-detail"></div>
          <button class="g-buy"></button>
          <button class="g-play">ESCAPE <span>›››</span></button>
        </div>
      </div>`;
    root.appendChild(this.el);
    const q = <T extends HTMLElement>(s: string): T => this.el.querySelector(s) as T;
    q('.g-prev').addEventListener('click', () => this.cycleCar(-1));
    q('.g-next').addEventListener('click', () => this.cycleCar(1));
    q('.g-play').addEventListener('click', () => {
      audio.unlock();
      audio.click();
      this.onPlay?.();
    });
    q('.g-pair').addEventListener('click', () => {
      audio.unlock();
      this.onPair?.();
    });
    q('.g-buy').addEventListener('click', () => this.buyOrEquip());
    q('.g-settings').addEventListener('click', () => {
      audio.unlock();
      this.onSettings?.();
    });
    q('.g-mute').addEventListener('click', () => {
      audio.unlock();
      this.save.data.muted = !this.save.data.muted;
      this.save.save();
      audio.setMuted(this.save.data.muted);
      this.refresh();
    });
    this.el.querySelector('.g-admin')?.addEventListener('click', () => this.onAdmin?.());
    this.el.querySelectorAll<HTMLButtonElement>('.g-tab').forEach((b) =>
      b.addEventListener('click', () => {
        audio.unlock();
        audio.click();
        this.tab = b.dataset.tab as Tab;
        this.syncSelection();
        this.refresh();
      }),
    );
    this.syncSelection();
  }

  show(v: boolean): void {
    this.el.classList.toggle('hidden', !v);
    if (v) {
      this.syncSelection();
      this.refresh();
    }
  }

  /** Point each tab's selection at the currently equipped item. */
  private syncSelection(): void {
    const d = this.save.data;
    this.sel.car = CAR_ORDER.indexOf(d.car);
    this.sel.engine = Math.min(2, d.upgrades.engine + 1);
    this.sel.tires = Math.min(2, d.upgrades.tires + 1);
    this.sel.armor = Math.min(2, d.upgrades.armor + 1);
    this.sel.weapon = WEAPON_ORDER.indexOf(d.weapon);
    this.sel.gadget = GADGET_ORDER.indexOf(d.gadget);
  }

  private cycleCar(dir: number): void {
    audio.unlock();
    audio.click();
    this.tab = 'car';
    this.sel.car = (this.sel.car + dir + CAR_ORDER.length) % CAR_ORDER.length;
    const id = CAR_ORDER[this.sel.car];
    if (this.save.data.ownedCars.includes(id)) {
      this.save.data.car = id;
      this.save.save();
    }
    this.refresh();
  }

  private items(tab: Tab): Item[] {
    const d = this.save.data;
    switch (tab) {
      case 'car':
        return CAR_ORDER.map((id) => ({
          key: id, name: CARS[id].name, desc: CARS[id].trait, cost: CARS[id].cost,
          owned: d.ownedCars.includes(id), equipped: d.car === id, locked: false,
        }));
      case 'engine':
      case 'tires':
      case 'armor':
        return UPGRADES[tab].map((t, i) => ({
          key: String(i), name: t.name, desc: t.desc, cost: t.cost,
          owned: d.upgrades[tab] >= i, equipped: d.upgrades[tab] === i, locked: i > d.upgrades[tab] + 1,
        }));
      case 'weapon':
        return WEAPON_ORDER.map((id) => ({
          key: id, name: WEAPONS[id].name, desc: WEAPONS[id].desc, cost: WEAPONS[id].cost,
          owned: d.ownedWeapons.includes(id), equipped: d.weapon === id, locked: false,
        }));
      case 'gadget':
        return GADGET_ORDER.map((id) => ({
          key: id, name: GADGETS[id].name, desc: GADGETS[id].desc, cost: GADGETS[id].cost,
          owned: d.ownedGadgets.includes(id), equipped: d.gadget === id, locked: false,
        }));
    }
  }

  private buyOrEquip(): void {
    audio.unlock();
    const d = this.save.data;
    const list = this.items(this.tab);
    const it = list[this.sel[this.tab]];
    if (!it || it.equipped || it.locked) return;
    if (!it.owned) {
      if (!this.save.spend(it.cost)) {
        this.flash('NOT ENOUGH CASH');
        return;
      }
      audio.buy();
    } else audio.click();
    switch (this.tab) {
      case 'car':
        if (!d.ownedCars.includes(it.key as CarId)) d.ownedCars.push(it.key as CarId);
        d.car = it.key as CarId;
        break;
      case 'engine':
      case 'tires':
      case 'armor':
        d.upgrades[this.tab] = Math.max(d.upgrades[this.tab], Number(it.key));
        this.sel[this.tab] = Math.min(2, d.upgrades[this.tab] + 1);
        break;
      case 'weapon':
        if (!d.ownedWeapons.includes(it.key as WeaponId)) d.ownedWeapons.push(it.key as WeaponId);
        d.weapon = it.key as WeaponId;
        break;
      case 'gadget':
        if (!d.ownedGadgets.includes(it.key as GadgetId)) d.ownedGadgets.push(it.key as GadgetId);
        d.gadget = it.key as GadgetId;
        break;
    }
    this.save.save();
    this.refresh();
  }

  private flash(msg: string): void {
    const det = this.el.querySelector('.g-detail') as HTMLElement;
    det.innerHTML = `<b class="warn">${msg}</b>`;
    det.classList.remove('shake');
    void det.offsetWidth;
    det.classList.add('shake');
    setTimeout(() => this.refresh(), 1200);
  }

  /** True if any not-yet-owned item is affordable (drives the "• New Upgrade" dot). */
  hasAffordableUpgrade(): boolean {
    const cash = this.save.data.cash;
    return TABS.some((t) => this.items(t.id).some((i) => !i.owned && !i.locked && i.cost <= cash));
  }

  refresh(): void {
    const d = this.save.data;
    (this.el.querySelector('.g-cash') as HTMLElement).textContent = formatCash(d.cash);
    (this.el.querySelector('.g-best') as HTMLElement).textContent = formatTime(d.bestTime);
    (this.el.querySelector('.g-pair') as HTMLElement).textContent = this.pairedLabel();
    (this.el.querySelector('.g-mute') as HTMLElement).textContent = d.muted ? '🔇' : '🔊';
    this.el.querySelectorAll<HTMLButtonElement>('.g-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === this.tab));

    // Car panel shows the browsed car's stats with current upgrades
    const carId = CAR_ORDER[this.sel.car];
    const car = CARS[carId];
    const l: Loadout = { ...loadoutFromSave(d), car: carId };
    const st = computeStats(l);
    (this.el.querySelector('.g-carname') as HTMLElement).innerHTML = `${car.name.toUpperCase()}${d.ownedCars.includes(carId) ? '' : `<small>${formatCash(car.cost)}</small>`}`;
    (this.el.querySelector('.b-speed') as HTMLElement).style.width = `${Math.min(100, (st.maxSpeed / 44) * 100)}%`;
    (this.el.querySelector('.b-armor') as HTMLElement).style.width = `${Math.min(100, (st.maxHp / 200) * 100)}%`;
    (this.el.querySelector('.b-boost') as HTMLElement).style.width = `${Math.min(100, ((st.burstMult * st.chargeMult) / 2.6) * 100)}%`;
    (this.el.querySelector('.g-trait') as HTMLElement).textContent = car.trait;
    (this.el.querySelector('.g-loadout') as HTMLElement).innerHTML =
      `<span>${WEAPONS[d.weapon].name}</span><span>${GADGETS[d.gadget].name}</span><span>${UPGRADES.engine[d.upgrades.engine].name}</span><span>${UPGRADES.tires[d.upgrades.tires].name}</span><span>${UPGRADES.armor[d.upgrades.armor].name}</span>`;

    const list = this.items(this.tab);
    const itemsEl = this.el.querySelector('.g-items') as HTMLElement;
    itemsEl.innerHTML = list
      .map((it, i) => {
        const state = it.equipped ? 'EQUIPPED' : it.owned ? 'OWNED' : it.locked ? 'LOCKED' : it.cost === 0 ? 'FREE' : formatCash(it.cost);
        const cls = ['g-item', i === this.sel[this.tab] ? 'sel' : '', it.equipped ? 'eq' : '', it.locked ? 'locked' : '', !it.owned && it.cost > d.cash ? 'pricey' : ''].join(' ');
        const tier = this.tab === 'engine' || this.tab === 'tires' || this.tab === 'armor' ? `<em>TIER ${i + 1}</em>` : '';
        return `<button class="${cls}" data-i="${i}">${tier}<b>${it.name}</b><span>${state}</span></button>`;
      })
      .join('');
    itemsEl.querySelectorAll<HTMLButtonElement>('.g-item').forEach((b) =>
      b.addEventListener('click', () => {
        audio.unlock();
        audio.click();
        this.sel[this.tab] = Number(b.dataset.i);
        if (this.tab === 'car') {
          const id = CAR_ORDER[this.sel.car];
          if (d.ownedCars.includes(id)) {
            d.car = id;
            this.save.save();
          }
        }
        this.refresh();
      }),
    );
    const it = list[this.sel[this.tab]];
    const buy = this.el.querySelector('.g-buy') as HTMLButtonElement;
    const det = this.el.querySelector('.g-detail') as HTMLElement;
    if (it) {
      det.innerHTML = `<b>→ ${it.name}:</b> ${it.desc}`;
      buy.disabled = it.equipped || it.locked || (!it.owned && it.cost > d.cash);
      buy.textContent = it.equipped ? 'EQUIPPED' : it.locked ? 'BUY PREVIOUS TIER' : it.owned ? 'EQUIP' : `BUY / EQUIP: ${formatCash(it.cost)}`;
      buy.classList.toggle('can', !buy.disabled);
    }

    // 3D: show browsed car (or equipped), and a floating preview of the browsed item
    const shown: Loadout = { ...loadoutFromSave(d), car: this.tab === 'car' ? carId : d.car };
    this.onLoadout?.(shown);
    const idx = this.sel[this.tab];
    switch (this.tab) {
      case 'weapon':
        this.onPreview?.('weapon', WEAPON_ORDER[idx], 0);
        break;
      case 'gadget':
        this.onPreview?.('gadget', GADGET_ORDER[idx], 0);
        break;
      case 'armor':
        this.onPreview?.(idx === 2 ? 'armor' : null, idx === 2 ? 'upgrade_dozer' : null, idx);
        break;
      case 'tires':
        this.onPreview?.('tires', 'tires', idx);
        break;
      case 'engine':
        this.onPreview?.('engine', 'engine', idx);
        break;
      default:
        this.onPreview?.(null, null, 0);
    }
  }
}
