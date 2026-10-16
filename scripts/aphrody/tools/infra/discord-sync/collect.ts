// SPDX-License-Identifier: Apache-2.0
// Collecte l'instantané du réseau depuis le hub vps : WireGuard (handshakes, adresses publiques), ports TCP des
// membres, tunnel inverse d'Omar, faits des hôtes Linux (vps local, dbfr par SSH) et bloc NET_LIVE_* poussé par le
// PC propriétaire. Aucun secret n'est lu : `wg show` est limité aux sous-commandes sans clé privée.
import {
  LINUX_SCRIPT,
  parseKv,
} from "@aphrody/yolo-core/src/host/net-facts.ts";
import {
  parseContainers,
  type HostSnap,
  type MemberSnap,
  type Snapshot,
} from "./protocol.ts";

export interface MemberCfg {
  id: string;
  address: string;
  facts: "local" | "ssh" | "pushed" | "none";
  ssh?: string;
  reversePorts?: number[];
}

export interface SyncConfig {
  category: string;
  channels: Record<string, { name: string; topic: string }>;
  users: Record<string, { id: string; name: string }>;
  watch: { channels: string[]; dm: string[] };
  members: MemberCfg[];
  ports: number[];
  /** Conteneurs éphémères (builds) ignorés : expressions régulières sur le nom. */
  ignoreContainers?: string[];
  offlineAfterS: number;
  offlineConfirmTicks: number;
}

export interface CollectDeps {
  run: (cmd: string[], timeoutMs: number) => Promise<string>;
  probe: (host: string, port: number, timeoutMs: number) => Promise<boolean>;
  readPushed: () => string | undefined;
  nowS: () => number;
}

const FAILED = `printf 'failed=%s\\n' "$(systemctl --failed --plain --no-legend 2>/dev/null | awk '{print $1}' | tr '\\n' ' ')"`;
export const FACTS_SCRIPT = `${LINUX_SCRIPT}; ${FAILED}`;

/** `wg show <if> <sous-commande>` : lignes `clé<TAB>valeur…` indexées par clé publique. */
export function parseWgTable(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const line of text.split("\n")) {
    const f = line.split("\t");
    if (f.length >= 2 && f[0]) out.set(f[0], f.slice(1));
  }
  return out;
}

export interface WgView {
  address: string;
  handshake: number;
  endpoint: string;
  rx: number;
  tx: number;
}

export function wgView(
  allowed: string,
  handshakes: string,
  endpoints: string,
  transfer: string,
): WgView[] {
  const a = parseWgTable(allowed);
  const h = parseWgTable(handshakes);
  const e = parseWgTable(endpoints);
  const t = parseWgTable(transfer);
  return [...a.entries()].map(([key, v]) => ({
    address: (v[0] ?? "").split(/[ ,]/)[0]!.split("/")[0]!,
    handshake: Number(h.get(key)?.[0]) || 0,
    endpoint: e.get(key)?.[0] === "(none)" ? "" : (e.get(key)?.[0] ?? ""),
    rx: Number(t.get(key)?.[0]) || 0,
    tx: Number(t.get(key)?.[1]) || 0,
  }));
}

const ipOf = (endpoint: string) =>
  endpoint.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");

/** Faits poussés par un PC : lignes NET_LIVE_<MEMBRE>_<NOM>=valeur (jamais autre chose). */
export function pushedFacts(
  text: string,
  member: string,
): { facts: Record<string, string>; at?: string } {
  const key = `NET_LIVE_${member.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_`;
  const facts: Record<string, string> = {};
  let at: string | undefined;
  for (const line of text.split("\n")) {
    if (line.startsWith("NET_LIVE_AT="))
      at = line.slice("NET_LIVE_AT=".length).trim();
    else if (line.startsWith(key)) {
      const eq = line.indexOf("=");
      facts[line.slice(key.length, eq).toLowerCase()] = line
        .slice(eq + 1)
        .trim();
    }
  }
  return { facts, at };
}

export async function collect(
  cfg: SyncConfig,
  d: CollectDeps,
): Promise<Snapshot> {
  const wgRun = (sub: string) => d.run(["wg", "show", "wg1", sub], 8000);
  const [allowed, handshakes, endpoints, transfer] = await Promise.all([
    wgRun("allowed-ips"),
    wgRun("latest-handshakes"),
    wgRun("endpoints"),
    wgRun("transfer"),
  ]);
  const wg = new Map(
    wgView(allowed, handshakes, endpoints, transfer).map((p) => [p.address, p]),
  );
  const nowS = d.nowS();
  const members: MemberSnap[] = await Promise.all(
    cfg.members.map(async (m) => {
      const peer = wg.get(m.address);
      const ageS =
        peer && peer.handshake > 0 ? Math.max(0, nowS - peer.handshake) : null;
      const isHub = m.facts === "local";
      const wgUp = isHub || (ageS !== null && ageS < cfg.offlineAfterS);
      const rev = m.reversePorts?.[0];
      const reverse = rev ? await d.probe("127.0.0.1", rev, 1500) : false;
      const results = await Promise.all(
        cfg.ports.map(async (p) => ({
          p,
          ok: wgUp ? await d.probe(m.address, p, 2500) : false,
        })),
      );
      return {
        id: m.id,
        address: m.address,
        online: wgUp || reverse,
        wg: wgUp,
        reverse,
        ageS: isHub ? 0 : ageS,
        publicIp: peer?.endpoint ? ipOf(peer.endpoint) : undefined,
        rx: peer?.rx ?? 0,
        tx: peer?.tx ?? 0,
        open: results.filter((r) => r.ok).map((r) => r.p),
        closed: results.filter((r) => !r.ok).map((r) => r.p),
      };
    }),
  );
  const ignore = (cfg.ignoreContainers ?? []).map((p) => new RegExp(p));
  const hosts: Record<string, HostSnap> = {};
  await Promise.all(
    cfg.members.map(async (m) => {
      let kv: Record<string, string> = {};
      let factsAt: string | undefined;
      if (m.facts === "local")
        kv = parseKv(await d.run(["sh", "-c", FACTS_SCRIPT], 15_000));
      else if (m.facts === "ssh" && m.ssh)
        kv = parseKv(
          await d.run(
            [
              "ssh",
              "-o",
              "BatchMode=yes",
              "-o",
              "ConnectTimeout=4",
              m.ssh,
              FACTS_SCRIPT,
            ],
            15_000,
          ),
        );
      else if (m.facts === "pushed") {
        const text = d.readPushed();
        if (text) ({ facts: kv, at: factsAt } = pushedFacts(text, m.id));
      } else return;
      if (Object.keys(kv).length === 0) return;
      hosts[m.id] = {
        containers: Object.fromEntries(
          Object.entries(parseContainers(kv.containers ?? "")).filter(
            ([name]) => !ignore.some((re) => re.test(name)),
          ),
        ),
        failed: (kv.failed ?? "").split(/\s+/).filter(Boolean),
        facts: kv,
        factsAt,
      };
    }),
  );
  return { at: new Date(nowS * 1000).toISOString(), members, hosts };
}
