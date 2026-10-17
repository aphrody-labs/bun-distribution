// SPDX-License-Identifier: Apache-2.0
/**
 * Proton management: discovery of Valve Proton and custom compatibility tools, install and
 * update of GE-Proton and proton-cachyos into `compatibilitytools.d`, Valve Proton and the official
 * anti-cheat runtimes through steamcmd, and per-game selection (`config.ts` `setCompatTool`).
 *
 * Anti-cheat support only installs the runtimes Valve and the game publishers ship (Proton
 * EasyAntiCheat Runtime 1826330, Proton BattlEye Runtime 1161040, or the same runtimes from the
 * Lutris index that Heroic and umu use). Nothing here patches or bypasses anti-cheat.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { parseAppInfo } from "./appinfo.js";
import { readVdf } from "./config.js";
import { compatToolDirs, isDir, norm, resolveSteamRoot } from "./paths.js";
import { appUpdate, type SteamcmdOptions } from "./steamcmd.js";
import { kvObj, kvStr } from "./vdf.js";

/** Official Steam runtimes for anti-cheat under Proton (Steam tools, free with any account). */
export const ANTI_CHEAT_RUNTIMES = {
  eac: {
    appId: 1826330,
    name: "Proton EasyAntiCheat Runtime",
    env: "PROTON_EAC_RUNTIME",
    lutris: "eac_runtime",
  },
  battleye: {
    appId: 1161040,
    name: "Proton BattlEye Runtime",
    env: "PROTON_BATTLEYE_RUNTIME",
    lutris: "battleye_runtime",
  },
} as const;

/**
 * Valve compatibility tools by app id, as listed in the client's `appcache/appinfo.vdf` on
 * 2026-10-17. {@link valveProtonCatalog} prefers the live appinfo of the host.
 */
export const VALVE_PROTON: Record<string, number> = {
  "Proton 11.0": 4628710,
  "Proton 10.0": 3658110,
  "Proton 9.0": 2805730,
  "Proton 8.0": 2348590,
  "Proton Experimental": 1493710,
  "Proton Hotfix": 2180100,
  "Steam Linux Runtime 4.0": 4183110,
  "Steam Linux Runtime 3.0 (sniper)": 1628350,
};

/** Valve Proton builds and Steam Linux Runtimes known to this client (name -> app id). */
export function valveProtonCatalog(steamRoot = resolveSteamRoot()): Record<string, number> {
  try {
    const info = parseAppInfo(readFileSync(join(steamRoot, "appcache", "appinfo.vdf")));
    const out: Record<string, number> = {};
    for (const app of info.apps) {
      const name = kvStr(app.kv, "appinfo", "common", "name") ?? "";
      if (/^(Proton (\d|Experimental|Hotfix|Next)|Steam Linux Runtime)/.test(name) && !/ARM64|Arm64/.test(name))
        out[name] = app.appid;
    }
    return Object.keys(out).length ? out : VALVE_PROTON;
  } catch {
    return VALVE_PROTON;
  }
}

export interface CompatTool {
  /** Name used by `CompatToolMapping` (`GE-Proton11-9`, `proton_10`, ...). */
  internalName: string;
  displayName: string;
  kind: "custom" | "valve";
  path: string;
  version: string | null;
}

/** Library roots of the client (`libraryfolders.vdf`), the Steam root first. */
export function libraryRoots(steamRoot = resolveSteamRoot()): string[] {
  const kv = kvObj(
    readVdf(join(steamRoot, "config", "libraryfolders.vdf")) ??
      readVdf(join(steamRoot, "steamapps", "libraryfolders.vdf")),
    "libraryfolders",
  );
  const paths = Object.values(kv ?? {}).flatMap(v => (typeof v === "string" ? [] : [norm(kvStr(v, "path") ?? "")]));
  return [...new Set([norm(steamRoot), ...paths.filter(Boolean)])];
}

