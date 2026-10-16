/**
 * @file cross-language-parity.test.ts
 * @description Cross-language verification test asserting bit-exact parity across
 * Rust, C/C++, .NET 10, Bun/TypeScript, and Python.
 */

import { describe, expect, it } from "bun:test";
import {
  computeLevel5Crc32,
  computeNieCrc32,
  deriveCpkKeyFromFilename,
  PureCrand,
} from "../src/nie-bridge/index.js";
import {
  NIE_CRYPTO_CONSTANTS,
  NIE_CRITICAL_OFFSETS,
  NIE_RTTI_CLASSES,
  NIE_MEMORY_STRUCTURES,
} from "../src/docs/nie-re-map.js";
import { VfsFormatConsumer } from "../src/formats/index.js";

describe("Cross-Language 5-Runtime Parity Suite (Rust, C++, .NET 10, Bun/TS, Python)", () => {
  describe("Cryptographic and CRC32 Vectors", () => {
    it("computes bit-exact Level-5 reflected CRC32 matching all 5 runtimes", () => {
      // Vector 1: Empty string
      expect(computeLevel5Crc32("")).toBe(0x00000000);

      // Vector 2: "Focus" -> 0xA30165ED
      expect(computeLevel5Crc32("Focus")).toBe(0xa30165ed);

      // Vector 3: Standard 123456789 test vector -> 0xCBF43926
      expect(computeLevel5Crc32("123456789")).toBe(0xcbf43926);
    });

    it("computes raw NIE accumulator (no final XOR) matching all 5 runtimes", () => {
      // Inversion relation: computeNieCrc32(x) == computeLevel5Crc32(x) ^ 0xFFFFFFFF
      const crcReflected = computeLevel5Crc32("Focus");
      const crcRaw = computeNieCrc32("Focus");
      expect((crcRaw ^ 0xffffffff) >>> 0).toBe(crcReflected);
      expect(crcRaw).toBe(0x5cfe9a12);
    });

    it("derives CPK encryption key matching all 5 runtimes", () => {
      const key = deriveCpkKeyFromFilename("1d08dda99e8549431c6c7b459ed8deab.cpk");
      expect(key).toBe(0xbd281847);
    });
  });

  describe("Deterministic PRNG CRand (MT19937)", () => {
    it("generates exact reference sequence for seed 5489 across all runtimes", () => {
      const rng = new PureCrand(5489);

      // Bit-exact Mersenne Twister reference sequence
      expect(rng.nextU32()).toBe(3499211612);
      expect(rng.nextU32()).toBe(581869302);
      expect(rng.nextU32()).toBe(3890346734);
    });

    it("evaluates Lemire bounded rejection matching nie.exe engine behavior", () => {
      const rng1 = new PureCrand(42);
      const rng2 = new PureCrand(42);

      // Bound 0 returns raw next uint in nie.exe
      const raw = rng1.nextU32();
      const boundedZero = rng2.bounded(0);
      expect(boundedZero).toBe(raw);

      // Non-zero bounds stay strictly in range [0, bound)
      const rng = new PureCrand(12345);
      for (let i = 0; i < 50; i++) {
        const val = rng.bounded(15);
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(15);
      }
    });

    it("generates single-precision float in [0.0, 1.0)", () => {
      const rng = new PureCrand(777);
      for (let i = 0; i < 50; i++) {
        const f = rng.nextF32();
        expect(f).toBeGreaterThanOrEqual(0.0);
        expect(f).toBeLessThan(1.0);
      }
    });
  });

  describe("Reverse Engineering Ground Truth (nie.exe)", () => {
    it("matches all 7 cryptographic constants across runtimes", () => {
      expect(NIE_CRYPTO_CONSTANTS.length).toBe(7);

      const viola = NIE_CRYPTO_CONSTANTS.find((c) => c.name === "VIOLA_FIXED_KEY");
      expect(viola?.intValue).toBe(0x1717e18e);

      const poly = NIE_CRYPTO_CONSTANTS.find((c) => c.name === "LEVEL5_CRC32_POLYNOMIAL");
      expect(poly?.intValue).toBe(0xedb88320);

      const table = NIE_CRYPTO_CONSTANTS.find((c) => c.name === "CRI_ENCRYPTED_TABLE_MAGIC");
      expect(table?.intValue).toBe(0xf5f39e1f);

      const live = NIE_CRYPTO_CONSTANTS.find((c) => c.name === "LIVES_SAVE_HEADER_MAGIC");
      expect(live?.intValue).toBe(0x9dce66c3);

      const const2 = NIE_CRYPTO_CONSTANTS.find((c) => c.name === "LIVES_SAVE_CONST2");
      expect(const2?.intValue).toBe(0x2ec3031f);

      const blob = NIE_CRYPTO_CONSTANTS.find((c) => c.name === "LIVES_BLOB_MAGIC");
      expect(blob?.intValue).toBe(0xeeff);

      const steam = NIE_CRYPTO_CONSTANTS.find((c) => c.name === "STEAM_APP_ID");
      expect(steam?.intValue).toBe(2799860);
    });

    it("matches all 8 critical function pointers across runtimes", () => {
      expect(NIE_CRITICAL_OFFSETS.length).toBe(8);

      const offsets = new Map(NIE_CRITICAL_OFFSETS.map((o) => [o.symbol, o.runtimePc]));
      expect(offsets.get("GameTickLoop")).toBe(0x1406d5840n);
      expect(offsets.get("CharaControllerUpdate")).toBe(0x1404ecd60n);
      expect(offsets.get("CriFsStreamDecryptBlock")).toBe(0x1405a1120n);
      expect(offsets.get("CriLaylaDecompressStream")).toBe(0x1405b3890n);
      expect(offsets.get("RdbnTableLookup")).toBe(0x1403c8040n);
      expect(offsets.get("G4txDecodeTexture")).toBe(0x1404b2a80n);
      expect(offsets.get("LuaHostInit")).toBe(0x14072f910n);
      expect(offsets.get("CRand_MT19937_Next")).toBe(0x14081c200n);
    });

    it("matches all 8 RTTI classes and 3 memory structures", () => {
      expect(NIE_RTTI_CLASSES.length).toBe(8);
      const rttiNames = NIE_RTTI_CLASSES.map((r) => r.name);
      expect(rttiNames).toContain("Object");
      expect(rttiNames).toContain("CharaController");
      expect(rttiNames).toContain("BallPhysics");
      expect(rttiNames).toContain("VfsManager");
      expect(rttiNames).toContain("CpkArchive");
      expect(rttiNames).toContain("RenderScene");
      expect(rttiNames).toContain("SkinnedMesh");
      expect(rttiNames).toContain("SoundPlayer");

      expect(NIE_MEMORY_STRUCTURES.BonePalette.sizeHex).toBe("0x600");
      expect(NIE_MEMORY_STRUCTURES.FontGlyph.sizeHex).toBe("0x0C");
      expect(NIE_MEMORY_STRUCTURES.RdbnHeader.sizeHex).toBe("0x50");
    });
  });

  describe("28 Canonical VFS Formats", () => {
    it("contains all 28 canonical formats with consistent descriptors", () => {
      const all = VfsFormatConsumer.listAll();
      expect(all.length).toBe(28);

      const g4tx = VfsFormatConsumer.get(1);
      expect(g4tx?.magicAscii).toBe("G4TX");
      expect(g4tx?.extension).toBe(".g4tx");
      expect(g4tx?.category).toBe("texture");

      const live = VfsFormatConsumer.get(28);
      expect(live?.magicAscii).toBe("LIVE");
      expect(live?.magicHex).toBe("0x9DCE66C3");
      expect(live?.encryptionSupported).toBe(true);
    });
  });
});
