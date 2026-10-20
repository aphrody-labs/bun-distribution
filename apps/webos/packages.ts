// SPDX-License-Identifier: Apache-2.0
// Assembles the installable app packages of the Bun OS web distribution into dist/apps/<id>/ and writes
// dist/registry.json. Every package lists its files with sha256 so the client verifies each download.
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { verifyQualification } from "../../packages/bun-engine/web-emulation/qualification.ts";

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
  licenseNotices?: {
    status: "partial";
    manifest: string;
    missingOwners: string[];
  };
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

async function finalize(
  dist: string,
  meta: Omit<PackageManifest, "files" | "size" | "entry"> & { entry?: string },
) {
  const dir = join(dist, "apps", meta.id);
  const files: PackageManifest["files"] = [];
  for (const file of (await walk(dir)).sort()) {
    const rel = relative(dir, file).replaceAll("\\", "/");
    if (rel === "app.json") continue;
    files.push({
      path: rel,
      sha256: await sha256(file),
      bytes: (await stat(file)).size,
    });
  }
  const manifest: PackageManifest = {
    ...meta,
    version: `${meta.version}${meta.version.includes("+") ? "." : "+"}web.${new Bun.CryptoHasher("sha256").update(JSON.stringify(files)).digest("hex").slice(0, 12)}`,
    entry: meta.entry ?? "index.html",
    files,
    size: files.reduce((n, f) => n + f.bytes, 0),
  };
  await Bun.write(join(dir, "app.json"), JSON.stringify(manifest));
  return manifest;
}

/** Copy actual upstream text; a registry's license label is never substituted for a notice. */
async function emulatorNotices(
  dest: string,
  core: string,
  fixtures: { path: string; source: string; license: string }[],
) {
  const lock = await Bun.file(
    join(root, "packages/bun-engine/web-emulation/web-emulation.lock.json"),
  ).json();
  const sourceKeys: Record<string, string> = {
    "zakuro-3ds": "zakuro",
    "tetanes-nes": "tetanes",
    "rustboyadvance-gba": "rustboyadvance-ng",
    "starpsx-psx": "starpsx",
  };
  const owners: {
    id: string;
    directory?: string;
    explicit?: string[];
    source?: string;
    release?: string;
    commit?: string;
    license?: string;
  }[] = [
    {
      id: "bun-engine",
      directory: "crates/bun-engine-core",
      source: "https://github.com/aphrody-labs/bun-engine",
    },
  ];
  if (core === "dust-nds")
    owners.push({
      id: "dust",
      explicit: ["docs/licenses/iecode/licenses/dust/LICENSE"],
      source: "crates/aphrody-dust-core/Cargo.toml",
    });
  else {
    const key = sourceKeys[core] ?? core;
    const pin = lock.sources[key];
    owners.push({
      id: key,
      directory: pin?.path,
      source: pin?.url,
      commit: pin?.commit,
    });
  }
  for (const fixture of fixtures) {
    // Resolve only an actual existing source checkout. A binary release cache has no license text.
    const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/|$)/.exec(
      fixture.source,
    );
    const repository = match
      ? `https://github.com/${match[1]}/${match[2]}`
      : undefined;
    const ownerID = fixture.path
      .split("/")
      .slice(0, 2)
      .join("-")
      .replace(/[^a-zA-Z0-9_-]/g, "-");
    const godmode = fixture.path.startsWith("fixtures/godmode9i/");
    owners.push({
      id: ownerID,
      directory: godmode
        ? undefined
        : match
          ? `vendor/${match[2].toLowerCase()}`
          : undefined,
      explicit: godmode
        ? ["packages/bun-engine/web-emulation/notices/godmode9i/LICENSE"]
        : undefined,
      source: godmode
        ? "https://raw.githubusercontent.com/DS-Homebrew/GodMode9i/v3.10.0/LICENSE"
        : (repository ?? fixture.source),
      release: fixture.source,
      license: fixture.license,
    });
  }
  const records = [];
  const missingOwners: string[] = [];
  for (const owner of owners) {
    const paths = new Set<string>(owner.explicit ?? []);
    if (owner.directory) {
      const directory = join(root, owner.directory);
      const available = await stat(directory)
        .then((s) => s.isDirectory())
        .catch((error: any) => {
          if (error.code === "ENOENT") return false;
          throw error;
        });
      // Includes nested third-party notices retained by the available source owner.
      if (available) {
        for await (const file of new Bun.Glob(
          "**/{LICENSE,LICENSE.*,LICENSE-*,COPYING,COPYING.*,NOTICE,NOTICE.*,license.txt}",
        ).scan({ cwd: directory, onlyFiles: true, followSymlinks: false })) {
          if (
            !file
              .split(/[\\/]/)
              .some((part) =>
                ["node_modules", "target", ".git", "build"].includes(part),
              )
          )
            paths.add(`${owner.directory}/${file.replaceAll("\\", "/")}`);
        }
      }
    }
    const notices = [];
    for (const path of [...paths].sort()) {
      if (!(await Bun.file(join(root, path)).exists())) continue;
      const target = `licenses/${owner.id}/${path}`;
      await Bun.write(join(dest, target), Bun.file(join(root, path)));
      notices.push({
        path: target,
        sourcePath: path,
        sha256: await sha256(join(root, path)),
      });
    }
    if (!notices.length) missingOwners.push(owner.id);
    records.push({
      ...owner,
      notices,
      status: notices.length
        ? "source-notices-copied"
        : "missing-source-notices",
    });
  }
  await Bun.write(
    join(dest, "LICENSES.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        status: "partial",
        scope:
          "Exact notices found in available primary source owners. Transitive dependency license coverage and corresponding-source delivery are not established by this manifest.",
        missingOwners,
        owners: records,
      },
      null,
      2,
    ),
  );
  if (missingOwners.length)
    console.warn(
      `${core}: missing upstream license texts: ${missingOwners.join(", ")}`,
    );
  return {
    status: "partial" as const,
    manifest: "LICENSES.json",
    missingOwners,
  };
}

