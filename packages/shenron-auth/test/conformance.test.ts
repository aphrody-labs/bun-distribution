// Source: packages/shenron/auth/test/conformance.test.ts at 8172f535ce (preserved Git history).
// SPDX-License-Identifier: Apache-2.0
/**
 * W3-AUTH-07 — conformance of the `@shenron/db` repositories to the ports of
 * `@shenron/auth` (docs/STACK.md, D-ports). The `satisfies` clauses are the
 * contract: `bun check -p packages/shenron-auth` fails when a repository drifts from
 * `AgentKeyStore` / `DiscordAccountLookup`. `@shenron/db` is a devDependency
 * only: `src/` never imports it (checked below and by check-workspace-packages).
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { fullSchema } from "@shenron/db/full-schema";
import { createAgentKeyRepository } from "@shenron/db/repos/agent-keys";
import { createDiscordAccountLookup } from "@shenron/db/repos/accounts";
import { agentKeyStrategy, authorize } from "../src/guards";
import type { AgentKeyStore, DiscordAccountLookup } from "../src/ports";

const db = drizzle.mock({ schema: fullSchema });

const agentKeyStore = createAgentKeyRepository(db) satisfies AgentKeyStore;
const discordAccounts = createDiscordAccountLookup(db) satisfies DiscordAccountLookup;

describe("ports conformance", () => {
  test("the repositories expose every port method", () => {
    for (const method of ["findActiveByHash", "touch", "countWritesSince", "recordCall"] as const) {
      expect(typeof agentKeyStore[method]).toBe("function");
    }
    expect(typeof discordAccounts.discordIdForUser).toBe("function");
  });

  test("the repository plugs into agentKeyStrategy as a store", async () => {
    // A non-agent Bearer never reaches the store: not applicable → 401 unauthenticated.
    const decision = await authorize(
      new Request("https://site.test/api/agent/v1/feed", {
        headers: { authorization: "Bearer not-an-agent-token" },
      }),
      [agentKeyStrategy({ store: agentKeyStore })],
    );
    expect(decision).toEqual({ ok: false, status: 401, code: "unauthenticated" });
  });

  test("src/ never imports @shenron/db (dev-only edge)", () => {
    const dir = join(import.meta.dir, "..", "src");
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts")) continue;
      expect(readFileSync(join(dir, file), "utf8")).not.toMatch(/from\s+["']@shenron\/db/);
    }
  });
});
