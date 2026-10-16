// SPDX-License-Identifier: Apache-2.0
/**
 * Access pack: the one file the team sends to Omar (privately, never from the repository). It carries addresses of the
 * private tunnel and the team's WireGuard block, never a private key. Every value is validated because it ends up in
 * ssh arguments, remote shell text, URLs and a WireGuard configuration.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { KitPaths } from "./paths.ts";
import {
  TUNNEL_NAME_RE,
  isWgKey,
  parseWgText,
  validateWgSections,
} from "./wireguard.ts";

export const PACK_FILE_NAME = "aphrody-omar-acces.json";
export const DEFAULT_DOWNLOADS = "https://downloads.aphrody.com";
export const DEFAULT_REPOSITORY = "aphrody-labs/aphrody";

export interface HostEntry {
  address: string;
  port: number;
  user: string;
  /** "train" marks a host where training may run. */
  roles: string[];
  /** Checkout of the repository on that host, where `aphrody train` is run from. */
  repoDir: string;
  /** Name of the aphrody binary on the host (PATH lookup or absolute path). */
  aphrodyBin: string;
}

export interface ServiceEntry {
  url: string;
  health: string;
}

export interface AccessPack {
  schemaVersion: 1;
  kind: "aphrody-omar-access";
  issuedAt: string;
  issuedFor: string;
  wireguard?: {
    tunnelName: string;
    block?: string;
    expectedPublicKey?: string;
  };
  hosts: Record<string, HostEntry>;
  trainHost?: string;
  services: { mcpHttp?: ServiceEntry; a2a?: ServiceEntry };
  /** known_hosts lines (public host keys) so the first connection is verified, not trusted blindly. */
  hostKeys: string[];
  downloadsBase: string;
  repository: string;
}

const HOST_ID_RE = /^[a-z][a-z0-9-]{0,15}$/;
const ADDRESS_RE =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|[0-9A-Fa-f:]{2,45})$/;
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const REMOTE_PATH_RE =
  /^(?:~\/|\/)?[A-Za-z0-9_.+@%=,-]+(?:\/[A-Za-z0-9_.+@%=,-]+)*\/?$/;
const BIN_RE = /^(?:\/[A-Za-z0-9_.+-]+)+$|^[A-Za-z0-9_.+-]+$/;
const HOST_KEY_RE =
  /^\S+ (?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)) [A-Za-z0-9+/]+={0,2}$/;
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

export class PackError extends Error {}

const record = (value: unknown, what: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new PackError(`${what} : objet attendu`);
  return value as Record<string, unknown>;
};
const text = (value: unknown, what: string): string => {
  if (typeof value !== "string" || value === "")
    throw new PackError(`${what} : texte attendu`);
  return value;
};

export function isSafeRemotePath(path: string): boolean {
  return REMOTE_PATH_RE.test(path) && !path.split("/").includes("..");
}