/** Browser emulators built by packages/bun-engine/web-emulation into dist/web-emulation. */
async function emulators(dist: string): Promise<PackageManifest[]> {
  const out: PackageManifest[] = [];
  const src = join(root, "dist/web-emulation");
  const player = await Bun.file(join(import.meta.dir, "player.html")).text();
  const rejected: { core: string; reason: string }[] = [];
  const entries = await readdir(src, { withFileTypes: true }).catch(
    (error: any) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (
      !entry.isDirectory() ||
      !(await Bun.file(join(src, entry.name, "manifest.json")).exists())
    )
      continue;
    const core = entry.name;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(core))
      throw new Error(`Unsafe emulator core: ${core}`);
    const id = `game-${core}`;
    const dest = join(dist, "apps", id);
    // A rejected rebuild must not leave an old installable package behind.
    await rm(dest, { recursive: true, force: true });
    let receipt;
    try {
      receipt = await verifyQualification(src, core, { root });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      rejected.push({ core, reason });
      console.warn(`reject ${id}: ${reason}`);
      continue;
    }
    const manifest = await Bun.file(join(src, core, "manifest.json")).json();
    if (typeof manifest.license !== "string" || !manifest.license.trim())
      throw new Error(`${core}: core license metadata is missing`);
    await mkdir(dest, { recursive: true });
    for (const path of Object.keys(receipt.files)) {
      const copied = join(dest, "payload", path);
      await Bun.write(copied, Bun.file(join(src, path)));
      if ((await sha256(copied)) !== receipt.files[path])
        throw new Error(
          `${core}: packaged qualification input changed: ${path}`,
        );
    }
    // The loader registry must be included verbatim among the qualified files.
    const firmwareIDs = manifest.firmware ?? [];
    if (firmwareIDs.length) {
      const registry = await Bun.file(
        join(src, "firmware/firmware.json"),
      ).json();
      if (!receipt.files["firmware/firmware.json"])
        throw new Error(`${core}: firmware registry was not qualified`);
      for (const firmwareID of firmwareIDs) {
        const pin = registry.firmware[firmwareID];
        if (
          !pin ||
          !receipt.fixtures.some(
            (f) => f.path === `firmware/${pin.file}` && f.sha256 === pin.sha256,
          )
        )
          throw new Error(`${core}: missing qualified firmware ${firmwareID}`);
      }
    }
    await Bun.write(join(dest, "qualification.json"), JSON.stringify(receipt));
    const licenseNotices = await emulatorNotices(dest, core, receipt.fixtures);
    await Bun.write(
      join(dest, "emulator.json"),
      JSON.stringify({
        core,
        variant: receipt.variant,
        manifest: `payload/${core}/manifest.json`,
        qualification: "qualification.json",
        fixtures: receipt.fixtures,
        qualificationHarnessRevision: receipt.sourceRevision,
      }),
    );
    await Bun.write(
      join(dest, "PROVENANCE.json"),
      JSON.stringify(
        {
          core: {
            id: core,
            license: manifest.license,
            build: manifest.build ?? null,
          },
          qualificationHarnessRevision: receipt.sourceRevision,
          fixtures: receipt.fixtures,
          note: "License descriptions and source URLs are retained from the canonical registries; this metadata does not replace upstream license notices.",
        },
        null,
        2,
      ),
    );
    await Bun.write(join(dest, "index.html"), player);
    out.push(
      await finalize(dist, {
        id,
        name: manifest.name ?? core,
        version: manifest.version ?? "0.0.0",
        category: "games",
        description:
          "Qualified browser emulator with bundled open-source test content.",
        license: manifest.license,
        glyph: (manifest.systems?.[0] ?? core).toUpperCase().slice(0, 4),
        threads:
          (receipt.variant === "threads"
            ? manifest.variants?.threads
            : manifest
          )?.threads === true,
        licenseNotices,
      }),
    );
  }
  await Bun.write(
    join(dist, "emulation-rejections.json"),
    JSON.stringify({ schemaVersion: 1, rejected }, null, 2),
  );
  return out;
}

export async function buildPackages(dist: string): Promise<PackageManifest[]> {
  const packages = [...(await emulators(dist)), ...(await craftApps(dist))];
  const registry = {
    schemaVersion: 1,
    generated: new Date().toISOString(),
    packages: packages.map(({ files: _files, ...p }) => ({
      ...p,
      manifest: `/apps/${p.id}/app.json`,
    })),
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
