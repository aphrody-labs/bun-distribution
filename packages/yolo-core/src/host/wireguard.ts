// SPDX-License-Identifier: Apache-2.0
// Private WireGuard tunnel (vps hub, dbfr, WSL, two Windows PCs) and the `omar` Unix account: declaration checks, hub and
// client sections, ufw rules and the host plan. Declared intent only: this module never mutates a host. `wg-plan` prints the
// ordered steps; `--observe` runs only the read-only (`check`, `warn`, `info`) ones. There is no apply here: the owner's
// written order in the main session is the gate, and the steps are plain root shell text.
//   bun packages/engine/core/src/host/cli.ts wg-plan [--observe] [--json]
//   bun packages/engine/core/src/host/cli.ts wg-client <peer> [--hub-public-key K] [--format sections|paste|conf]
//        [--private-key-file F | --private-key-stdin] [--out FILE]
// Private keys: born on their own peer (`wg genkey` on a host, the WireGuard app on Windows), never written to the repository.
// `wg-client --format conf` is the only path that touches one: it reads it from a file or stdin, prints to stdout or to an
// `--out` file that must lie outside the checkout, and the declaration, the sections and the plan never carry one.
// Imports from ./index.ts are type-only so index.ts can call `tunnelProblems` without a runtime cycle.
// oxlint-disable no-await-in-loop -- sequential by design: host commands run one after the other.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { HostAccount, HostCatalog } from "./index.ts";

export const TUNNEL_FILE = "wireguard/aphrody-tunnel.json";

export interface TunnelPeer {
  id: string;
  host: string;
  os: "linux" | "windows";
  address: string;
  publicKey: string | null;
  keyOrigin: string;
  publicKeyNote?: string;
  udpSource: {
    mode: "covered-by-shenron-admin" | "ufw";
    ips?: string[];
    comment?: string;
    note?: string;
  };
}
export interface TunnelService {
  id: string;
  host: string;
  address: string;
  port?: number;
  proto: "tcp";
  expose: "listener" | "socket-proxyd" | "peer-listener";
  upstream?: string;
  unit?: string;
  auth?: string;
  caveat?: string;
  status?: string;
  pendingReason?: string;
}
export interface Tunnel {
  name: string;
  status: string;
  interface: string;
  windowsTunnelName: string;
  subnet: string;
  clientAllowedIps: string;
  keepalive: number;
  existingNetworks: { name: string; cidr: string }[];
  /** Same path on every host: each private key stays on the host that generated it. */
  keyFiles: { private: string; public: string };
  hub: {
    peer: string;
    address: string;
    endpoint: string;
    listenPort: number;
    publicKey: string | null;
  };
  peers: TunnelPeer[];
  services: TunnelService[];
  grants: Record<string, string[]>;
  firewall: {
    marker: string;
    foreignMarkers: string[];
    neverOpen: number[];
    meshDenied?: string[];
  };
  /** All-port, all-protocol reachability between trusted members (dev PCs, build hub); never towards meshDenied. */
  mesh?: TunnelMesh[];
}
export interface TunnelMesh {
  id: string;
  from: string[];
  to: string[];
  note?: string;
}

export function loadTunnel(root: string, file = TUNNEL_FILE): Tunnel {
  return JSON.parse(readFileSync(join(root, file), "utf8"));
}

// ── addresses and keys ───────────────────────────────────────────────────────────────────────────────────────────────────

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
function ipToInt(ip: string): number | undefined {
  const m = IPV4.exec(ip);
  if (!m) return undefined;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return undefined;
  return (
    ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0
  );
}
export function parseCidr(
  cidr: string,
): { base: number; bits: number; mask: number } | undefined {
  const [ip, len] = cidr.split("/");
  const base = ip === undefined ? undefined : ipToInt(ip);
  const bits = len === undefined ? 32 : Number(len);
  if (base === undefined || !Number.isInteger(bits) || bits < 0 || bits > 32)
    return undefined;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { base: (base & mask) >>> 0, bits, mask };
}
export function cidrsOverlap(a: string, b: string): boolean {
  const x = parseCidr(a);
  const y = parseCidr(b);
  if (!x || !y) return false;
  const mask = x.bits < y.bits ? x.mask : y.mask;
  return (x.base & mask) >>> 0 === (y.base & mask) >>> 0;
}
export function inCidr(ip: string, cidr: string): boolean {
  const n = ipToInt(ip);
  const c = parseCidr(cidr);
  return n !== undefined && c !== undefined && (n & c.mask) >>> 0 === c.base;
}

/** A WireGuard key: 44 base64 characters that decode to exactly 32 bytes. */
export function isWgKey(key: unknown): key is string {
  if (typeof key !== "string" || key.length !== 44) return false;
  const raw = Buffer.from(key, "base64");
  return raw.length === 32 && raw.toString("base64") === key;
}

/** Text that looks like private key material: a wg-quick PrivateKey line or a PEM/OpenSSH private block. */
export const PRIVATE_KEY_PATTERN =
  /PrivateKey\s*=\s*[A-Za-z0-9+/]{43}=|BEGIN (OPENSSH |RSA |EC |DSA )?PRIVATE KEY|AGE-SECRET-KEY-/;

// ── validation (called by checkCatalog) ──────────────────────────────────────────────────────────────────────────────────

