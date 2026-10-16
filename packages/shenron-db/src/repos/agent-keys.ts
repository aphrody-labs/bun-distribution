// Source: packages/shenron/db/src/repos/agent-keys.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
/**
 * Agent key repository (`AgentKey`, `AgentAudit`). Structurally satisfies the
 * `AgentKeyStore` port of `@shenron/auth` and carries the admin operations of
 * `apps/shenron/site/src/lib/agent-keys.ts` with the same surface. Only the SHA-256 of
 * a token is stored; revocation is soft (`revokedAt`), rows are never deleted.
 *
 * Runtime class: `pure` (Web Crypto only, query builder only).
 */
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { AGENT_SCOPES, type AgentScope } from "../constants";
import { agentAudit, agentKeys } from "../schema";
import type { ShenronPgDatabase } from "../types";

/** Readable token prefix, recognisable in a log or a secret manager. */
export const AGENT_TOKEN_PREFIX = "dbfr_agent_";
/** Writes per hour when the key sets no quota. */
export const DEFAULT_AGENT_RATE_LIMIT = 120;

// oxlint-disable-next-line no-explicit-any -- repositories accept any Drizzle PG schema
type AnyDb = ShenronPgDatabase<any>;

export interface AgentKeyRecord {
  id: string;
  name: string;
  scopes: readonly string[];
  revokedAt: Date | null;
  /** Writes per hour allowed for this key. */
  rateLimit: number;
}

export interface AgentAuditEntry {
  keyId: string | null;
  keyName: string | null;
  method: string;
  path: string;
  status: number;
  summary?: string | null;
}

export interface CreatedAgentKey {
  id: string;
  name: string;
  prefix: string;
  scopes: AgentScope[];
  /** Plain token — shown ONCE, never readable again. */
  token: string;
}

export interface AgentKeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: AgentScope[];
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  rateLimitPerHour: number | null;
  /** Writes over the last 24 hours (audit). */
  calls24h: number;
}

export interface AgentAuditView {
  id: number;
  keyName: string | null;
  method: string;
  path: string;
  status: number;
  summary: string | null;
  createdAt: string;
}

export function isAgentScope(value: unknown): value is AgentScope {
  return typeof value === "string" && (AGENT_SCOPES as readonly string[]).includes(value);
}

/** Deduplicated scopes restricted to the known vocabulary. */
export function parseScopes(input: unknown): AgentScope[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter(isAgentScope))];
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Unpadded base64url (same output as `Buffer#toString("base64url")`). */
export function base64url(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]! + B64URL[(n >> 6) & 63]! + B64URL[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]! + B64URL[(n >> 6) & 63]!;
  }
  return out;
}

/** SHA-256 hex of a token (the only form ever stored). */
export async function hashAgentToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

