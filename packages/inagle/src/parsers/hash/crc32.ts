/**
 * @file crc32.ts
 * @description CRC32 hash computation for cfg.bin key tables.
 * Grounded in aphrody-nie-formats and unified through nie-bridge.
 *
 * Uses the standard CRC32 polynomial (0xEDB88320).
 */

import { CRC32_POLYNOMIAL, computeLevel5Crc32 } from "../../nie-bridge/contracts.js";

export { CRC32_POLYNOMIAL };

/**
 * Compute CRC32 hash of a byte array.
 * Delegates to the authoritative byte-exact Level-5 CRC32 implementation from nie-bridge.
 * @param data - Input bytes
 * @returns 32-bit CRC32 hash
 */
export function crc32(data: Uint8Array): number {
  return computeLevel5Crc32(data);
}

/**
 * Compute CRC32 hash of a string (UTF-8 encoded).
 * @param str - Input string
 * @returns 32-bit CRC32 hash
 */
export function crc32String(str: string): number {
  return computeLevel5Crc32(str);
}

/**
 * Compute CRC32 and return as hex string.
 * @param data - Input bytes
 * @returns Hex string (e.g., "0x12345678")
 */
export function crc32Hex(data: Uint8Array): string {
  return `0x${crc32(data).toString(16).toUpperCase().padStart(8, "0")}`;
}

/**
 * Compute CRC32 of a string and return as hex.
 * @param str - Input string
 * @returns Hex string (e.g., "0x12345678")
 */
export function crc32StringHex(str: string): string {
  return `0x${crc32String(str).toString(16).toUpperCase().padStart(8, "0")}`;
}

export default crc32;
