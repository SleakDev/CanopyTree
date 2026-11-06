/**
 * Deterministic pseudo-random utilities.
 * A string seed is hashed into a 32-bit state, which feeds mulberry32.
 */

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return h >>> 0;
}

export function mulberry32(state) {
  let a = state >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed) {
    this.seed = String(seed);
    this._next = mulberry32(hashString(this.seed));
  }

  /** 0..1 */
  float() {
    return this._next();
  }

  range(min, max) {
    return min + (max - min) * this._next();
  }

  /** Inclusive integer range. */
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  chance(probability = 0.5) {
    return this._next() < probability;
  }

  sign() {
    return this._next() < 0.5 ? -1 : 1;
  }

  pick(list) {
    return list[Math.floor(this._next() * list.length)];
  }

  gauss() {
    const u = Math.max(1e-9, this._next());
    const v = this._next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Independent stream: changing one system never reshuffles another. */
  fork(label) {
    return new Rng(`${this.seed}::${label}`);
  }
}

export const SEED_ADJECTIVES = [
  'amber', 'mossy', 'quiet', 'verdant', 'golden', 'willow', 'cedar', 'hazel',
  'fern', 'copper', 'silver', 'wandering', 'sunlit', 'shadow', 'wild', 'gentle',
  'ancient', 'spring', 'olive', 'misty', 'tender', 'lush', 'bright', 'earthy',
];

export const SEED_NOUNS = [
  'oak', 'cedar', 'grove', 'birch', 'canopy', 'meadow', 'willow', 'aspen',
  'elm', 'juniper', 'orchard', 'thicket', 'maple', 'fern', 'hollow', 'ridge',
  'garden', 'sapling', 'moss', 'spruce', 'harbor', 'hill', 'glade', 'brook',
];

export function randomSeed() {
  const adj = SEED_ADJECTIVES[Math.floor(Math.random() * SEED_ADJECTIVES.length)];
  const noun = SEED_NOUNS[Math.floor(Math.random() * SEED_NOUNS.length)];
  const number = Math.floor(Math.random() * 900) + 100;
  return `${adj}-${noun}-${number}`;
}

export function sanitizeSeed(value) {
  const cleaned = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return cleaned || randomSeed();
}
