/**
 * @file contracts.ts
 * @description Byte-exact Level-5 binary contracts matching aphrody-nie-formats.
 * Provides immutable constants, struct layouts, and binary validations for IEVR formats.
 */

// ============================================================================
// Level-5 Binary Magics (Little-Endian 32-bit uints)
// ============================================================================

/** Magic "RDBN" (LE: 0x4E424452) used by Level-5 cfg.bin files */
export const RDBN_MAGIC = 0x4e424452;

/** Magic "G4TX" (LE: 0x58543447) used by Level-5 Graphics 4 Texture containers */
export const G4TX_MAGIC = 0x58543447;

/** Magic "CPK " (LE: 0x204B5043) used by CRI Middleware CPK archives */
export const CPK_MAGIC = 0x204b5043;

/** Magic "@UTF" (0x40555446) used by CRI UTF table schemas */
export const UTF_MAGIC = 0x40555446;

/** Magic "DDS " (LE: 0x20534444) used by embedded DirectDraw Surface textures */
export const DDS_MAGIC = 0x20534444;

/** Magic "CRILAYLA" header identifier prefix */
export const CRILAYLA_PREFIX = "CRILAYLA";

// ============================================================================
// Layout and Alignment Dimensions (bytes)
// ============================================================================

export const RDBN_LAYOUT = {
  MIN_HEADER_SIZE: 0x50, // 80 bytes
  EXPECTED_VERSION: 0x64, // 100
  ENTRY_SIZE: 0x20, // 32 bytes per table entry
  ALIGNMENT: 4,
} as const;

export const G4TX_LAYOUT = {
  HEADER_SIZE: 0x60, // 96 bytes
  ENTRY_SIZE: 0x30, // 48 bytes
  SUB_ENTRY_SIZE: 0x18, // 24 bytes
  EXPECTED_FILE_TYPE: 0x65,
  ALIGNMENT: 16,
} as const;

export const CPK_LAYOUT = {
  HEADER_SIZE: 0x800, // 2048 bytes standard sector
  TOC_ALIGNMENT: 0x800,
} as const;

// ============================================================================
// CRC32 - Standard IEEE 802.3 polynomial (0xEDB88320)
// ============================================================================

export const CRC32_POLYNOMIAL = 0xedb88320;

// Precomputed table for high-performance byte-exact hashing
export const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? CRC32_POLYNOMIAL ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

/** Size of the uncompressed header block at the end of a CRILAYLA stream (always 256 bytes) */
export const CRILAYLA_RAW_HEADER_SIZE = 0x100;

/** Minimum size of a valid CRILAYLA file (0x10 header + 0x100 raw block = 272 bytes) */
export const CRILAYLA_MIN_FILE_SIZE = 0x10 + CRILAYLA_RAW_HEADER_SIZE;

/** Fixed encryption key used for packaged Viola cfg.bin archives (NOT for data/packs/*.cpk) */
export const VIOLA_FIXED_KEY = 0x1717e18e;

/**
 * Computes the byte-exact Level-5 CRC32 hash for an ASCII/UTF-8 string or byte array.
 * Used for section names, table lookup keys, and asset hashes.
 */
export function computeLevel5Crc32(input: string | Uint8Array): number {
  let crc = 0xffffffff;
  if (typeof input === "string") {
    const bytes = new TextEncoder().encode(input);
    for (let i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[i]) & 0xff];
    }
  } else {
    for (let i = 0; i < input.length; i++) {
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ input[i]) & 0xff];
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Computes the raw NIE/Level-5 CRC32 accumulator without the final inversion.
 * Identical to nie-engine::g4::crc32_of / aphrody-nie-formats::crc32_nie.
 * Used for uniformKeeperModelIdCrc, uniformFielderModelIdCrc, and asset model ID CRC fields.
 */
export function computeNieCrc32(input: string | Uint8Array): number {
  let crc = 0xffffffff;
  if (typeof input === "string") {
    const bytes = new TextEncoder().encode(input);
    for (let i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[i]) & 0xff];
    }
  } else {
    for (let i = 0; i < input.length; i++) {
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ input[i]) & 0xff];
    }
  }
  return crc >>> 0;
}

/**
 * Derives the CRI position-XOR decryption key from a CPK archive filename.
 * In Level-5 IEVR, keys are derived from the basename of the .cpk file via CRC32.
 * @param filename - CPK filename (basename, e.g. "1d08dda99e8549431c6c7b459ed8deab.cpk")
 */
export function deriveCpkKeyFromFilename(filename: string): number {
  const base =
    filename.includes("/") || filename.includes("\\") ? filename.split(/[/\\]/).pop()! : filename;
  return computeLevel5Crc32(base);
}

// ============================================================================
// Typed Binary Inspection Models
// ============================================================================

export type BinaryFormatKind = "rdbn" | "g4tx" | "cpk" | "utf" | "dds" | "crilayla" | "unknown";

export interface BinaryHeaderProbe {
  kind: BinaryFormatKind;
  magic: number;
  headerSize: number;
  byteLength: number;
  isValid: boolean;
  details?: Record<string, number | string | boolean>;
}

export interface RdbnHeaderInfo {
  magic: number;
  headerSize: number;
  version: number;
  dataOffset: number;
  dataSize: number;
  typeOffset: number;
  typeCount: number;
  fieldOffset: number;
  fieldCount: number;
  rootOffset: number;
  rootCount: number;
  stringHashOffset: number;
  stringOffsetsOffset: number;
  hashCount: number;
  valueOffset: number;
  stringOffset: number;
}

export interface G4txHeaderInfo {
  magic: number;
  headerSize: number;
  fileType: number;
  tableSize: number;
  textureCount: number;
  totalCount: number;
  subTextureCount: number;
  textureDataSize: number;
  entryOffset: number;
  subEntryOffset: number;
  hashOffset: number;
  idOffset: number;
  stringOffset: number;
  nxtchBase: number;
}