function parseService(value: unknown, what: string): ServiceEntry {
  const entry = record(value, what);
  const url = text(entry.url, `${what}.url`);
  const health = text(entry.health ?? entry.url, `${what}.health`);
  for (const candidate of [url, health]) {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new PackError(`${what} : adresse web invalide`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      throw new PackError(`${what} : http ou https seulement`);
    if (parsed.username || parsed.password)
      throw new PackError(`${what} : pas d'identifiants dans l'adresse`);
  }
  return { url, health };
}

export function parseAccessPack(input: unknown): AccessPack {
  const root = record(input, "fichier d'accès");
  if (root.kind !== "aphrody-omar-access" || root.schemaVersion !== 1)
    throw new PackError(
      "ce fichier n'est pas un fichier d'accès Aphrody (version 1)",
    );
  const hostsIn = record(root.hosts, "hosts");
  const hosts: Record<string, HostEntry> = {};
  for (const [id, raw] of Object.entries(hostsIn)) {
    if (!HOST_ID_RE.test(id))
      throw new PackError(`nom d'hôte invalide : ${id}`);
    const host = record(raw, `hosts.${id}`);
    const address = text(host.address, `hosts.${id}.address`);
    if (!ADDRESS_RE.test(address))
      throw new PackError(`hosts.${id}.address invalide`);
    const port = host.port === undefined ? 22 : Number(host.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new PackError(`hosts.${id}.port invalide`);
    const user = text(host.user ?? "omar", `hosts.${id}.user`);
    if (!USER_RE.test(user)) throw new PackError(`hosts.${id}.user invalide`);
    const rolesIn = host.roles === undefined ? [] : host.roles;
    if (
      !Array.isArray(rolesIn) ||
      rolesIn.some(
        (role) => typeof role !== "string" || !/^[a-z-]{1,20}$/.test(role),
      )
    )
      throw new PackError(`hosts.${id}.roles invalide`);
    const repoDir = text(host.repoDir ?? "~/aphrody", `hosts.${id}.repoDir`);
    if (!isSafeRemotePath(repoDir))
      throw new PackError(`hosts.${id}.repoDir : chemin non autorisé`);
    const aphrodyBin = text(
      host.aphrodyBin ?? "aphrody",
      `hosts.${id}.aphrodyBin`,
    );
    if (!BIN_RE.test(aphrodyBin))
      throw new PackError(`hosts.${id}.aphrodyBin invalide`);
    hosts[id] = {
      address,
      port,
      user,
      roles: rolesIn as string[],
      repoDir,
      aphrodyBin,
    };
  }
  if (Object.keys(hosts).length === 0)
    throw new PackError("aucun hôte dans le fichier d'accès");
  const trainHost =
    root.trainHost === undefined
      ? undefined
      : text(root.trainHost, "trainHost");
  if (trainHost !== undefined && !hosts[trainHost])
    throw new PackError("trainHost ne désigne aucun hôte");

  if (trainHost && hosts[trainHost])
    hosts[trainHost].roles = [...new Set([...hosts[trainHost].roles, "train"])];

  let wireguard: AccessPack["wireguard"];
  if (root.wireguard !== undefined) {
    const wg = record(root.wireguard, "wireguard");
    const tunnelName = text(wg.tunnelName ?? "aphrody", "wireguard.tunnelName");
    if (!TUNNEL_NAME_RE.test(tunnelName))
      throw new PackError("wireguard.tunnelName invalide");
    const block =
      wg.block === undefined ? undefined : text(wg.block, "wireguard.block");
    if (block !== undefined) {
      try {
        validateWgSections(
          parseWgText(
            block.includes("[Interface]") ? block : `[Interface]\n${block}`,
          ),
          false,
        );
      } catch (error) {
        throw new PackError(`wireguard.block : ${(error as Error).message}`);
      }
    }
    const expectedPublicKey =
      wg.expectedPublicKey === undefined
        ? undefined
        : text(wg.expectedPublicKey, "wireguard.expectedPublicKey");
    if (expectedPublicKey !== undefined && !isWgKey(expectedPublicKey))
      throw new PackError("wireguard.expectedPublicKey invalide");
    wireguard = {
      tunnelName,
      ...(block === undefined ? {} : { block }),
      ...(expectedPublicKey ? { expectedPublicKey } : {}),
    };
  }

  const servicesIn =
    root.services === undefined ? {} : record(root.services, "services");
  const services: AccessPack["services"] = {};
  if (servicesIn.mcpHttp !== undefined)
    services.mcpHttp = parseService(servicesIn.mcpHttp, "services.mcpHttp");
  if (servicesIn.a2a !== undefined)
    services.a2a = parseService(servicesIn.a2a, "services.a2a");

  const hostKeysIn = root.hostKeys === undefined ? [] : root.hostKeys;
  if (
    !Array.isArray(hostKeysIn) ||
    hostKeysIn.some(
      (line) => typeof line !== "string" || !HOST_KEY_RE.test(line),
    )
  )
    throw new PackError(
      "hostKeys : lignes known_hosts attendues (hôte type clé)",
    );

  const downloadsBase = text(
    root.downloadsBase ?? DEFAULT_DOWNLOADS,
    "downloadsBase",
  ).replace(/\/+$/, "");
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(downloadsBase))
    throw new PackError("downloadsBase : https://hôte attendu");
  const repository = text(root.repository ?? DEFAULT_REPOSITORY, "repository");
  if (!REPO_RE.test(repository))
    throw new PackError("repository : propriétaire/nom attendu");

  return {
    schemaVersion: 1,
    kind: "aphrody-omar-access",
    issuedAt: typeof root.issuedAt === "string" ? root.issuedAt : "",
    issuedFor: typeof root.issuedFor === "string" ? root.issuedFor : "",
    ...(wireguard ? { wireguard } : {}),
    hosts,
    ...(trainHost ? { trainHost } : {}),
    services,
    hostKeys: hostKeysIn as string[],
    downloadsBase,
    repository,
  };
}

export async function readPackFile(path: string): Promise<AccessPack> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new PackError(
      `fichier d'accès illisible (${(error as Error).message})`,
    );
  }
  return parseAccessPack(raw);
}

export async function saveProfile(
  paths: KitPaths,
  pack: AccessPack,
): Promise<void> {
  await mkdir(dirname(paths.profileFile), { recursive: true });
  await writeFile(paths.profileFile, `${JSON.stringify(pack, null, 2)}\n`);
}

/** The profile installed by `acces`, or undefined when none yet (or when it no longer validates). */
export async function loadProfile(
  paths: KitPaths,
): Promise<AccessPack | undefined> {
  if (!existsSync(paths.profileFile)) return undefined;
  try {
    return await readPackFile(paths.profileFile);
  } catch {
    return undefined;
  }
}

/** Access files lying where a browser or a chat app puts downloads, newest first (`name (1).json` counts). */
export function findPackFiles(dirs: string[]): string[] {
  const found: { path: string; mtime: number }[] = [];
  const pattern = /^aphrody-omar-acces(?: \(\d+\))?\.json$/i;
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!pattern.test(name)) continue;
      const path = join(dir, name);
      try {
        found.push({ path, mtime: statSync(path).mtimeMs });
      } catch {
        // vanished
      }
    }
  }
  return found.toSorted((a, b) => b.mtime - a.mtime).map((entry) => entry.path);
}

export function searchDirs(paths: KitPaths, exeDir: string): string[] {
  return [
    ...new Set([exeDir, paths.downloadsDir, paths.desktopDir, paths.dataDir]),
  ];
}

export function trainHostId(pack: AccessPack): string | undefined {
  if (pack.trainHost) return pack.trainHost;
  const marked = Object.entries(pack.hosts).find(([, host]) =>
    host.roles.includes("train"),
  );
  return marked?.[0];
}
