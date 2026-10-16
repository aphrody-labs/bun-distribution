// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { DiscordError, type Message } from "./api.ts";
import { collect, pushedFacts, wgView, type SyncConfig } from "./collect.ts";
import {
  decode,
  diff,
  emptyState,
  encode,
  envelope,
  MAX_CONTENT,
  parseContainers,
  renderStatus,
  type Snapshot,
} from "./protocol.ts";
import { tick, type Api, type Io } from "./sync.ts";

const cfg: SyncConfig = {
  category: "03 · Synchronisation",
  channels: {
    etat: { name: "sync-etat", topic: "t" },
    evenements: { name: "sync-evenements", topic: "t" },
    demandes: { name: "sync-demandes", topic: "t" },
  },
  users: { owner: { id: "1", name: "o" }, omar: { id: "2", name: "m" } },
  watch: { channels: [], dm: [] },
  members: [
    { id: "vps", address: "10.200.77.1", facts: "local" },
    {
      id: "omar",
      address: "10.200.77.10",
      facts: "none",
      reversePorts: [22010],
    },
  ],
  ports: [22, 5900],
  offlineAfterS: 180,
  offlineConfirmTicks: 2,
};

const snap = (
  omarOnline: boolean,
  containers: Record<string, string> = {},
  failed: string[] = [],
): Snapshot => ({
  at: "2026-10-09T15:00:00.000Z",
  members: [
    {
      id: "vps",
      address: "10.200.77.1",
      online: true,
      wg: true,
      reverse: false,
      ageS: 0,
      rx: 0,
      tx: 0,
      open: [22],
      closed: [5900],
    },
    {
      id: "omar",
      address: "10.200.77.10",
      online: omarOnline,
      wg: omarOnline,
      reverse: false,
      ageS: omarOnline ? 12 : 9000,
      publicIp: "203.0.113.9",
      rx: 1,
      tx: 2,
      open: omarOnline ? [22] : [],
      closed: omarOnline ? [5900] : [22, 5900],
    },
  ],
  hosts: { vps: { containers, failed, facts: { load: "1.0 0.5 0.2" } } },
});

describe("protocole", () => {
  test("encode/decode aller-retour", () => {
    const env = envelope("request", "prompt", {
      from: "owner",
      to: ["omar"],
      needsAck: true,
      data: { title: "x" },
    });
    const msg = encode(env, "Bonjour Omar");
    expect(msg.startsWith("APHRODY-SYNC/1 request prompt\n")).toBe(true);
    expect(decode(msg)).toEqual(env);
  });
  test("texte tronqué, JSON intact, limite respectée", () => {
    const env = envelope("event", "x", { data: { a: 1 } });
    const msg = encode(env, "a".repeat(5000));
    expect(msg.length).toBeLessThanOrEqual(MAX_CONTENT);
    expect(decode(msg)?.id).toBe(env.id);
  });
  test("messages non structurés ou invalides ignorés", () => {
    expect(decode("bonjour")).toBeNull();
    expect(
      decode("APHRODY-SYNC/1 event x\n```json\n{pas du json}\n```"),
    ).toBeNull();
    expect(
      decode(
        'APHRODY-SYNC/1 event x\n```json\n{"v":2,"kind":"event","id":"a"}\n```',
      ),
    ).toBeNull();
  });
  test("conteneurs docker ps", () => {
    expect(
      parseContainers(
        "a=Up_3_minutes_(healthy) b=Up_1_hour_(unhealthy) c=Restarting_(1)_5_s_ago d=Up_2_s",
      ),
    ).toEqual({
      a: "up",
      b: "unhealthy",
      c: "restarting",
      d: "up",
    });
  });
});

describe("diff", () => {
  test("première observation = base, pas d'événement", () => {
    const s = emptyState();
    const r = diff(s, snap(true, { a: "up" }));
    expect(r.baseline).toBe(true);
    expect(r.events).toEqual([]);
  });
  test("hors ligne confirmé après 2 mesures, puis retour en ligne", () => {
    const s = emptyState();
    diff(s, snap(true));
    expect(diff(s, snap(false)).events).toEqual([]);
    const off = diff(s, snap(false)).events.map((e) => e.type);
    expect(off).toEqual(["member.offline"]);
    expect(diff(s, snap(false)).events).toEqual([]);
    expect(diff(s, snap(true)).events.map((e) => e.type)).toEqual([
      "member.online",
    ]);
  });
  test("conteneur démarré/arrêté/unhealthy et unité en échec", () => {
    const s = emptyState();
    diff(s, snap(true, { a: "up", b: "up" }));
    const r = diff(s, snap(true, { a: "unhealthy", c: "up" }, ["x.service"]));
    expect(r.events.map((e) => e.type).toSorted()).toEqual([
      "container.started",
      "container.stopped",
      "container.unhealthy",
      "task.failed",
    ]);
    const back = diff(s, snap(true, { a: "up", c: "up" }));
    expect(back.events.map((e) => e.type).toSorted()).toEqual([
      "container.healthy",
      "task.recovered",
    ]);
  });
  test("port d'un membre en ligne qui change", () => {
    const s = emptyState();
    diff(s, snap(true));
    const r = diff(s, snap(true));
    expect(r.events).toEqual([]);
  });
});

