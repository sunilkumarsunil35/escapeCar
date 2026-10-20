# Escape Car — MVP

3D low-poly arcade mafia getaway. Three.js + Rapier3D + PeerJS + Vite/TypeScript. It boots with **zero assets**: if a model's `url` is `null` in `public/assets/manifest.json`, the game builds a procedural low-poly mesh with every named socket.

## Run

```bash
npm install
npm run dev          # http://localhost:5173 (also served on your LAN IP)
npm run dev:https    # HTTPS on the LAN, needed for iOS gyro + phone controller
npm run build        # typecheck + production build to dist/
```

## Controls

| | Keyboard / mouse | Phone (direct play) | Phone as QR controller |
|---|---|---|---|
| Steer | A / D, ← / → | Left joystick (floats where your thumb lands), or tilt ±30° (gyro) | Tilt |
| Hop + drift / brake | Space / Shift | DRIFT button (left half in gyro mode) | HOLD TO DRIFT |
| Fire roof weapon (360° auto-aim) | J / F / click (hold) | Hold FIRE button | HOLD TO SHOOT |
| Drop rear gadget | E / Q | GADGET button | GADGET |
| Nitro (banked charges, max 3) | W / ↑ / N | Push joystick up (NITRO button in gyro mode) | NITRO |
| Slow down / reverse | S / ↓ | Pull joystick down (reverses once stopped) | Both zones held |
| Pause | Esc / P | ❚❚ | — |

Drift for 1.5 s to charge **Blue Turbo**, or 3.0 s for **Orange Turbo** (rams bikes). Release the drift button to fire the turbo. Landing a ramp jump also gives an Orange Turbo.

## QR pairing

In the garage, click **PAIR PHONE (QR)** and scan the code. The phone opens `/?room=ABCD`, connects to the PC over WebRTC (PeerJS) and streams input at 60 FPS. The phone vibrates when the car takes damage. The phone must reach the dev server through your LAN IP, not `localhost`.

## Admin asset inspector

Open `http://localhost:5173/?admin=true`, then:

1. Pick an asset ID.
2. Drag and drop a `.glb` file.
3. Tune scale, rotation Y, the collider box and socket XYZ live.
4. Click **Save to Project**. The Vite middleware (`/api/save-asset`, dev only) writes the file to `public/assets/models/` and updates `manifest.json`.

Use **Revert to procedural** to set `url` back to `null`.

## Dev helpers

`?debug` lets you press keys 1–4 to jump straight to that Heat level.

## Optional global leaderboard

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to use a Supabase table: `leaderboard(name text, time_ms int, score int, created_at timestamptz default now())`. Without these, the game uses a local leaderboard stored in the browser.

## Layout

```
src/
  core/        engine loop + bloom, Rapier wrapper, palette, GeoBuilder (merged flat-shaded meshes), save, audio synth, leaderboard
  data/        all gameplay tuning (cars, weapons, gadgets, upgrades, enemies, heat levels, lighting presets)
  assets/      AssetRegistry (manifest + GLB loader + socket resolution) and procedural/ model builders
  input/       keyboard/touch/gyro merge, PeerJS host, phone controller app
  game/        Game loop, Track (endless chunk pool), PlayerCar, Enemies, Hazards, Combat, Director, Effects, Lighting, CameraRig
  garage/      3D turntable garage scene
  ui/          HUD, garage menu, wrecked/pause/calibrate/pair screens, styles
  admin/       ?admin=true inspector
vite.config.ts  local-asset-saver middleware
```
