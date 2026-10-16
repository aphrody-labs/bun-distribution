/**
 * @file engine.ts
 * @description Authoritative binary validation and parsing bridge grounded in aphrody-nie-formats.
 */

import {
  type BinaryHeaderProbe,
  CPK_MAGIC,
  CRC32_TABLE,
  CRILAYLA_MIN_FILE_SIZE,
  CRILAYLA_PREFIX,
  CRILAYLA_RAW_HEADER_SIZE,
  DDS_MAGIC,
  G4TX_LAYOUT,
  G4TX_MAGIC,
  type G4txHeaderInfo,
  RDBN_LAYOUT,
  RDBN_MAGIC,
  type RdbnHeaderInfo,
  UTF_MAGIC,
} from "./contracts.ts";

/** Helper to align an offset to a power of 2 */
function align(offset: number, boundary: number): number {
  return (offset + (boundary - 1)) & ~(boundary - 1);
}

/**
 * Probes the binary format of a buffer by inspecting magic headers and structure constraints.
 */
export function probeFormat(buffer: ArrayBuffer | Uint8Array): BinaryHeaderProbe {
  const view =
    buffer instanceof Uint8Array
      ? new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : new DataView(buffer);

  const byteLength = view.byteLength;
  if (byteLength < 4) {
    return {
      kind: "unknown",
      magic: 0,
      headerSize: 0,
      byteLength,
      isValid: false,
    };
  }

  const magic = view.getUint32(0, true);

  // Check RDBN
  if (magic === RDBN_MAGIC) {
    const isValid = byteLength >= RDBN_LAYOUT.MIN_HEADER_SIZE;
    const headerSize = isValid ? view.getUint16(4, true) : 0;
    const version = isValid ? view.getUint32(6, true) : 0;
    return {
      kind: "rdbn",
      magic,
      headerSize,
      byteLength,
      isValid: isValid && version === RDBN_LAYOUT.EXPECTED_VERSION,
      details: {
        version,
        headerSize,
      },
    };
  }

  // Check G4TX
  if (magic === G4TX_MAGIC) {
    const isValid = byteLength >= G4TX_LAYOUT.HEADER_SIZE;
    const headerSize = isValid ? view.getUint32(4, true) : 0;
    const fileType = isValid ? view.getUint32(8, true) : 0;
    return {
      kind: "g4tx",
      magic,
      headerSize,
      byteLength,
      isValid: isValid && fileType === G4TX_LAYOUT.EXPECTED_FILE_TYPE,
      details: {
        fileType,
        headerSize,
      },
    };
  }

  // Check CPK
  if (magic === CPK_MAGIC) {
    return {
      kind: "cpk",
      magic,
      headerSize: 0x800,
      byteLength,
      isValid: byteLength >= 0x800,
    };
  }

  // Check @UTF (Big-endian or Little-endian)
  const beMagic = view.getUint32(0, false);
  if (beMagic === UTF_MAGIC) {
    return {
      kind: "utf",
      magic: beMagic,
      headerSize: 0x20,
      byteLength,
      isValid: byteLength >= 0x20,
    };
  }

  // Check DDS
  if (magic === DDS_MAGIC) {
    return {
      kind: "dds",
      magic,
      headerSize: 128,
      byteLength,
      isValid: byteLength >= 128,
    };
  }

  // Check CRILAYLA ASCII header
  if (byteLength >= 8) {
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const ascii = String.fromCharCode(...u8.subarray(0, 8));
    if (ascii === CRILAYLA_PREFIX) {
      return {
        kind: "crilayla",
        magic: 0,
        headerSize: 16,
        byteLength,
        isValid: true,
      };
    }
  }

  return {
    kind: "unknown",
    magic,
    headerSize: 0,
    byteLength,
    isValid: false,
  };
}

/**
 * Parses and validates an authoritative RDBN (cfg.bin) header matching aphrody-nie-formats.
 * Throws an Error if the buffer is malformed or invalid.
 */
