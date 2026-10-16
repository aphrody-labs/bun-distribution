import { describe, expect, it } from "bun:test";
import {
  isNativeAvailable,
  getNativeLibraryPath,
  getNativeLoadError,
  nieVersion,
  nieBuildInfo,
  nieCrc32,
  nieCrc32Nie,
  nieCpkKeyFromFilename,
  nieDecryptCpkBlock,
  nieIsCrilayla,
  nieCompressCrilayla,
  nieDecompressCrilayla,
  nieProbeHeader,
  nieFormatName,
  nieCpkProbe,
  nieCfgBinProbe,
  nieG4txProbe,
  nieClearError,
  nieGetLastError,
  NieCrandHandle,
} from "../src/ffi/index.js";

describe("Inagle Native FFI (bun:ffi)", () => {
  it("resolves and loads native libiecode successfully", () => {
    const available = isNativeAvailable();
    const libPath = getNativeLibraryPath();
    const loadError = getNativeLoadError();

    expect(typeof available).toBe("boolean");
    if (available) {
      expect(typeof libPath).toBe("string");
      expect(loadError).toBeNull();
      const version = nieVersion();
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    } else {
      expect(loadError).toBeDefined();
    }
  });

  it.skipIf(!isNativeAvailable())("retrieves build info and capability manifest", () => {
    const info = nieBuildInfo();
    expect(info).not.toBeNull();
    expect(info?.product).toBe("iecode");
    expect(Array.isArray(info?.capabilities)).toBe(true);
    expect(info?.capabilities).toContain("crc32");
    expect(info?.capabilities).toContain("cpk");
    expect(info?.capabilities).toContain("crilayla");
    expect(info?.capabilities).toContain("cfgbin");
    expect(info?.capabilities).toContain("g4tx");
  });

  describe("CRC32", () => {
    it("computes IEEE 802.3 Level-5 CRC32 vectors byte-exactly", () => {
      expect(nieCrc32("Focus")).toBe(0xa30165ed);
      expect(nieCrc32("123456789")).toBe(0xcbf43926);
      expect(nieCrc32("")).toBe(0);
      expect(nieCrc32("m_growthTableLv1List")).toBe(0xeebb7243);
    });

    it("computes raw NIE CRC32 accumulator", () => {
      expect(nieCrc32Nie("")).toBe(0xffffffff);
      const data = "test";
      const raw = nieCrc32Nie(data);
      const standard = nieCrc32(data);
      expect(~raw >>> 0).toBe(standard);
    });
  });

  describe("CRI CPK & CRILAYLA", () => {
    it("derives CPK decryption key from filenames and paths", () => {
      const key1 = nieCpkKeyFromFilename("archive.cpk");
      const key2 = nieCpkKeyFromFilename("/var/game/packs/archive.cpk");
      const key3 = nieCpkKeyFromFilename("C:\\Games\\data\\packs\\archive.cpk");

      expect(key1).toBeGreaterThan(0);
      expect(key1).toBe(key2);
      expect(key1).toBe(key3);
    });

    it("performs position-aware XOR decryption involution", () => {
      const original = new Uint8Array([0x43, 0x50, 0x4b, 0x20, 0x12, 0x34, 0x56, 0x78]);
      const buffer = new Uint8Array(original);
      const key = nieCpkKeyFromFilename("test_archive.cpk");

      nieDecryptCpkBlock(buffer, 0, key);
      expect(buffer).not.toEqual(original);

      // Re-running XOR with identical offset and key restores original plaintext
      nieDecryptCpkBlock(buffer, 0, key);
      expect(buffer).toEqual(original);
    });

    it.skipIf(!isNativeAvailable())("compresses and decompresses CRILAYLA round-trip", () => {
      const sample = new Uint8Array(400);
      for (let i = 0; i < sample.length; i++) {
        sample[i] = (i * 7 + 13) & 0xff;
      }

      const compressed = nieCompressCrilayla(sample);
      expect(compressed).not.toBeNull();
      expect(nieIsCrilayla(compressed!)).toBe(true);

      const decompressed = nieDecompressCrilayla(compressed!);
      expect(decompressed).not.toBeNull();
      expect(decompressed!).toEqual(sample);
    });
  });

  describe("Format Probing", () => {
    it("identifies format signatures correctly", () => {
      const cpkBuffer = new Uint8Array([
        0x43, 0x50, 0x4b, 0x20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ]);
      expect(nieCpkProbe(cpkBuffer)).toBe(true);
      expect(nieProbeHeader(cpkBuffer)).toBe(14); // 14 = CPK
      expect(nieFormatName(14)).toBe("CPK");
      expect(nieProbeHeader(new TextEncoder().encode("CRILAYLA"))).toBe(22);
      expect(nieProbeHeader(new TextEncoder().encode("CRImagic"))).toBe(0);
      expect(nieProbeHeader(new TextEncoder().encode("CPKx"))).toBe(0);

      const rdbnBuffer = new Uint8Array([0x52, 0x44, 0x42, 0x4e, 0, 0, 0, 0]);
      expect(nieCfgBinProbe(rdbnBuffer)).toBe(1); // 1 = RDBN probe flag

      const g4txBuffer = new Uint8Array([0x47, 0x34, 0x54, 0x58, 0, 0, 0, 0]);
      expect(nieG4txProbe(g4txBuffer)).toBe(true);
      expect(nieFormatName(1)).toBe("G4TX");
    });
  });

  describe("CRand PRNG (MT19937)", () => {
    it("generates deterministic random numbers matching MT19937 ground truth", () => {
      const rng = new NieCrandHandle(5489);
      try {
        expect(rng.nextU32()).toBe(3499211612);
        expect(rng.nextU32()).toBe(581869302);
        expect(rng.nextU32()).toBe(3890346734);

        const b = rng.bounded(10);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThan(10);

        const f = rng.nextF32();
        expect(f).toBeGreaterThanOrEqual(0.0);
        expect(f).toBeLessThan(1.0);
      } finally {
        rng.close();
      }
    });
  });

  describe("Diagnostics & Error Management", () => {
    it("handles error buffers cleanly", () => {
      if (!isNativeAvailable()) return;
      nieClearError();
      const err = nieGetLastError();
      expect(err).toBeNull();
    });
  });
});