/** Custom tools in `compatibilitytools.d` and Valve Proton installs in every library. */
export function listCompatTools(steamRoot = resolveSteamRoot()): CompatTool[] {
  const tools: CompatTool[] = [];
  for (const dir of compatToolDirs(steamRoot)) {
    if (!isDir(dir)) continue;
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const vdf = kvObj(readVdf(join(path, "compatibilitytool.vdf")), "compatibilitytools", "compat_tools");
      if (!vdf) continue;
      for (const [internalName, v] of Object.entries(vdf)) {
        if (typeof v === "string") continue;
        tools.push({
          internalName,
          displayName: kvStr(v, "display_name") ?? internalName,
          kind: "custom",
          path: norm(path),
          version: readVersion(path),
        });
      }
    }
  }
  for (const lib of libraryRoots(steamRoot)) {
    const common = join(lib, "steamapps", "common");
    if (!isDir(common)) continue;
    for (const entry of readdirSync(common)) {
      if (!entry.startsWith("Proton") || !existsSync(join(common, entry, "proton"))) continue;
      tools.push({
        internalName: valveInternalName(entry),
        displayName: entry,
        kind: "valve",
        path: norm(join(common, entry)),
        version: readVersion(join(common, entry)),
      });
    }
  }
  return tools;
}

/** `Proton 10.0` -> `proton_10`, `Proton Experimental` -> `proton_experimental`. */
export const valveInternalName = (dir: string): string =>
  dir === "Proton Experimental"
    ? "proton_experimental"
    : dir === "Proton Hotfix"
      ? "proton_hotfix"
      : `proton_${dir
          .replace(/^Proton\s*/, "")
          .replace(/\.0$/, "")
          .replace(/\W+/g, "_")
          .toLowerCase()}`;

function readVersion(dir: string): string | null {
  try {
    return readFileSync(join(dir, "version"), "utf8").trim().split(/\s+/).pop() ?? null;
  } catch {
    return null;
  }
}

/** True when this CPU runs x86-64-v3 code (AVX2, BMI1/2, FMA, MOVBE, F16C, LZCNT). */
export function supportsX86_64V3(): boolean {
  if (process.arch !== "x64") return false;
  try {
    const flags = readFileSync("/proc/cpuinfo", "utf8").match(/^flags\s*:(.*)$/m)?.[1] ?? "";
    const set = new Set(flags.trim().split(/\s+/));
    return ["avx2", "bmi1", "bmi2", "fma", "movbe", "f16c", "abm"].every(f => set.has(f));
  } catch {
    // No /proc/cpuinfo (Windows preparing a Linux install): portable x86-64; pass --arch x86_64_v3.
    return false;
  }
}

export type ProtonFlavor = "ge" | "cachyos";

export interface ProtonRelease {
  flavor: ProtonFlavor;
  tag: string;
  asset: string;
  url: string;
  checksumUrl: string | null;
  size: number;
}

const REPOS: Record<ProtonFlavor, string> = {
  ge: "GloriousEggroll/proton-ge-custom",
  cachyos: "CachyOS/proton-cachyos",
};

/** Latest (or `tag`) GitHub release of a Proton flavor, with the asset for this architecture. */
export async function protonRelease(
  flavor: ProtonFlavor,
  opts: { tag?: string | undefined; arch?: string | undefined } = {},
): Promise<ProtonRelease> {
  const api = `https://api.github.com/repos/${REPOS[flavor]}/releases/${opts.tag ? `tags/${opts.tag}` : "latest"}`;
  const res = await fetch(api, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "bun-steam",
    },
  });
  if (!res.ok) throw new Error(`${api}: HTTP ${res.status}`);
  const rel = (await res.json()) as {
    tag_name: string;
    assets: { name: string; browser_download_url: string; size: number }[];
  };
  const arch =
    opts.arch ??
    (process.arch === "arm64" ? "arm64" : flavor === "cachyos" && supportsX86_64V3() ? "x86_64_v3" : "x86_64");
  const wanted = (name: string) =>
    flavor === "ge"
      ? name.endsWith(arch === "arm64" ? "-aarch64.tar.gz" : "-x86_64.tar.gz") ||
        (name === `${rel.tag_name}.tar.gz` && arch !== "arm64")
      : name.endsWith(`-${arch}.tar.xz`);
  const asset = rel.assets.find(a => wanted(a.name));
  if (!asset) throw new Error(`${flavor} ${rel.tag_name}: no ${arch} archive`);
  const stem = asset.name.replace(/\.tar\.(gz|xz)$/, "");
  const sum = rel.assets.find(a => a.name === `${stem}.sha512sum`);
  return {
    flavor,
    tag: rel.tag_name,
    asset: asset.name,
    url: asset.browser_download_url,
    checksumUrl: sum?.browser_download_url ?? null,
    size: asset.size,
  };
}

