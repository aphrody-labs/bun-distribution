// SPDX-License-Identifier: Apache-2.0
// Convention de messages structurés de la synchronisation propriétaire <-> Omar sur Discord.
// Un message lisible par un humain ET par A2A/Codex :
//   APHRODY-SYNC/1 <kind> <type>
//   <texte court en français>
//   ```json
//   {"v":1,"kind":"event","type":"member.online","id":"…","at":"…","data":{…}}
//   ```
// Aucun secret n'est jamais encodé dans un message.
export const PROTOCOL = "APHRODY-SYNC/1";
export const KINDS = ["state", "event", "request", "report", "agreement", "ack"] as const;
export type Kind = (typeof KINDS)[number];
export const ACK_EMOJI = "✅";
export const MAX_CONTENT = 1900;

export interface Envelope {
  v: 1;
  kind: Kind;
  type: string;
  id: string;
  at: string;
  from?: string;
  to?: string[];
  needsAck?: boolean;
  ref?: string;
  data?: Record<string, unknown>;
}

export function newId(now = Date.now(), rand = Math.random()): string {
  return `${now.toString(36)}-${Math.floor(rand * 36 ** 4)
    .toString(36)
    .padStart(4, "0")}`;
}

export function envelope(
  kind: Kind,
  type: string,
  extra: Partial<Omit<Envelope, "v" | "kind" | "type">> = {},
  now = new Date(),
): Envelope {
  return {
    v: 1,
    kind,
    type,
    id: extra.id ?? newId(now.getTime()),
    at: now.toISOString(),
    ...extra,
  };
}

const FENCE = "`".repeat(3);

/** Message complet : préfixe machine, texte humain, bloc JSON compact. Tronque le texte, jamais le JSON. */
export function encode(env: Envelope, text: string): string {
  const json = JSON.stringify(env);
  const head = `${PROTOCOL} ${env.kind} ${env.type}`;
  const fixed = head.length + json.length + 2 * FENCE.length + 8;
  if (fixed > MAX_CONTENT) throw new Error(`message trop long (${fixed} > ${MAX_CONTENT})`);
  const room = MAX_CONTENT - fixed;
  const body = text.length > room ? `${text.slice(0, Math.max(0, room - 1))}…` : text;
  return `${head}\n${body}\n${FENCE}json\n${json}\n${FENCE}`;
}

const HEAD = /^APHRODY-SYNC\/1 (\w+) (\S+)/;
const BLOCK = new RegExp(`${FENCE}json\\n([\\s\\S]*?)\\n${FENCE}`);

/** Extrait l'enveloppe d'un contenu de message ; null si le message n'est pas structuré ou invalide. */
export function decode(content: string): Envelope | null {
  if (!HEAD.test(content)) return null;
  const m = BLOCK.exec(content);
  if (!m) return null;
  try {
    const env = JSON.parse(m[1]!) as Envelope;
    if (env.v !== 1 || !KINDS.includes(env.kind) || typeof env.id !== "string") return null;
    return env;
  } catch {
    return null;
  }
}

// --- instantané du réseau et événements ------------------------------------------------------------------------

export interface MemberSnap {
  id: string;
  address: string;
  online: boolean;
  wg: boolean;
  reverse: boolean;
  ageS: number | null;
  publicIp?: string;
  rx: number;
  tx: number;
  open: number[];
  closed: number[];
}

export interface HostSnap {
  containers: Record<string, string>;
  failed: string[];
  facts: Record<string, string>;
  factsAt?: string;
}

export interface Snapshot {
  at: string;
  members: MemberSnap[];
  hosts: Record<string, HostSnap>;
}

export interface MemberState {
  online: boolean;
  since: string;
  pending: number;
}

export interface PendingAck {
  id: string;
  title: string;
  to: string[];
  by: string[];
  channelId: string;
}

export interface SyncState {
  channels: Record<string, string>;
  statusMessageId?: string;
  cursors: Record<string, string>;
  members: Record<string, MemberState>;
  ports: Record<string, number[]>;
  containers: Record<string, Record<string, string>>;
  failed: Record<string, string[]>;
  pendingAcks: Record<string, PendingAck>;
  started?: string;
  ficheMessageId?: string;
  ficheHash?: string;
  omarFiche?: Record<string, unknown>;
}