function readIfExists(root: string, file: string): string | undefined {
  const path = join(root, file);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

export function tunnelProblems(root: string, file = TUNNEL_FILE): string[] {
  const problems: string[] = [];
  const text = readIfExists(root, file);
  if (text === undefined) return [`missing wireguard declaration: ${file}`];
  if (PRIVATE_KEY_PATTERN.test(text))
    problems.push(`${file}: contains private key material`);
  const t = JSON.parse(text) as Tunnel;
  const subnet = parseCidr(t.subnet);
  if (!subnet || subnet.bits < 16 || subnet.bits > 29)
    problems.push(`${file}: bad subnet ${t.subnet}`);
  for (const net of t.existingNetworks)
    if (cidrsOverlap(t.subnet, net.cidr))
      problems.push(
        `${file}: subnet ${t.subnet} overlaps ${net.cidr} (${net.name})`,
      );
  if (t.clientAllowedIps !== t.subnet)
    problems.push(
      `${file}: clientAllowedIps must equal the subnet (split tunnel only), got ${t.clientAllowedIps}`,
    );
  if (!/^wg\d+$/.test(t.interface) || t.interface === "wg0")
    problems.push(
      `${file}: interface ${t.interface} must be a new wgN (wg0 is the historical Shenron link)`,
    );
  if (t.hub.listenPort === 51820)
    problems.push(`${file}: listenPort 51820 belongs to wg0`);
  if (!inCidr(t.hub.address, t.subnet))
    problems.push(`${file}: hub address outside the subnet`);
  if (t.hub.publicKey !== null && !isWgKey(t.hub.publicKey))
    problems.push(`${file}: hub publicKey is not a WireGuard key`);
  const used = new Set<string>([t.hub.address]);
  const keys = new Set<string>();
  for (const p of t.peers) {
    if (!inCidr(p.address, t.subnet))
      problems.push(
        `${file}: peer ${p.id} address ${p.address} outside the subnet`,
      );
    if (used.has(p.address))
      problems.push(`${file}: peer ${p.id} duplicate address ${p.address}`);
    used.add(p.address);
    if (p.publicKey !== null) {
      if (!isWgKey(p.publicKey))
        problems.push(`${file}: peer ${p.id} publicKey is not a WireGuard key`);
      if (keys.has(p.publicKey))
        problems.push(`${file}: peer ${p.id} reuses another peer's key`);
      keys.add(p.publicKey);
    } else if (!p.keyOrigin)
      problems.push(`${file}: peer ${p.id} has no key and no keyOrigin`);
    if (p.udpSource.mode === "ufw") {
      if (!p.udpSource.ips?.length)
        problems.push(`${file}: peer ${p.id} ufw source without addresses`);
      for (const ip of p.udpSource.ips ?? [])
        if (
          ipToInt(ip) === undefined ||
          ip.includes("/") ||
          ip.startsWith("0.")
        )
          problems.push(
            `${file}: peer ${p.id} source ${ip} must be one public address`,
          );
      const marker = p.udpSource.comment ?? "";
      if (marker !== `${t.firewall.marker}-${p.id}`)
        problems.push(
          `${file}: peer ${p.id} comment must be ${t.firewall.marker}-${p.id}`,
        );
    }
  }
  const ids = new Set([t.hub.peer, ...t.peers.map((p) => p.id)]);
  const services = new Map(t.services.map((s) => [s.id, s]));
  for (const s of t.services) {
    if (s.port !== undefined && (s.port < 1 || s.port > 65535))
      problems.push(`${file}: service ${s.id} bad port`);
    if (s.port !== undefined && t.firewall.neverOpen.includes(s.port))
      problems.push(
        `${file}: service ${s.id} opens a never-open port ${s.port}`,
      );
    if (s.port === undefined && s.status !== "pending")
      problems.push(`${file}: service ${s.id} has no port and is not pending`);
    if (!inCidr(s.address, t.subnet))
      problems.push(`${file}: service ${s.id} address outside the subnet`);
    if (
      s.expose === "socket-proxyd" &&
      (!s.upstream || !/^127\.0\.0\.1:\d+$/.test(s.upstream))
    )
      problems.push(`${file}: service ${s.id} upstream must be loopback`);
    if (s.expose === "socket-proxyd") {
      const ownerAddress =
        s.host === t.hub.peer
          ? t.hub.address
          : t.peers.find((peer) => peer.host === s.host)?.address;
      if (s.address !== ownerAddress)
        problems.push(
          `${file}: service ${s.id} must listen on its declared owner address`,
        );
    }
  }
  for (const [peer, list] of Object.entries(t.grants)) {
    if (!ids.has(peer))
      problems.push(`${file}: grant for unknown peer ${peer}`);
    for (const id of list)
      if (!services.has(id))
        problems.push(`${file}: grant ${peer} -> unknown service ${id}`);
  }
  if (
    !t.firewall.marker ||
    t.firewall.foreignMarkers.some(
      (m) => t.firewall.marker.includes(m) || m.includes(t.firewall.marker),
    )
  )
    problems.push(`${file}: firewall marker collides with a foreign marker`);
  const members = new Set([t.hub.peer, ...t.peers.map((p) => p.id)]);
  for (const m of t.mesh ?? [])
    for (const id of [...m.from, ...m.to]) {
      if (!members.has(id))
        problems.push(`${file}: mesh ${m.id} names unknown member ${id}`);
      if (m.to.includes(id) && t.firewall.meshDenied?.includes(id))
        problems.push(
          `${file}: mesh ${m.id} opens every port of ${id}, which is meshDenied`,
        );
    }
  for (const rule of ufwRules(t))
    if (t.firewall.foreignMarkers.some((m) => rule.text.includes(m)))
      problems.push(`${file}: ufw rule carries a foreign marker: ${rule.text}`);
  return problems;
}

const KEY_LINE =
  /^((?:[^\s"]|"[^"]*")+)\s+(?:sk-)?(?:ssh-ed25519|ecdsa-sha2-nistp\d+|ssh-rsa)(?:@openssh\.com)?\s+[A-Za-z0-9+/=]+(?:\s.*)?$/;
export function accountProblems(
  root: string,
  accounts: HostAccount[],
  t?: Tunnel,
): string[] {
  const problems: string[] = [];
  for (const a of accounts) {
    const tag = `account ${a.user}`;
    for (const f of [
      a.authorizedKeys,
      a.sudoers,
      ...a.sshdDropIns.map((d) => d.file),
    ])
      if (!existsSync(join(root, f)))
        problems.push(`${tag}: missing file ${f}`);
    if (a.groups.some((g) => ["postgres", "docker", "sudo", "adm"].includes(g)))
      problems.push(
        `${tag}: no postgres, docker, sudo or adm group (sudo is granted by the sudoers file alone)`,
      );
    const peer = t?.peers.find((p) => p.id === a.user);
    if (peer && !a.allowedFrom.includes(peer.address))
      problems.push(
        `${tag}: tunnel address ${peer.address} missing from allowedFrom`,
      );
    for (const f of [
      a.authorizedKeys,
      a.sudoers,
      ...a.sshdDropIns.map((d) => d.file),
    ]) {
      const text = readIfExists(root, f);
      if (text !== undefined && PRIVATE_KEY_PATTERN.test(text))
        problems.push(`${tag}: ${f} contains private key material`);
    }
    const keys = readIfExists(root, a.authorizedKeys);
    for (const raw of (keys ?? "").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const m = KEY_LINE.exec(line);
      if (!m) {
        problems.push(`${tag}: key line is not "options type key [comment]"`);
        continue;
      }
      const options = m[1] ?? "";
      const from = /(^|,)from="([^"]+)"/.exec(options)?.[2];
      if (!from) problems.push(`${tag}: key line without from=`);
      else
        for (const entry of from.split(","))
          if (!a.allowedFrom.includes(entry))
            problems.push(`${tag}: from=${entry} is not in allowedFrom`);
      if (!/(^|,)restrict(,|$)/.test(options))
        problems.push(`${tag}: key line without restrict`);
    }
    const sudoers = readIfExists(root, a.sudoers) ?? "";
    const rules = sudoers
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#"));
    const grants = rules.filter((l) => !l.startsWith("Defaults"));
    if (grants.length !== 1 || !grants[0]!.startsWith(`${a.user} `))
      problems.push(
        `${tag}: sudoers must hold exactly one rule, for ${a.user}`,
      );
    if (
      rules.some(
        (l) => l.startsWith("Defaults") && !l.startsWith(`Defaults:${a.user} `),
      )
    )
      problems.push(`${tag}: sudoers Defaults must be scoped to ${a.user}`);
    if (rules.some((l) => l.includes("%") || l.includes("#include")))
      problems.push(`${tag}: sudoers must not grant a group or include a file`);
    const own = a.sshdDropIns.find((d) =>
      (readIfExists(root, d.file) ?? "").includes(`Match User ${a.user}`),
    );
    const sshd = own ? (readIfExists(root, own.file) ?? "") : "";
    for (const need of [
      `Match User ${a.user}`,
      "AuthenticationMethods publickey",
      "PasswordAuthentication no",
      "GatewayPorts no",
      "AuthorizedKeysFile /etc/ssh/authorized_keys.d/%u",
    ])
      if (!sshd.includes(need))
        problems.push(`${tag}: ${own?.file ?? "sshd drop-in"} lacks "${need}"`);
    // Forwarding: none, or loopback-only: reverse (-R) onto 127.0.0.1 ports (PermitListen) and local (-L)
    // limited to explicit 127.0.0.1 ports (PermitOpen), never an open or remote destination.
    const forwarding = /^\s*AllowTcpForwarding\s+(\S+)\s*$/m.exec(sshd)?.[1];
    if (
      forwarding === "remote" ||
      forwarding === "local" ||
      forwarding === "yes"
    ) {
      const open =
        /^\s*PermitOpen\s+(.+)$/m.exec(sshd)?.[1]?.trim().split(/\s+/) ?? [];
      if (
        open.length === 0 ||
        open.some((o) => o !== "none" && !/^127\.0\.0\.1:\d+$/.test(o))
      )
        problems.push(
          `${tag}: forwarding needs "PermitOpen none" or 127.0.0.1:<port> entries only`,
        );
      const listen =
        /^\s*PermitListen\s+(.+)$/m.exec(sshd)?.[1]?.trim().split(/\s+/) ?? [];
      if (
        forwarding !== "local" &&
        (listen.length === 0 ||
          listen.some((l) => !/^127\.0\.0\.1:\d+$/.test(l)))
      )
        problems.push(
          `${tag}: remote forwarding must list PermitListen 127.0.0.1:<port> entries only`,
        );
    } else if (forwarding !== "no")
      problems.push(
        `${tag}: ${own?.file ?? "sshd drop-in"} lacks "AllowTcpForwarding no" (or loopback-only forwarding)`,
      );
    if (a.postgresAccess === "sudo-only") {
      const deny = a.sshdDropIns
        .filter((d) => d.hosts.includes("dbfr"))
        .some((d) =>
          /^DenyUsers\s+postgres\s*$/m.test(readIfExists(root, d.file) ?? ""),
        );
      if (a.hosts.includes("dbfr") && !deny)
        problems.push(
          `${tag}: postgres is sudo-only but no dbfr sshd drop-in denies the postgres login`,
        );
    }
  }
  return problems;
}

// ── rendering ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const HUB_KEY_PLACEHOLDER =
  "<CLE_PUBLIQUE_DU_HUB: sudo wg show wg1 public-key sur le vps, apres l'apply>";

function peerById(t: Tunnel, id: string): TunnelPeer {
  const p = t.peers.find((x) => x.id === id);
  if (!p)
    throw new Error(
      `unknown peer: ${id} (${t.peers.map((x) => x.id).join(", ")})`,
    );
  return p;
}
const envName = (id: string) =>
  `${id.toUpperCase().replaceAll("-", "_")}_PUBLIC_KEY`;

export interface ClientSections {
  interface: string;
  peer: string;
  hubKeyKnown: boolean;
}
/** `[Interface]` (Address only, no key) and `[Peer]` (the hub) of a client. Split tunnel: AllowedIPs is the subnet, never /0. */
export function clientSections(
  t: Tunnel,
  peerId: string,
  hubPublicKey?: string | null,
): ClientSections {
  const p = peerById(t, peerId);
  const hub = hubPublicKey ?? t.hub.publicKey;
  if (hub != null && !isWgKey(hub))
    throw new Error(
      "hub public key is not a WireGuard key (44 base64 characters, 32 bytes)",
    );
  if (t.clientAllowedIps.endsWith("/0"))
    throw new Error("refusing a default route: split tunnel only");
  return {
    interface: [`[Interface]`, `Address = ${p.address}/32`].join("\n"),
    peer: [
      `[Peer]`,
      `# hub aphrody (vps)`,
      `PublicKey = ${hub ?? HUB_KEY_PLACEHOLDER}`,
      `Endpoint = ${t.hub.endpoint}`,
      `AllowedIPs = ${t.clientAllowedIps}`,
      `PersistentKeepalive = ${t.keepalive}`,
    ].join("\n"),
    hubKeyKnown: hub != null,
  };
}
/**
 * What goes under the `PrivateKey` line the WireGuard for Windows app writes in an empty tunnel: the Interface lines after the key,
 * then the Peer section. The app refuses to import a file that has no PrivateKey (conf/parser.go, "An interface must have a private
 * key"), so a key-less `.conf` cannot be a one-click import: the key must be born in the app.
 */
export function clientPasteBlock(
  t: Tunnel,
  peerId: string,
  hubPublicKey?: string | null,
): string {
  const s = clientSections(t, peerId, hubPublicKey);
  return `${s.interface.split("\n").slice(1).join("\n")}\n\n${s.peer}\n`;
}
/** A complete wg-quick file. The private key comes from the caller (file or stdin) and is validated, never stored here. */
export function clientConf(
  t: Tunnel,
  peerId: string,
  hubPublicKey: string,
  privateKey: string,
): string {
  if (!isWgKey(privateKey.trim()))
    throw new Error(
      "private key is not a WireGuard key (44 base64 characters, 32 bytes)",
    );
  if (!isWgKey(hubPublicKey))
    throw new Error("--hub-public-key is required for a complete .conf");
  const s = clientSections(t, peerId, hubPublicKey);
  const [head, address] = s.interface.split("\n");
  return `${head}\nPrivateKey = ${privateKey.trim()}\n${address}\n\n${s.peer}\n`;
}
/** Refuses a destination inside the checkout so a private key cannot end up in the repository. */
export function assertOutsideRepo(path: string, repoRoot: string): void {
  const target = resolve(path);
  let dir = dirname(target);
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
  const real = join(realpathSync(dir), relative(dir, target));
  const rel = relative(realpathSync(repoRoot), real);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)))
    throw new Error(`refusing to write inside the repository: ${path}`);
}

