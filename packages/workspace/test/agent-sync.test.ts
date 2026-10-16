// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { syncAgentPass, type SyncClient } from "../src/agent-sync.ts";

test("wrong kernel domains stop before conversation ingestion", async () => {
  const tools: string[] = [];
  const client: SyncClient = {
    async call(tool) {
      tools.push(tool);
      return { value: "dbfr" };
    },
    close() {},
  };
  await expect(syncAgentPass(client, "aphrody", true)).rejects.toThrow(
    "domain differs",
  );
  expect(tools).toEqual(["nu_eval"]);
});

test("native sync publishes counters, preserves memory mode and omits private sessions", async () => {
  const calls: unknown[] = [];
  const client: SyncClient = {
    async call(tool, args) {
      calls.push([tool, args]);
      return tool === "nu_eval"
        ? { value: "aphrody" }
        : JSON.stringify({
            output_dir: join(
              process.env.APHRODY_HOME || join(homedir(), ".aphrody"),
              "workspaces/aphrody/sessions",
            ),
            state_path: "/private/state",
            records_ingested: 12,
            sessions: [
              { title: "private conversation", text: "private content" },
            ],
            memory: { records_fed: 4 },
            issues: [],
          });
    },
    close() {},
  };
  const result = await syncAgentPass(client, "aphrody", true);
  expect(calls[1]).toEqual([
    "sync_external_agents",
    { live: true, memory: true },
  ]);
  expect(result.records_ingested).toBe(12);
  expect(result.memory.records_fed).toBe(4);
  expect(JSON.stringify(result)).not.toContain("private conversation");
  expect(JSON.stringify(result)).not.toContain("private content");
});

test("logical MCP errors and unexpected stores remain failed passes", async () => {
  const client: SyncClient = {
    async call(tool) {
      return tool === "nu_eval"
        ? { value: "aphrody" }
        : { error: "sync failed" };
    },
    close() {},
  };
  await expect(syncAgentPass(client, "aphrody", true)).rejects.toThrow(
    "sync failed",
  );
  client.call = async (tool) =>
    tool === "nu_eval" ? { value: "aphrody" } : { output_dir: "/other-domain" };
  await expect(syncAgentPass(client, "aphrody", true)).rejects.toThrow(
    "selected domain store",
  );
});
