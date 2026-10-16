/**
 * @file index.ts
 * @description Strongly-typed VFS Format Consumer for Inazuma Eleven: Victory Road.
 * Unifies format detection, schema validation, and header extraction across Bun and native libiecode.
 */

import { VFS_FORMATS, resolveFormat } from "../docs/vfs-catalog.js";
import type { VfsFormatDescriptor } from "../docs/types.js";
import { nieFormatDetect } from "../ffi/nie.js";

export { VFS_FORMATS, resolveFormat };
export type { VfsFormatDescriptor };

export interface HeaderValidationResult {
  valid: boolean;
  format?: VfsFormatDescriptor;
  reason?: string;
}

/**
 * Universal VFS Format Consumer.
 * High-performance format inspection backed by native Rust `aphrody-nie-formats` and fallback JS catalog.
 */
export class VfsFormatConsumer {
  /**
   * Detects the binary format from a raw byte buffer.
   */
  static detect(data: Uint8Array): VfsFormatDescriptor {
    if (data.length === 0) {
      return this.getUnknown();
    }

    // 1. Try native Rust detection via C-ABI
    try {
      const nativeId = nieFormatDetect(data);
      if (nativeId > 0 && nativeId <= 28) {
        const desc = this.getById(nativeId);
        if (desc) return desc;
      }
    } catch {
      // Fallback to JS pure detection
    }

    // 2. Pure JS fallback detection by magic
    const magicAscii = this.readAscii(data, 0, 4);
    const resolved = resolveFormat(magicAscii) ?? resolveFormat(this.readAscii(data, 0, 8));
    if (resolved) return resolved;

    // Check PNG signature: 89 50 4E 47 0D 0A 1A 0A
    if (
      data.length >= 8 &&
      data[0] === 0x89 &&
      data[1] === 0x50 &&
      data[2] === 0x4e &&
      data[3] === 0x47
    ) {
      const png = resolveFormat(".png");
      if (png) return png;
    }

    // Check LIVE save container: 0x9DCE66C3
    if (data.length >= 4) {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      if (dv.getUint32(0, true) === 0x9dce66c3) {
        const live = resolveFormat("LIVE");
        if (live) return live;
      }
    }

    return this.getUnknown();
  }

  /**
   * Resolves a format descriptor by ID (1..28) or extension (e.g. '.g4tx').
   */
  static get(idOrExt: number | string): VfsFormatDescriptor | undefined {
    if (typeof idOrExt === "number") {
      return this.getById(idOrExt);
    }
    return resolveFormat(idOrExt);
  }

  /**
   * Resolves format by ID (1..28).
   */
  static getById(id: number): VfsFormatDescriptor | undefined {
    return VFS_FORMATS.find((f) => f.id === id);
  }

  /**
   * Returns all 28 canonical VFS formats.
   */
  static listAll(): VfsFormatDescriptor[] {
    return VFS_FORMATS;
  }

  /**
   * Returns whether a format is Big-Endian.
   */
  static isBigEndian(id: number): boolean {
    const desc = this.getById(id);
    return desc?.isBigEndian ?? false;
  }

  /**
   * Validates whether a byte buffer matches the expected format header.
   */
  static validate(formatId: number, data: Uint8Array): HeaderValidationResult {
    const target = this.getById(formatId);
    if (!target) {
      return { valid: false, reason: `Unknown format ID ${formatId}` };
    }
    if (data.length < 4) {
      return {
        valid: false,
        reason: "Buffer too small for header validation (need at least 4 bytes)",
      };
    }

    const detected = this.detect(data);
    if (detected.id !== target.id) {
      return {
        valid: false,
        format: detected,
        reason: `Format mismatch: expected ${target.magicAscii} (${target.extension}), detected ${detected.magicAscii} (${detected.extension})`,
      };
    }

    return { valid: true, format: target };
  }

  /**
   * Returns a descriptor for unknown binary data.
   */
  static getUnknown(): VfsFormatDescriptor {
    return {
      id: 0,
      magicHex: "0x00000000",
      magicAscii: "NONE",
      extension: ".bin",
      description: "Unknown binary payload",
      isBigEndian: false,
      category: "system",
      encryptionSupported: false,
      compressionSupported: false,
    };
  }

  private static readAscii(data: Uint8Array, offset: number, length: number): string {
    if (data.length < offset + length) return "";
    let str = "";
    for (let i = 0; i < length; i++) {
      const code = data[offset + i];
      if (code === 0) break;
      str += String.fromCharCode(code);
    }
    return str;
  }
}