describe("collecte", () => {
  test("conteneurs éphémères ignorés", async () => {
    const c = await collect(
      { ...cfg, ignoreContainers: ["^yolo-rel-"] },
      {
        run: async (cmd) =>
          cmd[0] === "wg" ? "" : "containers=yolo-rel-1=Up_1_s keep=Up_2_s\n",
        probe: async () => false,
        readPushed: () => undefined,
        nowS: () => 1,
      },
    );
    expect(Object.keys(c.hosts.vps?.containers ?? {})).toEqual(["keep"]);
  });
  test("wgView lit les sous-commandes sans clé privée", () => {
    const v = wgView(
      "K1\t10.200.77.10/32",
      "K1\t100",
      "K1\t92.1.2.3:5000",
      "K1\t7\t9",
    );
    expect(v).toEqual([
      {
        address: "10.200.77.10",
        handshake: 100,
        endpoint: "92.1.2.3:5000",
        rx: 7,
        tx: 9,
      },
    ]);
  });
  test("faits poussés : seulement le membre demandé", () => {
    const text =
      "SECRET=1\nNET_LIVE_AT=2026-10-09T10:00:00Z\nNET_LIVE_APHRO_PC_CONTAINERS=a=Up_1_s\nNET_LIVE_VPS_X=1\n";
    expect(pushedFacts(text, "aphro-pc")).toEqual({
      facts: { containers: "a=Up_1_s" },
      at: "2026-10-09T10:00:00Z",
    });
  });
  test("snapshot : handshake récent en ligne, ancien hors ligne, tunnel inverse", async () => {
    const now = 10_000;
    const mk = (hs: number, reverse: boolean) =>
      collect(cfg, {
        run: async (c) =>
          c[0] === "wg"
            ? ((
                {
                  "allowed-ips": "K\t10.200.77.10/32",
                  "latest-handshakes": `K\t${hs}`,
                  endpoints: "K\t1.2.3.4:5",
                  transfer: "K\t1\t2",
                } as Record<string, string>
              )[c[3]!] ?? "")
            : "containers=a=Up_1_s\nfailed=u.service \n",
        probe: async (h, p) => (h === "127.0.0.1" ? reverse : p === 22),
        readPushed: () => undefined,
        nowS: () => now,
      });
    const fresh = await mk(now - 20, false);
    expect(fresh.members[1]).toMatchObject({
      online: true,
      wg: true,
      ageS: 20,
      publicIp: "1.2.3.4",
      open: [22],
    });
    expect(fresh.hosts.vps?.failed).toEqual(["u.service"]);
    const stale = await mk(now - 4000, false);
    expect(stale.members[1]).toMatchObject({
      online: false,
      wg: false,
      open: [],
    });
    const rev = await mk(now - 4000, true);
    expect(rev.members[1]).toMatchObject({
      online: true,
      wg: false,
      reverse: true,
    });
  });
});

// --- faux Discord en mémoire ---------------------------------------------------------------------------------