export interface HubConfig {
  /** Text with the private key and the not-yet-known peer keys as visible placeholders (what the plan prints). */
  text: string;
  /** Peers whose public key is an apply-time input (`<ID>_PUBLIC_KEY`). */
  needs: { peer: string; env: string; origin: string }[];
}
export function hubConfig(t: Tunnel): HubConfig {
  const needs: HubConfig["needs"] = [];
  const lines = [
    `[Interface]`,
    `Address = ${t.hub.address}/${parseCidr(t.subnet)?.bits}`,
    `ListenPort = ${t.hub.listenPort}`,
    `PrivateKey = <read from ${t.keyFiles.private} at install, never printed>`,
  ];
  for (const p of t.peers) {
    const key =
      p.publicKey ??
      (() => {
        needs.push({
          peer: p.id,
          env: envName(p.id),
          origin: p.publicKeyNote ?? p.keyOrigin,
        });
        return `\${${envName(p.id)}}`;
      })();
    lines.push(
      "",
      `[Peer]`,
      `# ${p.id}`,
      `PublicKey = ${key}`,
      `AllowedIPs = ${p.address}/32`,
    );
  }
  return { text: `${lines.join("\n")}\n`, needs };
}
function linuxPeerConf(t: Tunnel, p: TunnelPeer): string {
  return [
    `[Interface]`,
    `Address = ${p.address}/32`,
    `PrivateKey = <read from ${t.keyFiles.private} at install, never printed>`,
    ``,
    `[Peer]`,
    `# hub aphrody (vps)`,
    `PublicKey = \${HUB_PUBLIC_KEY}`,
    `Endpoint = ${t.hub.endpoint}`,
    `AllowedIPs = ${t.clientAllowedIps}`,
    `PersistentKeepalive = ${t.keepalive}`,
    ``,
  ].join("\n");
}

export interface UfwRule {
  peer: string;
  service?: string;
  kind: "udp-source" | "input" | "route";
  command: string;
  text: string;
}
/** The ufw rules of the hub (vps). Only specific sources, never "Anywhere"; comment `aphrody-wg-<peer>`. */
export function ufwRules(t: Tunnel): UfwRule[] {
  const rules: UfwRule[] = [];
  const iface = t.interface;
  const add = (
    peer: string,
    kind: UfwRule["kind"],
    command: string,
    service?: string,
  ) =>
    rules.push({
      peer,
      service,
      kind,
      command: `ufw ${command}`,
      text: `ufw ${command}`,
    });
  for (const p of t.peers)
    if (p.udpSource.mode === "ufw")
      for (const ip of p.udpSource.ips ?? [])
        add(
          p.id,
          "udp-source",
          `allow from ${ip} to any port ${t.hub.listenPort} proto udp comment '${t.firewall.marker}-${p.id}'`,
        );
  const services = new Map(t.services.map((s) => [s.id, s]));
  for (const [peerId, ids] of Object.entries(t.grants))
    for (const id of ids) {
      const s = services.get(id);
      const p =
        peerId === t.hub.peer
          ? { address: t.hub.address }
          : t.peers.find((x) => x.id === peerId);
      if (
        !s ||
        !p ||
        s.status === "pending" ||
        s.port === undefined ||
        s.address === p.address
      )
        continue;
      const comment = `comment '${t.firewall.marker}-${peerId}'`;
      // Traffic the hub originates leaves through OUTPUT, which ufw admits: no forwarding rule applies.
      if (peerId === t.hub.peer) continue;
      if (s.host === t.hub.peer)
        add(
          peerId,
          "input",
          `allow in on ${iface} from ${p.address} to ${s.address} port ${s.port} proto tcp ${comment}`,
          id,
        );
      else
        add(
          peerId,
          "route",
          `route allow in on ${iface} out on ${iface} from ${p.address} to ${s.address} port ${s.port} proto tcp ${comment}`,
          id,
        );
    }
  for (const m of t.mesh ?? [])
    for (const from of m.from)
      for (const to of m.to) {
        const src =
          from === t.hub.peer
            ? t.hub.address
            : t.peers.find((x) => x.id === from)?.address;
        const dst =
          to === t.hub.peer
            ? t.hub.address
            : t.peers.find((x) => x.id === to)?.address;
        // Hub-originated traffic leaves through OUTPUT; a member never needs a rule towards itself.
        if (!src || !dst || from === to || from === t.hub.peer) continue;
        const comment = `comment '${t.firewall.marker}-${from}'`;
        if (to === t.hub.peer)
          add(
            from,
            "input",
            `allow in on ${iface} from ${src} to ${dst} ${comment}`,
            `mesh:${m.id}:${to}`,
          );
        else
          add(
            from,
            "route",
            `route allow in on ${iface} out on ${iface} from ${src} to ${dst} ${comment}`,
            `mesh:${m.id}:${to}`,
          );
      }
  return rules;
}

