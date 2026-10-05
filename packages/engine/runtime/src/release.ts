/**
 * Installed-artifact management of the YOLO runtime: install (verified, immutable, previous kept),
 * rollback, list. Layout and rationale in `artifact.ts`; used by `scripts/release/runtime_release.ts` and
 * by `yolo runtime ...` of the standalone CLI.
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { hostTarget, runtimeHome, verifyArtifact } from "./artifact";

function targetDir(): string {
  return join(runtimeHome(), hostTarget());
}

function point(dir: string, name: "current" | "previous", to: string | undefined): void {
  const link = join(dir, name);
  if (existsSync(link) || isLink(link)) rmSync(link, { force: true });
  if (to === undefined) return;
  const tmp = `${link}.tmp`;
  rmSync(tmp, { force: true });
  symlinkSync(to, tmp, "dir");
  renameSync(tmp, link); // atomic replacement
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function read(dir: string, name: "current" | "previous"): string | undefined {
  const link = join(dir, name);
  return isLink(link) ? readlinkSync(link) : undefined;
}

export function install(source: string): string {
  const manifest = verifyArtifact(source);
  const lib = Object.entries(manifest.files).find(([f]) => /\.(so|dylib|dll)$/.test(f));
  const hash8 = (lib?.[1].sha256 ?? "unknown").slice(0, 8);
  const name = `${manifest.version}-${hash8}`;
  const dir = targetDir();
  mkdirSync(dir, { recursive: true });
  const destination = join(dir, name);
  if (!existsSync(destination)) {
    const staging = `${destination}.staging`;
    rmSync(staging, { recursive: true, force: true });
    cpSync(source, staging, { recursive: true });
    verifyArtifact(staging); // never activate a copy that does not verify
    renameSync(staging, destination);
  }
  const current = read(dir, "current");
  if (current !== name) {
    point(dir, "previous", current);
    point(dir, "current", name);
  }
  return name;
}

export function rollback(): { current: string; previous: string | undefined } {
  const dir = targetDir();
  const previous = read(dir, "previous");
  const current = read(dir, "current");
  if (previous === undefined) throw new Error("Nothing to roll back to: no previous artifact");
  verifyArtifact(join(dir, previous));
  point(dir, "previous", current);
  point(dir, "current", previous);
  return { current: previous, previous: current };
}

export function list(): { name: string; current: boolean; previous: boolean }[] {
  const dir = targetDir();
  if (!existsSync(dir)) return [];
  const current = read(dir, "current");
  const previous = read(dir, "previous");
  return readdirSync(dir)
    .filter((entry) => entry !== "current" && entry !== "previous" && !entry.endsWith(".tmp"))
    .toSorted()
    .map((name) => ({ name, current: name === current, previous: name === previous }));
}
