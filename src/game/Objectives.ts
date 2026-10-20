import { rand, pick } from '../core/math';
import { audio } from '../core/Audio';

/** Things the player does that feed objectives and the combo meter. */
export type GameEvent =
  | 'kill_bike'
  | 'kill_sedan'
  | 'kill_chopper'
  | 'near_miss'
  | 'turbo_blue'
  | 'turbo_orange'
  | 'ramp_jump'
  | 'barrel'
  | 'cash';

interface ObjectiveDef {
  id: string;
  label: (n: number) => string;
  event: GameEvent | GameEvent[] | 'clean' | 'combo';
  target: (heat: number) => number;
  reward: (heat: number) => number;
  minHeat: number;
}

const OBJECTIVES: ObjectiveDef[] = [
  { id: 'bikes', label: (n) => `DESTROY ${n} HITMAN BIKES`, event: 'kill_bike', target: (h) => 4 + h, reward: (h) => 150 + h * 50, minHeat: 1 },
  { id: 'sedans', label: (n) => `DESTROY ${n} TOMMY SEDANS`, event: 'kill_sedan', target: (h) => 1 + h, reward: (h) => 200 + h * 60, minHeat: 2 },
  { id: 'nearmiss', label: (n) => `${n} NEAR-MISSES`, event: 'near_miss', target: (h) => 2 + h, reward: (h) => 150 + h * 40, minHeat: 1 },
  { id: 'orange', label: (n) => `FIRE ${n} ORANGE TURBO${n > 1 ? 'S' : ''}`, event: 'turbo_orange', target: (h) => (h >= 3 ? 2 : 1), reward: (h) => 180 + h * 40, minHeat: 1 },
  { id: 'turbos', label: (n) => `FIRE ${n} DRIFT TURBOS`, event: ['turbo_blue', 'turbo_orange'], target: (h) => 2 + Math.floor(h / 2), reward: (h) => 140 + h * 40, minHeat: 1 },
  { id: 'jumps', label: (n) => `${n} RAMP JUMP${n > 1 ? 'S' : ''}`, event: 'ramp_jump', target: (h) => (h >= 3 ? 3 : 2), reward: (h) => 160 + h * 40, minHeat: 1 },
  { id: 'barrels', label: (n) => `BLOW UP ${n} BARRELS`, event: 'barrel', target: (h) => 2 + h, reward: (h) => 160 + h * 40, minHeat: 2 },
  { id: 'cash', label: (n) => `GRAB $${n} CASH`, event: 'cash', target: (h) => 150 + h * 100, reward: (h) => 120 + h * 40, minHeat: 1 },
  { id: 'clean', label: (n) => `NO DAMAGE FOR ${n}s`, event: 'clean', target: (h) => 12 + h * 3, reward: (h) => 200 + h * 50, minHeat: 1 },
  { id: 'combo', label: (n) => `REACH A x${(1 + n * 0.5).toFixed(1)} COMBO`, event: 'combo', target: (h) => Math.min(3, 1 + Math.floor(h / 2)), reward: (h) => 220 + h * 60, minHeat: 1 },
  { id: 'chopper', label: () => 'SHOOT DOWN THE CHOPPER', event: 'kill_chopper', target: () => 1, reward: () => 800, minHeat: 4 },
];

/** Combo points per event (paid out × multiplier when the chain ends). */
const COMBO_VALUE: Record<GameEvent, number> = {
  kill_bike: 2, kill_sedan: 5, kill_chopper: 30, near_miss: 4, turbo_blue: 3, turbo_orange: 7, ramp_jump: 6, barrel: 3, cash: 0,
};

const COMBO_WINDOW = 3.5;
/** Events needed per +0.5 multiplier step. */
const COMBO_STEP = 5;
const OBJECTIVE_TIME = 55;
const MAX_MULT = 3;

export interface ObjectiveView {
  label: string;
  progress: number;
  target: number;
  timeLeft: number;
  reward: number;
}

export interface ComboView {
  count: number;
  mult: number;
  bank: number;
  timeFrac: number;
}

/**
 * Short-term goals for a run: one timed mini-objective at a time plus a combo chain — kills,
 * near-misses, turbos, jumps and barrel blasts within 4.5 s of each other build a multiplier
 * (up to x4) that pays out when the chain ends. A big hit breaks the chain and halves the payout.
 */
export class Objectives {
  // Combo
  comboCount = 0;
  comboBank = 0;
  comboTimer = 0;
  bestMult = 1;
  comboCash = 0;
  // Objectives
  current: { def: ObjectiveDef; target: number; progress: number; time: number; reward: number } | null = null;
  private nextIn = 3;
  private lastIds: string[] = [];
  completed = 0;
  objectiveCash = 0;
  private cleanTime = 0;
  onPayout: ((cash: number, label: string, cls: string) => void) | null = null;
  onBanner: ((html: string, cls: string) => void) | null = null;

