import * as THREE from 'three';

const RING = 256;
const pool: THREE.Vector3[] = Array.from({ length: RING }, () => new THREE.Vector3());
let next = 0;

/**
 * Short-lived Vector3 from a fixed ring buffer — for throwaway arguments (particle velocities,
 * offsets) that the callee copies immediately. Avoids per-frame allocations and the GC hitches
 * they cause. Never store the returned vector; it is reused 256 calls later.
 */
export function sv(x = 0, y = 0, z = 0): THREE.Vector3 {
  const v = pool[next];
  next = (next + 1) % RING;
  return v.set(x, y, z);
}
