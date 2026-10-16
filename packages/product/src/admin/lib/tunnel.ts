// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- sequential by design: ordered steps, polling and one host after the other */
/**
 * The private WireGuard tunnel on Windows. The private key is born here; the .conf is assembled locally from the team's
 * block and handed to WireGuard's own service installer (`wireguard /installtunnelservice`, documented by WireGuard for
 * non-interactive deployment) from an elevated copy of this program. A plain .conf dropped in WireGuard's Configurations
 * folder is encrypted by its manager (DPAPI) and the original removed, which is what we wait for before installing.
 */
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Context } from "./context.ts";
import { redact } from "./log.ts";
import type { KitPaths } from "./paths.ts";
import type { AccessPack } from "./profile.ts";
import type { System } from "./system.ts";
import { findTool } from "./tools.ts";
import {
  assembleConf,
  generatePrivateKey,
  isWgKey,
  normaliseConf,
  publicKeyOf,
} from "./wireguard.ts";

export const serviceName = (tunnel: string): string =>
  `WireGuardTunnel$${tunnel}`;

export function parseServiceState(scOutput: string): string | undefined {
  return /STATE\s*:\s*\d+\s+(\w+)/.exec(scOutput)?.[1];
}

export async function tunnelState(
  sys: System,
  tunnel: string,
): Promise<string | undefined> {
  const result = await sys.run(["sc", "query", serviceName(tunnel)], {
    timeoutMs: 15_000,
  });
  return parseServiceState(result.stdout);
}

/** Current user only (plus SYSTEM and Administrators) on a file that holds a key. */
export async function restrictFile(sys: System, path: string): Promise<void> {
  if (sys.platform === "win32") {
    const user = sys.env.USERNAME ?? "";
    const grants = [
      "*S-1-5-18:F",
      "*S-1-5-32-544:F",
      ...(user ? [`${user}:F`] : []),
    ];
    await sys.run(["icacls", path, "/inheritance:r", "/grant:r", ...grants], {
      timeoutMs: 20_000,
    });
  } else await chmod(path, 0o600).catch(() => undefined);
}

/** The WireGuard private key of this PC: read it, or make it (and protect the file). */
export async function ensureWgKey(
  sys: System,
  paths: KitPaths,
): Promise<{ created: boolean; privateKey: string; publicKey: string }> {
  if (existsSync(paths.wgKeyFile)) {
    const existing = (await readFile(paths.wgKeyFile, "utf8")).trim();
    if (isWgKey(existing))
      return {
        created: false,
        privateKey: existing,
        publicKey: publicKeyOf(existing),
      };
    throw new Error(
      "la clé WireGuard enregistrée sur ce PC est illisible : ne la supprime pas, préviens l'équipe",
    );
  }
  const privateKey = generatePrivateKey();
  await mkdir(dirname(paths.wgKeyFile), { recursive: true });
  await writeFile(paths.wgKeyFile, `${privateKey}\n`, { mode: 0o600 });
  await restrictFile(sys, paths.wgKeyFile);
  return { created: true, privateKey, publicKey: publicKeyOf(privateKey) };
}

export interface StagedConf {
  path: string;
  /** Fingerprint of what was staged: a new team block or a new key means a new import. */
  fingerprint: string;
}