// ── plan ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type WgHost = "vps" | "dbfr" | "wsl" | "windows";
export type WgPhase =
  "preflight" | "provision" | "install" | "verify" | "rollback" | "manual";
/** `check` blocks the plan, `warn` reports a risk, `info` only reads, `mutate` changes the host, `pending` waits for an input. */
export type WgKind = "check" | "warn" | "info" | "mutate" | "pending";
export interface WgStep {
  id: string;
  host: WgHost;
  phase: WgPhase;
  kind: WgKind;
  note: string;
  /** Root shell text on `host` (`set -eu` scripts for mutations). Variables named in `needs` are apply-time inputs. */
  run?: string;
  needs?: string[];
  /** Shown instead of the raw command output when an observed step fails. */
  onFail?: string;
  /** Observe-only evaluation computed here instead of on the host (not serialised). */
  probe?: (runner: Runner) => Promise<{ ok: boolean; detail: string }>;
}
export interface WgPlan {
  name: string;
  status: "plan-only";
  interface: string;
  subnet: string;
  hub: string;
  hubConfig: string;
  clients: Record<
    string,
    { interface: string; peer: string; pasteBlock: string }
  >;
  ufw: UfwRule[];
  sequence: string[];
  pending: string[];
  decisions: string[];
  steps: WgStep[];
}
export type Runner = (
  host: WgHost,
  command: string,
) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface PlanContext {
  root: string;
  catalog: HostCatalog;
  compose: (unit: string) => string;
}

const b64 = (text: string) => Buffer.from(text).toString("base64");
const prefix = (subnet: string) =>
  (subnet.split("/")[0] ?? "").split(".").slice(0, 3).join(".");
const dots = (s: string) => s.replaceAll(".", "\\.");

function hubScript(t: Tunnel, cfg: HubConfig): string {
  const body = cfg.text.split("\n");
  const keyAt = body.findIndex((l) => l.startsWith("PrivateKey ="));
  const head = body.slice(0, keyAt).join("\n");
  const tail = body
    .slice(keyAt + 1)
    .join("\n")
    .replace(
      /\$\{(\w+)\}/g,
      (_m, name: string) => `\${${name}:?${name} is an apply-time input}`,
    );
  return [
    `set -eu`,
    `umask 077`,
    `{`,
    `cat <<'HEAD'`,
    head,
    `HEAD`,
    `printf 'PrivateKey = %s\\n' "$(cat ${t.keyFiles.private})"`,
    `cat <<EOF`,
    tail.replace(/\n+$/, ""),
    `EOF`,
    `} > /etc/wireguard/${t.interface}.conf.new`,
    `mv /etc/wireguard/${t.interface}.conf.new /etc/wireguard/${t.interface}.conf`,
    `chmod 0600 /etc/wireguard/${t.interface}.conf`,
  ].join("\n");
}
function peerScript(t: Tunnel, p: TunnelPeer): string {
  const conf = linuxPeerConf(t, p).split("\n");
  const keyAt = conf.findIndex((l) => l.startsWith("PrivateKey ="));
  return [
    `set -eu`,
    `umask 077`,
    `{`,
    `cat <<'HEAD'`,
    conf.slice(0, keyAt).join("\n"),
    `HEAD`,
    `printf 'PrivateKey = %s\\n' "$(cat ${t.keyFiles.private})"`,
    `cat <<EOF`,
    conf
      .slice(keyAt + 1)
      .join("\n")
      .replace(/\n+$/, "")
      .replace(
        "${HUB_PUBLIC_KEY}",
        "${HUB_PUBLIC_KEY:?HUB_PUBLIC_KEY is an apply-time input}",
      ),
    `EOF`,
    `} > /etc/wireguard/${t.interface}.conf.new`,
    `mv /etc/wireguard/${t.interface}.conf.new /etc/wireguard/${t.interface}.conf`,
    `chmod 0600 /etc/wireguard/${t.interface}.conf`,
  ].join("\n");
}
const keygen = (t: Tunnel) =>
  [
    `set -eu`,
    `install -d -m 0700 /etc/wireguard`,
    `umask 077`,
    `[ -s ${t.keyFiles.private} ] || wg genkey > ${t.keyFiles.private}`,
    `wg pubkey < ${t.keyFiles.private} > ${t.keyFiles.public}`,
    `chmod 0600 ${t.keyFiles.private}; chmod 0644 ${t.keyFiles.public}`,
  ].join("\n");

/** Base64 blobs of the key lines of an authorized_keys text. */
export function keyBlobs(keys: string): string[] {
  return keys
    .split("\n")
    .map(
      (l) =>
        /\s(?:sk-)?(?:ssh-ed25519|ecdsa-sha2-nistp\d+|ssh-rsa)(?:@openssh\.com)?\s+([A-Za-z0-9+/=]+)/.exec(
          l.trim(),
        )?.[1],
    )
    .filter((b): b is string => Boolean(b));
}