/** Directory name an archive is installed as (`GE-Proton11-9`, `proton-cachyos-...-x86_64_v3`). */
export const toolDirName = (rel: ProtonRelease): string =>
  rel.flavor === "ge" ? rel.tag : rel.asset.replace(/\.tar\.(gz|xz)$/, "");

/** First custom compatibility tool directory (`STEAM_EXTRA_COMPAT_TOOLS_PATHS`, then the client's). */
export const defaultCompatDir = (steamRoot = resolveSteamRoot()): string => compatToolDirs(steamRoot)[0]!;

async function download(url: string, file: string, checksumUrl: string | null): Promise<void> {
  const res = await fetch(url, { headers: { "user-agent": "bun-steam" } });
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const hasher = new Bun.CryptoHasher("sha512");
  const writer = Bun.file(file).writer();
  for await (const chunk of res.body) {
    hasher.update(chunk);
    writer.write(chunk);
  }
  await writer.end();
  if (!checksumUrl) return;
  const sum = (await (await fetch(checksumUrl, { headers: { "user-agent": "bun-steam" } })).text())
    .trim()
    .split(/\s+/)[0];
  if (sum && sum.toLowerCase() !== hasher.digest("hex")) throw new Error(`${basename(file)}: SHA-512 mismatch`);
}

async function extract(archive: string, into: string, strip = 0): Promise<void> {
  mkdirSync(into, { recursive: true });
  const args = ["tar", "-xf", archive, "-C", into];
  if (strip) args.push(`--strip-components=${strip}`);
  const proc = Bun.spawn(args, { stdout: "ignore", stderr: "pipe" });
  if ((await proc.exited) !== 0) throw new Error(`tar: ${(await new Response(proc.stderr).text()).trim()}`);
}

export interface InstallResult {
  flavor: ProtonFlavor;
  tag: string;
  path: string;
  internalNames: string[];
  installed: boolean;
  pruned: string[];
}

/**
 * Installs a GE-Proton or proton-cachyos release into a compatibility tool directory (SHA-512
 * verified when the release publishes a checksum). `prune` removes older tools of the same flavor.
 */
export async function installProton(
  flavor: ProtonFlavor,
  opts: {
    tag?: string;
    arch?: string;
    dir?: string;
    prune?: boolean;
    log?: (m: string) => void;
  } = {},
): Promise<InstallResult> {
  const rel = await protonRelease(flavor, opts);
  const dir = opts.dir ?? defaultCompatDir();
  const name = toolDirName(rel);
  const target = join(dir, name);
  let installed = false;
  if (!existsSync(join(target, "compatibilitytool.vdf"))) {
    mkdirSync(dir, { recursive: true });
    const staging = join(dir, `.bun-steam-${process.pid}`);
    const archive = join(dir, `.bun-steam-${process.pid}-${rel.asset}`);
    try {
      opts.log?.(`downloading ${rel.asset} (${(rel.size / 2 ** 20).toFixed(0)} MiB)`);
      await download(rel.url, archive, rel.checksumUrl);
      opts.log?.(`extracting into ${target}`);
      await extract(archive, staging);
      const [top] = readdirSync(staging);
      if (!top) throw new Error(`${rel.asset}: empty archive`);
      rmSync(target, { recursive: true, force: true });
      renameSync(join(staging, top), target);
      installed = true;
    } finally {
      rmSync(staging, { recursive: true, force: true });
      rmSync(archive, { force: true });
    }
  }
  const pruned: string[] = [];
  if (opts.prune) {
    const same = flavor === "ge" ? /^GE-Proton/ : /^proton-cachyos/;
    for (const entry of readdirSync(dir)) {
      if (entry !== name && same.test(entry)) {
        rmSync(join(dir, entry), { recursive: true, force: true });
        pruned.push(entry);
      }
    }
  }
  const internal = kvObj(readVdf(join(target, "compatibilitytool.vdf")), "compatibilitytools", "compat_tools");
  return {
    flavor,
    tag: rel.tag,
    path: norm(target),
    internalNames: Object.keys(internal ?? {}),
    installed,
    pruned,
  };
}

