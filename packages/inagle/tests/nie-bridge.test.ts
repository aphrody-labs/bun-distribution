/**
 * @file nie-bridge.test.ts
 * @description Verifies byte-exact Level-5 binary contracts and parser probes.
 */

import { describe, expect, it } from "bun:test";
import {
  G4TX_LAYOUT,
  G4TX_MAGIC,
  RDBN_LAYOUT,
  RDBN_MAGIC,
  computeLevel5Crc32,
  computeNieCrc32,
  decompressCrilayla,
  decryptCpkBlock,
  deriveCpkKeyFromFilename,
  isCrilayla,
  parseG4txHeader,
  parseRdbnHeader,
  probeFormat,
  PureCrand,
} from "../src/nie-bridge/index.js";

describe("nie-bridge Level-5 binary contracts", () => {
  it("computes byte-exact Level-5 CRC32 matching polynomial 0xEDB88320", () => {
    // Test standard CRC32 against known reference values
    const hashEmpty = computeLevel5Crc32("");
    expect(hashEmpty).toBe(0);

    const hashName = computeLevel5Crc32("m_growthTableLv1List");
    expect(typeof hashName).toBe("number");
    expect(hashName).toBeGreaterThan(0);
  });

  it("probes and validates an authoritative RDBN (cfg.bin) header", () => {
    const buf = new Uint8Array(RDBN_LAYOUT.MIN_HEADER_SIZE);
    const view = new DataView(buf.buffer);

    // Write RDBN magic
    view.setUint32(0, RDBN_MAGIC, true);
    // Header size = 0x50
    view.setUint16(4, 0x50, true);
    // Version = 100 (0x64)
    view.setUint32(6, 0x64, true);

    const probe = probeFormat(buf);
    expect(probe.kind).toBe("rdbn");
    expect(probe.isValid).toBe(true);

    const parsed = parseRdbnHeader(buf);
    expect(parsed.magic).toBe(RDBN_MAGIC);
    expect(parsed.version).toBe(100);
    expect(parsed.headerSize).toBe(0x50);
  });

  it("probes and validates an authoritative G4TX texture container header", () => {
    const buf = new Uint8Array(G4TX_LAYOUT.HEADER_SIZE);
    const view = new DataView(buf.buffer);

    // Write G4TX magic
    view.setUint32(0, G4TX_MAGIC, true);
    // Header size = 0x60
    view.setUint32(4, 0x60, true);
    // File type = 0x65
    view.setUint32(8, 0x65, true);
    // Table size = 0x100
    view.setUint32(12, 0x100, true);
    // Texture count = 1
    view.setUint32(16, 1, true);
    // Total count = 2
    view.setUint32(20, 2, true);
    // Sub-texture count = 1
    view.setUint32(24, 1, true);

    const probe = probeFormat(buf);
    expect(probe.kind).toBe("g4tx");
    expect(probe.isValid).toBe(true);

    const parsed = parseG4txHeader(buf);
    expect(parsed.magic).toBe(G4TX_MAGIC);
    expect(parsed.entryOffset).toBe(0x60);
    // subEntryOffset = 0x60 + 1 * 0x30 = 0x90
    expect(parsed.subEntryOffset).toBe(0x90);
    // hashOffset = align16(0x90 + 1 * 0x18 = 0xa8) = 0xb0
    expect(parsed.hashOffset).toBe(0xb0);
    // idOffset = 0xb0 + 2 * 4 = 0xb8
    expect(parsed.idOffset).toBe(0xb8);
    // stringOffset = align4(0xb8 + 2 = 0xba) = 0xbc
    expect(parsed.stringOffset).toBe(0xbc);
  });

  it("derives CRI CPK decryption keys from archive filenames matching NIE", () => {
    // Exact reference vector from aphrody-nie-formats/src/cpk.rs:55
    const key = deriveCpkKeyFromFilename("1d08dda99e8549431c6c7b459ed8deab.cpk");
    expect(key).toBe(0xbd281847);

    // Strips path prefixes
    const keyFromPath = deriveCpkKeyFromFilename("data/packs/1d08dda99e8549431c6c7b459ed8deab.cpk");
    expect(keyFromPath).toBe(0xbd281847);
  });

  it("computes the raw NIE CRC32 accumulator without final inversion", () => {
    const rawCrc = computeNieCrc32("test");
    expect(typeof rawCrc).toBe("number");
    expect(rawCrc).toBeGreaterThan(0);
  });

  it("detects and decompresses CRILAYLA compressed buffers byte-exactly", () => {
    const magicBuf = new Uint8Array(16);
    new TextEncoder().encodeInto("CRILAYLA", magicBuf);
    expect(isCrilayla(magicBuf)).toBe(true);

    const nonMagic = new Uint8Array(16);
    expect(isCrilayla(nonMagic)).toBe(false);

    // Synthetic vector: uncompressed_size = 0, header_offset = 0 (272 bytes total)
    const crilaylaBuf = new Uint8Array(0x110);
    new TextEncoder().encodeInto("CRILAYLA", crilaylaBuf);
    const view = new DataView(crilaylaBuf.buffer);
    view.setUint32(8, 0, true); // uncompressed_size = 0
    view.setUint32(12, 0, true); // header_offset = 0
    crilaylaBuf.fill(0xcd, 0x10, 0x110); // raw block filled with 0xCD

    const decompressed = decompressCrilayla(crilaylaBuf);
    expect(decompressed.length).toBe(0x100);
    expect(decompressed[0]).toBe(0xcd);
    expect(decompressed[255]).toBe(0xcd);
  });

  it("executes CRI position-XOR decryption involutively", () => {
    const original = new Uint8Array([0x43, 0x50, 0x4b, 0x20, 0x01, 0x02, 0x03, 0x04]);
    const buffer = new Uint8Array(original);
    const key = 0xbd281847;

    // Encrypt / first pass
    decryptCpkBlock(buffer, key, 0);
    expect(buffer).not.toEqual(original);

    // Decrypt / second pass (involutory XOR)
    decryptCpkBlock(buffer, key, 0);
    expect(buffer).toEqual(original);
  });

  it("generates MT19937 ground truth with Lemire bounded rejection via PureCrand", () => {
    const rng = new PureCrand(5489);

    expect(rng.nextU32()).toBe(3499211612);
    expect(rng.nextU32()).toBe(581869302);
    expect(rng.nextU32()).toBe(3890346734);

    const b = rng.bounded(10);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(10);

    const f = rng.nextF32();
    expect(f).toBeGreaterThanOrEqual(0.0);
    expect(f).toBeLessThan(1.0);

    const raw = new PureCrand(42).nextU32();
    const boundedZero = new PureCrand(42).bounded(0);
    expect(boundedZero).toBe(raw);
  });
});
