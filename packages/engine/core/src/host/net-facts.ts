// SPDX-License-Identifier: Apache-2.0
// Live facts of every member of the private network, rendered into the generated block of network.env: WireGuard
// state seen by the hub (public address, handshake age, traffic), host facts of the Linux members read over SSH,
// local facts of this PC, reachability of the well-known ports. No secret is read or printed.
import { cpus, hostname, totalmem, freemem, uptime, release } from "node:os";
import type { Tunnel } from "./wireguard.ts";

export type Run = (cmd: string[], timeoutMs: number) => Promise<string>;
export type PortProbe = (host: string, port: number, timeoutMs: number) => Promise<boolean>;

export const run: Run = async (cmd, timeoutMs) => {
  try {
    const p = Bun.spawn(cmd, {
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
      timeout: timeoutMs,
    });
    const out = await new Response(p.stdout).text();
    await p.exited;
    return out;
  } catch {
    return "";
  }
};

/** Hardware declared by the owner on 2026-10-09 (the only facts of a PC that cannot be probed remotely). */
export const DECLARED: Record<string, Record<string, string>> = {
  "aphro-pc": {
    DEVICE: "APHRODY",
    CPU: "Intel Core i7-13700F",
    RAM_GB: "32",
    OS: "Windows 11 Home",
  },
  omar: { DEVICE: "Omar", CPU: "Intel Core i5-14400F", RAM_GB: "16", OS: "Windows" },
};

/** Ports probed on every member: SSH, WSL SSH, VNC, remote desktop, MCP HTTP, container API, A2A. */
export const PORTS = [22, 2222, 5900, 8795, 8793, 8999, 8788];

const key = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
const clean = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

export interface WgPeer {
  address: string;
  endpoint: string;
  publicIp: string;
  handshakeAgeS: number | null;
  rx: number;
  tx: number;
}

/** `wg show <if> dump`: first line is the interface, then one tab-separated line per peer. */
export function parseWgDump(text: string, nowS = Math.floor(Date.now() / 1000)): WgPeer[] {
  const peers: WgPeer[] = [];
  for (const line of text.split("\n").slice(1)) {
    const f = line.split("\t");
    if (f.length < 8) continue;
    const address = (f[3] ?? "").split(",")[0]?.split("/")[0] ?? "";
    const endpoint = f[2] === "(none)" ? "" : (f[2] ?? "");
    const hs = Number(f[4]);
    peers.push({
      address,
      endpoint,
      publicIp: endpoint.replace(/:\d+$/, "").replace(/^\[|\]$/g, ""),
      handshakeAgeS: hs > 0 ? Math.max(0, nowS - hs) : null,
      rx: Number(f[5]) || 0,
      tx: Number(f[6]) || 0,
    });
  }
  return peers;
}

/** `name=value` lines. */
export function parseKv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) out[line.slice(0, at).trim()] = clean(line.slice(at + 1));
  }
  return out;
}

export const LINUX_SCRIPT = String.raw`printf 'hostname=%s\n' "$(hostname)"; printf 'uptime_s=%s\n' "$(cut -d. -f1 /proc/uptime)"; printf 'load=%s\n' "$(cut -d' ' -f1-3 /proc/loadavg)"; free -m | awk '/Mem:/{printf "mem_used_total_mb=%s/%s\n",$3,$2}'; printf 'disk_used_pct=%s\n' "$(df --output=pcent / | tail -1 | tr -d ' %')"; printf 'cpus=%s\n' "$(nproc)"; printf 'kernel=%s\n' "$(uname -r)"; printf 'docker=%s\n' "$(docker version --format '{{.Server.Version}}' 2>/dev/null)"; printf 'containers=%s\n' "$(docker ps --format '{{.Names}}={{.Status}}' 2>/dev/null | tr ' ' '_' | tr '\n' ' ')"; printf 'image_runtime_created=%s\n' "$(docker image inspect aphrody:runtime --format '{{.Created}}' 2>/dev/null)"; printf 'ufw_rules=%s\n' "$(sudo -n ufw status numbered 2>/dev/null | grep -c '^\[')"; printf 'listen_non_loopback=%s\n' "$(ss -ltnH | awk '{print $4}' | grep -v '^127\.' | grep -v '^\[::1\]' | sort -u | tr '\n' ',')"; printf 'aphrody=%s\n' "$(aphrody --version 2>/dev/null | head -1)"; printf 'compose_projects=%s\n' "$(docker compose ls -q 2>/dev/null | tr '\n' ',')"`;

async function linuxFacts(host: string, runner: Run): Promise<Record<string, string>> {
  const opts = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=4"];
  return parseKv(await runner(["ssh", ...opts, host, LINUX_SCRIPT], 15_000));
}

export async function localFacts(runner: Run): Promise<Record<string, string>> {
  const c = cpus();
  const listen = (await runner(["netstat", "-an", "-p", "tcp"], 8000))
    .split("\n")
    .filter((l) => /LISTENING|ÉCOUTE/i.test(l))
    .map((l) => l.trim().split(/\s+/)[1] ?? "")
    .filter((a) => a && !a.startsWith("127.") && !a.startsWith("[::1]"));
  const docker = clean(
    await runner(["docker", "version", "--format", "{{.Server.Version}}"], 8000),
  );
  return {
    hostname: hostname(),
    uptime_s: String(Math.floor(uptime())),
    cpus: String(c.length),
    cpu_model: c[0]?.model.trim() ?? "",
    mem_used_total_mb: `${Math.round((totalmem() - freemem()) / 1048576)}/${Math.round(totalmem() / 1048576)}`,
    os_release: release(),
    bun: Bun.version,
    docker,
    containers: clean(
      (await runner(["docker", "ps", "--format", "{{.Names}}={{.Status}}"], 8000)).replace(
        / /g,
        "_",
      ),
    ),
    image_runtime_created: clean(
      await runner(
        ["docker", "image", "inspect", "aphrody:runtime", "--format", "{{.Created}}"],
        8000,
      ),
    ),
    listen_non_loopback: [...new Set(listen)].toSorted().join(","),
  };
}

