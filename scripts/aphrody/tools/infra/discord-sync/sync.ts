// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable eslint/no-await-in-loop -- ordre des messages et limites de débit Discord */
// Un passage de synchronisation (idempotent) : salons, message d'état épinglé édité en place, événements, courrier
// entrant (rapports d'Omar), accusés de réception ✅ et dépôt sortant. L'état vit dans un seul fichier JSON écrit par
// ce seul processus ; les dépendances sont injectées pour les tests.
import {
  DiscordError,
  type Channel,
  type Discord,
  type Message,
} from "./api.ts";
import type { SyncConfig } from "./collect.ts";
import { syncFiche } from "./fiche.ts";
import {
  ACK_EMOJI,
  decode,
  diff,
  encode,
  envelope,
  renderStatus,
  type Envelope,
  type Event,
  type Kind,
  type Snapshot,
  type SyncState,
} from "./protocol.ts";

export type Api = Pick<
  Discord,
  | "me"
  | "channels"
  | "createChannel"
  | "messages"
  | "post"
  | "edit"
  | "remove"
  | "pin"
  | "react"
  | "reactors"
  | "upload"
>;

export interface Io {
  outbox: () => { name: string; body: string }[];
  dropOutbox: (name: string) => void;
  writeInbox: (name: string, body: string) => void;
  writeAgreement: (name: string, body: string) => void;
  readFiche?: () => string | undefined;
  writeMerged?: (body: string) => void;
}

/** Retrouve ou crée la catégorie et les trois salons, avec les droits de la catégorie « Tunnel et hôtes ». */
export async function ensureChannels(
  api: Api,
  cfg: SyncConfig,
  state: SyncState,
  template: string,
): Promise<void> {
  const all = await api.channels();
  const tmplChannel = all.find((c) => c.type === 4 && c.name === template);
  if (!tmplChannel) throw new Error(`catégorie modèle absente : ${template}`);
  const overwrites = (tmplChannel.permission_overwrites ?? []).map((o) => ({
    id: o.id,
    type: o.type,
    allow: o.allow,
    deny: o.deny,
  }));
  let category = all.find((c) => c.type === 4 && c.name === cfg.category);
  category ??= await api.createChannel({
    name: cfg.category,
    type: 4,
    permission_overwrites: overwrites,
  });
  for (const [key, def] of Object.entries(cfg.channels)) {
    const found: Channel | undefined = all.find(
      (c) =>
        c.type === 0 && c.name === def.name && c.parent_id === category!.id,
    );
    const ch =
      found ??
      (await api.createChannel({
        name: def.name,
        type: 0,
        topic: def.topic,
        parent_id: category.id,
        permission_overwrites: overwrites,
      }));
    state.channels[key] = ch.id;
  }
}

const post = async (
  api: Api,
  channel: string,
  env: Envelope,
  text: string,
): Promise<Message> =>
  await api.post(channel, {
    content: encode(env, text),
    allowed_mentions: { parse: [] },
  });

async function publish(
  api: Api,
  state: SyncState,
  events: Event[],
  now: Date,
): Promise<number> {
  const channel = state.channels.evenements!;
  for (const e of events)
    await post(
      api,
      channel,
      envelope("event", e.type, { from: "sync", data: e.data }, now),
      e.text,
    );
  return events.length;
}

async function updateStatus(
  api: Api,
  state: SyncState,
  snap: Snapshot,
): Promise<"edited" | "created"> {
  const channel = state.channels.etat!;
  const { content, embed } = renderStatus(snap, state);
  const body = { content, embeds: [embed], allowed_mentions: { parse: [] } };
  if (state.statusMessageId) {
    try {
      await api.edit(channel, state.statusMessageId, body);
      return "edited";
    } catch (error) {
      if (!(error instanceof DiscordError) || error.status !== 404) throw error;
    }
  }
  const created = await api.post(channel, body);
  await api.pin(channel, created.id);
  state.statusMessageId = created.id;
  // L'épinglage laisse un message système : on le retire.
  for (const m of await api.messages(channel, "limit=5"))
    if (m.type === 6) await api.remove(channel, m.id);
  return "created";
}

