// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { fullSchema } from "@shenron/db/full-schema";
import { AGENT_SCOPES, COMMENT_STATUSES, POST_STATUSES, posts } from "@shenron/db/schema";
import { AGENT_SCOPES as canonicalScopes } from "@shenron/db/constants";
import { createDiscordAccountLookup } from "@shenron/db/repos/accounts";
import { createAgentKeyRepository } from "@shenron/db/repos/agent-keys";

test("Admin consumes the shared editorial schema and canonical enum arrays", () => {
  expect(AGENT_SCOPES).toBe(canonicalScopes);
  expect(COMMENT_STATUSES).toEqual(["visible", "hidden", "deleted"]);
  expect(POST_STATUSES).toContain("draft");
  expect(fullSchema.posts).toBe(posts);
});

test("Admin schema builds parameterized SQL on Drizzle mock without opening a connection", () => {
  const db = drizzle.mock({ schema: fullSchema });
  const query = db.select({ id: posts.id }).from(posts).limit(10).toSQL();
  expect(query.sql).toContain('from "Post"');
  expect(query.params).toEqual([10]);
  expect(typeof createDiscordAccountLookup(db).discordIdForUser).toBe("function");
  expect(typeof createAgentKeyRepository(db).findActiveByHash).toBe("function");
});