export function parseRdbnHeader(buffer: ArrayBuffer | Uint8Array): RdbnHeaderInfo {
  const view =
    buffer instanceof Uint8Array
      ? new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : new DataView(buffer);

  if (view.byteLength < RDBN_LAYOUT.MIN_HEADER_SIZE) {
    throw new Error(`RDBN buffer too small: expected >= 0x50 bytes, got ${view.byteLength}`);
  }

  const magic = view.getUint32(0, true);
  if (magic !== RDBN_MAGIC) {
    throw new Error(
      `Invalid RDBN magic: expected 0x${RDBN_MAGIC.toString(16)}, got 0x${magic.toString(16)}`,
    );
  }

  const headerSize = view.getUint16(0x04, true);
  const version = view.getUint32(0x06, true);
  const dataOffset = view.getUint16(0x0a, true) * 4;
  const dataSize = view.getUint32(0x0c, true);
  const typeOffset = view.getUint16(0x24, true) * 4;
  const typeCount = view.getUint16(0x26, true);
  const fieldOffset = view.getUint16(0x28, true) * 4;
  const fieldCount = view.getUint16(0x2a, true);
  const rootOffset = view.getUint16(0x2c, true) * 4;
  const rootCount = view.getUint16(0x2e, true);
  const stringHashOffset = view.getUint16(0x30, true) * 4;
  const stringOffsetsOffset = view.getUint16(0x32, true) * 4;
  const hashCount = view.getUint16(0x34, true);
  const valueOffset = view.getUint16(0x36, true) * 4;
  const stringOffset = view.getUint32(0x38, true);

  return {
    magic,
    headerSize,
    version,
    dataOffset,
    dataSize,
    typeOffset,
    typeCount,
    fieldOffset,
    fieldCount,
    rootOffset,
    rootCount,
    stringHashOffset,
    stringOffsetsOffset,
    hashCount,
    valueOffset,
    stringOffset,
  };
}

/**
 * Parses and computes exact table offsets for a Level-5 G4TX texture container.
 * Strictly implements the table layout formula from aphrody-nie-formats/src/g4tx.rs.
 */
export function parseG4txHeader(buffer: ArrayBuffer | Uint8Array): G4txHeaderInfo {
  const view =
    buffer instanceof Uint8Array
      ? new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : new DataView(buffer);

  if (view.byteLength < G4TX_LAYOUT.HEADER_SIZE) {
    throw new Error(`G4TX buffer too small: expected >= 0x60 bytes, got ${view.byteLength}`);
  }

  const magic = view.getUint32(0, true);
  if (magic !== G4TX_MAGIC) {
    throw new Error(
      `Invalid G4TX magic: expected 0x${G4TX_MAGIC.toString(16)}, got 0x${magic.toString(16)}`,
    );
  }

  const headerSize = view.getUint32(0x04, true);
  const fileType = view.getUint32(0x08, true);
  const tableSize = view.getUint32(0x0c, true);
  const textureCount = view.getUint32(0x10, true);
  const totalCount = view.getUint32(0x14, true);
  const subTextureCount = view.getUint32(0x18, true);
  const textureDataSize = view.getUint32(0x1c, true);

  // Exact offsets matching aphrody-nie-formats::g4tx:
  // entry_offset = 0x60
  // sub_entry_offset = entry_offset + texture_count * 0x30
  // hash_offset = align16(sub_entry_offset + sub_texture_count * 0x18)
  // id_offset = hash_offset + total_count * 4
  // string_offset = align4(id_offset + total_count)
  // nxtch_base = align16(header_size + table_size)
  const entryOffset = 0x60;
  const subEntryOffset = entryOffset + textureCount * G4TX_LAYOUT.ENTRY_SIZE;
  const hashOffset = align(subEntryOffset + subTextureCount * G4TX_LAYOUT.SUB_ENTRY_SIZE, 16);
  const idOffset = hashOffset + totalCount * 4;
  const stringOffset = align(idOffset + totalCount, 4);
  const nxtchBase = align(headerSize + tableSize, 16);

  return {
    magic,
    headerSize,
    fileType,
    tableSize,
    textureCount,
    totalCount,
    subTextureCount,
    textureDataSize,
    entryOffset,
    subEntryOffset,
    hashOffset,
    idOffset,
    stringOffset,
    nxtchBase,
  };
}

// ============================================================================
// CRILAYLA Decompression (Byte-exact port from aphrody-nie-formats::crilayla)
// ============================================================================

/**
 * Returns true if buffer begins with ASCII magic "CRILAYLA".
 */
export function isCrilayla(buffer: ArrayBuffer | Uint8Array): boolean {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (u8.length < 8) return false;
  return (
    u8[0] === 0x43 &&
    u8[1] === 0x52 &&
    u8[2] === 0x49 &&
    u8[3] === 0x4c &&
    u8[4] === 0x41 &&
    u8[5] === 0x59 &&
    u8[6] === 0x4c &&
    u8[7] === 0x41
  );
}

/**
 * Reverse bitstream reader for CRILAYLA decompression.
 * Faithfully ports the exact semantics of CriLayla.cs and crilayla.rs.
 */
class BitReader {
  ptr: number;
  bitsLeft: number;

  constructor(rawBlockStart: number) {
    this.ptr = rawBlockStart;
    this.bitsLeft = 0;
  }