const link = (guild: string, channel: string, id: string) =>
  `https://discord.com/channels/${guild}/${channel}/${id}`;

interface Inbound {
  events: Event[];
  seen: number;
}

/** Courrier entrant : rapports structurés, messages d'Omar, demandes à accuser. Le curseur évite tout rejeu. */
async function scanInbound(
  api: Api,
  cfg: SyncConfig,
  state: SyncState,
  guild: string,
  botId: string,
  io: Io,
): Promise<Inbound> {
  const events: Event[] = [];
  let seen = 0;
  const omarId = cfg.users.omar!.id;
  const watched = [
    { id: state.channels.demandes!, source: "demandes" },
    ...cfg.watch.channels.map((id) => ({ id, source: "salon" })),
    ...cfg.watch.dm.map((id) => ({ id, source: "dm" })),
  ];
  for (const w of watched) {
    const cursor = state.cursors[w.id];
    let msgs: Message[];
    try {
      msgs = await api.messages(
        w.id,
        cursor ? `after=${cursor}&limit=50` : "limit=1",
      );
    } catch (error) {
      if (
        error instanceof DiscordError &&
        (error.status === 403 || error.status === 404)
      )
        continue;
      throw error;
    }
    msgs.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    if (!cursor) {
      state.cursors[w.id] = msgs.at(-1)?.id ?? "0";
      continue;
    }
    for (const m of msgs) {
      state.cursors[w.id] = m.id;
      seen++;
      const env = decode(m.content);
      const mine = m.author.id === botId;
      if (
        env &&
        (env.kind === "request" || env.kind === "agreement") &&
        env.needsAck &&
        w.source === "demandes"
      ) {
        if (!state.pendingAcks[m.id]) {
          const all = Object.keys(cfg.users);
          const to = (
            env.to?.length ? env.to : all.filter((u) => u !== env.from)
          ).filter((u) => u in cfg.users);
          state.pendingAcks[m.id] = {
            id: env.id,
            title: String(env.data?.title ?? env.type).slice(0, 60),
            to,
            by: [],
            channelId: w.id,
          };
          await api.react(w.id, m.id, ACK_EMOJI).catch(() => undefined);
        }
        continue;
      }
      if (mine || m.author.bot || m.type === 6) continue;
      if (env?.kind === "report") {
        if (env.type === "fiche" && m.author.id === omarId && env.data)
          state.omarFiche = env.data;
        io.writeInbox(
          `${m.id}.json`,
          JSON.stringify({
            message: m.id,
            channel: w.id,
            author: m.author.username,
            envelope: env,
          }),
        );
        events.push({
          type: "report.received",
          text: `Rapport reçu de ${m.author.username} : ${env.type}${w.source === "dm" ? " (DM)" : ` ${link(guild, w.id, m.id)}`}.`,
          data: {
            from: m.author.username,
            report: env.type,
            ref: env.id,
            source: w.source,
            message: m.id,
          },
        });
      } else if (m.author.id === omarId && w.source !== "demandes") {
        events.push({
          type: "message.received",
          text: `Message d'Omar (${w.source === "dm" ? "DM" : "salon"}, ${m.content.length} car., ${m.attachments.length} pj)${w.source === "dm" ? "" : ` ${link(guild, w.id, m.id)}`}.`,
          data: {
            from: "omar",
            source: w.source,
            chars: m.content.length,
            attachments: m.attachments.length,
            message: m.id,
          },
        });
      }
    }
  }
  return { events, seen };
}

