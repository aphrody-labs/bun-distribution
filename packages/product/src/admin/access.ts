// SPDX-License-Identifier: Apache-2.0
import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseAccessPack, type AccessPack } from "./lib/profile.ts";
export interface Tunnel {
  windowsTunnelName?: string;
  peers: { id: string; publicKey?: string }[];
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
export function buildAccessPack(
  tunnel: Tunnel,
  options: MakeOptions,
): AccessPack {
  const peer = tunnel.peers.find((entry) => entry.id === options.peer);
  if (!peer) throw new Error(`pair inconnu dans le tunnel : ${options.peer}`);
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
    if (service.id === "a2a")
      services.a2a = { url: root, health: `${root}/ping` };
  }
  return parseAccessPack({
    schemaVersion: 1,
    kind: "aphrody-omar-access",
    issuedAt: options.issuedAt ?? new Date().toISOString(),
    issuedFor: options.peer,
    ...(options.wgBlock
      ? {
          wireguard: {
            tunnelName: tunnel.windowsTunnelName ?? "aphrody",
            block: options.wgBlock,
            ...(peer.publicKey ? { expectedPublicKey: peer.publicKey } : {}),
          },
        }
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
