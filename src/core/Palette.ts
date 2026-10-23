import * as THREE from 'three';

/** Shared palette — every procedural model pulls from these so the whole game reads as one art set. */
export const C = {
  asphalt: 0x3a3d45,
  asphaltDark: 0x2c2f36,
  laneWhite: 0xf1f1ea,
  laneYellow: 0xf2c94c,
  sidewalk: 0xb9b3aa,
  curb: 0xd8d2c8,
  brick1: 0xb2523a,
  brick2: 0x9a4632,
  brick3: 0xc4694b,
  brick4: 0x8c3f2f,
  tan: 0xcfa77c,
  stone: 0xd9c9ad,
  stoneDark: 0xa8977c,
  trim: 0xe6dccb,
  iron: 0x2b2d33,
  ironLight: 0x4a4d55,
  glassDay: 0x5f7590,
  awningTeal: 0x2f6f73,
  awningRed: 0x9b2c2c,
  wood: 0x8a5a33,
  woodDark: 0x5e3b22,
  crate: 0xa0703f,
  drumGreen: 0x3f5f3a,
  black: 0x17181c,
  tire: 0x1d1e22,
  whitewall: 0xf4f1e8,
  chrome: 0xd7dde3,
  chromeDark: 0x9aa3ad,
  skin: 0xe0ac85,
  suit: 0x1f2026,
  red: 0xc8402c,
  redDark: 0x9c2f21,
  orange: 0xf28c28,
  stripeWhite: 0xf5f3ee,
  hazardYellow: 0xf7c11e,
  sand: 0xe9d3a1,
  sandDark: 0xd6bb85,
  ocean: 0x1e88c8,
  oceanLight: 0x47b3e6,
  palmTrunk: 0x8b6a45,
  palmLeaf: 0x4f9a3a,
  palmLeafDark: 0x3c7d2c,
  grass: 0x6aa84f,
  concrete: 0xc9c6bf,
  signGreen: 0x2e7d4f,
  cash: 0x4caf50,
  cashDark: 0x2e7d32,
  band: 0xf1e3b5,
  neonCyan: 0x29e3ff,
  neonPink: 0xff3fb4,
  neonPurple: 0xb26bff,
  neonYellow: 0xffd23f,
  lampGlow: 0xfff2c4,
  headlight: 0xfff6d8,
  tailLight: 0xff2a2a,
  skyline: 0xb9b2a6,
  skylineDark: 0x8f8a80,
};

export type Layer = 'lit' | 'far' | 'glow' | 'window' | 'night' | 'water';

/** Shared clock for the animated ocean (advanced by the game loop). */
export const WATER_UNIFORMS = { uTime: { value: 0 } };

function makeWaterMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.18, metalness: 0.2 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = WATER_UNIFORMS.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 wpW = modelMatrix * vec4(transformed, 1.0);
        // Waves calm down toward the shoreline (local x = distance from road centre).
        float amp = clamp((position.x - 34.0) / 30.0, 0.12, 1.0);
        float wave = sin(wpW.x * 0.11 + uTime * 1.25) * 0.34
                   + sin(wpW.z * 0.17 - uTime * 1.65) * 0.24
                   + sin((wpW.x + wpW.z) * 0.06 + uTime * 0.7) * 0.45;
        transformed.y += wave * amp;`,
      );
  };
  m.customProgramCacheKey = () => 'escape-water-v1';
  return m;
}

/** Flat-shaded vertex-colored materials shared across all merged meshes (one draw call per layer per model). */
export const MATS = {
  lit: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0.04 }),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  window: new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x5b6f86 }),
  water: makeWaterMaterial(),
  /** Same look as `lit` but its meshes skip the shadow pass (backdrop buildings). */
  far: null as unknown as THREE.MeshStandardMaterial,
  night: new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  }),
};

MATS.far = MATS.lit;

const flatCache = new Map<string, THREE.MeshStandardMaterial>();
/** Cached standalone flat material for meshes that need their own material (e.g. hit-flash, glossy oil). */
export function flatMat(color: number, opts: { roughness?: number; metalness?: number; emissive?: number } = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${opts.roughness ?? 0.8}|${opts.metalness ?? 0.05}|${opts.emissive ?? 0}`;
  let m = flatCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
      roughness: opts.roughness ?? 0.8,
      metalness: opts.metalness ?? 0.05,
      emissive: opts.emissive ?? 0,
    });
    flatCache.set(key, m);
  }
  return m;
}

const glowCache = new Map<string, THREE.MeshBasicMaterial>();
export function glowMat(color: number, opts: { additive?: boolean; opacity?: number } = {}): THREE.MeshBasicMaterial {
  const key = `${color}|${opts.additive ? 1 : 0}|${opts.opacity ?? 1}`;
  let m = glowCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color,
      toneMapped: false,
      transparent: opts.additive || (opts.opacity ?? 1) < 1,
      opacity: opts.opacity ?? 1,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: !opts.additive,
      side: THREE.DoubleSide,
    });
    glowCache.set(key, m);
  }
  return m;
}
