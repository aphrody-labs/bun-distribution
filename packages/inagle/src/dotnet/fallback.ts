/**
 * @file fallback.ts
 * @description High-fidelity pure-JS fallback for IECODE .NET operations when native binary is absent.
 */

import {
  computeLevel5Crc32 as fallbackCrc32,
  decompressCrilayla as fallbackDecompress,
  decryptCpkBlock as fallbackDecrypt,
  isCrilayla as fallbackIsCrilayla,
} from "../nie-bridge/index.js";
import { type DetectedFormat, type DotnetBridgeStatus, type IDotnetBridge } from "./types.js";

export class FallbackDotnetBridge implements IDotnetBridge {
  private readonly _status: DotnetBridgeStatus = {
    available: false,
    mode: "fallback",
    version: "2.0.5-fallback",
    schema: "iecode.ffi/v1",
    libraryPath: null,
  };

  public get status(): DotnetBridgeStatus {
    return this._status;
  }

  public isAvailable(): boolean {
    return false;
  }

  public computeLevel5Crc32(data: Uint8Array | string): number {
    return fallbackCrc32(data);
  }

  public detectFormat(data: Uint8Array): DetectedFormat {
    if (data.length < 4) {
      return { format: "Unknown", formatId: 0, name: "Empty", extension: "" };
    }

    const magic = (data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24)) >>> 0;

    // Check known magic numbers matching FormatDetector
    if (magic === 0x204b5043 || magic === 0x43504b20) {
      return { format: "CPK", formatId: 14, name: "Criware Package", extension: ".cpk" };
    }
    if (magic === 0x58543447 || magic === 0x47345458) {
      return { format: "G4TX", formatId: 1, name: "Level-5 Texture Container", extension: ".g4tx" };
    }
    if (magic === 0x444d3447 || magic === 0x47344d44) {
      return { format: "G4MD", formatId: 2, name: "Level-5 Model Data", extension: ".g4md" };
    }
    if (magic === 0x474d3447 || magic === 0x47344d47) {
      return { format: "G4MG", formatId: 3, name: "Level-5 Model Group", extension: ".g4mg" };
    }
    if (magic === 0x544d3447 || magic === 0x47344d54) {
      return { format: "G4MT", formatId: 4, name: "Level-5 Material", extension: ".g4mt" };
    }
    if (magic === 0x4b533447 || magic === 0x47345348) {
      return { format: "G4SK", formatId: 5, name: "Level-5 Skeleton", extension: ".g4sk" };
    }
    if (magic === 0x4b503447 || magic === 0x47345048) {
      return { format: "G4PK", formatId: 6, name: "Level-5 Package", extension: ".g4pk" };
    }
    if (magic === 0x41523447 || magic === 0x47345241) {
      return { format: "G4RA", formatId: 7, name: "Level-5 Resource Archive", extension: ".g4ra" };
    }
    if (magic === 0x4e424452) {
      return {
        format: "CFGBIN",
        formatId: 11,
        name: "Level-5 Configuration Binary",
        extension: ".cfg.bin",
      };
    }
    if (magic === 0x20534444) {
      return { format: "DDS", formatId: 22, name: "DirectDraw Surface", extension: ".dds" };
    }
    if (magic === 0x474e5089) {
      return { format: "PNG", formatId: 23, name: "PNG Image", extension: ".png" };
    }
    if (magic === 0x46464952) {
      return { format: "RIFF", formatId: 24, name: "RIFF Audio/Video", extension: ".wav" };
    }

    return { format: "Unknown", formatId: 0, name: "Unknown", extension: ".bin" };
  }

  public isCrilayla(data: Uint8Array): boolean {
    return fallbackIsCrilayla(data);
  }

  public decompressCrilayla(data: Uint8Array): Uint8Array {
    return fallbackDecompress(data);
  }

  public compressCrilayla(data: Uint8Array): Uint8Array {
    const rawBlockSize = Math.min(data.length, 0x100);
    const uncompressedPayloadSize = data.length > 0x100 ? data.length - 0x100 : 0;

    let bitstream: number[] = [];
    if (uncompressedPayloadSize > 0) {
      const bitBuffer: number[] = [];
      // Push literal bytes from last to first
      for (let i = data.length - 1; i >= 0x100; i--) {
        bitBuffer.push(0); // 0 = literal flag
        const byte = data[i]!;
        for (let b = 7; b >= 0; b--) {
          bitBuffer.push((byte >> b) & 1);
        }
      }
      // Pack bits into bytes (MSB first)
      const packedBytes: number[] = [];
      let current = 0;
      let count = 0;
      for (const bit of bitBuffer) {
        current = (current << 1) | bit;
        count++;
        if (count === 8) {
          packedBytes.push(current);
          current = 0;
          count = 0;
        }
      }
      if (count > 0) {
        current <<= 8 - count;
        packedBytes.push(current);
      }
      // Reverse bitstream order
      packedBytes.reverse();
      bitstream = packedBytes;
    }

    const headerOffset = bitstream.length;
    const totalSize = 16 + headerOffset + 0x100;
    const out = new Uint8Array(totalSize);

    // Header "CRILAYLA"
    new TextEncoder().encodeInto("CRILAYLA", out.subarray(0, 8));
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    view.setUint32(8, uncompressedPayloadSize, true);
    view.setUint32(12, headerOffset, true);

    // Bitstream
    if (headerOffset > 0) {
      out.set(bitstream, 16);
    }

    // Raw block
    const rawDst = 16 + headerOffset;
    out.fill(0, rawDst, rawDst + 0x100);
    if (rawBlockSize > 0) {
      out.set(data.subarray(0, rawBlockSize), rawDst);
    }

    return out;
  }

  public decryptCpkBlock(
    data: Uint8Array,
    offset: bigint | number = 0n,
    key: bigint | number = 0x1717e18en,
  ): Uint8Array {
    const copy = new Uint8Array(data.length);
    copy.set(data);
    const numKey = Number(key);
    const numOffset = Number(offset);
    fallbackDecrypt(copy, numKey, numOffset);
    return copy;
  }

  public isRdbn(data: Uint8Array): boolean {
    if (data.length < 4) return false;
    return (
      data[0] === 0x52 && // R
      data[1] === 0x44 && // D
      data[2] === 0x42 && // B
      data[3] === 0x4e // N
    );
  }
}
