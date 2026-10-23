/*
 * Escape Car perf probe (dev only). On /?debug with the dev hook:
 *   await import('/tools/perf-probe.js'); __perfProbe({ heat: 3, frames: 900 })
 * Steps the game frame-by-frame (sim + render) with full HP and reports CPU frame-time
 * percentiles, draw calls, triangles, and JS heap growth (Chrome only).
 */
window.__perfProbe = function ({ heat = 3, frames = 900, warmup = 300 } = {}) {
  const app = window.__escape;
  const g = app.game;
  const p = g.player;
  const kd = (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
  const ku = (c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
  if (g.state !== 'playing') app.beginRun();
  g.director.skipTo(heat);
  kd('KeyJ');
  const r = app.engine.renderer;
  const drive = () => {
    const rel = Math.atan2(Math.sin(p.yaw - p.trackHeading), Math.cos(p.yaw - p.trackHeading));
    const cmd = (2.5 - p.lat) * 0.22 + rel * 2.6;
    if (cmd > 0.12) { kd('KeyD'); ku('KeyA'); } else if (cmd < -0.12) { kd('KeyA'); ku('KeyD'); } else { ku('KeyA'); ku('KeyD'); }
    p.hp = p.stats.maxHp;
  };
  for (let i = 0; i < warmup; i++) { drive(); app.debugStep(1); }
  const times = [];
  let calls = 0;
  let tris = 0;
  const heap0 = performance.memory ? performance.memory.usedJSHeapSize : 0;
  r.info.autoReset = false;
  for (let i = 0; i < frames; i++) {
    drive();
    r.info.reset();
    const t0 = performance.now();
    app.debugStep(1);
    times.push(performance.now() - t0);
    calls += r.info.render.calls;
    tris += r.info.render.triangles;
  }
  r.info.autoReset = true;
  ['KeyA', 'KeyD', 'KeyJ'].forEach(ku);
  const heap1 = performance.memory ? performance.memory.usedJSHeapSize : 0;
  times.sort((a, b) => a - b);
  const q = (f) => +times[Math.min(times.length - 1, Math.floor(times.length * f))].toFixed(2);
  return {
    heat, frames,
    avgMs: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2),
    p50: q(0.5), p95: q(0.95), p99: q(0.99), max: +times[times.length - 1].toFixed(2),
    drawCalls: Math.round(calls / frames), triangles: Math.round(tris / frames),
    heapGrowthMB: performance.memory ? +((heap1 - heap0) / 1048576).toFixed(1) : 'n/a',
  };
};