function accountSteps(
  ctx: PlanContext,
  t: Tunnel,
  host: "vps" | "dbfr",
): WgStep[] {
  const steps: WgStep[] = [];
  for (const a of ctx.catalog.accounts ?? []) {
    if (!a.hosts.includes(host)) continue;
    const id = (s: string) => `${host}.account.${a.user}.${s}`;
    const keys = readIfExists(ctx.root, a.authorizedKeys) ?? "";
    const hasKey = keys
      .split("\n")
      .some((l) => l.trim() && !l.trim().startsWith("#"));
    steps.push(
      {
        id: id("absent"),
        host,
        phase: "preflight",
        kind: "info",
        note: `${a.user} does not exist yet (getent)`,
        run: `getent passwd ${a.user} || echo "${a.user}: absent"`,
      },
      {
        id: id("sudo-impl"),
        host,
        phase: "preflight",
        kind: "info",
        note: "sudo implementation: sudo-rs logs to syslog only (journald), no I/O log",
        run: `sudo --version | head -1; readlink -f /usr/bin/sudo`,
      },
      {
        id: id("journal"),
        host,
        phase: "preflight",
        kind: "check",
        note: "journald is persistent, so sudo history survives a reboot",
        run: `test -d /var/log/journal`,
      },
      ...keyBlobs(keys).map((blob, n): WgStep => ({
        id: id(`key-not-on-other-logins.${n}`),
        host,
        phase: "preflight",
        kind: "warn",
        note: `omar's ssh key is not also a line of the ubuntu or root authorized_keys (otherwise those logins bypass the omar restrictions)`,
        run: `! sudo -n grep -qF -- '${blob}' /home/ubuntu/.ssh/authorized_keys /root/.ssh/authorized_keys 2>/dev/null`,
        onFail:
          "the same key is already a line of ubuntu or root authorized_keys on this host: it opens a full-sudo login that bypasses the omar account",
      })),
      {
        id: id("visudo"),
        host,
        phase: "preflight",
        kind: "check",
        note: "visudo is available to validate the sudoers drop-in before install",
        run: `test -x /usr/sbin/visudo`,
      },
      {
        id: id("user"),
        host,
        phase: "provision",
        kind: "mutate",
        note: `create ${a.user} (no password, no extra group, key-only login)`,
        run: `set -eu\nid -u ${a.user} >/dev/null 2>&1 || useradd --create-home --shell /bin/bash --comment 'Omar (aphrody private tunnel guest)' ${a.user}`,
      },
    );
    for (const d of a.sshdDropIns.filter((x) => x.hosts.includes(host))) {
      const text = readFileSync(join(ctx.root, d.file), "utf8");
      steps.push({
        id: id(`sshd:${d.install.split("/").pop()}`),
        host,
        phase: "install",
        kind: "mutate",
        note: `install ${d.install}, validate with sshd -t, reload ssh`,
        run: [
          `set -eu`,
          `echo ${b64(text)} | base64 -d > ${d.install}.new`,
          `chmod 0644 ${d.install}.new; mv ${d.install}.new ${d.install}`,
          `sshd -t && { systemctl reload ssh || systemctl reload sshd; }`,
        ].join("\n"),
      });
    }
    steps.push(
      hasKey
        ? {
            id: id("keys"),
            host,
            phase: "install",
            kind: "mutate",
            note: "install the root-owned authorized_keys file",
            run: `set -eu\ninstall -d -m 0755 /etc/ssh/authorized_keys.d\necho ${b64(keys)} | base64 -d > /etc/ssh/authorized_keys.d/${a.user}\nchmod 0644 /etc/ssh/authorized_keys.d/${a.user}`,
          }
        : {
            id: id("keys"),
            host,
            phase: "install",
            kind: "pending",
            note: `${a.authorizedKeys} holds no key line: the ssh-ed25519 public key is not received yet, so the account stays unable to log in (no key is invented)`,
          },
      {
        id: id("sudoers"),
        host,
        phase: "install",
        kind: "mutate",
        note: `install /etc/sudoers.d/${a.user} (0440) only if visudo accepts it`,
        run: [
          `set -eu`,
          `echo ${b64(readFileSync(join(ctx.root, a.sudoers), "utf8"))} | base64 -d > /etc/sudoers.d/${a.user}.new`,
          `chmod 0440 /etc/sudoers.d/${a.user}.new`,
          `visudo -c -f /etc/sudoers.d/${a.user}.new`,
          `mv /etc/sudoers.d/${a.user}.new /etc/sudoers.d/${a.user}`,
        ].join("\n"),
      },
      {
        id: id("verify-sshd"),
        host,
        phase: "verify",
        kind: "check",
        note: "effective sshd values for omar from his public address",
        run: `sudo -n sshd -T -C user=${a.user},host=x,addr=${a.allowedFrom[0]} | grep -E '^(authenticationmethods publickey|passwordauthentication no|allowtcpforwarding (no|remote)|gatewayports no|authorizedkeysfile /etc/ssh/authorized_keys.d/%u)$' | wc -l | grep -qx 5`,
      },
      {
        id: id("verify-sudo"),
        host,
        phase: "verify",
        kind: "check",
        note: "sudo -l for omar lists the single NOPASSWD rule",
        run: `sudo -n -l -U ${a.user} | grep -q 'NOPASSWD: ALL'`,
      },
      {
        id: id("rollback"),
        host,
        phase: "rollback",
        kind: "mutate",
        note: "lock the account and remove the grants; the home directory stays",
        run: `set -eu\nrm -f /etc/sudoers.d/${a.user} /etc/ssh/authorized_keys.d/${a.user} ${a.sshdDropIns
          .filter((x) => x.hosts.includes(host))
          .map((x) => x.install)
          .join(
            " ",
          )}\nsshd -t && { systemctl reload ssh || systemctl reload sshd; }\nid -u ${a.user} >/dev/null 2>&1 && usermod --lock --expiredate 1 ${a.user} || true`,
      },
    );
    if (a.postgresAccess === "sudo-only" && host === "dbfr")
      steps.push(
        {
          id: id("pg-no-group"),
          host,
          phase: "preflight",
          kind: "check",
          note: "omar is not (and will not be) in the postgres group",
          run: `! id -nG ${a.user} 2>/dev/null | tr ' ' '\\n' | grep -qx postgres`,
        },
        {
          id: id("pg-no-ssh-key"),
          host,
          phase: "preflight",
          kind: "check",
          note: "no ssh key exists for the postgres login, so DenyUsers postgres cuts nothing in use",
          run: `! test -e /var/lib/postgresql/.ssh/authorized_keys`,
        },
        {
          id: id("pg-hba-clean"),
          host,
          phase: "preflight",
          kind: "check",
          note: `pg_hba.conf has no entry for the tunnel subnet ${t.subnet} (Shenron owns pg_hba; this lot adds none)`,
          run: `! sudo -n grep -Eq '^[^#]*${dots(prefix(t.subnet))}\\.' /etc/postgresql/18/main/pg_hba.conf`,
        },
        {
          id: id("pg-ufw-clean"),
          host,
          phase: "preflight",
          kind: "check",
          note: "no ufw rule opens 5432 or 6379 to the tunnel subnet",
          run: `! sudo -n ufw status | grep -E '(^|[[:space:]])(5432|6379)' | grep -q '${dots(prefix(t.subnet))}\\.'`,
        },
        {
          id: id("pg-direct"),
          host,
          phase: "verify",
          kind: "check",
          note: "sshd refuses a direct postgres login",
          run: `sudo -n sshd -T | grep -qx 'denyusers postgres'`,
        },
      );
  }
  return steps;
}

