/*
 * Escape Car blast probe (dev only). On /?debug:
 *   await import('/tools/blast-probe.js'); __blastProbe()
 * Detonates a 4-barrel chain beside the car and records, frame by frame for 2 s:
 * CPU frame cost, hit-stop freezes (how much game time was lost), peak shake trauma and
 * how many separate freeze episodes happened — the things that read as "stutter".
 */
window.__blastProbe = function ({ barrels = 4, frames = 120 } = {}) {
  const app = window.__escape;
  const g = app.game;
  const p = g.player;
  if (g.state !== 'playing') app.beginRun();
  g.director.skipTo(2);
  for (let i = 0; i < 120; i++) { p.hp = p.stats.maxHp; app.debugStep(1); }
  const hz = g.hazards;
  const placed = [];
  for (let i = 0; i < barrels; i++) {
    const b = hz.placeHazard(hz.barrelList, p.dist + 10 + i * 2.5, p.lat + (i % 2 ? 2 : -2));
    if (b) placed.push(b);
  }
  app.debugStep(1);
  hz.igniteBarrel(placed[0], 0.01);
  const rows = [];
  let freezeEpisodes = 0;
  let wasFrozen = false;
  let peakTrauma = 0;
  let gameTimeLost = 0;
  for (let i = 0; i < frames; i++) {
    p.hp = p.stats.maxHp;
    const t0 = performance.now();
    const gt0 = g.director.time;
    app.debugStep(1, 1 / 60);
    const ms = performance.now() - t0;
    const frozen = g.hitStopT > 0;
    if (frozen && !wasFrozen) freezeEpisodes++;
    wasFrozen = frozen;
    gameTimeLost += 1 / 60 - (g.director.time - gt0);
    peakTrauma = Math.max(peakTrauma, g.rig.trauma);
    rows.push(ms);
  }
  rows.sort((a, b) => a - b);
  return {
    barrelsPlaced: placed.length,
    freezeEpisodes,
    gameTimeLostMs: Math.round(gameTimeLost * 1000),
    peakTrauma: +peakTrauma.toFixed(2),
    peakShakeIntensity: +(peakTrauma * peakTrauma * g.rig.shakeScale).toFixed(2),
    frameMsP50: +rows[Math.floor(rows.length * 0.5)].toFixed(2),
    frameMsMax: +rows[rows.length - 1].toFixed(2),
  };
};
