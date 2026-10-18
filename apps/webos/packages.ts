// SPDX-License-Identifier: Apache-2.0
// Assembles the installable app packages of the Bun OS web distribution into dist/apps/<id>/ and writes
// dist/registry.json. Every package lists its files with sha256 so the client verifies each download.
import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");

export interface PackageManifest {
  id: string;
  name: string;
  version: string;
  category: "games" | "create" | "tools";
  description: string;
  license: string;
  entry: string;
  /** Short monogram shown when the package has no icon of its own. */
  glyph: string;
  /** Needs cross-origin isolation (threads); the site always serves it. */
  threads?: boolean;
  size: number;
  files: { path: string; sha256: string; bytes: number }[];
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

async function sha256(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

async function finalize(dist: string, meta: Omit<PackageManifest, "files" | "size" | "entry"> & { entry?: string }) {
  const dir = join(dist, "apps", meta.id);
  const files: PackageManifest["files"] = [];
  for (const file of (await walk(dir)).sort()) {
    const rel = relative(dir, file).replaceAll("\\", "/");
    if (rel === "app.json") continue;
    files.push({ path: rel, sha256: await sha256(file), bytes: (await stat(file)).size });
  }
  const manifest: PackageManifest = {
    ...meta,
    entry: meta.entry ?? "index.html",
    files,
    size: files.reduce((n, f) => n + f.bytes, 0),
  };
  await Bun.write(join(dir, "app.json"), JSON.stringify(manifest));
  return manifest;
}

const EMULATORS = [
  {
    core: "dust-nds",
    id: "game-nds-dust",
    name: "Nintendo DS (Dust)",
    glyph: "DS",
    description: "Play Nintendo DS games you own. Runs fully in your browser with WebGPU; touch screen supported.",
  },
  {
    core: "melonds",
    id: "game-nds-melonds",
    name: "Nintendo DS (melonDS)",
    glyph: "mDS",
    description: "Second Nintendo DS engine with the full melonDS feature set. Uses several threads.",
    threads: true,
  },
] as const;

/** Browser emulators built by packages/bun-engine/web-emulation into dist/web-emulation. */
async function emulators(dist: string): Promise<PackageManifest[]> {
  const out: PackageManifest[] = [];
  const src = join(root, "dist/web-emulation");
  const player = await Bun.file(join(import.meta.dir, "player.html")).text();
  for (const e of EMULATORS) {
    const coreDir = join(src, e.core);
    if (!(await Bun.file(join(coreDir, "manifest.json")).exists())) {
      console.warn(`skip ${e.id}: ${coreDir} is not built`);
      continue;
    }
    const manifest = JSON.parse(await Bun.file(join(coreDir, "manifest.json")).text()) as {
      license?: string;
      version?: string;
    };
    const dest = join(dist, "apps", e.id);
    await mkdir(dest, { recursive: true });
    await cp(coreDir, join(dest, "core"), { recursive: true });
    await cp(join(src, "runtime"), join(dest, "runtime"), { recursive: true });
    await Bun.write(join(dest, "index.html"), player);
    out.push(
      await finalize(dist, {
        id: e.id,
        name: e.name,
        version: manifest.version ?? "0.0.0",
        category: "games",
        description: e.description,
        license: manifest.license ?? "GPL-3.0-or-later",
        glyph: e.glyph,
        threads: "threads" in e ? e.threads : undefined,
      }),
    );
  }
  return out;
}

export async function buildPackages(dist: string): Promise<PackageManifest[]> {
  const packages = [...(await emulators(dist)), ...(await craftApps(dist))];
  const registry = {
    schemaVersion: 1,
    generated: new Date().toISOString(),
    packages: packages.map(({ files: _files, ...p }) => ({ ...p, manifest: `/apps/${p.id}/app.json` })),
  };
  await Bun.write(join(dist, "registry.json"), JSON.stringify(registry));
  return packages;
}

// Craft web apps are compiled by build-craft.ts into out/craft/<id>/; they join the registry when present.
async function craftApps(dist: string): Promise<PackageManifest[]> {
  const out: PackageManifest[] = [];
  const src = join(import.meta.dir, "out/craft");
  if (!(await Bun.file(join(src, "index.json")).exists())) return out;
  const index = JSON.parse(await Bun.file(join(src, "index.json")).text()) as {
    id: string;
    name: string;
    glyph: string;
    description: string;
    version: string;
  }[];
  for (const app of index) {
    const dest = join(dist, "apps", `craft-${app.id}`);
    await mkdir(dest, { recursive: true });
    await cp(join(src, app.id), dest, { recursive: true });
    out.push(
      await finalize(dist, {
        id: `craft-${app.id}`,
        name: app.name,
        version: app.version,
        category: "create",
        description: app.description,
        license: "MIT OR Apache-2.0",
        glyph: app.glyph,
      }),
    );
  }
  return out;
}
