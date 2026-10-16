/**
 * @file formats.test.ts
 * @description Unit tests for VFS format consumer and cross-language descriptors in Bun.
 */

import { describe, expect, it } from "bun:test";
import { VfsFormatConsumer } from "../src/formats/index.js";
import {
  isNativeAvailable,
  nieFormatCatalog,
  nieFormatCategory,
  nieFormatCount,
  nieFormatDetect,
  nieFormatExtension,
  nieFormatIsBigEndian,
  nieFormatMimeType,
  nieFormatName,
  nieFormatSupportsCompression,
  nieFormatSupportsEncryption,
} from "../src/ffi/nie.js";

describe("VfsFormatConsumer (Bun / TypeScript)", () => {
  it("should list all 28 canonical VFS formats", () => {
    const list = VfsFormatConsumer.listAll();
    expect(list.length).toBe(28);

    const g4tx = VfsFormatConsumer.get(1);
    expect(g4tx?.magicAscii).toBe("G4TX");
    expect(g4tx?.extension).toBe(".g4tx");
    expect(g4tx?.category).toBe("texture");
    expect(g4tx?.isBigEndian).toBe(false);

    const cpk = VfsFormatConsumer.get(14);
    expect(cpk?.magicAscii.trim()).toBe("CPK");
    expect(cpk?.isBigEndian).toBe(true);
    expect(cpk?.encryptionSupported).toBe(true);

    const live = VfsFormatConsumer.get(28);
    expect(live?.magicAscii).toBe("LIVE");
    expect(live?.magicHex).toBe("0x9DCE66C3");
  });

  it("should detect format from header magic bytes in memory", () => {
    // 1. G4TX magic (0x58543447 LE)
    const g4txBuf = new Uint8Array([0x47, 0x34, 0x54, 0x58, 0x20, 0x00, 0x00, 0x00]);
    const detectedG4tx = VfsFormatConsumer.detect(g4txBuf);
    expect(detectedG4tx.id).toBe(1);
    expect(detectedG4tx.magicAscii).toBe("G4TX");

    // 2. CPK magic (0x204B5043 BE)
    const cpkBuf = new Uint8Array([0x43, 0x50, 0x4b, 0x20, 0x00, 0x00, 0x00, 0x00]);
    const detectedCpk = VfsFormatConsumer.detect(cpkBuf);
    expect(detectedCpk.id).toBe(14);
    expect(detectedCpk.isBigEndian).toBe(true);

    // 3. RDBN magic (0x4E424452 LE)
    const rdbnBuf = new Uint8Array([0x52, 0x44, 0x42, 0x4e, 0x50, 0x00, 0x01, 0x00]);
    const detectedRdbn = VfsFormatConsumer.detect(rdbnBuf);
    expect(detectedRdbn.id).toBe(11);
    expect(detectedRdbn.extension).toBe(".cfg.bin");

    // 4. CRILAYLA magic
    const laylaBuf = new Uint8Array([0x43, 0x52, 0x49, 0x4c, 0x41, 0x59, 0x4c, 0x41, 0x00, 0x10, 0x00, 0x00]);
    const detectedLayla = VfsFormatConsumer.detect(laylaBuf);
    expect(detectedLayla.id).toBe(22);

    // 5. LIVE save container (0x9DCE66C3 LE)
    const liveBuf = new Uint8Array([0xc3, 0x66, 0xce, 0x9d, 0x01, 0x00, 0x00, 0x00]);
    const detectedLive = VfsFormatConsumer.detect(liveBuf);
    expect(detectedLive.id).toBe(28);

    // 6. Unknown bytes
    const unknownBuf = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const detectedUnknown = VfsFormatConsumer.detect(unknownBuf);
    expect(detectedUnknown.id).toBe(0);
  });

  it("should validate header bytes against expected format", () => {
    const g4txBuf = new Uint8Array([0x47, 0x34, 0x54, 0x58, 0x20, 0x00, 0x00, 0x00]);
    const validRes = VfsFormatConsumer.validate(1, g4txBuf);
    expect(validRes.valid).toBe(true);
    expect(validRes.format?.id).toBe(1);

    const invalidRes = VfsFormatConsumer.validate(14, g4txBuf);
    expect(invalidRes.valid).toBe(false);
    expect(invalidRes.reason).toContain("Format mismatch");
  });

  it.skipIf(!isNativeAvailable())("should query native Rust C-ABI format symbols via FFI", () => {
    expect(nieFormatCount()).toBe(28);

    // ID 1: G4TX
    expect(nieFormatName(1)).toBe("G4TX");
    expect(nieFormatExtension(1)).toBe(".g4tx");
    expect(nieFormatMimeType(1)).toBe("image/x-level5-g4tx");
    expect(nieFormatCategory(1)).toBe("texture");
    expect(nieFormatIsBigEndian(1)).toBe(false);
    expect(nieFormatSupportsCompression(1)).toBe(true);
    expect(nieFormatSupportsEncryption(1)).toBe(false);

    // ID 14: CPK
    expect(nieFormatName(14)).toBe("CPK");
    expect(nieFormatExtension(14)).toBe(".cpk");
    expect(nieFormatIsBigEndian(14)).toBe(true);
    expect(nieFormatSupportsEncryption(14)).toBe(true);

    // Native detection
    const g4txBuf = new Uint8Array([0x47, 0x34, 0x54, 0x58, 0x20, 0x00, 0x00, 0x00]);
    expect(nieFormatDetect(g4txBuf)).toBe(1);

    // Full catalog JSON via C-ABI
    const catalog = nieFormatCatalog();
    expect(catalog.length).toBe(28);
    const first = catalog[0];
    expect(first.id).toBe(1);
    expect(first.name).toBe("G4TX");
    expect(first.extension).toBe(".g4tx");
  });
});
