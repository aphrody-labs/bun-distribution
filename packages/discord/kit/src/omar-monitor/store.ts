// SPDX-License-Identifier: Apache-2.0
import { Database } from "bun:sqlite";

export interface SourceMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: { id: string; bot?: boolean };
  webhook_id?: string | null;
  content: string;
}
export interface Policy {
  guildId: string;
  channelId: string;
  channelIds?: string[];
  omarUserIds: string[];
  ownerId: string;
  envFile: string;
  store: string;
  receipt: string;
  codex: string;
  cwd: string;
  nativeMcp: string;
  shenronMcp?: string;
  fleetMcp?: string;
  profile: string;
  reconcileSeconds: number;
  historyPageBudget: number;
  documentation?: string;
  codexTransport?: { type: "ssh"; target: string };
  workerHosts?: WorkerHost[];
  defaultWorkerHost?: string;
}
export interface WorkerHost {
  id: string;
  match: string[];
  unavailableReason?: string;
  transport?: { type: "ssh"; target: string };
  codex?: string;
  cwd?: string;
  nativeMcp?: string;
  profile?: string;
}
export interface Job {
  id: string;
  text: string;
  state: string;
  channel_id?: string;
  monitor_thread: string | null;
  worker_thread: string | null;
  worker_host?: string | null;
  goals: string | null;
  evidence: string | null;
}
export function isAuthorizedUser(message: SourceMessage, policy: Policy): boolean {
  const isOwner = !!policy.ownerId && message.author.id === policy.ownerId;
  const isOmarUser =
    Array.isArray(policy.omarUserIds) && policy.omarUserIds.includes(message.author.id);
  const allowedChannels =
    policy.channelIds && policy.channelIds.length > 0 ? policy.channelIds : [policy.channelId];
  return (
    allowedChannels.includes(message.channel_id) &&
    (!message.guild_id || message.guild_id === policy.guildId) &&
    !message.author.bot &&
    !message.webhook_id &&
    (isOwner || isOmarUser) &&
    !!message.content.trim()
  );
}
export const isOmar = isAuthorizedUser;
export class Queue {
  readonly db: Database;
  constructor(path: string) {
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, author TEXT NOT NULL, text TEXT NOT NULL, received INTEGER NOT NULL, via TEXT NOT NULL DEFAULT 'rest', channel_id TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY REFERENCES messages(id), text TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', monitor_thread TEXT, worker_thread TEXT, goals TEXT, evidence TEXT, channel_id TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS outbox(nonce TEXT PRIMARY KEY, source TEXT NOT NULL, text TEXT NOT NULL, channel_id TEXT NOT NULL DEFAULT '')",
    );
    const msgCols = this.db.query<{ name: string }, []>("PRAGMA table_info(messages)").all();
    if (!msgCols.some((col) => col.name === "via"))
      this.db.exec("ALTER TABLE messages ADD COLUMN via TEXT NOT NULL DEFAULT 'rest'");
    if (!msgCols.some((col) => col.name === "channel_id"))
      this.db.exec("ALTER TABLE messages ADD COLUMN channel_id TEXT NOT NULL DEFAULT ''");
    const jobCols = this.db.query<{ name: string }, []>("PRAGMA table_info(jobs)").all();
    if (!jobCols.some((col) => col.name === "channel_id"))
      this.db.exec("ALTER TABLE jobs ADD COLUMN channel_id TEXT NOT NULL DEFAULT ''");
    if (!jobCols.some((col) => col.name === "worker_host"))
      this.db.exec("ALTER TABLE jobs ADD COLUMN worker_host TEXT");
    const outboxCols = this.db.query<{ name: string }, []>("PRAGMA table_info(outbox)").all();
    if (!outboxCols.some((col) => col.name === "channel_id"))
      this.db.exec("ALTER TABLE outbox ADD COLUMN channel_id TEXT NOT NULL DEFAULT ''");
  }
  ingest(message: SourceMessage, policy: Policy, via: "rest" | "gateway" = "rest") {
    const allowedChannels =
      policy.channelIds && policy.channelIds.length > 0 ? policy.channelIds : [policy.channelId];
    if (
      !allowedChannels.includes(message.channel_id) ||
      (message.guild_id && message.guild_id !== policy.guildId)
    )
      return;
    this.db.transaction(() => {
      const added = this.db
        .query(
          "INSERT OR IGNORE INTO messages(id,author,text,received,via,channel_id) VALUES(?,?,?,?,?,?)",
        )
        .run(message.id, message.author.id, message.content, Date.now(), via, message.channel_id);
      if (added.changes && isOmar(message, policy))
        this.db
          .query("INSERT INTO jobs(id,text,channel_id) VALUES(?,?,?)")
          .run(message.id, message.content, message.channel_id);
    })();
  }
  next(): Job | null {
    return this.db
      .query<Job, []>(
        "SELECT * FROM jobs WHERE state IN ('pending','planning','executing') ORDER BY length(id),id LIMIT 1",
      )
      .get();
  }
  update(id: string, fields: Partial<Omit<Job, "id" | "text">>) {
    const entries = Object.entries(fields);
    for (const [key] of entries) {
      if (
        ![
          "state",
          "monitor_thread",
          "worker_thread",
          "worker_host",
          "goals",
          "evidence",
          "channel_id",
        ].includes(key)
      )
        throw new Error("Invalid queue field");
    }
    this.db.transaction(() => {
      for (const [key, value] of entries)
        this.db.query(`UPDATE jobs SET ${key}=? WHERE id=?`).run(value, id);
    })();
  }
  get(key: string): string | null {
    return (
      this.db.query<{ value: string }, [string]>("SELECT value FROM metadata WHERE key=?").get(key)
        ?.value ?? null
    );
  }
  set(key: string, value: string) {
    this.db
      .query("INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(key, value);
  }
  counts() {
    return this.db
      .query<{ state: string; count: number }, []>(
        "SELECT state,count(*) AS count FROM jobs GROUP BY state",
      )
      .all();
  }
  post(nonce: string, source: string, text: string, channelId = "") {
    this.db
      .query("INSERT OR IGNORE INTO outbox VALUES(?,?,?,?)")
      .run(nonce, source, text, channelId);
  }
  posts(): { nonce: string; source: string; text: string; channel_id?: string }[] {
    return this.db
      .query<{ nonce: string; source: string; text: string; channel_id: string }, []>(
        "SELECT nonce, source, text, channel_id FROM outbox LIMIT 20",
      )
      .all()
      .map((row) =>
        row.channel_id ? row : { nonce: row.nonce, source: row.source, text: row.text },
      );
  }
  posted(nonce: string) {
    this.db.query("DELETE FROM outbox WHERE nonce=?").run(nonce);
  }
  close() {
    this.db.close();
  }
}
