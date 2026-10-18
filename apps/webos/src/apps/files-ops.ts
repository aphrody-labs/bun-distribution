// SPDX-License-Identifier: Apache-2.0
// File operations of the explorer over the Rust VFS (`os.fs`): copy, move, trash, restore, usage.
// The wasm RPC serves rename and delete only, so copy, move and trash are composed here from
// read/write/mkdir/rename/remove.
import type { WebOs } from "@aphrody/webos-wasm";
import { HOME } from "../os";

export interface Entry {
  name: string;
  path: string;
  kind: "file" | "dir";
  size: number;
  ext: string;
}

export const TRASH = `${HOME}/.Trash`;
const ORIGINS = `${TRASH}/.origins.json`;
const dec = new TextDecoder();
const enc = new TextEncoder();

export const join = (a: string, b: string) => (a === "/" ? `/${b}` : `${a}/${b}`);
export const parent = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";
export const base = (p: string) => p.slice(p.lastIndexOf("/") + 1) || "/";
export const extOf = (name: string) => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
};
export const inTrash = (p: string) => p === TRASH || p.startsWith(`${TRASH}/`);
export const isInside = (p: string, dir: string) => p === dir || p.startsWith(dir === "/" ? "/" : `${dir}/`);
export const protectedPath = (p: string) => p === "/" || p === HOME || p === TRASH;

export const fmtSize = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : n < 1073741824
        ? `${(n / 1048576).toFixed(1)} MB`
        : `${(n / 1073741824).toFixed(2)} GB`;

export function exists(os: WebOs, path: string): boolean {
  try {
    os.fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

export function listDir(os: WebOs, dir: string): Entry[] {
  const rows = JSON.parse(os.fs.list(dir)) as { name: string; kind: "file" | "dir"; size: number }[];
  return rows.map(r => ({ name: r.name, path: join(dir, r.name), kind: r.kind, size: r.size, ext: extOf(r.name) }));
}

/** "name (2).ext" until the name is free in `dir`. */
export function uniquePath(os: WebOs, dir: string, name: string): string {
  let candidate = join(dir, name);
  if (!exists(os, candidate)) return candidate;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; ; n++) {
    candidate = join(dir, `${stem} (${n})${ext}`);
    if (!exists(os, candidate)) return candidate;
  }
}

/** Recursive copy; refuses to copy a folder into itself. Returns the new path. */
export function copyTo(os: WebOs, src: string, dir: string): string {
  if (isInside(dir, src) && os.fs.stat(src) && (JSON.parse(os.fs.stat(src)) as { kind: string }).kind === "dir")
    throw new Error("Cannot copy a folder into itself");
  const dst = uniquePath(os, dir, base(src));
  const walk = (from: string, to: string) => {
    const st = JSON.parse(os.fs.stat(from)) as { kind: string };
    if (st.kind === "dir") {
      os.fs.mkdir(to);
      for (const e of listDir(os, from)) walk(e.path, join(to, e.name));
    } else os.fs.write(to, os.fs.read(from));
  };
  walk(src, dst);
  return dst;
}

/** Move into `dir` (rename on the Rust VFS). Returns the new path. */
export function moveTo(os: WebOs, src: string, dir: string): string {
  if (protectedPath(src)) throw new Error(`${src} is protected`);
  if (isInside(dir, src)) throw new Error("Cannot move a folder into itself");
  if (parent(src) === dir) return src;
  const dst = uniquePath(os, dir, base(src));
  os.fs.rename(src, dst);
  return dst;
}

function readOrigins(os: WebOs): Record<string, string> {
  try {
    return JSON.parse(dec.decode(os.fs.read(ORIGINS))) as Record<string, string>;
  } catch {
    return {};
  }
}
const writeOrigins = (os: WebOs, map: Record<string, string>) =>
  os.fs.write(ORIGINS, enc.encode(JSON.stringify(map)));

function ensureTrash(os: WebOs) {
  if (!exists(os, TRASH)) os.fs.mkdir(TRASH);
}

/** Move to ~/.Trash (remembering the origin); items already in the trash are removed for good. */
export function trash(os: WebOs, paths: string[]): void {
  ensureTrash(os);
  const origins = readOrigins(os);
  for (const p of paths) {
    if (protectedPath(p)) throw new Error(`${p} is protected`);
    if (inTrash(p)) {
      os.fs.remove(p);
      delete origins[base(p)];
      continue;
    }
    const dst = uniquePath(os, TRASH, base(p));
    os.fs.rename(p, dst);
    origins[base(dst)] = p;
  }
  writeOrigins(os, origins);
}

/** Put trashed items back where they came from (or into the home folder). */
export function restore(os: WebOs, paths: string[]): void {
  const origins = readOrigins(os);
  for (const p of paths) {
    const name = base(p);
    const target = origins[name] ?? join(HOME, name);
    const dir = parent(target);
    if (!exists(os, dir)) os.fs.mkdir(dir);
    os.fs.rename(p, uniquePath(os, dir, base(target)));
    delete origins[name];
  }
  writeOrigins(os, origins);
}

export function emptyTrash(os: WebOs): void {
  if (!exists(os, TRASH)) return;
  for (const e of listDir(os, TRASH)) if (e.name !== ".origins.json") os.fs.remove(e.path);
  writeOrigins(os, {});
}

/** Bytes, files and folders below `dir` (recursive walk of the VFS). */
export function usage(os: WebOs, dir = "/"): { bytes: number; files: number; dirs: number } {
  const out = { bytes: 0, files: 0, dirs: 0 };
  const stack = [dir];
  while (stack.length) {
    for (const e of listDir(os, stack.pop()!)) {
      if (e.kind === "dir") {
        out.dirs++;
        stack.push(e.path);
      } else {
        out.files++;
        out.bytes += e.size;
      }
    }
  }
  return out;
}
