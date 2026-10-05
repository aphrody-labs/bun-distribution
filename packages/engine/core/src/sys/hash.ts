/**
 * Native Bun zero-copy hashing algorithms:
 * - Wyhash 64-bit: ultra fast, non-cryptographic PRNG/hasher (Bun.hash.wyhash)
 * - CRC32: IEEE 802.3 checksum (Bun.hash.crc32)
 * - SHA-256: Cryptographic hasher (Bun.CryptoHasher)
 */

export function wyhash(input: string | Uint8Array, seed: bigint | number = 0n): string {
  const seedBigInt = typeof seed === "bigint" ? seed : BigInt(seed);
  const hashVal =
    typeof input === "string"
      ? Bun.hash.wyhash(input, seedBigInt)
      : Bun.hash.wyhash(input, seedBigInt);
  return hashVal.toString(16);
}

export function crc32(input: string | Uint8Array): string {
  const crc = Bun.hash.crc32(input);
  return crc.toString(16);
}

export function sha256(input: Uint8Array | string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(typeof input === "string" ? new TextEncoder().encode(input) : input);
  return hasher.digest("hex");
}
