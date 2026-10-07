// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, open, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  publishSyncReceipts,
  syncPass,
  type SyncConfig,
  type SyncState,
} from "../src/agent-home-drive-sync.ts";

const config: SyncConfig = {
  version: 1,
  root: "/repo",
  aphrody: "aphrody",
  yolo: "yolo",
  receiptRoot: "/private",
  drive: { home: "/dbfr", folderId: "folder", intervalSeconds: 300 },
  retrieval: { root: "/staged", intervalSeconds: 3600 },
  jobs: ["drive-retrieval", "drive"],
  publication: {
    host: "local",
    directory: "/protected",
    receiptName: "agent-sync-vps-status.json",
  },
};
const state: SyncState = {
  drive: {
    ok: true,
    failures: 0,
    nextAt: 300_000,
    lastSuccess: { observedAt: "2026-10-07T13:00:00.000Z", report: { unchanged: 3 } },
  },
};
const temporary: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "aphrody-sync-publication-"));
  temporary.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("a selected Drive worker needs no agent settings and cannot retain unrelated job receipts", async () => {
  const previous: SyncState = {
    agents: { ok: false, failures: 3, nextAt: 0 },
    "rag-monitor": { ok: true, failures: 0, nextAt: 0 },
  };
  const calls: { argv: string[]; env?: Record<string, string> }[] = [];
  const next = await syncPass(
    {
      ...config,
      ragMonitor: { unit: "rag.service", reportPath: "/private/rag.json", intervalSeconds: 60 },
    },
    previous,
    async (argv, env) => {
      calls.push({ argv, env });
      return argv[0] === "yolo"
        ? '{"unchanged":3,"token":"private"}'
        : '{"indexed":1,"chunks":4,"errors":[]}';
    },
    1000,
  );
  expect(calls.map(({ argv }) => argv)).toEqual([
    ["yolo", "google", "drive", "sync", "--download-only"],
    ["aphrody", "home", "index", "/staged", "--label", "drive-dbfr-staged", "--profile", "dbfr"],
  ]);
  expect(calls[0]?.env).toEqual({
    APHRODY_AGENT_HOME: "/dbfr",
    APHRODY_GOOGLE_DRIVE_FOLDER_ID: "folder",
  });
  expect(Object.keys(next)).toEqual(["drive", "drive-retrieval"]);
  expect(next.drive?.lastSuccess?.report).toEqual({ unchanged: 3 });
  expect(next["drive-retrieval"]?.lastSuccess?.report).toEqual({ indexed: 1, chunks: 4 });
  expect(previous.agents?.failures).toBe(3);
  expect(Object.keys(previous)).toEqual(["agents", "rag-monitor"]);
});

test("selected jobs keep their last success and backoff while excluded jobs never run", async () => {
  let calls = 0;
  const next = await syncPass(
    { ...config, jobs: ["drive"] },
    { ...state, agents: { ok: false, failures: 6, nextAt: 0 } },
    async () => {
      calls++;
      throw new Error("Drive unavailable");
    },
    300_000,
  );
  expect(calls).toBe(1);
  expect(next.drive?.ok).toBe(false);
  expect(next.drive?.nextAt).toBe(360_000);
  expect(next.drive?.lastSuccess).toEqual(state.drive?.lastSuccess);
  expect(next.agents).toBeUndefined();
});

test("invalid selections fail before calling any capability", async () => {
  let calls = 0;
  await Promise.all(
    [[], ["drive", "drive"], ["agents"], ["unknown"], null].map((jobs) =>
      expect(
        syncPass({ ...config, jobs } as SyncConfig, {}, async () => {
          calls++;
          return "{}";
        }),
      ).rejects.toThrow("Selected sync jobs"),
    ),
  );
  expect(calls).toBe(0);
});

test("local publication atomically replaces only its distinct private receipt without SSH", async () => {
  const path = await directory();
  const legacy = ["drive-sync.json", "agent-sync.json", "rag-sync.json", "automation-sync.json"];
  await Promise.all(legacy.map((name) => Bun.write(join(path, name), "owned-by-wsl")));
  const receipt = join(path, "agent-sync-vps-status.json");
  await Bun.write(receipt, "previous-complete-receipt", { mode: 0o666 });
  const reader = await open(receipt, "r");
  try {
    await publishSyncReceipts(
      { ...config, publication: { ...config.publication, directory: path } },
      state,
      async () => {
        throw new Error("Local publication must not use SSH");
      },
    );
    expect(await reader.readFile("utf8")).toBe("previous-complete-receipt");
    expect((await Bun.file(receipt).json()).jobs).toEqual(state);
    expect((await stat(receipt)).mode & 0o777).toBe(0o600);
    expect((await readdir(path)).toSorted()).toEqual(
      [...legacy, "agent-sync-vps-status.json"].toSorted(),
    );
    await Promise.all(
      legacy.map(async (name) =>
        expect(await Bun.file(join(path, name)).text()).toBe("owned-by-wsl"),
      ),
    );
  } finally {
    await reader.close();
  }
});

test("omitting a receipt name preserves the legacy per-capability publication contract", async () => {
  const path = await directory();
  await publishSyncReceipts(
    { ...config, publication: { host: "local", directory: path } },
    state,
    async () => {
      throw new Error("Local publication must not use SSH");
    },
  );
  expect((await readdir(path)).toSorted()).toEqual(["automation-sync.json", "drive-sync.json"]);
  expect(await Bun.file(join(path, "drive-sync.json")).json()).toEqual(state.drive?.lastSuccess);
  expect((await stat(join(path, "automation-sync.json"))).mode & 0o777).toBe(0o600);
});

test("unsafe receipt names cannot escape the destination or invoke a remote command", async () => {
  const path = await directory();
  let calls = 0;
  await Promise.all(
    [
      "../escape.json",
      "/absolute.json",
      "nested/receipt.json",
      "nested\\receipt.json",
      ".hidden.json",
      "receipt\n.json",
      "receipt\0.json",
      "receipt.txt",
      "",
      "a".repeat(130) + ".json",
    ].map((receiptName) =>
      expect(
        publishSyncReceipts(
          { ...config, publication: { host: "vps", directory: path, receiptName } },
          state,
          async () => {
            calls++;
            return "sync-receipts-published";
          },
        ),
      ).rejects.toThrow("receipt basename"),
    ),
  );
  expect(calls).toBe(0);
  expect(await readdir(path)).toEqual([]);
});
