/**
 * @file nie-bridge.test.ts
 * @description Verifies Azalee CPK nie-bridge buffer validation.
 */

import { describe, expect, it } from "bun:test";
import {
  CPK_MAGIC,
  SECTOR_SIZE,
  UTF_MAGIC,
  VIOLA_FIXED_KEY,
  computeLevel5Crc32,
  computeNieCrc32,
  decompressCrilayla,
  decryptCpkBlock,
  deriveCpkKeyFromFilename,
  isCrilayla,
  verifyCpkBuffer,
} from "../src/cpk/nie-bridge.js";

describe("azalee cpk nie-bridge", () => {
  it("detects valid CPK archive header with @UTF descriptor", () => {
    const buf = new Uint8Array(SECTOR_SIZE);
    const view = new DataView(buf.buffer);

    // CPK magic
    view.setUint32(0, CPK_MAGIC, true);
    // @UTF magic at offset 16
    view.setUint32(16, UTF_MAGIC, false);

    const result = verifyCpkBuffer(buf);
    expect(result.isValid).toBe(true);
    expect(result.magic).toBe(CPK_MAGIC);
    expect(result.sectorSize).toBe(0x800);
    expect(result.utfOffset).toBe(16);
  });

  it("rejects undersized buffers or non-CPK magics", () => {
    const smallBuf = new Uint8Array(100);
    expect(verifyCpkBuffer(smallBuf).isValid).toBe(false);

    const invalidBuf = new Uint8Array(SECTOR_SIZE);
    expect(verifyCpkBuffer(invalidBuf).isValid).toBe(false);
  });

  it("re-exports authoritative CRILAYLA and CRI crypto utilities from NIE", () => {
    expect(VIOLA_FIXED_KEY).toBe(0x1717e18e);
    expect(typeof isCrilayla).toBe("function");
    expect(typeof decompressCrilayla).toBe("function");
    expect(typeof decryptCpkBlock).toBe("function");
    expect(typeof deriveCpkKeyFromFilename).toBe("function");
    expect(typeof computeLevel5Crc32).toBe("function");
    expect(typeof computeNieCrc32).toBe("function");

    // Reference CPK key verification
    expect(deriveCpkKeyFromFilename("1d08dda99e8549431c6c7b459ed8deab.cpk")).toBe(0xbd281847);
  });
});
