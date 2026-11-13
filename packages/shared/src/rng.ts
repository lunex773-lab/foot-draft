/**
 * Deterministic pseudo random number generator.
 *
 * Used by the player generator, draft pool generation, CPU decisions and the
 * match simulation. Given the same seed, the sequence is identical on every
 * platform (Workers / browser / Node), which makes matches reproducible
 * (spec 6-4).
 *
 * NOTE: This is NOT a cryptographic RNG. Gacha draws (Phase 4) must use
 * crypto.getRandomValues on the server.
 */

/** cyrb128 string hash -> four 32-bit seeds */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export function hashString(str: string): number {
  return cyrb128(str)[0];
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  readonly seed: string;

  constructor(seed: string | number) {
    this.seed = String(seed);
    const [a, b, c, d] = cyrb128(this.seed);
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    // warm up
    for (let i = 0; i < 15; i++) this.next();
  }

  /** sfc32: float in [0, 1) */
  next(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** integer in [min, max] (inclusive) */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('Rng.pick on empty array');
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** pick an index using non-negative weights */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return Math.floor(this.next() * weights.length);
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    return items[this.weightedIndex(weights)];
  }

  /** Box-Muller normal distribution */
  normal(mean = 0, sd = 1): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return mean + sd * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** Derive an independent child generator (stable for a given label). */
  fork(label: string): Rng {
    return new Rng(`${this.seed}::${label}`);
  }
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}
