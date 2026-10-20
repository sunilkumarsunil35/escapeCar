import type { LeaderEntry, SaveStore } from './Save';

/**
 * Global Top-100 board. When VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are configured it uses a
 * single Supabase table `leaderboard(name text, time_ms int, score int, created_at timestamptz)`;
 * otherwise it falls back to the browser-local board stored in the save file.
 */
export class Leaderboard {
  private url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '');
  private key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  constructor(private save: SaveStore) {}

  get isGlobal(): boolean {
    return Boolean(this.url && this.key);
  }

  private headers(): Record<string, string> {
    return { apikey: this.key ?? '', Authorization: `Bearer ${this.key ?? ''}`, 'Content-Type': 'application/json' };
  }

  async submit(entry: LeaderEntry): Promise<void> {
    this.save.addLocalScore(entry);
    if (!this.isGlobal) return;
    try {
      await fetch(`${this.url}/rest/v1/leaderboard`, {
        method: 'POST',
        headers: { ...this.headers(), Prefer: 'return=minimal' },
        body: JSON.stringify({ name: entry.name.slice(0, 16), time_ms: Math.round(entry.time * 1000), score: Math.round(entry.score) }),
      });
    } catch (err) {
      console.warn('[leaderboard] submit failed', err);
    }
  }

  async top(limit = 100): Promise<LeaderEntry[]> {
    if (this.isGlobal) {
      try {
        const res = await fetch(`${this.url}/rest/v1/leaderboard?select=name,time_ms,score,created_at&order=time_ms.desc&limit=${limit}`, {
          headers: this.headers(),
        });
        if (res.ok) {
          const rows = (await res.json()) as { name: string; time_ms: number; score: number; created_at: string }[];
          return rows.map((r) => ({ name: r.name, time: r.time_ms / 1000, score: r.score, date: Date.parse(r.created_at) }));
        }
      } catch (err) {
        console.warn('[leaderboard] fetch failed, using local board', err);
      }
    }
    return [...this.save.data.leaderboard].sort((a, b) => b.time - a.time).slice(0, limit);
  }
}
