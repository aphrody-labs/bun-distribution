// SPDX-License-Identifier: MIT
// Offline Ubuntu archive index: InRelease checksums, Packages and Contents-<arch>.
// Reference: https://wiki.debian.org/DebianRepository/Format
import type { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runProcess } from "@aphrody/bun-workspace/process";
import { deb822 } from "./deb822.ts";
import { decodedFile, download, lines } from "./remote.ts";

export interface UbuntuSource {
  mirror: string;
  series: string;
  suites: string[];
  components: string[];
  architectures: string[];
}

export const UBUNTU_KEYRING = "/usr/share/keyrings/ubuntu-archive-keyring.gpg";

/** VERSION_CODENAME of the running Ubuntu host, when this host is the target. */
export async function hostSeries(): Promise<string | undefined> {
  const file = Bun.file("/etc/os-release");
  if (process.platform !== "linux" || !(await file.exists())) return undefined;
  const fields = Object.fromEntries(
    (await file.text())
      .split("\n")
      .map((line) => /^([A-Z_]+)=(.*)$/.exec(line))
      .filter((match): match is RegExpExecArray => !!match)
      .map((match) => [match[1]!, match[2]!.replace(/^"|"$/g, "")]),
  );
  return fields.ID === "ubuntu" ? fields.VERSION_CODENAME : undefined;
}

