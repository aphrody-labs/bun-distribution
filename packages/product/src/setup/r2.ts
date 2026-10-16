// SPDX-License-Identifier: Apache-2.0
import { existsSync, statSync } from "node:fs";
import { copyFile, link, mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "../admin/lib/context.ts";
import { stepAphrody as legacyStepAphrody, type Step } from "../admin/lib/steps.ts";

export const R2_DIST = "https://dist.aphrody.app";
export type R2Product = "bun" | "aphrody";
export interface R2Manifest {
  product: R2Product;
  version: string;
  platform: "windows-x64";
  archive: string;
  sha256: string;
  binary?: string;
  binaries?: string[];
  aliases: string[];
  revision?: string;
  updated?: string;
  /** Release directory holding the archive and its SHA256SUMS.txt (bun/<tag>/), else the product root. */
  path?: string;
}
export interface R2Plan {
  manifest: R2Manifest;
  url: string;
  binaries: string[];
  aliases: Record<string, string>;
}
const names = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

async function binaryHash(path: string): Promise<string> {
  return new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");
}

/** Hash known installed bytes before any execution; detect corrupt copied aliases too. */
export async function installedR2Matches(root: string, plans: R2Plan[]): Promise<boolean> {
  try {
    const stamp = JSON.parse(await readFile(join(root, "bin", "r2-install.json"), "utf8")) as {
      plans: R2Plan[];
      checksums: Record<string, string>;
    };
    if (
      !Array.isArray(stamp.plans) ||
      !stamp.checksums ||
      !plans.every(plan =>
        stamp.plans.some(
          prior => prior.manifest.product === plan.manifest.product && prior.manifest.sha256 === plan.manifest.sha256,
        ),
      )
    )
      return false;
    const hashes = new Map<string, string>();
    for (const plan of plans) {
      const files = new Set([...plan.binaries.map(binary => binary.split("/").pop()!), ...Object.keys(plan.aliases)]);
      for (const name of files) {
        const expected = stamp.checksums[name];
        if (!expected || !/^[0-9a-f]{64}$/.test(expected)) return false;
        const file = join(root, "bin", name);
        const stat = statSync(file);
        if (!stat.isFile()) return false;
        const identity = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
        let hash = hashes.get(identity);
        if (!hash) {
          // Hash each distinct hard-linked file once, copied aliases independently.
          // eslint-disable-next-line no-await-in-loop
          hash = await binaryHash(file);
          hashes.set(identity, hash);
        }
        if (hash !== expected) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Same executable identity when hard links are unavailable on the target volume. */
export async function nativeAlias(source: string, destination: string): Promise<void> {
  try {
    await link(source, destination);
  } catch (error) {
    if (!["EPERM", "ENOTSUP", "EXDEV", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    await copyFile(source, destination, 1); // COPYFILE_EXCL; never overwrite an unrelated alias.
  }
}

/** Capture one manifest/checksum snapshot; never trust archive-supplied paths. */
export async function r2Plan(product: R2Product, fetchImpl: Context["fetchImpl"] = fetch): Promise<R2Plan> {
  const base = `${R2_DIST}/${product}`;
  const response = await fetchImpl(`${base}/manifest.json`, {
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`R2 ${product} metadata unavailable`);
  const manifest = (await response.json()) as R2Manifest;
  if (manifest.path !== undefined && !names.test(manifest.path)) throw new Error("Invalid R2 manifest path");
  const dir = manifest.path ? `${base}/${manifest.path}` : base;
  const checksums = await fetchImpl(`${dir}/SHA256SUMS.txt`, {
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!checksums.ok) throw new Error(`R2 ${product} metadata unavailable`);
  if (
    manifest.product !== product ||
    manifest.platform !== "windows-x64" ||
    !manifest.version?.trim() ||
    manifest.archive !== `${product}-windows-x64.zip` ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256)
  )
    throw new Error("Invalid R2 manifest identity");
  const entries = (await checksums.text()).trim().split(/\r?\n/).filter(Boolean);
  const matching = entries.filter(line =>
    new RegExp(`^[a-f0-9]{64}\\s+\\*?${manifest.archive.replaceAll(".", "\\.")}$`).test(line),
  );
  if (matching.length !== 1 || matching[0]!.slice(0, 64) !== manifest.sha256)
    throw new Error("R2 manifest/checksum mismatch");
  const expected =
    product === "bun"
      ? ["bun-windows-x64/bun.exe"]
      : ["aphrody-windows-x64/aphrody.exe", "aphrody-windows-x64/aphrody-site.exe"];
  const binaries = manifest.binaries ?? (manifest.binary ? [manifest.binary] : []);
  if (JSON.stringify(binaries) !== JSON.stringify(expected)) throw new Error("Unexpected R2 binary paths");
  if (
    !Array.isArray(manifest.aliases) ||
    manifest.aliases.some(alias => !names.test(alias)) ||
    new Set(manifest.aliases).size !== manifest.aliases.length
  )
    throw new Error("Invalid R2 aliases");
  if (product === "bun" && (!manifest.aliases.includes("bun") || !manifest.aliases.includes("bunx")))
    throw new Error("R2 Bun must provide bun and bunx aliases");
  return {
    manifest,
    url: `${dir}/${manifest.archive}`,
    binaries,
    aliases: Object.fromEntries(
      manifest.aliases.map(alias => [`${alias}.exe`, product === "bun" ? "bun.exe" : "aphrody.exe"]),
    ),
  };
}

/** Stage only: hash before extraction/execution. Never overwrite PATH binaries. */
export async function stageR2(ctx: Context, plan: R2Plan, root: string): Promise<string> {
  if (ctx.sys.platform !== "win32") throw new Error("Native Windows R2 stage requires Windows");
  await mkdir(root, { recursive: true });
  const staged = await mkdtemp(join(root, `${plan.manifest.product}-`));
  const archive = join(staged, plan.manifest.archive);
  const response = await ctx.fetchImpl(plan.url, {
    signal: AbortSignal.timeout(300000),
  });
  if (!response.ok) throw new Error(`R2 archive HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== plan.manifest.sha256)
    throw new Error("R2 archive SHA-256 mismatch");
  await writeFile(archive, bytes);
  // Extract only allowlisted binaries to a flat, newly allocated directory.
  // Zip metadata cannot choose a destination or create a symlink/reparse point.
  const script = `$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead($env:APHRODY_STAGE_ARCHIVE)
try { foreach($name in ($env:APHRODY_STAGE_BINARIES | ConvertFrom-Json)) {
 $entries=@($zip.Entries | Where-Object FullName -eq $name)
 if($entries.Count -ne 1) { throw 'Missing or duplicate archive binary' }
 $entry=$entries[0]
 if((($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960 -or ($entry.ExternalAttributes -band 1024)) { throw 'Archive links are forbidden' }
 $dest=Join-Path $env:APHRODY_STAGE_DIR ([IO.Path]::GetFileName($name))
 $inputStream=$entry.Open(); $outputStream=[IO.File]::Open($dest,[IO.FileMode]::CreateNew)
 try { $inputStream.CopyTo($outputStream) } finally { $inputStream.Dispose(); $outputStream.Dispose() }
} } finally { $zip.Dispose() }`;
  const extractionScript = join(staged, "extract-verified.ps1");
  await writeFile(extractionScript, `${script}\n`);
  const extracted = await ctx.sys.run(
    ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", extractionScript],
    {
      timeoutMs: 120000,
      env: {
        APHRODY_STAGE_ARCHIVE: archive,
        APHRODY_STAGE_DIR: staged,
        APHRODY_STAGE_BINARIES: JSON.stringify(plan.binaries),
      },
    },
  );
  if (extracted.code !== 0) throw new Error(`R2 extraction failed: ${extracted.stderr}`);
  for (const binary of plan.binaries) {
    const filename = binary.split("/").pop()!;
    if (!existsSync(join(staged, filename))) throw new Error(`R2 extraction missing: ${filename}`);
    // aphrody-site deliberately has --help only; no fabricated --version probe.
    // Ordered qualification keeps execution/output bounded to one binary.
    // eslint-disable-next-line no-await-in-loop
    const check = await ctx.sys.run(
      [join(staged, filename), filename === "aphrody-site.exe" ? "--help" : "--version"],
      { timeoutMs: 30000 },
    );
    if (check.code !== 0 || !check.stdout.trim())
      throw new Error(`R2 qualification failed: ${filename} (exit ${check.code}: ${check.stderr})`);
    if (filename !== "aphrody-site.exe" && !check.stdout.includes(plan.manifest.version))
      throw new Error(`R2 declared version mismatch: ${filename}`);
  }
  for (const [alias, binary] of Object.entries(plan.aliases)) {
    if (alias === binary) continue;
    // Native hard links preserve argv0 multicall dispatch, notably bunx.exe.
    // eslint-disable-next-line no-await-in-loop
    await nativeAlias(join(staged, binary), join(staged, alias));
  }
  await writeFile(join(staged, "verified-manifest.json"), JSON.stringify(plan, null, 2));
  return staged;
}

/** Activate only qualified stages in the dedicated per-user native install root. */
export async function activateR2(ctx: Context, stages: { plan: R2Plan; dir: string }[], root: string): Promise<string> {
  await mkdir(root, { recursive: true });
  const candidate = await mkdtemp(join(root, "bin-next-"));
  const checksums: Record<string, string> = {};
  for (const { plan, dir } of stages) {
    for (const binary of plan.binaries) {
      const name = binary.split("/").pop()!;
      // eslint-disable-next-line no-await-in-loop
      await copyFile(join(dir, name), join(candidate, name));
      // eslint-disable-next-line no-await-in-loop
      checksums[name] = await binaryHash(join(candidate, name));
    }
    for (const [alias, binary] of Object.entries(plan.aliases)) {
      if (alias === binary) continue;
      // eslint-disable-next-line no-await-in-loop
      await nativeAlias(join(candidate, binary), join(candidate, alias));
      checksums[alias] = checksums[binary]!;
    }
  }
  await writeFile(
    join(candidate, "r2-install.json"),
    JSON.stringify({ plans: stages.map(({ plan }) => plan), checksums }, null, 2),
  );
  const bin = join(root, "bin");
  const previous = existsSync(bin) ? join(root, `bin-previous-${Date.now()}`) : undefined;
  if (previous) await rename(bin, previous);
  try {
    await rename(candidate, bin);
  } catch (error) {
    if (previous) await rename(previous, bin);
    throw error;
  }
  const pathScript = `$ErrorActionPreference='Stop'\n$old=[Environment]::GetEnvironmentVariable('Path','User')\n$parts=@($old -split ';' | Where-Object { $_ -and $_ -ine $env:APHRODY_INSTALL_BIN })\n[Environment]::SetEnvironmentVariable('Path',(@($env:APHRODY_INSTALL_BIN)+$parts -join ';'),'User')\n`;
  const pathScriptFile = join(root, "set-user-path.ps1");
  await writeFile(pathScriptFile, pathScript);
  const updated = await ctx.sys.run(
    ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", pathScriptFile],
    { env: { APHRODY_INSTALL_BIN: bin }, timeoutMs: 30000 },
  );
  if (updated.code !== 0)
    throw new Error("Native binaries activated but user PATH update failed; prior bin retained for rollback");
  return bin;
}

export const stepNativeRuntime: Step = {
  id: "aphrody",
  titre: "Bun et Aphrody natifs",
  async run(ctx, mode, state) {
    if (state.pack?.downloadsBase) return legacyStepAphrody.run(ctx, mode, state);
    if (ctx.sys.platform !== "win32") return { state: "ignore", detail: "installation Windows seulement" };
    try {
      const plans = await Promise.all([r2Plan("bun", ctx.fetchImpl), r2Plan("aphrody", ctx.fetchImpl)]);
      const root = ctx.sys.env.APHRODY_NATIVE_INSTALL_ROOT || join(ctx.paths.localAppData, "Aphrody", "Native");
      if (await installedR2Matches(root, plans))
        return {
          state: "deja",
          detail: `Bun et Aphrody vérifiés dans ${join(root, "bin")}`,
        };
      if (mode === "simuler")
        return {
          state: "a-faire",
          detail: `installer Bun ${plans[0]!.manifest.version} et Aphrody ${plans[1]!.manifest.version} depuis R2 dans ${root}; vérifier SHA-256 et exécutables avant activation`,
        };
      const stages = [];
      for (const plan of plans) {
        stages.push({
          plan,
          // Stage each runtime in order before activating their shared install.
          // eslint-disable-next-line no-await-in-loop
          dir: await stageR2(ctx, plan, join(root, "verified")),
        });
      }
      const bin = await activateR2(ctx, stages, root);
      return {
        state: "fait",
        detail: `Bun, bunx et Aphrody installés dans ${bin}; ouvrir un nouveau terminal`,
      };
    } catch (error) {
      return {
        state: "echec",
        detail: `installation native refusée : ${(error as Error).message}`,
      };
    }
  },
};
