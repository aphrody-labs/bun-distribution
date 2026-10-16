#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Synchronisation propriétaire <-> Omar via Discord (hub vps). Jetons lus dans l'environnement (EnvironmentFile
// /etc/aphrody-discord.env), jamais affichés.
//   cli.ts setup                      crée/retrouve la catégorie et les salons sync-*
//   cli.ts tick [--fixture F]         un passage : état épinglé, événements, courrier, accusés (timer chaque minute)
//   cli.ts post <salon> --kind K --type T --text "…" [--json '{…}'] [--to a,b] [--from x] [--ack] [--outbox]
//   cli.ts read <salon> [--kind K] [--after ID] [--limit N]    messages structurés en JSONL (A2A / Codex)
//   cli.ts status                     résumé de l'état local (sans secret)
// --fixture F : JSON {"<membre>":{"online":false,"ageS":9999}} appliqué à l'instantané (simulation de tests).
import {
  closeSync,
  existsSync,
  openSync,
  statSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Discord } from "./api.ts";
import { collect, type CollectDeps, type SyncConfig } from "./collect.ts";
import {
  decode,
  emptyState,
  encode,
  envelope,
  KINDS,
  type Kind,
  type Snapshot,
  type SyncState,
} from "./protocol.ts";
import { tick, ensureChannels, type Io } from "./sync.ts";

const argv = Bun.argv.slice(2);
const cmd = argv[0];
const opt = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (n: string) => argv.includes(`--${n}`);

const stateDir =
  process.env.STATE_DIRECTORY?.split(":")[0] ??
  join(homedir(), ".aphrody", "sync");
const configPath =
  process.env.APHRODY_SYNC_CONFIG ??
  join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "..",
    "tools",
    "config",
    "host",
    "discord-sync.json",
  );
const cfg = JSON.parse(readFileSync(configPath, "utf8")) as SyncConfig;
const statePath = join(stateDir, "state.json");