/** Fold the merged-/usr aliases so /bin/x and /usr/bin/x are one path. */
export function usrMerged(path: string): string {
  const clean = path.replace(/^\.?\//, "");
  return /^(bin|sbin|lib|lib32|lib64|libx32)(\/|$)/.test(clean)
    ? `usr/${clean}`
    : clean;
}

const LIBRARY =
  /^(?:usr\/)?(lib\/x86_64-linux-gnu|lib\/i386-linux-gnu|lib64|lib32|lib)\/([^/]+\.so(?:\.[0-9][^/]*)?)$/;

interface IndexDigest {
  algorithm: "sha512" | "sha256";
  digest: string;
  size: number;
}

/** Strongest checksum list of a Release file (26.10 publishes SHA512 only). */
function releaseHashes(text: string): Map<string, IndexDigest> {
  const hashes = new Map<string, IndexDigest>();
  const stanza = deb822(new TextEncoder().encode(text))[0];
  for (const [algorithm, digits] of [
    ["sha256", 64],
    ["sha512", 128],
  ] as const)
    for (const line of (stanza?.[algorithm]?.[0] ?? "").split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (
        parts.length === 3 &&
        new RegExp(`^[a-f0-9]{${digits}}$`).test(parts[0]!)
      )
        hashes.set(parts[2]!, {
          algorithm,
          digest: parts[0]!,
          size: Number(parts[1]),
        });
    }
  return hashes;
}

const packageNames = (location: string) =>
  [
    ...new Set(
      location
        .split(",")
        .map((item) => item.slice(item.lastIndexOf("/") + 1).trim())
        .filter(Boolean),
    ),
  ].join(",");

export interface UbuntuSync {
  suite: string;
  signature: string;
  packages: number;
  files: number;
  libraries: number;
}

export async function syncUbuntu(
  db: Database,
  source: UbuntuSource,
  state: string,
  log: (line: string) => void,
): Promise<UbuntuSync[]> {
  const results: UbuntuSync[] = [];
  const directory = join(state, "ubuntu");
  await mkdir(directory, { recursive: true });
  db.exec(
    `DELETE FROM ubuntu_release; DELETE FROM ubuntu_pkg; DELETE FROM ubuntu_provide; DELETE FROM ubuntu_file; DELETE FROM ubuntu_lib;`,
  );
  const insertPackage = db.prepare(
    `INSERT INTO ubuntu_pkg VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(name, arch) DO UPDATE SET version = excluded.version, suite = excluded.suite,
       component = excluded.component, section = excluded.section, multiarch = excluded.multiarch,
       essential = excluded.essential`,
  );
  const insertProvide = db.prepare(`INSERT INTO ubuntu_provide VALUES (?,?,?)`);
  const insertFile = db.prepare(
    `INSERT INTO ubuntu_file VALUES (?,?) ON CONFLICT(path) DO UPDATE SET packages = packages || ',' || excluded.packages`,
  );
  const insertLibrary = db.prepare(`INSERT INTO ubuntu_lib VALUES (?,?,?,?,?)`);
  for (const suite of source.suites) {
    const release = join(directory, `${suite}_InRelease`);
    const fetched = await download(
      [`${source.mirror}/dists/${suite}/InRelease`],
      release,
      { maxBytes: 64 << 20, timeoutMs: 120_000 },
    );
    let signature = "unverified";
    if (
      process.platform === "linux" &&
      Bun.which("gpgv") &&
      (await Bun.file(UBUNTU_KEYRING).exists())
    ) {
      const result = await runProcess(
        ["gpgv", "--keyring", UBUNTU_KEYRING, release],
        directory,
        { timeoutMs: 60_000, maxOutputBytes: 1 << 20 },
      );
      if (result.code !== 0)
        throw new Error(`${suite}/InRelease signature verification failed`);
      signature = "gpgv:ubuntu-archive-keyring";
    }
    const hashes = releaseHashes(await Bun.file(release).text());
    const summary: UbuntuSync = {
      suite,
      signature,
      packages: 0,
      files: 0,
      libraries: 0,
    };
    const fetchIndex = async (path: string) => {
      const expected = hashes.get(path);
      if (!expected) return undefined;
      const local = join(directory, `${suite}_${path.replaceAll("/", "_")}`);
      if (
        (await Bun.file(local).exists()) &&
        Bun.file(local).size === expected.size &&
        new Bun.CryptoHasher(expected.algorithm)
          .update(await Bun.file(local).arrayBuffer())
          .digest("hex") === expected.digest
      )
        return local;
      await download([`${source.mirror}/dists/${suite}/${path}`], local, {
        maxBytes: 2 ** 30,
        timeoutMs: 1_800_000,
        [expected.algorithm]: expected.digest,
        size: expected.size,
      });
      return local;
    };
    for (const architecture of source.architectures)
      for (const component of source.components) {
        const local = await fetchIndex(
          `${component}/binary-${architecture}/Packages.gz`,
        );
        if (!local) continue;
        let stanza: Record<string, string> = Object.create(null);
        let last = "";
        const flush = () => {
          const name = stanza.package;
          if (name && stanza.version) {
            insertPackage.run(
              name,
              stanza.architecture ?? architecture,
              stanza.version,
              suite,
              component,
              stanza.section ?? null,
              stanza["multi-arch"] ?? null,
              stanza.essential === "yes" ? 1 : 0,
            );
            summary.packages++;
            for (const provide of (stanza.provides ?? "").split(",")) {
              const virtual = provide.trim().split(/[\s(:]/, 1)[0];
              if (virtual)
                insertProvide.run(
                  virtual,
                  name,
                  stanza.architecture ?? architecture,
                );
            }
          }
          stanza = Object.create(null);
        };
        db.exec("BEGIN");
        try {
          for await (const line of lines(
            await decodedFile(local),
            2 * 2 ** 30,
          )) {
            if (!line) flush();
            else if (/^\s/.test(line)) {
              if (last === "provides") stanza.provides += line;
            } else {
              const colon = line.indexOf(":");
              last = line.slice(0, colon).toLowerCase();
              stanza[last] = line.slice(colon + 1).trim();
            }
          }
          flush();
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        log(`ubuntu ${suite} ${component}/${architecture}: Packages indexed`);
      }
    for (const architecture of source.architectures) {
      const local = await fetchIndex(`Contents-${architecture}.gz`);
      if (!local) continue;
      db.exec("BEGIN");
      try {
        for await (const line of lines(
          await decodedFile(local),
          16 * 2 ** 30,
        )) {
          const match = /^(.*?)\s+(\S+)$/.exec(line);
          if (!match) continue;
          const path = usrMerged(match[1]!);
          const owners = packageNames(match[2]!);
          if (architecture === "amd64") {
            insertFile.run(path, owners);
            summary.files++;
          }
          const library = path.startsWith("usr/")
            ? LIBRARY.exec(path.slice(4))
            : null;
          if (!library) continue;
          const dir =
            library[1] === "lib/x86_64-linux-gnu" ||
            library[1] === "lib/i386-linux-gnu"
              ? "multiarch"
              : library[1]!;
          if (
            (architecture === "i386") !==
            (library[1] === "lib/i386-linux-gnu")
          )
            continue;
          insertLibrary.run(library[2]!, architecture, dir, path, owners);
          summary.libraries++;
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      log(`ubuntu ${suite} Contents-${architecture}: ${summary.files} paths`);
    }
    db.prepare(`INSERT OR REPLACE INTO ubuntu_release VALUES (?,?,?,?,?)`).run(
      suite,
      source.mirror,
      fetched.sha256,
      signature,
      new Date().toISOString(),
    );
    results.push(summary);
  }
  return results;
}

export interface LibraryOwner {
  /** Debian dependency atom, with :i386 for foreign-architecture owners. */
  package: string;
  path: string;
  dir: string;
}

export class UbuntuIndex {
  constructor(readonly db: Database) {}

  series(): string[] {
    return (
      this.db.prepare(`SELECT suite FROM ubuntu_release`).all() as Array<{
        suite: string;
      }>
    ).map((row) => row.suite);
  }

  /** Real package for amd64/all (or i386 with a :i386 suffix). */
  has(name: string): boolean {
    const [bare, qualifier] = name.split(":");
    const arches = qualifier === "i386" ? ["i386", "all"] : ["amd64", "all"];
    return !!this.db
      .prepare(`SELECT 1 FROM ubuntu_pkg WHERE name = ? AND arch IN (?, ?)`)
      .get(bare!, arches[0]!, arches[1]!);
  }

  version(name: string): string | undefined {
    const row = this.db
      .prepare(
        `SELECT version FROM ubuntu_pkg WHERE name = ? AND arch IN ('amd64','all')`,
      )
      .get(name) as { version: string } | null;
    return row?.version;
  }

  virtualProviders(name: string): string[] {
    return (
      this.db
        .prepare(
          `SELECT DISTINCT name FROM ubuntu_provide WHERE provide = ? AND arch IN ('amd64','all') ORDER BY name`,
        )
        .all(name) as Array<{ name: string }>
    ).map((row) => row.name);
  }

  owners(path: string): string[] {
    const row = this.db
      .prepare(`SELECT packages FROM ubuntu_file WHERE path = ?`)
      .get(usrMerged(path)) as { packages: string } | null;
    return row ? [...new Set(row.packages.split(","))] : [];
  }

  libraryOwners(soname: string, bits: 32 | 64): LibraryOwner[] {
    const rows = this.db
      .prepare(
        `SELECT arch, dir, path, packages FROM ubuntu_lib WHERE soname = ?`,
      )
      .all(soname) as Array<{
      arch: string;
      dir: string;
      path: string;
      packages: string;
    }>;
    const owners: LibraryOwner[] = [];
    // Native multiarch first, then the classic directories that ld.so also searches.
    const rank = (dir: string, arch: string) =>
      bits === 64
        ? arch === "amd64"
          ? { multiarch: 0, lib: 1, lib64: 2 }[dir]
          : undefined
        : arch === "amd64"
          ? dir === "lib32"
            ? 0
            : undefined
          : dir === "multiarch"
            ? 1
            : undefined;
    for (const row of rows
      .filter((row) => rank(row.dir, row.arch) !== undefined)
      .sort((a, b) => rank(a.dir, a.arch)! - rank(b.dir, b.arch)!))
      for (const name of row.packages.split(",")) {
        const atom = row.arch === "i386" ? `${name}:i386` : name;
        if (!owners.some((owner) => owner.package === atom))
          owners.push({ package: atom, path: row.path, dir: row.dir });
      }
    return owners;
  }

  /** Owners of `usr/bin/<name>` style executables across bin and sbin. */
  executableOwners(name: string): string[] {
    return [
      ...new Set([
        ...this.owners(`usr/bin/${name}`),
        ...this.owners(`usr/sbin/${name}`),
        ...this.owners(`usr/games/${name}`),
      ]),
    ];
  }
}
