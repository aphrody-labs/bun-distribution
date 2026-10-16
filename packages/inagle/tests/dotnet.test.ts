import { describe, expect, test } from "bun:test";
import * as Inagle from "../src/index.js";
import {
  compressCrilayla,
  computeLevel5Crc32,
  createDotnetBridge,
  decompressCrilayla,
  decryptCpkBlock,
  detectFormat,
  getDotnetStatus,
  isCrilayla,
  isDotnetAvailable,
  isRdbn,
} from "../src/dotnet/index.js";

describe("IECODE .NET & Node-API / NativeAOT Bridge", () => {
  test("exports dotnet on root Inagle", () => {
    expect(Inagle.dotnet).toBeDefined();
    expect(typeof Inagle.dotnet.computeLevel5Crc32).toBe("function");
    expect(typeof Inagle.dotnet.decompressCrilayla).toBe("function");
    expect(typeof Inagle.dotnet.compressCrilayla).toBe("function");
    expect(typeof Inagle.dotnet.detectFormat).toBe("function");
    expect(typeof Inagle.dotnet.decryptCpkBlock).toBe("function");
    expect(typeof Inagle.dotnet.isRdbn).toBe("function");
  });

  test("verifies bridge runtime metadata and availability", () => {
    const status = getDotnetStatus();
    expect(status).toBeDefined();
    expect(status.schema).toBe("iecode.ffi/v1");

    // In this environment, NativeAOT shared library was built and published
    if (isDotnetAvailable()) {
      expect(status.mode).toBe("native-aot");
      expect(status.version).toMatch(/^\d+\.\d+\.\d+(?:[-+].*)?$/);
      expect(status.libraryPath).toContain("IECODE.Ffi.so");
    } else {
      expect(status.mode).toBe("fallback");
      expect(status.version).toContain("fallback");
    }
  });

  test("computes Level-5 reflected CRC32 matching authoritative oracle", () => {
    const text = "chara_base";
    const textBytes = new TextEncoder().encode(text);

    const crcFromStr = computeLevel5Crc32(text);
    const crcFromBytes = computeLevel5Crc32(textBytes);

    expect(crcFromStr).toBe(crcFromBytes);
    expect(crcFromStr).toBe(0xc14c3006);

    // Empty input
    expect(computeLevel5Crc32("")).toBe(0);
    expect(computeLevel5Crc32(new Uint8Array())).toBe(0);
  });

  test("detects formats using FormatDetector magic signatures", () => {
    // CPK header
    const cpkHeader = new Uint8Array([0x43, 0x50, 0x4b, 0x20, 0x00, 0x00, 0x00, 0x00]);
    const cpkDetect = detectFormat(cpkHeader);
    expect(cpkDetect.format).toBe("CPK");
    expect(cpkDetect.formatId).toBe(14);
    expect(cpkDetect.extension).toBe(".cpk");

    // G4TX header
    const g4txHeader = new Uint8Array([0x47, 0x34, 0x54, 0x58, 0x00, 0x00, 0x00, 0x00]);
    const g4txDetect = detectFormat(g4txHeader);
    expect(g4txDetect.format).toBe("G4TX");
    expect(g4txDetect.formatId).toBe(1);
    expect(g4txDetect.extension).toBe(".g4tx");

    // Unknown header
    const unknownHeader = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const unknownDetect = detectFormat(unknownHeader);
    expect(unknownDetect.format).toBe("Unknown");
  });

  test("identifies RDBN configuration binary magic", () => {
    const validRdbn = new TextEncoder().encode("RDBN" + "\0".repeat(0x50));
    expect(isRdbn(validRdbn)).toBe(true);

    const invalid = new TextEncoder().encode("ABCD" + "\0".repeat(0x50));
    expect(isRdbn(invalid)).toBe(false);
  });

  test("performs byte-exact CRILAYLA compression and decompression roundtrip", () => {
    // Create test payload with non-trivial byte patterns
    const original = new Uint8Array(650);
    for (let i = 0; i < original.length; i++) {
      original[i] = (i * 17 + 31) & 0xff;
    }

    // Compress
    const compressed = compressCrilayla(original);
    expect(isCrilayla(compressed)).toBe(true);
    expect(compressed.length).toBeGreaterThan(16);

    // Verify magic header
    const header = new TextDecoder().decode(compressed.subarray(0, 8));
    expect(header).toBe("CRILAYLA");

    // Decompress
    const decompressed = decompressCrilayla(compressed);
    expect(decompressed.length).toBe(original.length);

    // Byte-exact equality
    for (let i = 0; i < original.length; i++) {
      expect(decompressed[i]).toBe(original[i]);
    }
  });

  test("performs CRI position-XOR block decryption and symmetric recovery", () => {
    const cleartext = new Uint8Array([0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80]);
    const key = 0x1717e18en;
    const offset = 0n;

    // Encrypt block
    const encrypted = decryptCpkBlock(cleartext, offset, key);
    expect(encrypted).not.toEqual(cleartext);

    // Decrypting again with the same key restores original cleartext (involutory XOR)
    const restored = decryptCpkBlock(encrypted, offset, key);
    expect(restored).toEqual(cleartext);
  });

  test("guarantees 100% agreement between NativeAOT and Fallback bridges", () => {
    const native = createDotnetBridge();
    const fallback = createDotnetBridge({ preferFallback: true });

    expect(fallback.status.mode).toBe("fallback");

    // CRC32 parity
    const payload = "test_level5_hash_agreement";
    expect(native.computeLevel5Crc32(payload)).toBe(fallback.computeLevel5Crc32(payload));

    // Decryption parity
    const data = new Uint8Array([11, 22, 33, 44, 55, 66, 77, 88]);
    const nativeDec = native.decryptCpkBlock(data, 0n, 0x1717e18en);
    const fallbackDec = fallback.decryptCpkBlock(data, 0n, 0x1717e18en);
    expect(nativeDec).toEqual(fallbackDec);

    // RDBN parity
    const rdbnBuf = new TextEncoder().encode("RDBN" + "\0".repeat(0x50));
    expect(native.isRdbn(rdbnBuf)).toBe(fallback.isRdbn(rdbnBuf));

    // CRILAYLA decompress parity: compress with native, decompress with fallback
    const sample = new Uint8Array(400);
    for (let i = 0; i < sample.length; i++) sample[i] = (i + 5) & 0xff;

    const comp = native.compressCrilayla(sample);
    const nativeDecomp = native.decompressCrilayla(comp);
    const fallbackDecomp = fallback.decompressCrilayla(comp);

    expect(nativeDecomp).toEqual(sample);
    expect(fallbackDecomp).toEqual(sample);
    expect(nativeDecomp).toEqual(fallbackDecomp);
  });
});