function fake() {
  let seq = 1000n;
  const msgs = new Map<string, Message[]>();
  const log: string[] = [];
  const reactions = new Map<string, string[]>();
  const channels = [
    {
      id: "T",
      type: 4,
      name: "02 · Tunnel et hôtes",
      permission_overwrites: [{ id: "a", type: 0, allow: "1024", deny: "0" }],
    },
  ];
  const add = (
    channel: string,
    content: string,
    author = { id: "BOT", username: "Aphrody", bot: true },
    type = 0,
  ) => {
    const m: Message = {
      id: String((seq += 1n)),
      channel_id: channel,
      type,
      content,
      timestamp: "t",
      author,
      attachments: [],
    };
    msgs.set(channel, [...(msgs.get(channel) ?? []), m]);
    return m;
  };
  const api: Api = {
    me: async () => ({ id: "BOT", username: "Aphrody" }),
    channels: async () => channels as never,
    createChannel: async (b) => {
      const c = {
        id: `C${channels.length}`,
        type: b.type as number,
        name: b.name as string,
        parent_id: b.parent_id as string,
        permission_overwrites: b.permission_overwrites as never,
      };
      channels.push(c as never);
      log.push(`create ${c.name}`);
      return c as never;
    },
    messages: async (ch, q = "") => {
      const list = msgs.get(ch) ?? [];
      const after = /after=(\d+)/.exec(q)?.[1];
      const limit = Number(/limit=(\d+)/.exec(q)?.[1] ?? 50);
      const f = after
        ? list.filter((m) => BigInt(m.id) > BigInt(after))
        : list.slice(-limit);
      return f.toReversed();
    },
    post: async (ch, b) => {
      log.push(`post ${ch}`);
      return add(ch, (b.content as string) ?? "");
    },
    edit: async (ch, id, b) => {
      const m = (msgs.get(ch) ?? []).find((x) => x.id === id);
      if (!m) throw new DiscordError(404, "PATCH", "x");
      m.content = (b.content as string) ?? m.content;
      log.push(`edit ${ch}`);
      return m;
    },
    remove: async (ch, id) => {
      msgs.set(
        ch,
        (msgs.get(ch) ?? []).filter((m) => m.id !== id),
      );
    },
    pin: async () => {
      log.push("pin");
      add("C1", "pinned", undefined, 6);
    },
    react: async (ch, id) => {
      reactions.set(`${ch}/${id}`, [
        ...(reactions.get(`${ch}/${id}`) ?? []),
        "BOT",
      ]);
    },
    reactors: async (ch, id) =>
      (reactions.get(`${ch}/${id}`) ?? []).map((u) => ({
        id: u,
        username: u,
        bot: u === "BOT",
      })),
    upload: async () => {
      throw new Error("upload is not used by sync");
    },
  };
  return { api, msgs, log, reactions, add, channels };
}

const memIo = () => {
  const inbox: string[] = [];
  const agreements: string[] = [];
  const outbox: { name: string; body: string }[] = [];
  const io: Io = {
    outbox: () => [...outbox],
    dropOutbox: (n) =>
      void outbox.splice(
        0,
        outbox.length,
        ...outbox.filter((o) => o.name !== n),
      ),
    writeInbox: (n) => void inbox.push(n),
    writeAgreement: (n) => void agreements.push(n),
  };
  return { io, inbox, agreements, outbox };
};