function loadState(): SyncState {
  try {
    return {
      ...emptyState(),
      ...(JSON.parse(readFileSync(statePath, "utf8")) as SyncState),
    };
  } catch {
    return emptyState();
  }
}
function saveState(s: SyncState) {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const tmp = `${statePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 1), { mode: 0o600 });
  renameSync(tmp, statePath);
}

function client(): Discord {
  const token = process.env.DISCORD_BOT_TOKEN ?? process.env.DISCORD_TOKEN;
  const guild = process.env.DISCORD_GUILD_ID ?? process.env.GUILD_ID;
  if (!token || !guild)
    throw new Error(
      "DISCORD_BOT_TOKEN / DISCORD_GUILD_ID absents de l'environnement",
    );
  return new Discord(token, guild);
}

const dir = (name: string) => {
  const d = join(stateDir, name);
  mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
};

const io: Io = {
  outbox: () =>
    existsSync(join(stateDir, "outbox"))
      ? readdirSync(join(stateDir, "outbox"))
          .filter((n) => n.endsWith(".json"))
          .toSorted()
          .map((name) => ({
            name,
            body: readFileSync(join(stateDir, "outbox", name), "utf8"),
          }))
      : [],
  dropOutbox: (name) => rmSync(join(stateDir, "outbox", name), { force: true }),
  writeInbox: (name, body) =>
    writeFileSync(join(dir("inbox"), name), body, { mode: 0o600 }),
  writeAgreement: (name, body) =>
    writeFileSync(join(dir("agreements"), name), body, { mode: 0o600 }),
  readFiche: () =>
    existsSync(join(stateDir, "fiche-owner.md"))
      ? readFileSync(join(stateDir, "fiche-owner.md"), "utf8")
      : undefined,
  writeMerged: (body) =>
    writeFileSync(join(stateDir, "fiche-merged.md"), body, { mode: 0o600 }),
};

async function run(cmdline: string[], timeoutMs: number): Promise<string> {
  try {
    const p = Bun.spawn(cmdline, {
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
}

async function tcp(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    Bun.connect({
      hostname: host,
      port,
      socket: {
        open(s) {
          clearTimeout(timer);
          s.end();
          resolve(true);
        },
        connectError() {
          clearTimeout(timer);
          resolve(false);
        },
        data() {},
      },
    }).catch(() => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

const deps: CollectDeps = {
  run,
  probe: tcp,
  readPushed: () => {
    const f = join(stateDir, "net-live.env");
    return existsSync(f) ? readFileSync(f, "utf8") : undefined;
  },
  nowS: () => Math.floor(Date.now() / 1000),
};

function applyFixture(snap: Snapshot, file: string) {
  const fx = JSON.parse(readFileSync(file, "utf8")) as Record<
    string,
    { online?: boolean; ageS?: number | null }
  >;
  for (const m of snap.members) {
    const f = fx[m.id];
    if (!f) continue;
    if (f.ageS !== undefined) m.ageS = f.ageS;
    if (f.online !== undefined) {
      m.online = f.online;
      m.wg = f.online;
      m.reverse = false;
      if (!f.online) {
        m.open = [];
        m.closed = [...cfg.ports];
      }
    }
  }
}

const template = "02 · Tunnel et hôtes";

if (cmd === "setup") {
  const api = client();
  const state = loadState();
  await ensureChannels(api, cfg, state, template);
  saveState(state);
  console.log(JSON.stringify(state.channels));
} else if (cmd === "tick") {
  // Un seul passage à la fois (timer + passages manuels) : verrou exclusif, périmé après 2 minutes.
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const lock = join(stateDir, "tick.lock");
  if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > 120_000)
    rmSync(lock, { force: true });
  let fd: number | undefined;
  try {
    fd = openSync(lock, "wx", 0o600);
  } catch (error) {
    console.log(
      JSON.stringify({
        skipped: "passage déjà en cours",
        code: (error as NodeJS.ErrnoException).code,
      }),
    );
  }
  if (fd !== undefined) {
    closeSync(fd);
    try {
      const api = client();
      const state = loadState();
      const snap = await collect(cfg, deps);
      const fx = opt("fixture");
      if (fx) applyFixture(snap, fx);
      try {
        console.log(
          JSON.stringify(
            await tick(api, cfg, state, snap, io, api.guildId, template),
          ),
        );
      } finally {
        saveState(state);
      }
    } finally {
      rmSync(lock, { force: true });
    }
  }
} else if (cmd === "post") {
  const channelKey = argv[1];
  const kind = opt("kind") as Kind;
  const type = opt("type");
  const text = opt("text");
  if (!channelKey || !KINDS.includes(kind) || !type || text === undefined)
    throw new Error(
      'usage : post <etat|evenements|demandes|fiche> --kind K --type T --text "…"',
    );
  const spec = {
    channel: channelKey,
    kind,
    type,
    text,
    from: opt("from"),
    to: opt("to")?.split(","),
    needsAck: flag("ack") || undefined,
    data: opt("json")
      ? (JSON.parse(opt("json")!) as Record<string, unknown>)
      : undefined,
  };
  if (flag("outbox")) {
    const f = join(
      dir("outbox"),
      `${Date.now()}-${Math.floor(Math.random() * 1e6)}.json`,
    );
    writeFileSync(f, JSON.stringify(spec), { mode: 0o600 });
    console.log(`outbox ${f}`);
  } else {
    const channel = loadState().channels[channelKey];
    if (!channel) throw new Error("salons inconnus : lancer setup");
    const env = envelope(kind, type, {
      from: spec.from,
      to: spec.to,
      needsAck: spec.needsAck,
      data: spec.data,
    });
    const m = await client().post(channel, {
      content: encode(env, text),
      allowed_mentions: { parse: [] },
    });
    console.log(JSON.stringify({ message: m.id, id: env.id }));
  }
} else if (cmd === "read") {
  const channel = loadState().channels[argv[1] ?? ""];
  if (!channel) throw new Error("salon inconnu : lancer setup");
  const kind = opt("kind");
  const query = `limit=${opt("limit") ?? 50}${opt("after") ? `&after=${opt("after")}` : ""}`;
  const msgs = await client().messages(channel, query);
  msgs.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  for (const m of msgs) {
    const env = decode(m.content);
    if (env && (!kind || env.kind === kind))
      console.log(
        JSON.stringify({
          message: m.id,
          author: m.author.username,
          posted: m.timestamp,
          ...env,
        }),
      );
  }
} else if (cmd === "status") {
  const s = loadState();
  console.log(
    JSON.stringify({
      channels: s.channels,
      statusMessageId: s.statusMessageId,
      members: s.members,
      pendingAcks: Object.keys(s.pendingAcks).length,
      started: s.started,
    }),
  );
} else {
  console.error(
    "usage : cli.ts setup | tick [--fixture F] | post | read | status",
  );
  process.exit(2);
}