export const emptyState = (): SyncState => ({
  channels: {},
  cursors: {},
  members: {},
  ports: {},
  containers: {},
  failed: {},
  pendingAcks: {},
});

export interface Event {
  type: string;
  text: string;
  data: Record<string, unknown>;
}

/** État d'un conteneur d'après `docker ps` : up, unhealthy, starting, restarting. */
export function containerState(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("unhealthy")) return "unhealthy";
  if (s.includes("restarting")) return "restarting";
  if (s.includes("starting")) return "starting";
  return "up";
}

export function parseContainers(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of raw.split(/\s+/)) {
    const at = item.indexOf("=");
    if (at <= 0) continue;
    out[item.slice(0, at)] = containerState(item.slice(at + 1).replaceAll("_", " "));
  }
  return out;
}

/**
 * Compare l'instantané à l'état précédent, met l'état à jour et rend les événements à publier.
 * Première observation : aucun événement (base de référence). Hors ligne confirmé après `confirmTicks` mesures.
 */
export function diff(
  state: SyncState,
  snap: Snapshot,
  confirmTicks = 2,
): { events: Event[]; baseline: boolean } {
  const events: Event[] = [];
  const baseline = state.started === undefined;
  for (const m of snap.members) {
    const prev = state.members[m.id];
    const stable = prev?.online === true && m.online;
    if (!prev) {
      state.members[m.id] = { online: m.online, since: snap.at, pending: 0 };
    } else if (m.online === prev.online) {
      prev.pending = 0;
    } else if (m.online) {
      state.members[m.id] = { online: true, since: snap.at, pending: 0 };
      events.push({
        type: "member.online",
        text: `${m.id} en ligne (${m.wg ? `wg1, handshake ${m.ageS ?? "?"} s` : "tunnel inverse"}).`,
        data: { member: m.id, wg: m.wg, reverse: m.reverse, ageS: m.ageS },
      });
    } else {
      prev.pending += 1;
      if (prev.pending >= confirmTicks) {
        const since = prev.since;
        state.members[m.id] = { online: false, since: snap.at, pending: 0 };
        events.push({
          type: "member.offline",
          text: `${m.id} hors ligne (aucun handshake wg1 récent, pas de tunnel inverse).`,
          data: { member: m.id, wg: m.wg, reverse: m.reverse, ageS: m.ageS, onlineSince: since },
        });
      }
    }
    const before = state.ports[m.id];
    if (before && stable) {
      for (const p of m.open.filter((x) => !before.includes(x)))
        events.push({
          type: "service.up",
          text: `${m.id}: port ${p} ouvert.`,
          data: { member: m.id, port: p },
        });
      for (const p of before.filter((x) => !m.open.includes(x)))
        events.push({
          type: "service.down",
          text: `${m.id}: port ${p} fermé.`,
          data: { member: m.id, port: p },
        });
    }
    state.ports[m.id] = m.open;
  }
  for (const [host, h] of Object.entries(snap.hosts)) {
    const prev = state.containers[host];
    if (prev) {
      for (const [name, st] of Object.entries(h.containers)) {
        const was = prev[name];
        if (!was)
          events.push({
            type: "container.started",
            text: `${host}: conteneur ${name} démarré (${st}).`,
            data: { host, container: name, state: st },
          });
        else if (was !== st && (st === "unhealthy" || was === "unhealthy" || st === "restarting"))
          events.push({
            type:
              st === "unhealthy" || st === "restarting"
                ? "container.unhealthy"
                : "container.healthy",
            text: `${host}: conteneur ${name} ${was} -> ${st}.`,
            data: { host, container: name, from: was, state: st },
          });
      }
      for (const name of Object.keys(prev))
        if (!(name in h.containers))
          events.push({
            type: "container.stopped",
            text: `${host}: conteneur ${name} arrêté.`,
            data: { host, container: name },
          });
    }
    state.containers[host] = h.containers;
    const pf = state.failed[host];
    if (pf) {
      for (const u of h.failed.filter((x) => !pf.includes(x)))
        events.push({
          type: "task.failed",
          text: `${host}: unité ${u} en échec.`,
          data: { host, unit: u },
        });
      for (const u of pf.filter((x) => !h.failed.includes(x)))
        events.push({
          type: "task.recovered",
          text: `${host}: unité ${u} rétablie.`,
          data: { host, unit: u },
        });
    }
    state.failed[host] = h.failed;
  }
  state.started ??= snap.at;
  return { events, baseline };
}

