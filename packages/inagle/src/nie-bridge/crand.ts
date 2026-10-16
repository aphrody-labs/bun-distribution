/**
 * @file crand.ts
 * @description Authoritative pure-TypeScript port of lives::CRand PRNG from nie.exe (MT19937).
 * Byte-exact cross-language parity with Rust aphrody-nie-core, .NET 10 IECODE.Core,
 * C++ iecode_core, and Python niepy.
 */

const N = 624;
const M = 397;
const MATRIX_A = 0x9908b0df;
const UPPER_MASK = 0x80000000;
const LOWER_MASK = 0x7fffffff;
const INIT_MULT = 1812433253; // 0x6C078965

/**
 * 32-bit Mersenne Twister MT19937 pseudorandom number generator with Lemire bounded rejection.
 */
export class PureCrand {
  #mt = new Uint32Array(N);
  #index = N;

  constructor(seed: number = 5489) {
    this.#mt[0] = seed >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = this.#mt[i - 1];
      // Math.imul handles 32-bit signed multiplication; convert to unsigned with >>> 0
      const s = prev ^ (prev >>> 30);
      this.#mt[i] = (Math.imul(INIT_MULT, s) + i) >>> 0;
    }
    this.#index = N; // Force regeneration on first draw
  }

  /**
   * Convenience factory folding a 64-bit seed into 32-bit via XOR.
   */
  static fromU64(seed: bigint | number): PureCrand {
    if (typeof seed === "bigint") {
      const low = Number(seed & 0xffffffffn);
      const high = Number((seed >> 32n) & 0xffffffffn);
      return new PureCrand((low ^ high) >>> 0);
    }
    return new PureCrand(seed >>> 0);
  }

  #generate(): void {
    for (let i = 0; i < N; i++) {
      const y = (this.#mt[i] & UPPER_MASK) | (this.#mt[(i + 1) % N] & LOWER_MASK);
      let next = this.#mt[(i + M) % N] ^ (y >>> 1);
      if ((y & 1) !== 0) {
        next ^= MATRIX_A;
      }
      this.#mt[i] = next >>> 0;
    }
    this.#index = 0;
  }

  /**
   * Generates next pseudo-random 32-bit unsigned integer with canonical MT19937 tempering.
   */
  nextU32(): number {
    if (this.#index >= N) {
      this.#generate();
    }

    let y = this.#mt[this.#index++];

    // Canonical MT19937 tempering (d = 0xFFFFFFFF, verified in nie.exe:0x1402bf031)
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;

    return y >>> 0;
  }

  /**
   * Generates bounded integer in [0, bound) using Lemire's method with rejection.
   * If bound === 0, returns the raw next uint (matching nie.exe behavior).
   */
  bounded(bound: number): number {
    const b = bound >>> 0;
    if (b === 0) {
      return this.nextU32();
    }

    let r = BigInt(this.nextU32());
    let product = r * BigInt(b);
    let low = Number(product & 0xffffffffn) >>> 0;

    if (low < b) {
      // threshold = (-b) % b = (2^32 - b) % b
      const threshold = ((-b >>> 0) % b) >>> 0;
      while (low < threshold) {
        r = BigInt(this.nextU32());
        product = r * BigInt(b);
        low = Number(product & 0xffffffffn) >>> 0;
      }
    }

    return Number(product >> 32n) >>> 0;
  }

  /**
   * Generates single-precision float in [0.0, 1.0) using top 24 bits.
   */
  nextF32(): number {
    const bits = this.nextU32() >>> 8;
    return bits / 16777216.0;
  }
}