export interface Fact {
  member: string;
  name: string;
  value: string;
}

export interface Collected {
  facts: Fact[];
  publicIps: Record<string, string>;
}

/** Everything observable from `self`: hub WireGuard dump, SSH facts of the Linux members, local facts, port probes. */
export async function collectFacts(
  t: Tunnel,
  self: string,
  probe: PortProbe,
  runner: Run = run,
  nowS = Math.floor(Date.now() / 1000),
): Promise<Collected> {
  const members = [t.hub.peer, ...t.peers.map((p) => p.id)];
  const addressOf = new Map<string, string>([
    [t.hub.peer, t.hub.address],
    ...t.peers.map((p): [string, string] => [p.id, p.address]),
  ]);
  const linux = new Set([t.hub.peer, ...t.peers.filter((p) => p.os === "linux").map((p) => p.id)]);
  linux.delete("wsl");
  const hubHost = t.hub.peer;
  const dumpJob = runner(
    ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=4", hubHost, "sudo -n wg show wg1 dump"],
    12_000,
  );
  const ownJob = linux.has(self) ? Promise.resolve<Record<string, string>>({}) : localFacts(runner);
  const remoteJobs = [...linux]
    .filter((m) => m !== self)
    .map(async (m): Promise<[string, Record<string, string>]> => [m, await linuxFacts(m, runner)]);
  const [dump, own, remote] = await Promise.all([dumpJob, ownJob, Promise.all(remoteJobs)]);
  const wg = new Map(parseWgDump(dump, nowS).map((p) => [p.address, p]));
  const facts: Fact[] = [];
  const publicIps: Record<string, string> = {};
  const add = (member: string, name: string, value: string | number | null | undefined) => {
    if (value !== undefined && value !== null && String(value) !== "")
      facts.push({ member, name, value: String(value) });
  };
  for (const [member, kv] of remote)
    for (const [k, v] of Object.entries(kv)) add(member, k.toUpperCase(), v);
  for (const [k, v] of Object.entries(own)) add(self, k.toUpperCase(), v);
  const portJobs = members.flatMap((m) => {
    const host = addressOf.get(m);
    return host ? PORTS.map((port) => ({ m, host, port })) : [];
  });
  const results = await Promise.all(
    portJobs.map(async (j) => Object.assign(j, { ok: await probe(j.host, j.port, 2500) })),
  );
  for (const m of members) {
    const address = addressOf.get(m) ?? "";
    const peer = wg.get(address);
    add(m, "ADDRESS", address);
    if (peer) {
      add(m, "PUBLIC_IP", peer.publicIp);
      add(m, "WG_ENDPOINT", peer.endpoint);
      add(m, "WG_HANDSHAKE_AGE_S", peer.handshakeAgeS ?? "never");
      add(m, "WG_RX_BYTES", peer.rx);
      add(m, "WG_TX_BYTES", peer.tx);
      add(m, "WG_ONLINE", peer.handshakeAgeS !== null && peer.handshakeAgeS < 180 ? "yes" : "no");
      if (peer.publicIp) publicIps[m] = peer.publicIp;
    } else if (m === t.hub.peer) {
      const ip = t.hub.endpoint.replace(/:\d+$/, "");
      add(m, "PUBLIC_IP", ip);
      publicIps[m] = ip;
    }
    const open = results.filter((r) => r.m === m && r.ok).map((r) => r.port);
    const closed = results.filter((r) => r.m === m && !r.ok).map((r) => r.port);
    add(m, "PORTS_OPEN", open.join(",") || "none");
    add(m, "PORTS_CLOSED", closed.join(","));
    for (const [k, v] of Object.entries(DECLARED[m] ?? {})) add(m, `DECLARED_${k}`, v);
  }
  return { facts, publicIps };
}

export function renderFacts(c: Collected, now = new Date()): string[] {
  return [
    `NET_LIVE_AT=${now.toISOString()}`,
    ...c.facts.map((f) => `NET_LIVE_${key(f.member)}_${f.name}=${f.value}`),
  ];
}

/** Rewrite `NAME=value` lines that exist outside the generated block; absent names are left alone. */
export function setKeys(text: string, values: Record<string, string>): string {
  let out = text;
  for (const [name, value] of Object.entries(values))
    out = out.replace(new RegExp(`^${name}=.*$`, "m"), () => `${name}=${value}`);
  return out;
}

/** The static public-address keys of network.env, from the live hub view. */
export function staticUpdates(publicIps: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {
    "aphro-pc": "OWNER_PUBLIC_IP",
    omar: "OMAR_PUBLIC_IP",
    vps: "VPS_PUBLIC_IP",
    dbfr: "DBFR_PUBLIC_IP",
  };
  return Object.fromEntries(
    Object.entries(map).flatMap(([m, k]) => (publicIps[m] ? [[k, publicIps[m]!]] : [])),
  );
}