export function buildPlan(t: Tunnel, ctx: PlanContext): WgPlan {
  const steps: WgStep[] = [];
  const hub = hubConfig(t);
  const net = prefix(t.subnet);
  const clients: WgPlan["clients"] = {};
  for (const p of t.peers) {
    const s = clientSections(t, p.id);
    clients[p.id] = {
      interface: s.interface,
      peer: s.peer,
      pasteBlock: clientPasteBlock(t, p.id),
    };
  }
  const rules = ufwRules(t);
  const proxies = t.services.filter(
    (s) =>
      s.host === t.hub.peer &&
      s.expose === "socket-proxyd" &&
      s.port !== undefined,
  );
  const pending: string[] = [];
  for (const p of t.peers)
    if (p.publicKey === null)
      pending.push(`${p.id}: public key (${p.publicKeyNote ?? p.keyOrigin})`);
  for (const a of ctx.catalog.accounts ?? []) {
    const keys = readIfExists(ctx.root, a.authorizedKeys) ?? "";
    if (!keys.split("\n").some((l) => l.trim() && !l.trim().startsWith("#")))
      pending.push(
        `${a.user}: ssh-ed25519 public key (${a.authorizedKeys} has no key line)`,
      );
  }
  pending.push(
    `hub: ${t.interface} public key, generated on the vps at apply, needed by every client`,
  );
  for (const s of t.services)
    if (s.status === "pending") pending.push(`${s.id}: ${s.pendingReason}`);

  const decisions = [
    ...(ctx.catalog.accounts ?? []).flatMap((a) =>
      (a.findings ?? []).map((f) => `${a.user}: ${f}`),
    ),
    ...t.services
      .filter((s) => s.caveat)
      .map((s) => `${s.id} (${s.auth}): ${s.caveat}`),
    "interface and subnet: wg0 is already the live Shenron link (10.8.0.0/24, ufw `Anywhere on wg0 ALLOW IN`), so the hub is a new wg1 on 10.200.77.0/24, UDP 51821",
    "sudo for omar is NOPASSWD:ALL (no Unix password exists) with sudo-rs journaling to journald only; there is no I/O log",
    "omar from= lists 92.170.252.46 and 10.200.77.10 (through the tunnel sshd sees the tunnel address); drop the second to force the public path",
    "92.170.252.46 already holds a Shenron `shenron-admin` ufw rule (all ports) on vps and dbfr, so Omar can already reach dbfr:5432 (scram) from it: remove it from Shenron's admin list (outside this lot) to keep postgres sudo-only",
    "vps sshd allows PasswordAuthentication yes and PermitRootLogin yes (00-hardening.conf): pre-existing, untouched here; omar is key-only through his Match block",
  ];

  // vps
  const vps = (
    id: string,
    phase: WgPhase,
    kind: WgKind,
    note: string,
    run?: string,
    extra: Partial<WgStep> = {},
  ) =>
    steps.push({
      id: `vps.${id}`,
      host: "vps",
      phase,
      kind,
      note,
      run,
      ...extra,
    });
  const wgPre = (host: "vps" | "dbfr" | "wsl") => {
    const checks: { id: string; note: string; run: string }[] = [
      {
        id: "tools",
        note: "wireguard-tools present",
        run: `command -v wg wg-quick >/dev/null`,
      },
      {
        id: "iface-free",
        note: `${t.interface} does not exist yet`,
        run: `! ip link show ${t.interface} >/dev/null 2>&1`,
      },
      {
        id: "conf-free",
        note: `/etc/wireguard/${t.interface}.conf does not exist yet`,
        run: `! sudo -n test -e /etc/wireguard/${t.interface}.conf`,
      },
      {
        id: "subnet-free",
        note: `no route already uses ${t.subnet}`,
        run: `! ip -4 route | grep -Eq '(^|[[:space:]])${dots(net)}\\.'`,
      },
    ];
    for (const c of checks)
      steps.push({
        ...c,
        id: `${host}.${c.id}`,
        host,
        phase: "preflight",
        kind: c.id === "tools" && host === "wsl" ? "warn" : "check",
        onFail:
          c.id === "tools" && host === "wsl"
            ? "not installed: the provision step installs wireguard-tools"
            : undefined,
        note:
          c.id === "tools" && host === "wsl"
            ? "wireguard-tools present (installed by the provision step when missing)"
            : c.note,
      });
  };
  wgPre("vps");
  vps(
    "udp-free",
    "preflight",
    "check",
    `UDP ${t.hub.listenPort} is free`,
    `! ss -lunH | awk '{print $4}' | grep -q ':${t.hub.listenPort}$'`,
  );
  vps(
    "ip-forward",
    "preflight",
    "check",
    "net.ipv4.ip_forward is 1 (peer to peer traffic is routed by the hub; wg0's PostUp is not touched)",
    `[ "$(sysctl -n net.ipv4.ip_forward)" = 1 ]`,
  );
  vps(
    "ufw-active",
    "preflight",
    "check",
    "ufw is active (default deny incoming, deny routed)",
    `sudo -n ufw status verbose | grep -E '^Status: active|^Default: deny \\(incoming\\).*deny \\(routed\\)' | wc -l | grep -qx 2`,
  );
  vps(
    "ufw-syntax",
    "preflight",
    "check",
    "the installed ufw accepts every rule below (ufw --dry-run, nothing is changed)",
    rules
      .map(
        (r) =>
          `sudo -n ${r.command.replace(/^ufw /, "ufw --dry-run ")} >/dev/null`,
      )
      .join(" && "),
  );
  vps(
    "ufw-fresh",
    "preflight",
    "check",
    "no aphrody-wg rule and no rule for the tunnel subnet exists yet",
    `! sudo -n ufw status | grep -E 'aphrody-wg|${dots(net)}\\.'`,
  );
  vps(
    "shenron-admin-clean",
    "preflight",
    "check",
    "the tunnel subnet is not in Shenron's admin list (shenron-admin ufw rules)",
    `! sudo -n ufw status | grep shenron-admin | grep -q '${dots(net)}\\.'`,
  );
  const omarIps = t.peers.flatMap((p) =>
    p.udpSource.mode === "ufw" ? (p.udpSource.ips ?? []) : [],
  );
  for (const ip of omarIps)
    vps(
      `admin-overlap.${ip}`,
      "preflight",
      "warn",
      `${ip} must not also hold a shenron-admin all-ports rule (it would bypass the narrow tunnel rule and open dbfr:5432)`,
      `! sudo -n ufw status | grep shenron-admin | grep -qF ${ip}`,
      {
        onFail: `${ip} holds a shenron-admin rule today (all ports on vps and dbfr, scram pg_hba on dbfr): remove it from the Shenron admin list, outside this lot`,
      },
    );
  vps(
    "workstation-coverage",
    "preflight",
    "info",
    "the workstation public address (WSL and Windows share it) and the dbfr address are shenron-admin sources on the vps, so UDP reaches wg1 without a second ufw rule",
    `sudo -n ufw status numbered | grep -c shenron-admin`,
    {
      probe: async (runner) => {
        let ip = "";
        try {
          ip = (
            await (
              await fetch("https://api.ipify.org", {
                signal: AbortSignal.timeout(8000),
              })
            ).text()
          ).trim();
        } catch {
          return {
            ok: false,
            detail: "workstation public address unavailable (api.ipify.org)",
          };
        }
        const r = await runner("vps", "sudo -n ufw status numbered");
        const line = r.stdout.split("\n").find((l) => l.includes(ip));
        return {
          ok: Boolean(line?.includes("shenron-admin")),
          detail: `workstation address ${ip.split(".").slice(0, 2).join(".")}.x.x ${line?.includes("shenron-admin") ? "is" : "is NOT"} a shenron-admin source`,
        };
      },
    },
  );
  for (const s of proxies)
    vps(
      `holder.${s.port}`,
      "preflight",
      "info",
      `who holds :${s.port} on the vps today${s.port === 8789 ? " (MCP-A2A.md finding 1: sshd, the WSL compute reverse tunnel)" : ""}`,
      `sudo -n ss -ltnp 'sport = :${s.port}' | tail -n +2 | cut -c1-140; true`,
    );
  for (const s of proxies)
    vps(
      `port-free.${s.port}`,
      "preflight",
      "check",
      `${t.hub.address}:${s.port} can be bound for the forwarder (no wildcard listener on :${s.port})`,
      `! ss -ltnH | awk '{print $4}' | grep -Eq '^(0\\.0\\.0\\.0|\\[::\\]|\\*|${dots(t.hub.address)}):${s.port}$'`,
      {
        onFail: `a wildcard listener holds :${s.port} (see holder.${s.port}): the forwarder cannot bind until the owner frees it`,
      },
    );
  vps(
    "keygen",
    "provision",
    "mutate",
    `private key born on the vps (0600, never printed), public half in ${t.keyFiles.public}`,
    keygen(t),
  );
  vps(
    "sysctl",
    "provision",
    "mutate",
    "persist ip_forward",
    `set -eu\nprintf 'net.ipv4.ip_forward=1\\n' > /etc/sysctl.d/60-aphrody-wg.conf\nsysctl -p /etc/sysctl.d/60-aphrody-wg.conf`,
  );
  vps(
    "hub-conf",
    "provision",
    "mutate",
    `render /etc/wireguard/${t.interface}.conf (0600); peers without a key are apply-time inputs`,
    hubScript(t, hub),
    { needs: hub.needs.map((n) => n.env) },
  );
  vps(
    "hub-verify-conf",
    "provision",
    "check",
    "the rendered file parses",
    `wg-quick strip ${t.interface} >/dev/null`,
  );
  for (const r of rules)
    vps(
      `ufw.${r.peer}.${r.service ?? "udp"}`,
      "install",
      "mutate",
      `${r.kind}: ${r.peer}${r.service ? ` -> ${r.service}` : ""}`,
      `sudo ${r.command}`,
    );
  for (const ext of ["socket", "service"] as const) {
    const unit = `aphrody-wg-proxy@.${ext}`;
    vps(
      `unit.${ext}`,
      "install",
      "mutate",
      `install ${unit} (composed from the catalog)`,
      `set -eu\necho ${b64(ctx.compose(unit))} | base64 -d > /etc/systemd/system/${unit}\nchmod 0644 /etc/systemd/system/${unit}`,
    );
  }
  vps(
    "systemd-verify",
    "install",
    "check",
    "systemd accepts the units",
    `systemd-analyze verify ${proxies.flatMap((s) => [`/etc/systemd/system/aphrody-wg-proxy@${s.port}.socket`, `/etc/systemd/system/aphrody-wg-proxy@${s.port}.service`]).join(" ")}`,
  );
  vps(
    "start",
    "install",
    "mutate",
    `start ${t.interface} and the forwarders`,
    `set -eu\nsystemctl daemon-reload\nsystemctl enable --now wg-quick@${t.interface}\nsystemctl enable --now ${proxies.map((s) => `aphrody-wg-proxy@${s.port}.socket`).join(" ")}`,
  );
  steps.push(...accountSteps(ctx, t, "vps"));
  vps(
    "verify-iface",
    "verify",
    "check",
    `${t.interface} is up on ${t.hub.address}`,
    `ip -4 -br a show ${t.interface} | grep -q '${t.hub.address}/'`,
  );
  vps(
    "verify-udp",
    "verify",
    "check",
    `UDP ${t.hub.listenPort} listens`,
    `ss -lunH | awk '{print $4}' | grep -q ':${t.hub.listenPort}$'`,
  );
  for (const s of proxies)
    vps(
      `verify-listen.${s.port}`,
      "verify",
      "check",
      `${t.hub.address}:${s.port} listens (tunnel address only)`,
      `ss -ltnH | awk '{print $4}' | grep -qx '${t.hub.address}:${s.port}'`,
    );
  vps(
    "verify-peers",
    "verify",
    "info",
    "latest handshakes per peer (a pending peer shows 0 until it connects)",
    `sudo -n wg show ${t.interface} latest-handshakes`,
  );
  vps(
    "verify-ufw",
    "verify",
    "check",
    "every aphrody-wg rule is a specific source (no Anywhere source)",
    `! sudo -n ufw status | grep aphrody-wg | grep -E 'Anywhere +#'`,
  );
  vps(
    "rollback",
    "rollback",
    "mutate",
    "remove the tunnel, the forwarders and the aphrody-wg ufw rules (shenron-admin and wg0 untouched)",
    [
      `set -u`,
      `systemctl disable --now ${proxies.map((s) => `aphrody-wg-proxy@${s.port}.socket`).join(" ")} wg-quick@${t.interface} 2>/dev/null || true`,
      `rm -f /etc/systemd/system/aphrody-wg-proxy@.socket /etc/systemd/system/aphrody-wg-proxy@.service /etc/sysctl.d/60-aphrody-wg.conf`,
      `systemctl daemon-reload`,
      `for n in $(ufw status numbered | grep 'aphrody-wg' | sed -E 's/^\\[ *([0-9]+)\\].*/\\1/' | sort -rn); do ufw --force delete "$n"; done`,
      `rm -f /etc/wireguard/${t.interface}.conf ${t.keyFiles.private} ${t.keyFiles.public}`,
    ].join("\n"),
  );

  // dbfr and wsl: clients of the hub
  for (const host of ["dbfr", "wsl"] as const) {
    const p = peerById(t, host);
    const h = (
      id: string,
      phase: WgPhase,
      kind: WgKind,
      note: string,
      run?: string,
      extra: Partial<WgStep> = {},
    ) =>
      steps.push({
        id: `${host}.${id}`,
        host,
        phase,
        kind,
        note,
        run,
        ...extra,
      });
    wgPre(host);
    if (host === "wsl") {
      h(
        "kernel-module",
        "preflight",
        "check",
        "the WSL kernel provides wireguard (CONFIG_WIREGUARD)",
        `modinfo wireguard >/dev/null 2>&1 || zcat /proc/config.gz | grep -Eq 'CONFIG_WIREGUARD=[ym]'`,
      );
      h(
        "systemd",
        "preflight",
        "check",
        "systemd runs in the WSL (wg-quick@ unit)",
        `[ -d /run/systemd/system ]`,
      );
      h(
        "install-tools",
        "provision",
        "mutate",
        "install wireguard-tools when missing",
        `set -eu\ncommand -v wg >/dev/null || apt-get install -y wireguard-tools`,
      );
    } else {
      h(
        "ufw-ssh",
        "preflight",
        "check",
        "dbfr already admits ssh (22/tcp): the tunnel needs no ufw change on dbfr",
        `sudo -n ufw status | grep -Eq '^22/tcp +ALLOW'`,
      );
      h(
        "ufw-no-5432",
        "preflight",
        "check",
        "no ufw rule opens PostgreSQL or Redis to the tunnel subnet",
        `! sudo -n ufw status | grep -E '(^|[[:space:]])(5432|6379)' | grep -q '${dots(net)}\\.'`,
      );
    }
    h(
      "keygen",
      "provision",
      "mutate",
      `private key born on ${host} (0600, never printed)`,
      keygen(t),
    );
    h(
      "conf",
      "provision",
      "mutate",
      `render /etc/wireguard/${t.interface}.conf (0600): Address ${p.address}/32, AllowedIPs ${t.clientAllowedIps} (split tunnel)`,
      peerScript(t, p),
      { needs: ["HUB_PUBLIC_KEY"] },
    );
    h(
      "start",
      "install",
      "mutate",
      `enable ${t.interface} at boot`,
      `systemctl enable --now wg-quick@${t.interface}`,
    );
    const localProxies = t.services.filter(
      (service) =>
        service.host === host &&
        service.expose === "socket-proxyd" &&
        service.port !== undefined,
    );
    if (localProxies.length > 0) {
      for (const ext of ["socket", "service"] as const) {
        const unit = `aphrody-wg-proxy@.${ext}`;
        // The same owner template is rendered for the actual peer address.
        const text = ctx.compose(unit).replaceAll(t.hub.address, p.address);
        h(
          `proxy-unit.${ext}`,
          "install",
          "mutate",
          `install ${unit} for ${host} at ${p.address}`,
          `set -eu\necho ${b64(text)} | base64 -d > /etc/systemd/system/${unit}\nchmod 0644 /etc/systemd/system/${unit}`,
        );
      }
      h(
        "proxy-verify",
        "install",
        "check",
        "systemd accepts this host's private proxy instances",
        `systemd-analyze verify ${localProxies.flatMap((service) => [`/etc/systemd/system/aphrody-wg-proxy@${service.port}.socket`, `/etc/systemd/system/aphrody-wg-proxy@${service.port}.service`]).join(" ")}`,
      );
      for (const [source, services] of Object.entries(t.grants)) {
        const sourceAddress =
          source === t.hub.peer
            ? t.hub.address
            : t.peers.find((peer) => peer.id === source)?.address;
        if (!sourceAddress || sourceAddress === p.address) continue;
        for (const service of localProxies.filter((candidate) =>
          services.includes(candidate.id),
        )) {
          h(
            `proxy-ufw.${source}.${service.id}`,
            "install",
            "mutate",
            `private input: ${source} -> ${service.id}`,
            `ufw allow in on ${t.interface} from ${sourceAddress} to ${p.address} port ${service.port} proto tcp comment '${t.firewall.marker}-${source}'`,
          );
        }
      }
      h(
        "proxy-start",
        "install",
        "mutate",
        `enable ${host} private proxy instances`,
        `set -eu\nsystemctl daemon-reload\nsystemctl enable --now ${localProxies.map((service) => `aphrody-wg-proxy@${service.port}.socket`).join(" ")}`,
      );
    }
    if (host === "dbfr") steps.push(...accountSteps(ctx, t, "dbfr"));
    h(
      "verify-handshake",
      "verify",
      "check",
      "a handshake with the hub happened",
      `sudo -n wg show ${t.interface} latest-handshakes | awk '{if ($2>0) ok=1} END{exit !ok}'`,
    );
    h(
      "verify-hub",
      "verify",
      "check",
      "the hub answers over the tunnel",
      `ping -c 2 -W 2 ${t.hub.address} >/dev/null`,
    );
    h(
      "rollback",
      "rollback",
      "mutate",
      "remove the tunnel from this host",
      `set -u\nsystemctl disable --now wg-quick@${t.interface} 2>/dev/null || true\nrm -f /etc/wireguard/${t.interface}.conf ${t.keyFiles.private} ${t.keyFiles.public}`,
    );
  }
  // Windows PCs: nothing runs on a host, the owner and Omar act in the WireGuard app.
  for (const p of t.peers.filter((x) => x.os === "windows"))
    steps.push({
      id: `windows.${p.id}`,
      host: "windows",
      phase: "manual",
      kind: p.publicKey === null ? "pending" : "info",
      note:
        p.publicKey === null
          ? `${p.id}: waits for his public key; then the app tunnel "${t.windowsTunnelName}" takes the paste block (wg-client ${p.id} --format paste)`
          : `${p.id}: public key recorded; create the tunnel "${t.windowsTunnelName}" in the WireGuard app and paste the block (wg-client ${p.id} --format paste)`,
    });

  const sequence = [
    "0. owner's written order in the main session, then check the pending inputs below",
    "1. dbfr, wsl: preflight, wireguard-tools, keygen (public keys are read back)",
    "2. vps: preflight, keygen, sysctl, hub conf (aphro-pc and omar keys are recorded, wsl and dbfr keys come from step 1), ufw rules, forwarder units, start wg1 and the sockets",
    "3. dbfr, wsl: render the client conf with the hub public key, start wg1, verify the handshake",
    "4. vps and dbfr: omar account (user, sshd drop-ins, sudoers, authorized_keys)",
    "5. Windows: aphro-pc and omar paste the client block (with the hub public key read after step 2) into an empty tunnel of the WireGuard app, then activate it",
    "6. verify on every host; rollback steps exist per host",
  ];
  const rank: Record<WgPhase, number> = {
    preflight: 0,
    provision: 1,
    install: 2,
    verify: 3,
    rollback: 4,
    manual: 5,
  };
  steps.sort((a, b) => rank[a.phase] - rank[b.phase]);
  return {
    name: t.name,
    status: "plan-only",
    interface: t.interface,
    subnet: t.subnet,
    hub: `${t.hub.address}:${t.hub.listenPort}`,
    hubConfig: hub.text,
    clients,
    ufw: rules,
    sequence,
    pending,
    decisions,
    steps,
  };
}

