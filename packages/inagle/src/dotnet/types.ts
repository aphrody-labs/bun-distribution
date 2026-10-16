/**
 * @file types.ts
 * @description Types for IECODE .NET & Node-API / NativeAOT bridge.
 */

export type DotnetBridgeMode = "native-aot" | "node-api" | "fallback";

export interface DotnetBridgeStatus {
  available: boolean;
  mode: DotnetBridgeMode;
  version: string;
  schema: string;
  libraryPath: string | null;
}

export type FormatKind =
  | "Unknown"
  | "G4TX"
  | "G4MD"
  | "G4MG"
  | "G4MT"
  | "G4SK"
  | "G4PK"
  | "G4RA"
  | "AGI"
  | "OBJB"
  | "PXCL"
  | "CFGBIN"
  | "XFSA"
  | "XPCK"
  | "CPK"
  | "AFS2"
  | "ADX"
  | "HCA"
  | "USM"
  | "UTF"
  | "ACB"
  | "AWB"
  | "DDS"
  | "PNG"
  | "RIFF"
  | "NXTCH"
  | "ZIP"
  | "GZIP"
  | "ZSTD";

export interface DetectedFormat {
  format: FormatKind;
  formatId: number;
  name: string;
  extension: string;
}

export const FORMAT_ID_MAP: Record<number, { format: FormatKind; name: string; extension: string }> = {
  0: { format: "Unknown", name: "Unknown", extension: ".bin" },
  1: { format: "G4TX", name: "Level-5 Texture Container", extension: ".g4tx" },
  2: { format: "G4MD", name: "Level-5 Model Data", extension: ".g4md" },
  3: { format: "G4MG", name: "Level-5 Model Group", extension: ".g4mg" },
  4: { format: "G4MT", name: "Level-5 Material", extension: ".g4mt" },
  5: { format: "G4SK", name: "Level-5 Skeleton", extension: ".g4sk" },
  6: { format: "G4PK", name: "Level-5 Package", extension: ".g4pk" },
  7: { format: "G4RA", name: "Level-5 Resource Archive", extension: ".g4ra" },
  8: { format: "AGI", name: "Level-5 Animation/Graphics", extension: ".agi" },
  9: { format: "OBJB", name: "Level-5 Binary Objects", extension: ".objb" },
  10: { format: "PXCL", name: "Level-5 Pixel/Collision", extension: ".pxcl" },
  11: { format: "CFGBIN", name: "Level-5 Configuration Binary", extension: ".cfg.bin" },
  12: { format: "XFSA", name: "Level-5 XFSA Archive", extension: ".xfsa" },
  13: { format: "XPCK", name: "Level-5 XPCK Package", extension: ".xpck" },
  14: { format: "CPK", name: "Criware Package", extension: ".cpk" },
  15: { format: "AFS2", name: "Criware Audio Archive", extension: ".afs2" },
  16: { format: "ADX", name: "Criware ADX Audio", extension: ".adx" },
  17: { format: "HCA", name: "Criware High Compression Audio", extension: ".hca" },
  18: { format: "USM", name: "Criware Video Stream", extension: ".usm" },
  19: { format: "UTF", name: "Criware UTF Table", extension: ".utf" },
  20: { format: "ACB", name: "Criware Audio Container Bundle", extension: ".acb" },
  21: { format: "AWB", name: "Criware Audio Wave Bank", extension: ".awb" },
  22: { format: "DDS", name: "DirectDraw Surface", extension: ".dds" },
  23: { format: "PNG", name: "Portable Network Graphics", extension: ".png" },
  24: { format: "RIFF", name: "RIFF Audio/Video Wave", extension: ".wav" },
  25: { format: "NXTCH", name: "Nintendo Switch Texture Chunk", extension: ".nxtch" },
  26: { format: "ZIP", name: "ZIP Archive", extension: ".zip" },
  27: { format: "GZIP", name: "GZIP Compressed Archive", extension: ".gz" },
  28: { format: "ZSTD", name: "Zstandard Compressed Archive", extension: ".zst" },
};

export interface IDotnetBridge {
  readonly status: DotnetBridgeStatus;
  isAvailable(): boolean;
  computeLevel5Crc32(data: Uint8Array | string): number;
  detectFormat(data: Uint8Array): DetectedFormat;
  isCrilayla(data: Uint8Array): boolean;
  decompressCrilayla(data: Uint8Array): Uint8Array;
  compressCrilayla(data: Uint8Array): Uint8Array;
  decryptCpkBlock(data: Uint8Array, offset?: bigint | number, key?: bigint | number): Uint8Array;
  isRdbn(data: Uint8Array): boolean;
}
