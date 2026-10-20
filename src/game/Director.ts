import { HEAT_LEVELS, type EnemyKind, type HeatDef } from '../data/config';
import { rand } from '../core/math';
import type { GameCtx } from './types';

/** Heat 1–4 progression by survival time: caps chasers, unlocks enemy types, hazards and the chopper boss. */
export class Director {
  time = 0;
  heat: HeatDef = HEAT_LEVELS[0];
  maxHeat = 1;
  private spawnT = 2.5;
  private chopperT = 0;
  onHeatChange: ((h: HeatDef) => void) | null = null;

  reset(): void {
    this.time = 0;
    this.heat = HEAT_LEVELS[0];
    this.maxHeat = 1;
    this.spawnT = 2.5;
    this.chopperT = 3;
  }

  /** Debug helper (admin/dev): jump straight to a heat level. */
  skipTo(level: number): void {
    const h = HEAT_LEVELS[Math.max(0, Math.min(3, level - 1))];
    this.time = Math.max(this.time, h.start + 0.01);
  }

  update(dt: number, ctx: GameCtx): void {
    this.time += dt;
    let next = HEAT_LEVELS[0];
    for (const h of HEAT_LEVELS) if (this.time >= h.start) next = h;
    if (next !== this.heat) {
      this.heat = next;
      this.maxHeat = Math.max(this.maxHeat, next.level);
      this.onHeatChange?.(next);
    }
    if (ctx.player.dead) return;

    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = rand(1.2, 2.4) * (1.15 - this.heat.level * 0.1);
      const free = this.heat.maxEnemies - ctx.enemies.activeCount;
      if (free > 0) {
        const kinds = this.heat.kinds;
        let kind: EnemyKind = kinds[0];
        if (kinds.includes('enemy_sedan') && Math.random() < 0.4) kind = 'enemy_sedan';
        const lead = ctx.enemies.spawn(kind, ctx) ?? ctx.enemies.spawn(kind === 'enemy_bike' ? 'enemy_sedan' : 'enemy_bike', ctx);
        // Hitman bikes often roll in as a pack of 2-3, which reads as a real chase.
        if (lead && lead.kind === 'enemy_bike' && lead.dist < ctx.player.dist && free > 1 && Math.random() < 0.6) {
          const extra = Math.min(free - 1, Math.random() < 0.4 ? 2 : 1);
          for (let i = 0; i < extra; i++) ctx.enemies.spawn('enemy_bike', ctx, lead);
        }
      }
    }
    if (this.heat.chopper && !ctx.enemies.chopper.active) {
      this.chopperT -= dt;
      if (this.chopperT <= 0) {
        ctx.enemies.spawnChopper(ctx);
        this.chopperT = 25;
      }
    }
  }
}