// ── observe (read-only) and render ───────────────────────────────────────────────────────────────────────────────────────

export const READ_ONLY: ReadonlySet<WgKind> = new Set([
  "check",
  "warn",
  "info",
]);
export interface Observed {
  ok: boolean;
  detail: string;
}
/** Runs only the read-only steps. A `mutate` step is never executed, whatever the runner. */
export async function observePlan(
  plan: WgPlan,
  runner: Runner,
): Promise<Map<string, Observed>> {
  const out = new Map<string, Observed>();
  for (const s of plan.steps) {
    if (!READ_ONLY.has(s.kind) || (s.run === undefined && !s.probe)) continue;
    // Only the preflight reads run: the other checks need the mutation first (rendered file, started unit).
    if (s.host === "windows" || s.phase !== "preflight") continue;
    try {
      if (s.probe) {
        out.set(s.id, await s.probe(runner));
        continue;
      }
      const r = await runner(s.host, s.run!);
      const text = `${r.stdout}${r.stderr}`
        .trim()
        .split("\n")
        .slice(0, 3)
        .join(" | ");
      out.set(s.id, {
        ok: r.code === 0,
        detail:
          r.code !== 0 && s.onFail
            ? s.onFail
            : text.replace(
                /^Error: remote command failed with exit code Some\(\d+\):\s*/,
                "",
              ),
      });
    } catch (error) {
      out.set(s.id, {
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return out;
}
export const defaultRunner: Runner = async (host, command) => {
  const argv =
    host === "wsl"
      ? ["bash", "-c", command]
      : ["aphrody", "infra", "ssh", "exec", "--host", host, "-c", command];
  const p = Bun.spawn(argv, {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, APHRODY_SSH_COMMAND_TIMEOUT_SECS: "60" },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  return { code: await p.exited, stdout, stderr };
};

export function renderPlan(
  plan: WgPlan,
  observed?: Map<string, Observed>,
): string {
  const lines: string[] = [];
  lines.push(
    `wg-plan ${plan.name}: interface ${plan.interface}, subnet ${plan.subnet}, hub ${plan.hub} (plan only, nothing applied)`,
  );
  lines.push("", "sequence:", ...plan.sequence.map((s) => `  ${s}`));
  lines.push(
    "",
    "hub /etc/wireguard/wg1.conf (vps), ${VAR} = apply-time input:",
    ...plan.hubConfig
      .trimEnd()
      .split("\n")
      .map((l) => `  ${l}`),
  );
  lines.push(
    "",
    `ufw rules on the vps (${plan.ufw.length}, comment aphrody-wg-<peer>):`,
    ...plan.ufw.map((r) => `  ${r.text}`),
  );
  for (const host of ["vps", "dbfr", "wsl", "windows"] as const) {
    const own = plan.steps.filter((s) => s.host === host);
    if (own.length === 0) continue;
    lines.push("", `[${host}]`);
    let phase = "";
    for (const s of own) {
      if (s.phase !== phase) {
        phase = s.phase;
        lines.push(`  ${phase}`);
      }
      const o = observed?.get(s.id);
      const mark = o
        ? o.ok
          ? "PASS"
          : s.kind === "warn" || s.kind === "info"
            ? "NOTE"
            : "FAIL"
        : "";
      lines.push(
        `    ${s.kind.padEnd(7)} ${s.id.padEnd(40)} ${mark ? `${mark.padEnd(5)}` : "     "}${s.note}${o?.detail ? ` [${o.detail}]` : ""}${s.needs?.length ? ` (needs ${s.needs.join(", ")})` : ""}`,
      );
    }
  }
  lines.push("", "pending inputs:", ...plan.pending.map((p) => `  - ${p}`));
  lines.push(
    "",
    "decisions and findings for the owner:",
    ...plan.decisions.map((d) => `  - ${d}`),
  );
  return lines.join("\n");
}

/** Project only the declared DBFR service proxy, never tunnel bootstrap or account steps. */
export function selectedProxySteps(
  t: Tunnel,
  ctx: PlanContext,
  serviceId: string,
): WgStep[] {
  const service = t.services.find((candidate) => candidate.id === serviceId);
  const peer = t.peers.find((candidate) => candidate.host === "dbfr");
  if (
    !service ||
    service.host !== "dbfr" ||
    service.expose !== "socket-proxyd" ||
    service.auth !== "bearer-token" ||
    !service.port ||
    service.port === 5432 ||
    service.port === 6379 ||
    !peer ||
    peer.os !== "linux" ||
    service.address !== peer.address ||
    !inCidr(service.address, t.subnet) ||
    !["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"].some((cidr) =>
      inCidr(service.address, cidr),
    ) ||
    service.upstream !== `127.0.0.1:${service.port}`
  )
    throw new Error(
      "Selected DBFR proxy must be its declared private authenticated loopback service",
    );
  const selected = {
    ...t,
    services: [service],
    grants: Object.fromEntries(
      Object.entries(t.grants).map(([source, ids]) => [
        source,
        ids.filter((id) => id === serviceId),
      ]),
    ),
  };
  return buildPlan(selected, ctx).steps.filter(
    (step) => step.host === "dbfr" && step.id.startsWith("dbfr.proxy-"),
  );
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function wgMain(
  cmd: string,
  rest: string[],
  ctx: PlanContext,
): Promise<void> {
  const flag = (name: string) => rest.includes(`--${name}`);
  const value = (name: string) => {
    const at = rest.indexOf(`--${name}`);
    return at >= 0 ? rest[at + 1] : undefined;
  };
  const t = loadTunnel(ctx.root);
  if (cmd === "wg-plan") {
    const plan = buildPlan(t, ctx);
    const observed = flag("observe")
      ? await observePlan(plan, defaultRunner)
      : undefined;
    console.log(
      flag("json")
        ? JSON.stringify(
            { ...plan, observed: observed && Object.fromEntries(observed) },
            null,
            2,
          )
        : renderPlan(plan, observed),
    );
    if (!flag("json"))
      console.log(
        "\nplan only: there is no apply in this command; the apply waits for the owner's written order",
      );
    return;
  }
  const peer = rest.find(
    (a, i) => !a.startsWith("--") && !rest[i - 1]?.startsWith("--"),
  );
  if (!peer)
    throw new Error(
      `wg-client <peer> (${t.peers.map((p) => p.id).join(", ")})`,
    );
  const format = value("format") ?? "sections";
  const hubKey = value("hub-public-key");
  let text: string;
  if (format === "sections") {
    const s = clientSections(t, peer, hubKey);
    text = `${s.interface}\n\n${s.peer}\n`;
  } else if (format === "paste") text = clientPasteBlock(t, peer, hubKey);
  else if (format === "conf") {
    const file = value("private-key-file");
    const key = flag("private-key-stdin")
      ? await Bun.stdin.text()
      : file
        ? readFileSync(file, "utf8")
        : undefined;
    if (key === undefined || !hubKey)
      throw new Error(
        "--format conf needs --hub-public-key and --private-key-file F or --private-key-stdin",
      );
    text = clientConf(t, peer, hubKey, key);
  } else throw new Error(`unknown --format ${format} (sections, paste, conf)`);
  const out = value("out");
  if (out) {
    assertOutsideRepo(out, resolve(ctx.root, "..", ".."));
    await Bun.write(out, text);
    console.log(`written ${out}`);
  } else process.stdout.write(text);
}