  getNextBit(input: Uint8Array): number {
    if (this.bitsLeft === 0) {
      if (this.ptr === 0x10) {
        throw new Error("CRILAYLA: bitstream exhausted (getNextBit)");
      }
      this.ptr--;
      this.bitsLeft = 7;
    } else {
      this.bitsLeft--;
    }
    return (input[this.ptr] >> this.bitsLeft) & 1;
  }

  read8(input: Uint8Array): number {
    if (this.ptr === 0x10) {
      throw new Error("CRILAYLA: bitstream exhausted (read8)");
    }
    this.ptr--;
    if (this.bitsLeft !== 0) {
      const extra = 8 - this.bitsLeft;
      const high = input[this.ptr + 1] & ((1 << this.bitsLeft) - 1);
      const low = (input[this.ptr] >> this.bitsLeft) & ((1 << extra) - 1);
      return ((high << extra) | low) & 0xff;
    } else {
      return input[this.ptr];
    }
  }

  readMax8(bitCount: number, input: Uint8Array): number {
    if (this.bitsLeft === 0) {
      if (this.ptr === 0x10) {
        throw new Error("CRILAYLA: bitstream exhausted (readMax8)");
      }
      this.ptr--;
      this.bitsLeft = 8;
    }

    const take1 = Math.min(this.bitsLeft, bitCount);
    this.bitsLeft -= take1;
    const result = (input[this.ptr] >> this.bitsLeft) & ((1 << take1) - 1);
    const remaining = bitCount - take1;

    if (remaining === 0) {
      return result;
    }

    if (this.ptr === 0x10) {
      throw new Error("CRILAYLA: bitstream exhausted (readMax8 cross)");
    }
    this.ptr--;
    this.bitsLeft = 8;

    const take2 = remaining;
    this.bitsLeft -= take2;
    const low = (input[this.ptr] >> this.bitsLeft) & ((1 << take2) - 1);
    return ((result << take2) | low) & 0xff;
  }

  read13(input: Uint8Array): number {
    let bitCount = 13;

    if (this.bitsLeft === 0) {
      if (this.ptr === 0x10) {
        throw new Error("CRILAYLA: bitstream exhausted (read13 init)");
      }
      this.ptr--;
      this.bitsLeft = 8;
    }

    const take1 = Math.min(this.bitsLeft, bitCount);
    const mask1 = take1 >= 8 ? 0xff : (1 << take1) - 1;
    const result1 = (input[this.ptr] >> (this.bitsLeft - take1)) & mask1;
    bitCount -= take1;

    this.bitsLeft = 8;
    if (this.ptr === 0x10) {
      throw new Error("CRILAYLA: bitstream exhausted (read13 octet 2)");
    }
    this.ptr--;

    const take2 = Math.min(this.bitsLeft, bitCount);
    const mask2 = take2 >= 8 ? 0xff : (1 << take2) - 1;
    const result2 = (input[this.ptr] >> (this.bitsLeft - take2)) & mask2;
    bitCount -= take2;

    let result = (result1 << take2) | result2;

    if (bitCount === 0) {
      this.bitsLeft -= take2;
      return result;
    }

    this.bitsLeft = 8;
    if (this.ptr === 0x10) {
      throw new Error("CRILAYLA: bitstream exhausted (read13 octet 3)");
    }
    this.ptr--;

    const take3 = bitCount;
    const mask3 = take3 >= 16 ? 0xffff : (1 << take3) - 1;
    result = (result << take3) | ((input[this.ptr] >> (this.bitsLeft - take3)) & mask3);
    this.bitsLeft -= take3;
    return result;
  }
}

/**
 * Decompresses a CRILAYLA compressed buffer and returns the uncompressed bytes.
 * Byte-exact with aphrody-nie-formats::crilayla::decompress.
 */
