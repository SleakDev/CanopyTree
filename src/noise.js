import { Rng } from './rng.js';

/**
 * Small, dependency-free 3D value noise with fbm.
 * Deterministic for a given seed.
 */
export function createNoise(seed = 'noise') {
  const rng = new Rng(`${seed}:noise`);
  const perm = new Uint8Array(512);
  const values = new Float32Array(256);

  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i++) table[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = table[i];
    table[i] = table[j];
    table[j] = tmp;
  }
  for (let i = 0; i < 512; i++) perm[i] = table[i & 255];
  for (let i = 0; i < 256; i++) values[i] = rng.range(-1, 1);

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;

  function lattice(ix, iy, iz) {
    const a = perm[(ix & 255) + perm[(iy & 255) + perm[iz & 255]]];
    return values[a];
  }

  function noise3(x, y, z) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fy = y - iy;
    const fz = z - iz;
    const u = fade(fx);
    const v = fade(fy);
    const w = fade(fz);

    const c000 = lattice(ix, iy, iz);
    const c100 = lattice(ix + 1, iy, iz);
    const c010 = lattice(ix, iy + 1, iz);
    const c110 = lattice(ix + 1, iy + 1, iz);
    const c001 = lattice(ix, iy, iz + 1);
    const c101 = lattice(ix + 1, iy, iz + 1);
    const c011 = lattice(ix, iy + 1, iz + 1);
    const c111 = lattice(ix + 1, iy + 1, iz + 1);

    const x00 = lerp(c000, c100, u);
    const x10 = lerp(c010, c110, u);
    const x01 = lerp(c001, c101, u);
    const x11 = lerp(c011, c111, u);
    return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
  }

  function fbm(x, y, z, octaves = 3, lacunarity = 2.0, gain = 0.5) {
    let amplitude = 0.5;
    let frequency = 1.0;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noise3(x * frequency, y * frequency, z * frequency) * amplitude;
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / norm;
  }

  /** 0..1 convenience wrapper. */
  function n01(x, y, z) {
    return noise3(x, y, z) * 0.5 + 0.5;
  }

  return { noise3, fbm, n01 };
}