describe("tick", () => {
  test("crée les salons une fois, épingle, édite en place, retire le message système", async () => {
    const f = fake();
    const state = emptyState();
    const m = memIo();
    const r1 = await tick(f.api, cfg, state, snap(true), m.io, "G");
    expect(r1.status).toBe("created");
    expect(r1.baseline).toBe(true);
    expect(f.log.filter((l) => l.startsWith("create")).length).toBe(4); // catégorie + 3 salons
    expect(f.log).toContain("pin");
    expect(f.msgs.get(state.channels.etat!)!.some((x) => x.type === 6)).toBe(
      false,
    );
    const r2 = await tick(f.api, cfg, state, snap(true), m.io, "G");
    expect(r2.status).toBe("edited");
    expect(f.log.filter((l) => l.startsWith("create")).length).toBe(4);
    expect(f.log.filter((l) => l === "pin").length).toBe(1);
    // reprise : état rechargé depuis le disque
    const reloaded = JSON.parse(JSON.stringify(state));
    const r3 = await tick(f.api, cfg, reloaded, snap(true), m.io, "G");
    expect(r3.status).toBe("edited");
    expect(r3.baseline).toBe(false);
  });
  test("message d'état supprimé : recréé et épinglé", async () => {
    const f = fake();
    const state = emptyState();
    const m = memIo();
    await tick(f.api, cfg, state, snap(true), m.io, "G");
    f.msgs.set(state.channels.etat!, []);
    const r = await tick(f.api, cfg, state, snap(true), m.io, "G");
    expect(r.status).toBe("created");
    expect(f.log.filter((l) => l === "pin").length).toBe(2);
  });
  test("Omar hors ligne simulé : événement publié dans sync-evenements, parsable", async () => {
    const f = fake();
    const state = emptyState();
    const m = memIo();
    await tick(f.api, cfg, state, snap(true), m.io, "G");
    await tick(f.api, cfg, state, snap(false), m.io, "G");
    const r = await tick(f.api, cfg, state, snap(false), m.io, "G");
    expect(r.events).toContain("member.offline");
    const posted = f.msgs
      .get(state.channels.evenements!)!
      .map((x) => decode(x.content))
      .filter(Boolean);
    expect(posted.map((e) => e!.type)).toContain("member.offline");
  });
  test("accord : ✅ de chaque destinataire, ack en réponse, fichier consigné, plus en attente", async () => {
    const f = fake();
    const state = emptyState();
    const m = memIo();
    await tick(f.api, cfg, state, snap(true), m.io, "G");
    const demandes = state.channels.demandes!;
    const env = envelope("agreement", "scope", {
      from: "owner",
      to: ["omar"],
      needsAck: true,
      data: { title: "Portée" },
    });
    const msg = f.add(demandes, encode(env, "Accord"));
    await tick(f.api, cfg, state, snap(true), m.io, "G");
    expect(state.pendingAcks[msg.id]?.to).toEqual(["omar"]);
    f.reactions.set(`${demandes}/${msg.id}`, ["BOT", "2"]);
    const r = await tick(f.api, cfg, state, snap(true), m.io, "G");
    expect(r.events).toContain("agreement.complete");
    expect(state.pendingAcks[msg.id]).toBeUndefined();
    expect(m.agreements).toEqual([`${env.id}.json`]);
    expect(
      f.msgs.get(demandes)!.some((x) => decode(x.content)?.kind === "ack"),
    ).toBe(true);
  });
  test("rapport structuré d'Omar : boîte de réception + événement report.received", async () => {
    const f = fake();
    const state = emptyState();
    const m = memIo();
    await tick(f.api, cfg, state, snap(true), m.io, "G");
    const rep = envelope("report", "codex", {
      from: "omar",
      data: { ok: true },
    });
    f.add(state.channels.demandes!, encode(rep, "Rapport"), {
      id: "2",
      username: "omlar_",
      bot: false,
    } as never);
    const r = await tick(f.api, cfg, state, snap(true), m.io, "G");
    expect(r.events).toContain("report.received");
    expect(m.inbox.length).toBe(1);
  });
  test("dépôt sortant publié puis supprimé", async () => {
    const f = fake();
    const state = emptyState();
    const m = memIo();
    await tick(f.api, cfg, state, snap(true), m.io, "G");
    m.outbox.push({
      name: "1.json",
      body: JSON.stringify({
        channel: "demandes",
        kind: "request",
        type: "task",
        text: "Fais X",
      }),
    });
    const r = await tick(f.api, cfg, state, snap(true), m.io, "G");
    expect(r.outbox).toBe(1);
    expect(m.outbox).toEqual([]);
  });
  test("échec Discord : l'état d'avant est rendu, les événements ne sont pas perdus", async () => {
    const f = fake();
    const state = emptyState();
    const m = memIo();
    await tick(f.api, cfg, state, snap(true, { a: "up" }), m.io, "G");
    const broken: Api = {
      ...f.api,
      post: async () => {
        throw new DiscordError(500, "POST", "x");
      },
    };
    await expect(
      tick(broken, cfg, state, snap(true, {}), m.io, "G"),
    ).rejects.toThrow();
    const r = await tick(f.api, cfg, state, snap(true, {}), m.io, "G");
    expect(r.events).toContain("container.stopped");
  });
  test("le statut ne contient aucun jeton et reste sous les limites Discord", () => {
    const { content, embed } = renderStatus(
      snap(true, { a: "up" }),
      emptyState(),
    );
    expect(content.length).toBeLessThanOrEqual(2000);
    expect(
      String((embed as { description: string }).description).length,
    ).toBeLessThanOrEqual(4096);
    expect(JSON.stringify([content, embed])).not.toMatch(
      /token|secret|password/i,
    );
  });
});

import { mergeFiche, scrub } from "./fiche.ts";
describe("fiche", () => {
  test("retire les secrets et ajoute la partie d'Omar", () => {
    const out = mergeFiche(
      "a\nPrivateKey = xxx\nNET_SERVICE_VNC=1 vnc-password\nb",
      { user: "omar" },
      new Date(0),
    );
    expect(out).not.toContain("PrivateKey");
    expect(out).toContain("vnc-password");
    expect(out).toContain("user : omar");
    expect(scrub("token = abcdefghijkl")).toBe("");
  });
});
