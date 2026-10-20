/*
 * Escape Car automated playtest bot (dev only).
 * Paste into the browser console on http://localhost:5173/?debug (or run via the dev hook) and call:
 *   await window.__runBot({ runs: 3, maxSeconds: 300 })
 * It drives with real damage, fires, drops gadgets, uses nitro, and returns telemetry:
 * spawns (ahead/behind, popped-in on screen), engagement, damage sources, deaths, kills, cash, stalls.
 */
(function () {
  const kd = (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
  const ku = (c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
  const ALL = ['KeyA', 'KeyD', 'KeyJ', 'KeyE', 'KeyW', 'Space'];

  window.__runBot = async function ({ runs = 3, maxSeconds = 300 } = {}) {
    const app = window.__escape;
    const results = [];
    for (let run = 0; run < runs; run++) {
      ALL.forEach(ku);
      app.wrecked?.hide?.();
      if (app.game.state !== 'idle') app.game.stop();
      document.querySelector('.g-play')?.click();
      if (app.game.state !== 'playing') app.beginRun();
      const g = app.game;
      const p = g.player;
      const T = {
        spawns: [], damage: {}, kills: {}, deathAt: null, heatAt: {}, stallSeconds: 0, cash: 0,
        engaged: [], lifetimes: [], chopperSeen: false, killsByHeat: {}, secondsNoEnemyNear: 0, secondsWithTarget: 0, samples: 0, minHp: 999,
      };
      // --- Instrument spawns ---
      const origSpawn = g.enemies.spawn.bind(g.enemies);
      g.enemies.spawn = (kind, ctx, packFollow = null) => {
        const ok = origSpawn(kind, ctx, packFollow);
        if (ok) {
          const e = ok;
          {
            const pos = e.worldPos.clone();
            g.track.sample(e.dist, e.lat, pos);
            pos.y = 1;
            const ndc = pos.clone().project(g.camera);
            const onScreen = ndc.z < 1 && Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1;
            const rel = e.dist - p.dist;
            e.__spawnT = g.director.time;
            e.__engaged = false;
            T.spawns.push({ t: +g.director.time.toFixed(1), kind, rel: Math.round(rel), lat: +e.lat.toFixed(1), onScreen, camDist: Math.round(pos.distanceTo(g.camera.position)) });
          }
        }
        return ok;
      };
      // --- Instrument damage sources ---
      const origDamage = g.damagePlayer.bind(g);
      g.damagePlayer = (amount, shake) => {
        const st = new Error().stack || '';
        const src = /updateFiring/.test(st) ? 'enemy_gunfire' : /Enemies\.ts.*\n?.*update/.test(st) && /Enemies/.test(st) ? 'enemy_ram'
          : /Hazards/.test(st) ? 'hazard' : /Ambient/.test(st) ? 'traffic' : /explode|Combat/.test(st) ? 'explosion' : 'other';
        const hpBefore = p.hp;
        origDamage(amount, shake);
        T.damage[src] = (T.damage[src] || 0) + (hpBefore - p.hp);
      };
      const origKilled = g.onEnemyKilled.bind(g);
      g.onEnemyKilled = (e) => {
        T.kills[e.kind] = (T.kills[e.kind] || 0) + 1;
        const hl = g.director.heat.level;
        T.killsByHeat[hl] = (T.killsByHeat[hl] || 0) + 1;
        if (e.__spawnT !== undefined) T.lifetimes.push(+(g.director.time - e.__spawnT).toFixed(1));
        origKilled(e);
      };

      // --- Drive ---
      const dt = 1 / 60;
      let slowFor = 0;
      kd('KeyJ');
      for (let f = 0; f < maxSeconds * 60 && g.state === 'playing'; f++) {
        // Lane choice: avoid hazards/traffic ahead, otherwise hold a lane near the middle.
        let target = p.lat;
        const avoid = g.hazards.avoidLat(p.dist, p.lat, 28);
        if (avoid !== null) target = avoid;
        else {
          let blocked = false;
          for (const c of g.ambient.solidBodies()) if (c.dist > p.dist && c.dist - p.dist < 25 && Math.abs(c.lat - p.lat) < 2.6) blocked = true;
          target = blocked ? (p.lat > 0 ? p.lat - 5 : p.lat + 5) : Math.max(-6, Math.min(6, Math.round((p.lat - 2.5) / 5) * 5 + 2.5));
        }
        const rel = Math.atan2(Math.sin(p.yaw - p.trackHeading), Math.cos(p.yaw - p.trackHeading));
        const cmd = (target - p.lat) * 0.22 + rel * 2.6;
        if (cmd > 0.12) { kd('KeyD'); ku('KeyA'); } else if (cmd < -0.12) { kd('KeyA'); ku('KeyD'); } else { ku('KeyA'); ku('KeyD'); }
        if (g.combat.gadgetReady && f % 30 === 0) { kd('KeyE'); } else if (f % 30 === 2) ku('KeyE');
        if (p.nitroCharges > 0 && p.nitro <= 0 && p.hp < p.stats.maxHp * 0.5 && f % 20 === 0) { kd('KeyW'); } else if (f % 20 === 2) ku('KeyW');
        app.debugStep(1, dt);
        if (f % 60 === 0) {
          T.samples++;
          let near = false;
          for (const e of g.enemies.targets()) {
            const d = Math.hypot(e.worldPos.x - p.renderPos.x, e.worldPos.z - p.renderPos.z);
            if (d < 30) near = true;
            if (d < 30 && !e.__engaged && e.__spawnT !== undefined) { e.__engaged = true; T.engaged.push(+(g.director.time - e.__spawnT).toFixed(1)); }
          }
          if (!near) T.secondsNoEnemyNear++;
          if (g.combat.target) T.secondsWithTarget++;
          if (g.enemies.chopper.active) T.chopperSeen = true;
          T.heatAt[g.director.heat.level] = T.heatAt[g.director.heat.level] ?? Math.round(g.director.time);
          T.minHp = Math.min(T.minHp, Math.round(p.hp));
          if (p.speed < 6) slowFor++; else slowFor = 0;
          if (slowFor >= 2) T.stallSeconds++;
        }
      }
      ALL.forEach(ku);
      T.deathAt = g.state === 'playing' ? null : +g.director.time.toFixed(1);
      T.survived = +g.director.time.toFixed(1);
      T.distance = Math.round(p.dist);
      T.cash = g.runCash + g.nearMissCash + g.objectives.objectiveCash + g.objectives.comboCash;
      T.objectives = g.objectives.completed;
      T.objectiveCash = g.objectives.objectiveCash;
      T.comboCash = g.objectives.comboCash;
      T.bestCombo = g.objectives.bestMult;
      g.enemies.spawn = origSpawn;
      g.damagePlayer = origDamage;
      g.onEnemyKilled = origKilled;
      if (g.state === 'playing') { g.objectives.finish(); g.stop(); }
      // let the wreck sequence finish if it started
      for (let i = 0; i < 200 && g.state === 'wrecking'; i++) app.debugStep(1, dt);
      results.push(T);
    }
    return results;
  };

  window.__summarize = function (results) {
    const avg = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null);
    return results.map((T) => {
      const ahead = T.spawns.filter((s) => s.rel > 0);
      const behind = T.spawns.filter((s) => s.rel <= 0);
      const dmgTotal = Object.values(T.damage).reduce((a, b) => a + b, 0);
      return {
        survived: T.survived, died: T.deathAt !== null, distance: T.distance, heatReachedAt: T.heatAt, minHp: T.minHp,
        spawns: T.spawns.length, ahead: ahead.length, behind: behind.length,
        poppedInOnScreen: T.spawns.filter((s) => s.onScreen).length,
        poppedInCloserThan100m: T.spawns.filter((s) => s.onScreen && s.camDist < 100).length,
        avgSecondsToEngage: avg(T.engaged), engagedCount: T.engaged.length,
        avgEnemyLifetime: avg(T.lifetimes), kills: T.kills,
        pctSecondsNoEnemyWithin30m: Math.round((T.secondsNoEnemyNear / Math.max(1, T.samples)) * 100),
        pctSecondsWithTarget: Math.round((T.secondsWithTarget / Math.max(1, T.samples)) * 100),
        damageTaken: Object.fromEntries(Object.entries(T.damage).map(([k, v]) => [k, Math.round(v)])), damageTotal: Math.round(dmgTotal),
        stallSeconds: T.stallSeconds, cash: T.cash, chopperSeen: T.chopperSeen, killsByHeat: T.killsByHeat,
        objectivesDone: T.objectives, objectiveCash: T.objectiveCash, comboCash: T.comboCash, bestCombo: T.bestCombo,
      };
    });
  };
})();