/** Accusés ✅ : un accord est complet quand chaque destinataire a réagi ; un message `ack` en réponse le consigne. */
async function processAcks(
  api: Api,
  cfg: SyncConfig,
  state: SyncState,
  botId: string,
  io: Io,
  now: Date,
): Promise<Event[]> {
  const events: Event[] = [];
  const userByDiscord = new Map(
    Object.entries(cfg.users).map(([name, u]) => [u.id, name]),
  );
  for (const [messageId, p] of Object.entries(state.pendingAcks)) {
    let users: { id: string; bot?: boolean }[];
    try {
      users = await api.reactors(p.channelId, messageId, ACK_EMOJI);
    } catch (error) {
      if (error instanceof DiscordError && error.status === 404) {
        delete state.pendingAcks[messageId];
        continue;
      }
      throw error;
    }
    for (const u of users) {
      const name = userByDiscord.get(u.id);
      if (
        !name ||
        u.id === botId ||
        u.bot ||
        p.by.includes(name) ||
        !p.to.includes(name)
      )
        continue;
      p.by.push(name);
      await api.post(p.channelId, {
        content: encode(
          envelope(
            "ack",
            "received",
            { from: name, ref: p.id, data: { by: name, message: messageId } },
            now,
          ),
          `Accusé de réception de ${name} pour : ${p.title}.`,
        ),
        message_reference: { message_id: messageId },
        allowed_mentions: { parse: [] },
      });
    }
    if (p.to.every((t) => p.by.includes(t))) {
      events.push({
        type: "agreement.complete",
        text: `Accusés complets (${p.by.join(", ")}) : ${p.title}.`,
        data: { ref: p.id, title: p.title, by: p.by },
      });
      io.writeAgreement(
        `${p.id}.json`,
        JSON.stringify({
          ref: p.id,
          title: p.title,
          by: p.by,
          at: now.toISOString(),
        }),
      );
      delete state.pendingAcks[messageId];
    }
  }
  return events;
}

async function flushOutbox(
  api: Api,
  state: SyncState,
  io: Io,
): Promise<number> {
  let n = 0;
  for (const item of io.outbox()) {
    try {
      const spec = JSON.parse(item.body) as {
        channel: string;
        kind: Kind;
        type: string;
        text: string;
        from?: string;
        to?: string[];
        needsAck?: boolean;
        data?: Record<string, unknown>;
      };
      const channel = state.channels[spec.channel];
      if (!channel) throw new Error(`salon inconnu : ${spec.channel}`);
      const env = envelope(spec.kind, spec.type, {
        from: spec.from,
        to: spec.to,
        needsAck: spec.needsAck,
        data: spec.data,
      });
      await post(api, channel, env, spec.text);
      n++;
    } catch (error) {
      if (error instanceof DiscordError) throw error; // réessayé au prochain passage
      console.error(
        `outbox ${item.name} ignoré : ${error instanceof Error ? error.message : error}`,
      );
    }
    io.dropOutbox(item.name);
  }
  return n;
}

export interface TickResult {
  status: "edited" | "created";
  events: string[];
  inbound: number;
  outbox: number;
  baseline: boolean;
}

export async function tick(
  api: Api,
  cfg: SyncConfig,
  state: SyncState,
  snap: Snapshot,
  io: Io,
  guild: string,
  template = "02 · Tunnel et hôtes",
  now = new Date(),
): Promise<TickResult> {
  if (
    !state.channels.etat ||
    !state.channels.evenements ||
    !state.channels.demandes ||
    (cfg.channels.fiche && !state.channels.fiche)
  )
    await ensureChannels(api, cfg, state, template);
  const bot = await api.me();
  const before = structuredClone(state);
  try {
    const { events, baseline } = diff(state, snap, cfg.offlineConfirmTicks);
    const all = [...events];
    if (baseline)
      all.push({
        type: "sync.started",
        text: "Synchronisation Discord démarrée (état de référence pris).",
        data: {},
      });
    const inbound = await scanInbound(api, cfg, state, guild, bot.id, io);
    all.push(...inbound.events);
    all.push(...(await processAcks(api, cfg, state, bot.id, io, now)));
    await publish(api, state, all, now);
    const status = await updateStatus(api, state, snap);
    const outbox = await flushOutbox(api, state, io);
    const fiche = await syncFiche(api, state, io.readFiche?.(), now);
    if (fiche.merged) io.writeMerged?.(fiche.merged);
    return {
      status,
      events: all.map((e) => e.type),
      inbound: inbound.seen,
      outbox,
      baseline,
    };
  } catch (error) {
    // Les événements non publiés seront recalculés au prochain passage : on rend l'état d'avant.
    const keep = {
      channels: state.channels,
      statusMessageId: state.statusMessageId,
    };
    Object.assign(state, before, keep);
    throw error;
  }
}
