// SPDX-License-Identifier: MIT
import { hashContent } from "@aphrody/bun-workspace/hash";

export type Ecosystem =
  "debian" | "ubuntu" | "cosmic" | "alpm" | "msys2" | "mingw" | "cygwin";
export type InputFormat =
  | "deb"
  | "deb822"
  | "pkginfo"
  | "srcinfo"
  | "cygwin"
  | "alpm-archive"
  | "source-archive";
export type Fields = Record<string, string[]>;

export interface SourceArtifact {
  path: string;
  size?: number;
  integrity?: string;
  url?: string;
}

export interface PackageRecord {
  ecosystem: Ecosystem;
  kind: "binary" | "source";
  name: string;
  version: string;
  architecture?: string;
  description?: string;
  homepage?: string;
  licenses: string[];
  dependencies: Record<string, string[]>;
  sources: SourceArtifact[];
  fields: Fields;
}

export interface PayloadEntry {
  path: string;
  kind: "file" | "directory" | "symlink" | "hardlink";
  mode: number;
  link?: string;
  data: Uint8Array;
}

export interface Abi {
  format: "elf" | "pe" | "script" | "data";
  architecture?: string;
  bits?: number;
  runtime?: "windows" | "cygwin" | "msys2" | "linux";
  imports?: string[];
  executable?: boolean;
  library?: boolean;
  subsystem?: number;
  elfOsAbi?: number;
}

export interface Inspection {
  schema: 1;
  input: { path: string; sha256: string; size: number; format: InputFormat };
  companion?: {
    path: string;
    sha256: string;
    size: number;
    format: InputFormat;
  };
  packages: PackageRecord[];
  payload: Array<
    Omit<PayloadEntry, "data"> & { size: number; sha256?: string; abi?: Abi }
  >;
}

export interface Limits {
  packed: number;
  unpacked: number;
  entries: number;
  metadata: number;
  deadlineMs: number;
}

export const LIMITS: Limits = {
  packed: 128 * 1024 * 1024,
  unpacked: 256 * 1024 * 1024,
  entries: 100_000,
  metadata: 16 * 1024 * 1024,
  deadlineMs: 30_000,
};

export const decoder = new TextDecoder("utf-8", { fatal: true });
export const sha256 = hashContent;

export function safePath(value: string): string {
  if (value.startsWith("/") || /[\\:\0\r\n]/.test(value))
    throw new Error(`Unsafe archive path: ${value}`);
  const parts = value.split("/").filter((part) => part !== "." && part !== "");
  if (!parts.length || parts.some((part) => part === ".."))
    throw new Error(`Unsafe archive path: ${value}`);
  return parts.join("/");
}