  reset(): void {
    this.comboCount = 0;
    this.comboBank = 0;
    this.comboTimer = 0;
    this.bestMult = 1;
    this.comboCash = 0;
    this.current = null;
    this.nextIn = 3;
    this.lastIds = [];
    this.completed = 0;
    this.objectiveCash = 0;
    this.cleanTime = 0;
  }

  get multiplier(): number {
    return Math.min(MAX_MULT, 1 + Math.floor(this.comboCount / COMBO_STEP) * 0.5);
  }

  event(type: GameEvent, amount = 1): void {
    if (COMBO_VALUE[type] > 0) {
      this.comboCount++;
      this.comboBank += COMBO_VALUE[type];
      this.comboTimer = COMBO_WINDOW;
      this.bestMult = Math.max(this.bestMult, this.multiplier);
    }
    const o = this.current;
    if (!o) return;
    const ev = o.def.event;
    const matches = Array.isArray(ev) ? ev.includes(type) : ev === type;
    if (matches) this.advance(type === 'cash' ? amount : 1);
  }

  /** Big hits break the combo chain (half payout) and reset the "no damage" objective. */
  damage(amount: number): void {
    this.cleanTime = 0;
    if (this.current?.def.event === 'clean') this.current.progress = 0;
    if (amount >= 8 && this.comboCount >= 2) this.endCombo(true);
  }

  private advance(n: number): void {
    const o = this.current;
    if (!o) return;
    o.progress = Math.min(o.target, o.progress + n);
    if (o.progress >= o.target) {
      this.completed++;
      this.objectiveCash += o.reward;
      this.onPayout?.(o.reward, `OBJECTIVE COMPLETE +$${o.reward}`, 'gold');
      this.onBanner?.('OBJECTIVE <span>COMPLETE!</span>', 'gold');
      audio.buy();
      this.current = null;
      this.nextIn = 4;
    }
  }

  private endCombo(broken: boolean): void {
    if (this.comboCount >= 2 && this.comboBank > 0) {
      const pay = Math.round(this.comboBank * this.multiplier * (broken ? 0.5 : 1));
      this.comboCash += pay;
      this.onPayout?.(pay, broken ? `COMBO BROKEN · +$${pay}` : `COMBO x${this.multiplier.toFixed(1)} · +$${pay}`, broken ? 'danger' : 'gold');
    }
    this.comboCount = 0;
    this.comboBank = 0;
    this.comboTimer = 0;
  }

  private newObjective(heat: number): void {
    const pool = OBJECTIVES.filter((d) => d.minHeat <= heat && !this.lastIds.includes(d.id));
    const def = heat >= 4 && !this.lastIds.includes('chopper') && Math.random() < 0.5 ? OBJECTIVES.find((d) => d.id === 'chopper') ?? pick(pool) : pick(pool);
    const target = def.target(heat);
    this.current = { def, target, progress: 0, time: def.id === 'chopper' ? 90 : OBJECTIVE_TIME, reward: Math.round(def.reward(heat) / 10) * 10 };
    this.lastIds = [def.id, ...this.lastIds].slice(0, 3);
    this.cleanTime = 0;
    this.onBanner?.(`NEW OBJECTIVE<br/><span>${def.label(target)}</span>`, 'objective');
  }

  update(dt: number, heat: number): void {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.endCombo(false);
    }
    if (!this.current) {
      this.nextIn -= dt;
      if (this.nextIn <= 0) this.newObjective(heat);
      return;
    }
    const o = this.current;
    o.time -= dt;
    if (o.def.event === 'clean') {
      this.cleanTime += dt;
      o.progress = Math.min(o.target, Math.floor(this.cleanTime));
      if (o.progress >= o.target) this.advance(0);
    } else if (o.def.event === 'combo') {
      const reached = Math.round((this.multiplier - 1) / 0.5);
      if (reached > o.progress) this.advance(reached - o.progress);
    }
    if (this.current && this.current.time <= 0) {
      this.onBanner?.('OBJECTIVE <span>FAILED</span>', 'danger');
      this.current = null;
      this.nextIn = rand(3, 5);
    }
  }

  objectiveView(): ObjectiveView | null {
    const o = this.current;
    if (!o) return null;
    return { label: o.def.label(o.target), progress: o.progress, target: o.target, timeLeft: Math.max(0, o.time), reward: o.reward };
  }

  comboView(): ComboView {
    return { count: this.comboCount, mult: this.multiplier, bank: this.comboBank, timeFrac: this.comboTimer / COMBO_WINDOW };
  }

  /** Called when the run ends so an unfinished chain still pays. */
  finish(): void {
    this.endCombo(false);
  }
}
