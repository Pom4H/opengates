// Deterministic randomness — the enabling primitive of a replayable simulation.
//
// A realistic simulation needs variability (durations, lead times, defects), but
// Open Gates' invariant is that a run is REPLAYABLE: same inputs ⇒ identical
// output, forever. We square that circle the way the engine does for `fold`:
// never touch Math.random(); draw every random number from an explicitly seeded,
// splittable PRNG. Same seed ⇒ same world.
//
// The generator is SplitMix64 (small, fast, good distribution) over BigInt. The
// load-bearing feature is `stream(name)`: independent sub-generators derived from
// the ROOT seed (not the live state), so adding a new draw in one concern does
// not shift the numbers drawn by another. That keeps a scenario stable as the
// model grows — the reason a global Math.random() makes simulations unrepeatable.

const MASK = (1n << 64n) - 1n;
const GOLDEN = 0x9e3779b97f4a7c15n;

function mix64(z: bigint): bigint {
  z = (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n & MASK;
  z = (z ^ (z >> 27n)) * 0x94d049bb133111ebn & MASK;
  return (z ^ (z >> 31n)) & MASK;
}

/** Fold an arbitrary seed (string / number / bigint) into a 64-bit value. */
function toSeed(seed: bigint | number | string): bigint {
  if (typeof seed === "bigint") return seed & MASK;
  if (typeof seed === "number") return mix64(BigInt(Math.trunc(seed)) & MASK);
  let h = 1469598103934665603n; // FNV-1a 64
  for (let i = 0; i < seed.length; i++) {
    h ^= BigInt(seed.charCodeAt(i));
    h = (h * 1099511628211n) & MASK;
  }
  return mix64(h);
}

export class Rng {
  /** The immutable root, so derived streams are independent of draw order. */
  private readonly root: bigint;
  private state: bigint;
  private spare: number | undefined; // cached Box–Muller normal

  constructor(seed: bigint | number | string = 0x1234_5678n) {
    this.root = toSeed(seed);
    this.state = this.root;
  }

  /** Next raw 64-bit value (advances state). */
  private nextU64(): bigint {
    this.state = (this.state + GOLDEN) & MASK;
    return mix64(this.state);
  }

  /** Uniform double in [0, 1). */
  float(): number {
    return Number(this.nextU64() >> 11n) / 9007199254740992; // 2^53
  }

  /** Uniform double in (0, 1] — safe for logs. */
  private floatOpen(): number {
    return 1 - this.float();
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.float() * n);
  }

  /** A coin with probability `p` of true. */
  bool(p = 0.5): boolean {
    return this.float() < p;
  }

  uniform(a: number, b: number): number {
    return a + (b - a) * this.float();
  }

  /** Standard-ish normal via Box–Muller (one spare cached per pair). */
  normal(mean = 0, sd = 1): number {
    if (this.spare !== undefined) {
      const z = this.spare;
      this.spare = undefined;
      return mean + sd * z;
    }
    const u1 = this.floatOpen();
    const u2 = this.float();
    const r = Math.sqrt(-2 * Math.log(u1));
    this.spare = r * Math.sin(2 * Math.PI * u2);
    return mean + sd * (r * Math.cos(2 * Math.PI * u2));
  }

  /**
   * Lognormal with a given MEDIAN and shape `sigma`. The natural model for a
   * positive, right-skewed quantity — a task duration or a delivery lead time:
   * usually near plan, occasionally much longer, never negative.
   */
  lognormal(median: number, sigma: number): number {
    return median * Math.exp(sigma * this.normal());
  }

  /** Triangular(min, mode, max) — a bounded estimate with a most-likely value. */
  triangular(min: number, mode: number, max: number): number {
    const u = this.float();
    const c = (mode - min) / (max - min);
    return u < c
      ? min + Math.sqrt(u * (max - min) * (mode - min))
      : max - Math.sqrt((1 - u) * (max - min) * (max - mode));
  }

  /** Poisson(lambda) via Knuth — small counts (defects, breakdowns per period). */
  poisson(lambda: number): number {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.float();
    } while (p > L);
    return k - 1;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  /** Weighted choice; weights need not be normalized. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = this.float() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r < 0) return items[i];
    }
    return items[items.length - 1];
  }

  /**
   * An independent sub-generator, derived from the root seed and `name`. Streams
   * with different names never interfere; the same name on the same root always
   * yields the same stream — regardless of how many draws happened in between.
   */
  stream(name: string): Rng {
    const child = new Rng(0n);
    const nameSeed = toSeed(name);
    // Mix root and name so (root, name) → a unique, well-distributed seed.
    (child as { root: bigint }).root = mix64((this.root ^ nameSeed) & MASK);
    (child as { state: bigint }).state = (child as unknown as { root: bigint }).root;
    return child;
  }
}

/** Convenience constructor. */
export function rng(seed: bigint | number | string = 0x1234_5678n): Rng {
  return new Rng(seed);
}