/** Installs or updates a Valve Proton build or Steam Linux Runtime through steamcmd. */
export function installValveTool(
  name: string,
  opts: SteamcmdOptions & { steamRoot?: string; validate?: boolean } = {},
) {
  const steamRoot = opts.steamRoot ?? resolveSteamRoot();
  const catalog = valveProtonCatalog(steamRoot);
  const appId = catalog[name] ?? (/^\d+$/.test(name) ? Number(name) : undefined);
  if (!appId) throw new Error(`unknown Valve tool ${name}; known: ${Object.keys(catalog).join(", ")}`);
  const dirName = Object.entries(catalog).find(([, id]) => id === appId)?.[0] ?? String(appId);
  return appUpdate(appId, {
    ...opts,
    platform: opts.platform ?? "linux",
    installDir: opts.installDir ?? join(steamRoot, "steamapps", "common", dirName),
  });
}

export interface RuntimeResult {
  name: keyof typeof ANTI_CHEAT_RUNTIMES;
  path: string;
  source: "steam" | "lutris";
  installed: boolean;
}

/**
 * Installs the official Proton EasyAntiCheat and BattlEye runtimes into `<dir>/eac` and
 * `<dir>/battleye` (`PROTON_EAC_RUNTIME` / `PROTON_BATTLEYE_RUNTIME`), from Steam through steamcmd
 * or from the Lutris runtime index used by Heroic and umu outside Steam.
 */
export async function installAntiCheatRuntimes(
  dir: string,
  opts: SteamcmdOptions & {
    source?: "steam" | "lutris";
    log?: (m: string) => void;
  } = {},
): Promise<RuntimeResult[]> {
  const source = opts.source ?? "steam";
  const out: RuntimeResult[] = [];
  let index: { name: string; url: string }[] | null = null;
  for (const [key, rt] of Object.entries(ANTI_CHEAT_RUNTIMES) as [
    keyof typeof ANTI_CHEAT_RUNTIMES,
    (typeof ANTI_CHEAT_RUNTIMES)["eac"],
  ][]) {
    const path = join(dir, key);
    const done = join(path, ".complete");
    if (existsSync(done)) {
      out.push({ name: key, path: norm(path), source, installed: false });
      continue;
    }
    if (source === "steam") {
      const run = await appUpdate(rt.appId, {
        ...opts,
        platform: "linux",
        installDir: path,
      });
      if (run.exitCode !== 0)
        throw new Error(`${rt.name}: steamcmd exit ${run.exitCode}${run.needsLogin ? " (no cached session)" : ""}`);
    } else {
      index ??= (await (await fetch("https://lutris.net/api/runtimes")).json()) as { name: string; url: string }[];
      const entry = index.find(r => r.name === rt.lutris);
      if (!entry) throw new Error(`Lutris runtime index has no ${rt.lutris}`);
      const archive = `${path}.bun-steam-${process.pid}.tar.xz`;
      mkdirSync(dir, { recursive: true });
      try {
        opts.log?.(`downloading ${rt.lutris}`);
        await download(entry.url, archive, null);
        rmSync(path, { recursive: true, force: true });
        await extract(archive, path, 1);
      } finally {
        rmSync(archive, { force: true });
      }
    }
    await Bun.write(done, "");
    out.push({ name: key, path: norm(path), source, installed: true });
  }
  return out;
}