// --- rendu du message d'état -----------------------------------------------------------------------------------

const block = (lines: string[]) => [FENCE, lines.join("\n") || "-", FENCE].join("\n");
const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));

export function humanAge(s: number | null): string {
  if (s === null) return "jamais";
  if (s < 90) return `${s} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} j`;
}

export function renderStatus(
  snap: Snapshot,
  state: SyncState,
): { content: string; embed: Record<string, unknown> } {
  const compact = {
    members: snap.members.map((m) => ({ id: m.id, online: m.online, ageS: m.ageS, open: m.open })),
    failed: Object.fromEntries(Object.entries(snap.hosts).map(([h, s]) => [h, s.failed.length])),
  };
  const env: Envelope = {
    v: 1,
    kind: "state",
    type: "network",
    id: "state",
    at: snap.at,
    data: compact,
  };
  const content = encode(env, "Etat du réseau privé wg1 (édité chaque minute).");
  const rows = snap.members.map((m) => {
    const st = m.online ? "EN LIGNE" : "HORS LIGNE";
    const via = m.wg ? "wg1" : m.reverse ? "inverse" : "-";
    return `${pad(m.id, 9)} ${pad(m.address, 12)} ${pad(st, 10)} ${pad(via, 8)} hs ${pad(humanAge(m.ageS), 7)} ${m.publicIp ?? "-"}`;
  });
  const ports = snap.members.map(
    (m) =>
      `${pad(m.id, 9)} ouverts ${m.open.join(",") || "aucun"}${m.closed.length ? ` | fermés ${m.closed.join(",")}` : ""}`,
  );
  const hosts = Object.entries(snap.hosts).map(([h, s]) => {
    const names = Object.entries(s.containers);
    const bad = names.filter(([, v]) => v !== "up").map(([k, v]) => `${k}:${v}`);
    const f = s.facts;
    const res = [
      f.load && `load ${f.load.split(" ")[0]}`,
      f.mem_used_total_mb && `ram ${f.mem_used_total_mb} Mo`,
      f.disk_used_pct && `disque ${f.disk_used_pct}%`,
    ]
      .filter(Boolean)
      .join(", ");
    const tail = s.factsAt ? ` (sonde ${s.factsAt.slice(11, 16)}Z)` : "";
    return `${pad(h, 9)} conteneurs ${names.length}${bad.length ? ` [${bad.join(" ")}]` : ""} | échecs ${s.failed.length ? s.failed.join(" ") : "0"}${res ? ` | ${res}` : ""}${tail}`;
  });
  const total = Object.values(snap.hosts).reduce((n, s) => n + Object.keys(s.containers).length, 0);
  const pending = Object.values(state.pendingAcks);
  const embed = {
    title: "Réseau privé wg1 (10.200.77.0/24)",
    color: snap.members.every((m) => m.online) ? 0x2ecc71 : 0xe67e22,
    description: [
      "**Membres**",
      block(rows),
      "**Ports TCP (22 SSH, 5900 VNC, 8795 bureau, 8793 MCP)**",
      block(ports),
      `**Hôtes** (${total} conteneurs)`,
      block(hosts),
      pending.length
        ? `**Accords en attente d'accusé ${ACK_EMOJI}** : ${pending.map((p) => p.title).join(" ; ")}`
        : "Aucun accord en attente.",
    ]
      .join("\n")
      .slice(0, 4000),
    timestamp: snap.at,
    footer: { text: "synchronisation automatique, chaque minute" },
  };
  return { content, embed };
}