/** New plain token: prefix + 32 random bytes in base64url. */
export function generateAgentToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${AGENT_TOKEN_PREFIX}${base64url(bytes)}`;
}

/** Query builders, exposed for `.toSQL()` inspection. */
export function agentKeyQueries(db: AnyDb) {
  return {
    findByHash: (hash: string) => db.select().from(agentKeys).where(eq(agentKeys.tokenHash, hash)).limit(1),
    touch: (id: string, at: Date) => db.update(agentKeys).set({ lastUsedAt: at }).where(eq(agentKeys.id, id)),
    countWritesSince: (id: string, since: Date) =>
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(agentAudit)
        .where(and(eq(agentAudit.keyId, id), gt(agentAudit.createdAt, since))),
    callsLastHour: (id: string) =>
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(agentAudit)
        .where(and(eq(agentAudit.keyId, id), sql`${agentAudit.createdAt} > now() - interval '1 hour'`)),
    recordCall: (entry: AgentAuditEntry) =>
      db.insert(agentAudit).values({
        keyId: entry.keyId,
        keyName: entry.keyName,
        method: entry.method.slice(0, 10),
        path: entry.path.slice(0, 300),
        status: entry.status,
        summary: entry.summary?.slice(0, 500) ?? null,
      }),
    insertKey: (values: typeof agentKeys.$inferInsert) => db.insert(agentKeys).values(values).returning(),
    listKeys: () => db.select().from(agentKeys).orderBy(desc(agentKeys.createdAt)),
    calls24hByKey: () =>
      db
        .select({ keyId: agentAudit.keyId, total: sql<number>`count(*)::int` })
        .from(agentAudit)
        .where(sql`${agentAudit.createdAt} > now() - interval '24 hours'`)
        .groupBy(agentAudit.keyId),
    revoke: (id: string, at: Date) =>
      db
        .update(agentKeys)
        .set({ revokedAt: at })
        .where(and(eq(agentKeys.id, id), isNull(agentKeys.revokedAt)))
        .returning({ id: agentKeys.id }),
    updateScopes: (id: string, scopes: AgentScope[]) =>
      db.update(agentKeys).set({ scopes }).where(eq(agentKeys.id, id)).returning({ id: agentKeys.id }),
    listAudit: (limit: number) =>
      db
        .select()
        .from(agentAudit)
        .orderBy(desc(agentAudit.createdAt))
        .limit(Math.min(500, Math.max(1, limit))),
  };
}

export function createAgentKeyRepository(db: AnyDb) {
  const q = agentKeyQueries(db);
  return {
    /** Key whose hash matches, revoked or not (the guard checks `revokedAt`). */
    async findActiveByHash(hash: string): Promise<AgentKeyRecord | null> {
      const [row] = await q.findByHash(hash);
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        scopes: row.scopes ?? [],
        revokedAt: row.revokedAt ?? null,
        rateLimit: row.rateLimitPerHour ?? DEFAULT_AGENT_RATE_LIMIT,
      };
    },
    async touch(id: string, at: Date): Promise<void> {
      await q.touch(id, at);
    },
    async countWritesSince(id: string, since: Date): Promise<number> {
      const rows = await q.countWritesSince(id, since);
      return Number(rows[0]?.total ?? 0);
    },
    /** Never throws: the audit must not break the API. */
    async recordCall(entry: AgentAuditEntry): Promise<void> {
      try {
        await q.recordCall(entry);
      } catch (err) {
        console.error("[agent-keys] audit", err);
      }
    },

    // ── Admin operations (surface of apps/shenron/site/src/lib/agent-keys.ts) ──

    /** Creates a key. The returned token is the only plain copy that will ever exist. */
    async createAgentKey(input: {
      name: string;
      scopes: AgentScope[];
      note?: string | null;
      createdBy?: string | null;
      rateLimitPerHour?: number | null;
    }): Promise<CreatedAgentKey> {
      const name = input.name.trim().slice(0, 80);
      if (!name) throw new Error("name_required");
      const scopes = parseScopes(input.scopes);
      if (scopes.length === 0) throw new Error("scopes_required");
      const token = generateAgentToken();
      const [row] = await q.insertKey({
        name,
        prefix: token.slice(0, AGENT_TOKEN_PREFIX.length + 6),
        tokenHash: await hashAgentToken(token),
        scopes,
        note: input.note?.trim() ? input.note.trim().slice(0, 500) : null,
        createdBy: input.createdBy ?? null,
        rateLimitPerHour: input.rateLimitPerHour ?? null,
      });
      if (!row) throw new Error("insert_failed");
      return { id: row.id, name: row.name, prefix: row.prefix, scopes, token };
    },
    async listAgentKeys(): Promise<AgentKeyView[]> {
      const rows = await q.listKeys();
      if (rows.length === 0) return [];
      const counts = await q.calls24hByKey();
      const byKey = new Map(counts.map(c => [c.keyId ?? "", Number(c.total)]));
      return rows.map(r => ({
        id: r.id,
        name: r.name,
        prefix: r.prefix,
        scopes: r.scopes ?? [],
        note: r.note,
        createdBy: r.createdBy,
        createdAt: r.createdAt.toISOString(),
        lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
        revokedAt: r.revokedAt?.toISOString() ?? null,
        rateLimitPerHour: r.rateLimitPerHour,
        calls24h: byKey.get(r.id) ?? 0,
      }));
    },
    /** Soft revocation: the row stays so the audit remains readable. */
    async revokeAgentKey(id: string): Promise<boolean> {
      const res = await q.revoke(id, new Date());
      return res.length > 0;
    },
    async updateAgentKeyScopes(id: string, scopes: AgentScope[]): Promise<boolean> {
      const next = parseScopes(scopes);
      if (next.length === 0) return false;
      const res = await q.updateScopes(id, next);
      return res.length > 0;
    },
    /** Calls of this key over the last hour (quota). */
    async agentCallsLastHour(keyId: string): Promise<number> {
      const rows = await q.callsLastHour(keyId);
      return Number(rows[0]?.total ?? 0);
    },
    async recordAgentCall(entry: AgentAuditEntry): Promise<void> {
      try {
        await q.recordCall(entry);
      } catch (err) {
        console.error("[agent-keys] audit", err);
      }
    },
    async listAgentAudit(limit = 100): Promise<AgentAuditView[]> {
      const rows = await q.listAudit(limit);
      return rows.map(r => ({
        id: r.id,
        keyName: r.keyName,
        method: r.method,
        path: r.path,
        status: r.status,
        summary: r.summary,
        createdAt: r.createdAt.toISOString(),
      }));
    },
  };
}

export type AgentKeyRepository = ReturnType<typeof createAgentKeyRepository>;
