#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- sequential staging */
/**
 * Build the one-click Windows installer of packages/infra/product locally. Nothing is uploaded or published.
 *
 *   bun scripts/release/stage-setup.ts [--out <dir>] [--smoke] [--compile-executable-path <Windows x64 Bun>]
 *
 * Writes into `<out>` (default packages/infra/product/dist, ignored by Git):
 *   aphrody-setup-<version>-<commit9>-x86_64-pc-windows-msvc.exe     the download (« Download Aphrody », kind `desktop`)
 *   aphrody-setup-<version>-<commit9>-x86_64-pc-windows-msvc.tar.gz  flat update archive (kind `update`) read by its updater
 *   SHA256SUMS and aphrody-setup.manifest.json (the entries scripts/release/publish-downloads.ts publishes).
 * The exe is compiled with Bun, branded with the pet icon by the shared rcedit-under-Wine helper and NOT signed: the
 * repository has no signing key. Native Windows x64 uses the running Bun; other build hosts may supply a qualified
 * Windows x64 Bun with `--compile-executable-path`. `--smoke` runs natively on Windows and under Wine elsewhere.
 */
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { scanPack, sha256File } from "./publish-creator.ts";
import { brandExe } from "./windows-exe.ts";

const repo = resolve(import.meta.dir, "../../../docs/aphrody");
const appDir = join(repo, "packages/infra/product");
const EXE = "Aphrody-Setup.exe";
const TARGET = "x86_64-pc-windows-msvc";
const ICON = join(repo, "crates/ui/identity/assets/brand/favicon.ico");

export interface StagedEntry {
  name: string;
  version: string;
  platform: string;
  target: string;
  kind: string;
  file: string;
  size: number;
  sha256: string;
}

async function run(
  argv: string[],
  cwd = repo,
  env: Record<string, string> = {},
): Promise<string> {
  const proc = Bun.spawn(argv, {
    windowsHide: true,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, WINEDEBUG: "-all", ...env },
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0)
    throw new Error(
      `${argv.slice(0, 4).join(" ")} failed (${code}):\n${err || out}`,
    );
  return out;
}

/** Published file names, in the downloads naming (`<component>-<version>-<commit9>-<target>.<ext>`). */
export const setupFiles = (version: string, commit: string) => ({
  exe: `aphrody-setup-${version}-${commit}-${TARGET}.exe`,
  update: `aphrody-setup-${version}-${commit}-${TARGET}.tar.gz`,
});

export function setupCompileCommand(
  outfile: string,
  options: {
    executable?: string;
    platform?: NodeJS.Platform;
    arch?: string;
    targetExecutable?: string;
  } = {},
): string[] {
  const argv = [options.executable ?? process.execPath, "build", "--compile"];
  if (
    (options.platform ?? process.platform) !== "win32" ||
    (options.arch ?? process.arch) !== "x64"
  )
    argv.push("--target=bun-windows-x64");
  if (options.targetExecutable)
    argv.push("--compile-executable-path", resolve(options.targetExecutable));
  return [...argv, "src/cli.ts", "--outfile", outfile];
}

export async function stageSetup(
  out: string,
  smoke: boolean,
  targetExecutable?: string,
): Promise<StagedEntry[]> {
  const { version } = JSON.parse(
    await readFile(join(appDir, "package.json"), "utf8"),
  ) as {
    version: string;
  };
  const commit = (await run(["git", "rev-parse", "--short=9", "HEAD"])).trim();
  const names = setupFiles(version, commit);
  const work = await mkdtemp(join(tmpdir(), "aphrody-setup-"));
  try {
    const pack = join(work, "pack");
    await mkdir(pack, { recursive: true });
    await run(
      setupCompileCommand(join(pack, EXE), { targetExecutable }),
      appDir,
    );
    await brandExe(join(pack, EXE), {
      icon: ICON,
      version: `${version}.0`,
      strings: {
        ProductName: "Aphrody",
        FileDescription: "Aphrody - installation",
        CompanyName: "Aphrody",
        LegalCopyright: "Apache-2.0",
        OriginalFilename: EXE,
        InternalName: "aphrody-setup",
      },
    });
    await scanPack(pack);
    if (smoke) {
      const runner = process.platform === "win32" ? [] : ["wine"];
      const env = {
        WINEPREFIX: join(process.env.HOME ?? "", ".cache/creator-kit/wine"),
        APHRODY_SETUP_NO_UPDATE: "1",
      };
      const printed = await run(
        [...runner, join(pack, EXE), "--version"],
        repo,
        env,
      );
      if (!printed.includes(version))
        throw new Error(`smoke: --version printed ${JSON.stringify(printed)}`);
      await run([...runner, join(pack, EXE), "--oui", "--simuler"], repo, env);
      for (const role of ["admin", "creator"]) {
        const roleVersion = await run(
          [...runner, join(pack, EXE), role, "--version"],
          repo,
          env,
        );
        if (!roleVersion.includes(version))
          throw new Error(`${role}: product version mismatch`);
        await run([...runner, join(pack, EXE), role, "--help"], repo, env);
        const events = await run(
          [...runner, join(pack, EXE), role, "desktop", "catalog"],
          repo,
          env,
        );
        const catalog = events
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => JSON.parse(line));
        if (
          !catalog.some((event) => event.catalog?.protocol === "aphrody.kit/1")
        )
          throw new Error(`${role}: desktop protocol missing`);
      }
      await run(
        [
          ...runner,
          join(pack, EXE),
          "--oui",
          "--roles",
          "admin,createur",
          "--simuler",
        ],
        repo,
        env,
      );
      console.log(
        "smoke ok (version, installation simulation, both role CLIs and desktop catalogs)",
      );
    }
    await mkdir(out, { recursive: true });
    await copyFile(join(pack, EXE), join(out, names.exe));
    await run(["tar", "-czf", join(out, names.update), "-C", pack, EXE]);
    const entries: StagedEntry[] = [];
    for (const [file, kind] of [
      [names.exe, "desktop"],
      [names.update, "update"],
    ] as const) {
      entries.push({
        name: "aphrody-setup",
        version,
        platform: "windows-x86_64",
        target: TARGET,
        kind,
        file,
        size: (await stat(join(out, file))).size,
        sha256: await sha256File(join(out, file)),
      });
    }
    await writeFile(
      join(out, "SHA256SUMS"),
      `${entries.map((e) => `${e.sha256}  ${e.file}`).join("\n")}\n`,
    );
    await writeFile(
      join(out, "aphrody-setup.manifest.json"),
      `${JSON.stringify(entries, null, 2)}\n`,
    );
    for (const e of entries) console.log(`${e.file}  ${e.size} B  ${e.sha256}`);
    return entries;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const at = args.indexOf("--out");
  const targetAt = args.indexOf("--compile-executable-path");
  if (
    targetAt >= 0 &&
    (!args[targetAt + 1] || args[targetAt + 1]?.startsWith("--"))
  )
    throw new Error(
      "--compile-executable-path requires a qualified Windows x64 Bun executable",
    );
  await stageSetup(
    resolve(at >= 0 ? (args[at + 1] ?? "") : join(appDir, "dist")),
    args.includes("--smoke"),
    targetAt >= 0 ? resolve(args[targetAt + 1]!) : undefined,
  );
}