/** Assemble the full .conf in a protected temporary file for the elevated installer. */
export async function stageConf(
  sys: System,
  paths: KitPaths,
  pack: AccessPack,
  privateKey: string,
  completeConf?: string,
): Promise<StagedConf> {
  const wg = pack.wireguard;
  if (!wg)
    throw new Error("le fichier d'accès ne contient pas de réglage WireGuard");
  const conf =
    completeConf !== undefined
      ? normaliseConf(completeConf)
      : wg.block
        ? assembleConf(
            privateKey,
            wg.block.includes("[Interface]")
              ? wg.block
              : `[Interface]\n${wg.block}`,
          )
        : undefined;
  if (!conf)
    throw new Error(
      "le fichier d'accès ne contient ni bloc WireGuard ni fichier .conf",
    );
  const dir = join(paths.programData, "Aphrody", "Omar", "tmp");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${wg.tunnelName}.conf`);
  await writeFile(path, conf, { mode: 0o600 });
  await restrictFile(sys, path);
  return {
    path,
    fingerprint: new Bun.CryptoHasher("sha256").update(conf).digest("hex"),
  };
}

const fingerprintFile = (paths: KitPaths): string =>
  join(paths.dataDir, "wg", "derniere-empreinte.txt");

export async function lastFingerprint(
  paths: KitPaths,
): Promise<string | undefined> {
  try {
    return (await readFile(fingerprintFile(paths), "utf8")).trim();
  } catch {
    return undefined;
  }
}

export async function rememberFingerprint(
  paths: KitPaths,
  fingerprint: string,
): Promise<void> {
  await mkdir(dirname(fingerprintFile(paths)), { recursive: true });
  await writeFile(fingerprintFile(paths), `${fingerprint}\n`);
}

const psQuote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/** Command line that starts `argv` elevated (one Windows consent window) and waits for it. */
export function elevatedCommand(argv: string[]): string[] {
  const [file, ...rest] = argv;
  const list = rest.map((arg) => psQuote(`"${arg}"`)).join(",");
  const script = `Start-Process -FilePath ${psQuote(file ?? "")} ${rest.length > 0 ? `-ArgumentList ${list} ` : ""}-Verb RunAs -Wait`;
  return [
    "powershell",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ];
}

/** How to start this same program again: the exe itself, or bun + the entry file when run from sources. */
export function selfCommand(ctx: Context): string[] {
  const name = ctx.exePath.split(/[\\/]/).pop() ?? "";
  return /^(?:bun|yolo|vu)(\.exe)?$/i.test(name)
    ? [ctx.exePath, process.argv[1] ?? "src/cli.ts"]
    : [ctx.exePath];
}

export interface TunnelResult {
  ok: boolean;
  detail: string;
}

/** Called in the NON elevated program: stage, ask Windows for the elevation, check the outcome, clean up. */
export async function importTunnel(
  ctx: Context,
  staged: StagedConf,
  tunnel: string,
): Promise<TunnelResult> {
  const { sys, log } = ctx;
  if (sys.platform !== "win32")
    return {
      ok: false,
      detail: "l'import du tunnel ne se fait que sous Windows",
    };
  if (!findTool(sys, ctx.paths, "wireguard"))
    return { ok: false, detail: "WireGuard n'est pas installé" };
  log(`tunnel : import élevé de ${tunnel}`);
  const result = await sys.run(
    elevatedCommand([
      ...selfCommand(ctx),
      "interne",
      "wg-installer",
      staged.path,
      tunnel,
    ]),
    { timeoutMs: 180_000 },
  );
  await rm(staged.path, { force: true }).catch(() => undefined);
  if (result.code !== 0)
    return {
      ok: false,
      detail: `Windows n'a pas lancé l'étape protégée (${redact(result.stderr).trim().slice(0, 160) || `code ${result.code}`}). As-tu cliqué sur « Oui » ?`,
    };
  for (let i = 0; i < 20; i += 1) {
    if ((await tunnelState(sys, tunnel)) === "RUNNING")
      return { ok: true, detail: `tunnel « ${tunnel} » actif` };
    await sys.sleep(1000);
  }
  return { ok: false, detail: `le tunnel « ${tunnel} » n'a pas démarré` };
}

/** Called in the ELEVATED copy: hand the staged conf to WireGuard's service installer. */
export async function installTunnelElevated(
  sys: System,
  paths: KitPaths,
  confPath: string,
  tunnel: string,
): Promise<TunnelResult> {
  const wireguard = findTool(sys, paths, "wireguard");
  if (!wireguard) return { ok: false, detail: "WireGuard introuvable" };
  const configurations = join(
    paths.programFiles,
    "WireGuard",
    "Data",
    "Configurations",
  );
  try {
    if ((await tunnelState(sys, tunnel)) !== undefined) {
      await sys.run([wireguard, "/uninstalltunnelservice", tunnel], {
        timeoutMs: 60_000,
      });
      for (
        let i = 0;
        i < 30 && (await tunnelState(sys, tunnel)) !== undefined;
        i += 1
      )
        await sys.sleep(500);
    }
    const conf = await readFile(confPath, "utf8");
    await mkdir(configurations, { recursive: true });
    const target = join(configurations, `${tunnel}.conf`);
    await writeFile(target, conf);
    let servicePath = target;
    for (let i = 0; i < 40; i += 1) {
      if (existsSync(`${target}.dpapi`)) {
        servicePath = `${target}.dpapi`;
        break;
      }
      await sys.sleep(500);
    }
    const installed = await sys.run(
      [wireguard, "/installtunnelservice", servicePath],
      {
        timeoutMs: 120_000,
      },
    );
    if (installed.code !== 0)
      return {
        ok: false,
        detail: `wireguard a répondu ${installed.code}: ${redact(
          installed.stderr || installed.stdout,
        )
          .trim()
          .slice(0, 160)}`,
      };
    return {
      ok: true,
      detail: servicePath.endsWith(".dpapi")
        ? "tunnel installé (configuration chiffrée par WireGuard)"
        : "tunnel installé",
    };
  } catch (error) {
    return { ok: false, detail: (error as Error).message };
  } finally {
    await rm(confPath, { force: true }).catch(() => undefined);
  }
}
