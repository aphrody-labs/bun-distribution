#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- sequential staging */
/**
 * Build the Windows pack of apps/community/omar-kit locally. Nothing is uploaded or published.
 *
 *   bun scripts/release/stage-omar-kit.ts [--out <dir>] [--smoke]
 *
 * Writes `<out>/Aphrody-Omar-<version>-windows-x64.zip` (the folder Omar unzips: exe, Guide.html, LISEZ-MOI.txt),
 * `<out>/omar-kit-<version>-<commit9>-x86_64-pc-windows-msvc.tar.gz` (flat update archive, downloads naming), SHA256SUMS and
 * `omar-kit.manifest.json` (the artifact entries the downloads publisher would list). The exe is compiled with Bun, branded
 * by the shared rcedit-under-Wine helper (icon, version, product) and NOT signed: the repository has no signing key.
 * `--smoke` runs `--version` and a local check of the exe under Wine.
 */
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { scanPack, sha256File } from "./publish-creator.ts";
import { brandExe } from "./windows-exe.ts";

const repo = resolve(import.meta.dir, "../..");
const appDir = join(repo, "apps/community/omar-kit");
const EXE = "Aphrody-Omar.exe";
const TARGET = "x86_64-pc-windows-msvc";

async function run(argv: string[], cwd = repo): Promise<string> {
  const proc = Bun.spawn(argv, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, WINEDEBUG: "-all" },
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${argv.slice(0, 4).join(" ")} failed (${code}):\n${err || out}`);
  return out;
}

const CSS = `body{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1b1b1f}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #d9d9e0;padding:.4rem .6rem;text-align:left;vertical-align:top}
code{background:#f2f2f6;padding:0 .25rem;border-radius:4px}@media (prefers-color-scheme:dark){body{background:#121214;color:#e6e6ea}td,th{border-color:#2c2c33}code{background:#1d1d22}}`;

/** docs/operations/omar-guide.md as one standalone page (what the menu's « Ouvrir le guide » shows). */
export function guideHtml(markdown: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aphrody : le guide d'Omar</title><style>${CSS}</style></head><body>${Bun.markdown.html(markdown)}</body></html>\n`;
}

async function stage(out: string, smoke: boolean): Promise<void> {
  const pkg = JSON.parse(await readFile(join(appDir, "package.json"), "utf8")) as {
    version: string;
  };
  const version = pkg.version;
  const commit = (await run(["git", "rev-parse", "--short=9", "HEAD"])).trim();
  const work = await mkdtemp(join(tmpdir(), "omar-kit-"));
  try {
    const pack = join(work, "pack");
    await mkdir(pack, { recursive: true });
    await run(
      [
        "bun",
        "build",
        "--compile",
        "--target=bun-windows-x64-baseline",
        "src/cli.ts",
        "--outfile",
        join(pack, EXE),
      ],
      appDir,
    );
    await brandExe(join(pack, EXE), {
      icon: join(appDir, "assets/aphrody-omar.ico"),
      version: `${version}.0`,
      strings: {
        ProductName: "Aphrody Omar",
        FileDescription: "Aphrody - kit administrateur",
        CompanyName: "Aphrody",
        LegalCopyright: "Apache-2.0",
        OriginalFilename: EXE,
        InternalName: "aphrody-omar",
      },
    });
    await writeFile(
      join(pack, "Guide.html"),
      guideHtml(await readFile(join(repo, "docs/operations/omar-guide.md"), "utf8")),
    );
    await writeFile(
      join(pack, "LISEZ-MOI.txt"),
      'Aphrody Omar\r\n\r\nDouble-clique sur Aphrody-Omar.exe, puis suis le menu (ouvre Guide.html pour le mode d\'emploi).\r\nSi Windows affiche "Windows a protege votre ordinateur" : Informations complementaires, puis Executer quand meme.\r\n',
    );
    await scanPack(pack);
    if (smoke) {
      const runner = process.platform === "win32" ? [] : ["wine"];
      const env = {
        ...process.env,
        WINEDEBUG: "-all",
        WINEPREFIX: join(process.env.HOME ?? "", ".cache/creator-kit/wine"),
        APHRODY_OMAR_NO_UPDATE: "1",
      };
      const version1 = Bun.spawnSync([...runner, join(pack, EXE), "--version"], { env });
      if (!version1.stdout.toString().includes(version))
        throw new Error(`smoke: --version printed ${JSON.stringify(version1.stdout.toString())}`);
      const check = Bun.spawnSync([...runner, join(pack, EXE), "verifier", "--local", "--json"], {
        env,
      });
      if (!check.stdout.toString().includes('"verdict"'))
        throw new Error(
          `smoke: verifier printed ${JSON.stringify(check.stdout.toString().slice(0, 200))}`,
        );
      console.log("smoke ok (exe starts, prints its version and the French check)");
    }
    await mkdir(out, { recursive: true });
    const zip = `Aphrody-Omar-${version}-windows-x64.zip`;
    const wrap = join(work, "wrap");
    await mkdir(wrap);
    await cp(pack, join(wrap, "Aphrody-Omar"), { recursive: true });
    await rm(join(out, zip), { force: true });
    await run(["zip", "-q", "-r", "-X", join(out, zip), "Aphrody-Omar"], wrap);
    const update = `omar-kit-${version}-${commit}-${TARGET}.tar.gz`;
    await run(["tar", "-czf", join(out, update), "-C", pack, ...(await readdir(pack)).toSorted()]);
    const files = [zip, update];
    const entries = [];
    for (const file of files) {
      entries.push({
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
      join(out, "omar-kit.manifest.json"),
      `${JSON.stringify(
        entries.map((e) => ({
          name: "omar-kit",
          version,
          platform: "windows-x86_64",
          target: TARGET,
          kind: "kit",
          file: e.file,
          size: e.size,
          sha256: e.sha256,
        })),
        null,
        2,
      )}\n`,
    );
    for (const e of entries) console.log(`${e.file}  ${e.size} B  ${e.sha256}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const at = args.indexOf("--out");
  await stage(
    resolve(at >= 0 ? (args[at + 1] ?? "") : join(appDir, "dist")),
    args.includes("--smoke"),
  );
}
