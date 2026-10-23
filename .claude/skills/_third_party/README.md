# Third-party agent skills

The skill folders next to this one (except `_third_party/`) are copied from
**awesome-gamedev-agent-skills** — https://github.com/gamedev-skills/awesome-gamedev-agent-skills
at commit `7eb1b53` (2026-10-23).

- Copyright 2026 Abhishek Barali and the awesome-gamedev-agent-skills contributors.
- Licensed under the Apache License, Version 2.0 — see `LICENSE-awesome-gamedev-agent-skills.txt`
  and the original `NOTICE-awesome-gamedev-agent-skills.txt` in this folder.

## Skills included

game-feel, camera-systems, audio-design, input-systems, game-ui-ux, performance-optimization,
physics-tuning, game-ai, level-design, procedural-gen, create-game-assets, threejs-scene-setup,
threejs-materials-lighting, threejs-gltf-loading, prototype-fast.

## Changes from the original (Apache-2.0 §4b)

- Only the 15 skills above were copied; the rest of the collection (Godot, Unity, Unreal, other
  engines, genres, router, tests) was not.
- `create-game-assets`: the `scripts/` folder (Python helpers) and `agents/openai.yaml` were
  **omitted** so no third-party executable code lives in this repository. Its `SKILL.md` may still
  mention those scripts; they are not available here.
- No skill text was modified.

## How Escape Car uses them

These are guidance documents for AI coding agents (Claude Code loads `.claude/skills/*/SKILL.md`
automatically for this project). Game code in `src/` is original TypeScript written for Escape Car;
it applies techniques described in these skills (e.g. trauma-based screen shake and hit-stop from
`game-feel`, SFX variation and volume buses from `audio-design`, radial stick deadzones from
`input-systems`, measure-first profiling from `performance-optimization`) but does not copy their
GDScript/C# snippets.
