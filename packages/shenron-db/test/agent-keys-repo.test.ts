// Source: packages/shenron/db/test/agent-keys-repo.test.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
// Parity with apps/shenron/site/src/lib/agent-keys.ts: the "site" queries below are the
// exact Drizzle calls of the site module, rebuilt on the same mock database.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { fullSchema } from "../src/full-schema";
import {
  AGENT_TOKEN_PREFIX,
  DEFAULT_AGENT_RATE_LIMIT,
  agentKeyQueries,
  base64url,
  createAgentKeyRepository,
  generateAgentToken,
  hashAgentToken,
  parseScopes,
} from "../src/repos/agent-keys";
import { agentAudit, agentKeys } from "../src/schema";
import type { ShenronPgDatabase } from "../src/types";

const db = drizzle.mock({ schema: fullSchema });
const q = agentKeyQueries(db as unknown as ShenronPgDatabase);
const AT = new Date("2026-09-24T00:00:00.000Z");

describe("agent key repository SQL parity with the site", () => {
  test("findActiveByHash: AgentKey by tokenHash (revoked rows included)", () => {
    const repo = q.findByHash("abc").toSQL();
    const site = db.query.agentKeys.findFirst({ where: eq(agentKeys.tokenHash, "abc") }).toSQL();
    expect(repo.sql).toContain('from "AgentKey"');
    expect(repo.sql).toContain('where "AgentKey"."tokenHash" = $1');
    expect(repo.sql).not.toContain('revokedAt" is null');
    expect(site.sql).toContain('"agentKeys"."tokenHash" = $1');
    expect(repo.params[0]).toBe(site.params[0]);
  });

  test("touch: lastUsedAt by id", () => {
    const repo = q.touch("k1", AT).toSQL();
    const site = db.update(agentKeys).set({ lastUsedAt: AT }).where(eq(agentKeys.id, "k1")).toSQL();
    expect(repo).toEqual(site);
  });

  test("agentCallsLastHour: identical to the site", () => {
    const site = db
      .select({ total: sql<number>`count(*)::int` })
      .from(agentAudit)
      .where(and(eq(agentAudit.keyId, "k1"), sql`${agentAudit.createdAt} > now() - interval '1 hour'`))
      .toSQL();
    expect(q.callsLastHour("k1").toSQL()).toEqual(site);
  });

  test("countWritesSince: same table and key predicate, bound instant", () => {
    const repo = q.countWritesSince("k1", AT).toSQL();
    expect(repo.sql).toBe(
      'select count(*)::int from "AgentAudit" where ("AgentAudit"."keyId" = $1 and "AgentAudit"."createdAt" > $2)',
    );
    expect(repo.params).toEqual(["k1", AT.toISOString()]);
  });

  test("recordCall: truncated insert identical to the site", () => {
    const entry = {
      keyId: "k1",
      keyName: "ingest",
      method: "POST-TOO-LONG-METHOD",
      path: `/api/${"x".repeat(400)}`,
      status: 201,
      summary: "s".repeat(600),
    };
    const site = db
      .insert(agentAudit)
      .values({
        keyId: entry.keyId,
        keyName: entry.keyName,
        method: entry.method.slice(0, 10),
        path: entry.path.slice(0, 300),
        status: entry.status,
        summary: entry.summary?.slice(0, 500) ?? null,
      })
      .toSQL();
    expect(q.recordCall(entry).toSQL()).toEqual(site);
  });

  test("admin: list, counts 24h, soft revoke, scopes, audit", () => {
    expect(q.listKeys().toSQL()).toEqual(db.select().from(agentKeys).orderBy(desc(agentKeys.createdAt)).toSQL());
    expect(q.calls24hByKey().toSQL()).toEqual(
      db
        .select({ keyId: agentAudit.keyId, total: sql<number>`count(*)::int` })
        .from(agentAudit)
        .where(sql`${agentAudit.createdAt} > now() - interval '24 hours'`)
        .groupBy(agentAudit.keyId)
        .toSQL(),
    );
    const revoke = q.revoke("k1", AT).toSQL();
    expect(revoke).toEqual(
      db
        .update(agentKeys)
        .set({ revokedAt: AT })
        .where(and(eq(agentKeys.id, "k1"), isNull(agentKeys.revokedAt)))
        .returning({ id: agentKeys.id })
        .toSQL(),
    );
    expect(revoke.sql).toContain('"revokedAt" is null');
    expect(revoke.sql).not.toContain("delete");
    expect(q.updateScopes("k1", ["read"]).toSQL()).toEqual(
      db
        .update(agentKeys)
        .set({ scopes: ["read"] })
        .where(eq(agentKeys.id, "k1"))
        .returning({ id: agentKeys.id })
        .toSQL(),
    );
    expect(q.listAudit(9999).toSQL()).toEqual(
      db.select().from(agentAudit).orderBy(desc(agentAudit.createdAt)).limit(500).toSQL(),
    );
    expect(q.listAudit(0).toSQL().params).toEqual([1]);
  });
});

describe("agent key helpers", () => {
  test("hash is the SHA-256 hex of the token (same as node:crypto)", async () => {
    const token = generateAgentToken();
    expect(token.startsWith(AGENT_TOKEN_PREFIX)).toBe(true);
    expect(token.length).toBe(AGENT_TOKEN_PREFIX.length + 43);
    expect(await hashAgentToken(token)).toBe(createHash("sha256").update(token, "utf8").digest("hex"));
  });

  test("base64url matches Buffer", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 31, 32, 33]) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37 + 11) & 255);
      expect(base64url(bytes)).toBe(Buffer.from(bytes).toString("base64url"));
    }
  });

  test("parseScopes dedupes and drops unknown scopes", () => {
    expect(parseScopes(["read", "read", "root", "moderate"])).toEqual(["read", "moderate"]);
    expect(parseScopes("read")).toEqual([]);
  });

  test("findActiveByHash maps the row to the AgentKeyStore record", async () => {
    const row = {
      id: "k1",
      name: "ingest",
      scopes: ["read"],
      revokedAt: null,
      rateLimitPerHour: null,
    };
    const fake = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
    };
    const repo = createAgentKeyRepository(fake as unknown as ShenronPgDatabase);
    expect(await repo.findActiveByHash("h")).toEqual({
      id: "k1",
      name: "ingest",
      scopes: ["read"],
      revokedAt: null,
      rateLimit: DEFAULT_AGENT_RATE_LIMIT,
    });
  });

  test("recordCall never throws", async () => {
    const fake = {
      insert: () => ({
        values: () => Promise.reject(new Error("db down")),
      }),
    };
    const original = console.error;
    console.error = () => {};
    try {
      const repo = createAgentKeyRepository(fake as unknown as ShenronPgDatabase);
      await repo.recordCall({ keyId: null, keyName: null, method: "GET", path: "/", status: 200 });
    } finally {
      console.error = original;
    }
  });

  test("createAgentKey validates input before touching the database", async () => {
    const repo = createAgentKeyRepository({} as unknown as ShenronPgDatabase);
    await expect(repo.createAgentKey({ name: "  ", scopes: ["read"] })).rejects.toThrow("name_required");
    await expect(repo.createAgentKey({ name: "x", scopes: [] })).rejects.toThrow("scopes_required");
  });
});