export function decompressCrilayla(buffer: ArrayBuffer | Uint8Array): Uint8Array {
  const input = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (input.length < CRILAYLA_MIN_FILE_SIZE) {
    throw new Error(
      `CRILAYLA buffer too small: expected >= ${CRILAYLA_MIN_FILE_SIZE} bytes, got ${input.length}`,
    );
  }
  if (!isCrilayla(input)) {
    throw new Error("Invalid CRILAYLA magic");
  }

  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const uncompressedSize = view.getUint32(8, true);
  const headerOffset = view.getUint32(12, true);

  const rawBlockStart = 0x10 + headerOffset;
  const rawBlockEnd = rawBlockStart + CRILAYLA_RAW_HEADER_SIZE;
  if (rawBlockEnd > input.length) {
    throw new Error("CRILAYLA raw block out of bounds");
  }

  const totalSize = CRILAYLA_RAW_HEADER_SIZE + uncompressedSize;
  const output = new Uint8Array(totalSize);

  // Copy raw block to the beginning of output
  output.set(input.subarray(rawBlockStart, rawBlockEnd), 0);

  if (uncompressedSize === 0) {
    return output;
  }

  const br = new BitReader(rawBlockStart);
  let writePos = totalSize;
  const MIN_COPY_LEN = 3;

  while (writePos > CRILAYLA_RAW_HEADER_SIZE) {
    const flag = br.getNextBit(input);
    if (flag === 0) {
      const byte = br.read8(input);
      writePos -= 1;
      output[writePos] = byte;
    } else {
      const rawOffset = br.read13(input);
      const offset = rawOffset + MIN_COPY_LEN;

      let length = MIN_COPY_LEN;
      const lvl2 = br.readMax8(2, input);
      length += lvl2;
      if (lvl2 === (1 << 2) - 1) {
        const lvl3 = br.readMax8(3, input);
        length += lvl3;
        if (lvl3 === (1 << 3) - 1) {
          const lvl5 = br.readMax8(5, input);
          length += lvl5;
          if (lvl5 === (1 << 5) - 1) {
            while (true) {
              const lvl8 = br.read8(input);
              length += lvl8;
              if (lvl8 !== 0xff) break;
            }
          }
        }
      }

      if (length > writePos - CRILAYLA_RAW_HEADER_SIZE) {
        throw new Error("CRILAYLA backref exceeds beginning of stream");
      }

      const dstStart = writePos - length;
      const srcEnd = writePos + offset;
      if (srcEnd > totalSize) {
        throw new Error("CRILAYLA backref source out of bounds");
      }

      if (offset >= length) {
        output.copyWithin(dstStart, srcEnd - length, srcEnd);
      } else {
        for (let i = writePos - 1; i >= dstStart; i--) {
          output[i] = output[i + offset];
        }
      }
      writePos = dstStart;
    }
  }

  return output;
}

// ============================================================================
// CRI Middleware Position-XOR Cryptography
// ============================================================================

function updateCrcState(seed: number, k: Uint8Array): number {
  let crc = ~seed >>> 0;
  for (let i = 0; i < 4; i++) {
    const idx = ((crc & 0xff) ^ k[i]) & 0xff;
    crc = ((crc >>> 8) ^ CRC32_TABLE[idx]) >>> 0;
  }
  return ~crc >>> 0;
}

function computeXorByte(crc: number, position: number): number {
  const baseShift = position * 2;
  let r8 = (crc >>> (baseShift + 8)) & 3;
  r8 |= ((crc >>> baseShift) & 0xff) << 2;
  r8 &= 0xff;
  r8 = ((r8 << 2) & 0xff) | ((crc >>> (baseShift + 16)) & 3);
  r8 = ((r8 << 2) & 0xff) | ((crc >>> (baseShift + 24)) & 3);
  return r8 & 0xff;
}

/**
 * Decrypts (in-place) a block of CRI Middleware position-XOR encrypted data.
 * Exact port of CriwareCrypt.DecryptBlock / aphrody-nie-formats::cpk::decrypt_block.
 * Encryption is an involutory XOR: running it twice with the same key restores cleartext.
 *
 * @param buffer - Data buffer to decrypt/encrypt in-place
 * @param key - 32-bit uint decryption key (e.g. from deriveCpkKeyFromFilename or VIOLA_FIXED_KEY)
 * @param fileOffset - Absolute offset in the file corresponding to buffer[0] (default 0)
 */
export function decryptCpkBlock(buffer: Uint8Array, key: number, fileOffset: number = 0): void {
  if (buffer.length === 0) return;

  const k = new Uint8Array([
    key & 0xff,
    (key >>> 8) & 0xff,
    (key >>> 16) & 0xff,
    (key >>> 24) & 0xff,
  ]);

  const length = buffer.length;
  let i = 0;

  const alignOffset = fileOffset & 3;
  if (alignOffset !== 0) {
    const currentCrc = updateCrcState(fileOffset & ~3, k);
    const alignCount = Math.min(4 - alignOffset, length);
    for (let j = 0; j < alignCount; j++) {
      const pos = (fileOffset + i) & 3;
      buffer[i] ^= computeXorByte(currentCrc, pos);
      i++;
    }
  }

  let baseOffset = fileOffset + i;
  while (i + 4 <= length) {
    const crc = updateCrcState(baseOffset, k);
    buffer[i] ^= computeXorByte(crc, 0);
    buffer[i + 1] ^= computeXorByte(crc, 1);
    buffer[i + 2] ^= computeXorByte(crc, 2);
    buffer[i + 3] ^= computeXorByte(crc, 3);
    i += 4;
    baseOffset += 4;
  }

  if (i < length) {
    const crc = updateCrcState(baseOffset, k);
    let pos = 0;
    while (i < length) {
      buffer[i] ^= computeXorByte(crc, pos);
      i++;
      pos++;
    }
  }
}
