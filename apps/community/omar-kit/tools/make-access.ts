#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Team side: build the access pack (`aphrody-omar-acces.json`) that Omar drops in Downloads. It reads the declared private
 * tunnel (config/host/wireguard/aphrody-tunnel.json) for the host addresses and the services granted to his peer, and wraps
 * the WireGuard block printed by the tunnel owner (`wg-client <peer> --format paste --hub-public-key <key>`). The pack holds
 * addresses but never a private key, so it is written OUTSIDE the repository and sent privately.
 *
 *   bun apps/community/omar-kit/tools/make-access.ts --tunnel config/host/wireguard/aphrody-tunnel.json --peer omar \
 *     --wg-block block.txt --train-host vps --out ~/private/aphrody-omar-acces.json [--host-keys known_hosts.txt]
 *     [--repo-dir vps=/srv/aphrody] [--aphrody-bin vps=/usr/local/bin/aphrody]
 */
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { parse } from "../../creator-kit/src/lib/args.ts";
import { parseAccessPack, type AccessPack } from "../src/lib/profile.ts";

interface Tunnel {
  windowsTunnelName?: string;
  peers: { id: string }[];
  services: { id: string; host: string; address: string; port?: number }[];
  grants: Record<string, string[]>;
}

export interface MakeOptions {
  peer: string;
  /** The tunnel owner's block for that peer (Address, then [Peer]). */
  wgBlock?: string;
  trainHost?: string;
  hostKeys?: string[];
  repoDirs?: Record<string, string>;
  aphrodyBins?: Record<string, string>;
  issuedAt?: string;
  user?: string;
}

/** Pure: tunnel declaration + options -> validated access pack. Throws with a reason when something is missing or unsafe. */
export function buildAccessPack(tunnel: Tunnel, options: MakeOptions): AccessPack {
  if (!tunnel.peers.some((peer) => peer.id === options.peer))
    throw new Error(`pair inconnu dans le tunnel : ${options.peer}`);
  const granted = new Set(tunnel.grants[options.peer] ?? []);
  const hosts: Record<string, unknown> = {};
  for (const service of tunnel.services) {
    if (!granted.has(service.id) || !service.id.startsWith("ssh-")) continue;
    hosts[service.host] = {
      address: service.address,
      port: service.port ?? 22,
      user: options.user ?? options.peer,
      roles: options.trainHost === service.host ? ["train"] : ["admin"],
      repoDir: options.repoDirs?.[service.host] ?? "~/aphrody",
      aphrodyBin: options.aphrodyBins?.[service.host] ?? "aphrody",
    };
  }
  if (Object.keys(hosts).length === 0)
    throw new Error(`aucun accès SSH accordé à ${options.peer} dans le tunnel`);
  const services: Record<string, unknown> = {};
  for (const service of tunnel.services) {
    if (!granted.has(service.id) || service.port === undefined) continue;
    const root = `http://${service.address}:${service.port}`;
    if (service.id === "mcp-http")
      services.mcpHttp = { url: `${root}/mcp`, health: `${root}/healthz` };
    if (service.id === "a2a") services.a2a = { url: root, health: `${root}/ping` };
  }
  return parseAccessPack({
    schemaVersion: 1,
    kind: "aphrody-omar-access",
    issuedAt: options.issuedAt ?? new Date().toISOString(),
    issuedFor: options.peer,
    ...(options.wgBlock
      ? { wireguard: { tunnelName: tunnel.windowsTunnelName ?? "aphrody", block: options.wgBlock } }
      : {}),
    hosts,
    ...(options.trainHost ? { trainHost: options.trainHost } : {}),
    services,
    hostKeys: options.hostKeys ?? [],
  });
}

/** A pack holds private addresses: refuse any destination inside a Git checkout (same rule as the tunnel's own key output). */
export function assertOutsideRepo(path: string, repoRoot: string): void {
  const target = resolve(path);
  let dir = dirname(target);
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
  const real = join(realpathSync(dir), relative(dir, target));
  const rel = relative(realpathSync(repoRoot), real);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)))
    throw new Error(
      `refus d'écrire dans le dépôt : ${path} (le fichier contient les adresses privées, mets-le ailleurs)`,
    );
}

const pairs = (values: string[] | undefined): Record<string, string> =>
  Object.fromEntries(
    (values ?? []).map((entry) => {
      const at = entry.indexOf("=");
      if (at < 1) throw new Error(`« ${entry} » : forme hôte=valeur attendue`);
      return [entry.slice(0, at), entry.slice(at + 1)] as const;
    }),
  );

async function main(argv: string[]): Promise<number> {
  const { values } = parse(argv, {
    tunnel: { type: "string" },
    peer: { type: "string" },
    "wg-block": { type: "string" },
    "train-host": { type: "string" },
    "host-keys": { type: "string" },
    "repo-dir": { type: "string", multiple: true },
    "aphrody-bin": { type: "string", multiple: true },
    out: { type: "string" },
    help: { type: "boolean", short: "h" },
  });
  if (values.help || !values.out || !values.peer) {
    console.log(
      "usage : make-access.ts --tunnel <aphrody-tunnel.json> --peer omar --wg-block <fichier> --out <fichier hors dépôt> [--train-host <hôte>] [--host-keys <fichier>] [--repo-dir hôte=chemin] [--aphrody-bin hôte=chemin]",
    );
    return values.help ? 0 : 2;
  }
  const repoRoot = resolve(import.meta.dir, "../../..");
  assertOutsideRepo(values.out, repoRoot);
  const tunnelFile = values.tunnel ?? join(repoRoot, "config/host/wireguard/aphrody-tunnel.json");
  const tunnel = JSON.parse(await readFile(tunnelFile, "utf8")) as Tunnel;
  const hostKeys = values["host-keys"]
    ? (await readFile(values["host-keys"], "utf8"))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"))
    : [];
  const pack = buildAccessPack(tunnel, {
    peer: values.peer,
    ...(values["wg-block"] ? { wgBlock: await readFile(values["wg-block"], "utf8") } : {}),
    ...(values["train-host"] ? { trainHost: values["train-host"] } : {}),
    hostKeys,
    repoDirs: pairs(values["repo-dir"]),
    aphrodyBins: pairs(values["aphrody-bin"]),
  });
  await mkdir(dirname(resolve(values.out)), { recursive: true });
  await writeFile(values.out, `${JSON.stringify(pack, null, 2)}\n`, { mode: 0o600 });
  console.log(
    `écrit : ${values.out} (hôtes : ${Object.keys(pack.hosts).join(", ")}${pack.wireguard?.block ? ", tunnel WireGuard" : ", SANS tunnel WireGuard"}${pack.hostKeys.length > 0 ? `, ${pack.hostKeys.length} empreintes` : ", SANS empreintes d'hôtes (première connexion non vérifiée)"})`,
  );
  console.log(
    "À envoyer en privé à la personne (jamais dans le dépôt). Il ne contient aucune clé privée.",
  );
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(await main(Bun.argv.slice(2)));
  } catch (error) {
    console.error(`make-access : ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
