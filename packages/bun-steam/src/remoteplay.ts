// SPDX-License-Identifier: Apache-2.0
/**
 * Steam Remote Play state of this client: known remote hosts/clients (`config/remoteclients.vdf`)
 * and recent session events from `logs/remote_connections.txt` and `logs/streaming_log.txt`.
 * Keys that could hold pairing secrets are dropped.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readVdf } from "./config.js";
import { resolveSteamRoot } from "./paths.js";
import { kvObj, kvStr } from "./vdf.js";

/** Remote Play discovery and stream ports (UDP 27031-27036, TCP 27036-27037). */
export const REMOTE_PLAY_PORTS = {
  udp: [27031, 27036],
  tcp: [27036, 27037],
} as const;

const SECRET_KEY = /key|token|secret|ticket|psk|pin|auth/i;

export interface RemoteClient {
  id: string;
  hostname: string | null;
  lastUpdated: number | null;
  lastResult: string | null;
  publicIp: string | null;
  apps: string[];
}

export interface RemotePlayState {
  clients: RemoteClient[];
  connections: string[];
  streaming: string[];
}

function tail(path: string, lines: number): string[] {
  try {
    return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).slice(-lines);
  } catch {
    return [];
  }
}

/** Known Remote Play peers and the last `lines` log events of both Remote Play logs. */
export function remotePlayState(steamRoot = resolveSteamRoot(), lines = 20): RemotePlayState {
  const cache = kvObj(readVdf(join(steamRoot, "config", "remoteclients.vdf")), "RemoteClientCache") ?? {};
  const clients = Object.entries(cache).flatMap(([id, v]) => {
    if (typeof v === "string") return [];
    const safe = Object.fromEntries(Object.entries(v).filter(([k]) => !SECRET_KEY.test(k)));
    return [
      {
        id,
        hostname: kvStr(safe, "hostname"),
        lastUpdated: Number(kvStr(safe, "LastUpdated")) || null,
        lastResult: kvStr(safe, "lastresult"),
        publicIp: kvStr(safe, "ippublic"),
        apps: Object.values(kvObj(safe, "apps") ?? {}).filter((a): a is string => typeof a === "string"),
      },
    ];
  });
  return {
    clients,
    connections: tail(join(steamRoot, "logs", "remote_connections.txt"), lines),
    streaming: tail(join(steamRoot, "logs", "streaming_log.txt"), lines),
  };
}
