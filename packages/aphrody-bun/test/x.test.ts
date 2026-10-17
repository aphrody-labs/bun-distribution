// SPDX-License-Identifier: Apache-2.0
// The X native job API through the real aphrody-ffi library (Web ABI 5): a client handle, operations
// as jobs, local operations and batches with a checkpoint, against a loopback server. No request
// leaves the machine and no real credential is used. Skips until the cdylib exists
// (cargo build -p aphrody-ffi, then APHRODY_FFI_DEV=1 or APHRODY_FFI_LIB=...).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveNativeLibraryPath } from "../src/library";

let available = false;
try {
  available = resolveNativeLibraryPath() !== undefined;
} catch {
  available = false;
}
const native = test.skipIf(!available);

interface Seen {
  method: string;
  path: string;
  csrf: string | null;
  body: string;
}

const seen: Seen[] = [];
let server: ReturnType<typeof Bun.serve>;
let dir: string;

const USER = {
  data: {
    user: {
      result: {
        rest_id: "7",
        core: { name: "Aphrody", screen_name: "aphrody_code" },
        legacy: { followers_count: 10, friends_count: 5 },
      },
    },
  },
};

function respond(request: Request, body: string): Response {
  const path = new URL(request.url).pathname;
  if (path.endsWith("/UserByScreenName")) return Response.json(USER);
  if (path.endsWith("/FavoriteTweet")) {
    const id = JSON.parse(body || "{}")?.variables?.tweet_id;
    if (id === "1002") return Response.json({ errors: [{ code: 139, message: "already favorited" }] }, { status: 403 });
    if (id === "1003")
      return Response.json({ errors: [{ code: 32, message: "could not authenticate you" }] }, { status: 401 });
    return Response.json({ data: { favorite_tweet: "Done" } });
  }
  return Response.json({ data: {} });
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "aphx-native-"));
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = request.method === "GET" ? "" : await request.text();
      seen.push({
        method: request.method,
        path: new URL(request.url).pathname,
        csrf: request.headers.get("x-csrf-token"),
        body,
      });
      return respond(request, body);
    },
  });
});

afterAll(() => {
  server?.stop(true);
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function openClient() {
  const { xClientOpen } = await import("../src/x");
  return xClientOpen(
    { auth_token: "AUTH_TOKEN_PLACEHOLDER", ct0: "CT0_PLACEHOLDER" },
    {
      apiBase: `http://127.0.0.1:${server.port}/i/api`,
      uploadBase: `http://127.0.0.1:${server.port}/upload`,
      persistSession: false,
      queryIdsPath: join(dir, "query-ids.json"),
      discoveryPages: [],
    },
  );
}

native("local operations answer synchronously without a client", async () => {
  const { xCall, xCallData } = await import("../src/x");
  const count = xCall(0, "parse_post_count", { text: "5M posts" });
  expect(count.ok).toBe(true);
  if (count.ok) expect(count.data).toBe(5_000_000);

  const meta = xCallData<{
    ops: { name: string; kind: string }[];
    policy: unknown;
  }>(0, "meta");
  expect(meta.ops.length).toBeGreaterThan(100);
  expect(meta.ops.some(op => op.name === "create_tweet")).toBe(true);

  const refused = xCall(0, "search", { query: "x" });
  expect(refused.ok).toBe(false);
  if (!refused.ok) {
    expect(refused.error.kind).toBe("invalid");
    expect(refused.error.message).toContain("network operation");
  }
});

native("opening a client validates the session and never echoes it", async () => {
  const { xClientClose, xClientOpen, XNativeError } = await import("../src/x");
  expect(() => xClientOpen({ auth_token: "only-one" } as never)).toThrow(XNativeError);
  const handle = await openClient();
  expect(JSON.stringify(handle)).not.toContain("AUTH_TOKEN_PLACEHOLDER");
  expect(handle.client).toBeGreaterThan(0);
  expect(xClientClose(handle.client)).toBe(true);
  expect(xClientClose(handle.client)).toBe(false);
});

native("a job runs an operation through the loopback server with the rotating headers", async () => {
  const { xClientClose, xSubmit } = await import("../src/x");
  const { client } = await openClient();
  seen.length = 0;
  const envelope = await xSubmit<{ screen_name: string; id: string }>(
    client,
    "user_by_screen_name",
    { handle: "@aphrody_code" },
    { id: "call-1" },
  );
  expect(envelope.ok).toBe(true);
  if (envelope.ok) {
    expect(envelope.id).toBe("call-1");
    expect(envelope.data.screen_name).toBe("aphrody_code");
    expect(envelope.attempts).toBe(1);
  }
  expect(seen[0]?.csrf).toBe("CT0_PLACEHOLDER");
  xClientClose(client);
});

native("failures are envelopes with a kind, and argument errors never reach the network", async () => {
  const { xClientClose, xSubmit } = await import("../src/x");
  const { client } = await openClient();
  seen.length = 0;
  const duplicate = await xSubmit(client, "like", { id: "1002" });
  expect(duplicate.ok).toBe(false);
  if (!duplicate.ok) {
    expect(duplicate.error.kind).toBe("terminal");
    expect(duplicate.error.code).toBe(139);
  }
  const dead = await xSubmit(client, "like", { id: "1003" });
  expect(dead.ok).toBe(false);
  if (!dead.ok) expect(dead.error.kind).toBe("auth");

  seen.length = 0;
  const missing = await xSubmit(client, "like", {});
  expect(missing.ok).toBe(false);
  if (!missing.ok) expect(missing.error.kind).toBe("invalid");
  const unknown = await xSubmit(client, "no_such_operation", {});
  expect(unknown.ok).toBe(false);
  expect(seen.length).toBe(0);
  xClientClose(client);
});

native("an aborted signal rejects and a closed client is unknown", async () => {
  const { xClientClose, xSubmit } = await import("../src/x");
  const { client } = await openClient();
  const controller = new AbortController();
  controller.abort();
  await expect(xSubmit(client, "whoami", {}, { signal: controller.signal })).rejects.toBeDefined();
  xClientClose(client);
  const unknown = await xSubmit(client, "whoami", {});
  expect(unknown.ok).toBe(false);
  if (!unknown.ok) expect(unknown.error.message).toContain("unknown client");
});

async function drain(batch: number) {
  const { xBatchPoll } = await import("../src/x");
  const items: Awaited<ReturnType<typeof xBatchPoll>>["items"] = [];
  for (;;) {
    const poll = xBatchPoll(batch, 50);
    items.push(...poll.items);
    if (poll.done) return { items, summary: poll.summary };
    // oxlint-disable-next-line no-await-in-loop -- sondage séquentiel jusqu'à épuisement du lot
    await Bun.sleep(5);
  }
}

native("a batch isolates failures, stops on a dead session and resumes from its checkpoint", async () => {
  const { xBatchSubmit, xClientClose } = await import("../src/x");
  const { client } = await openClient();
  const checkpoint = join(dir, "run.jsonl");
  const ops = ["1001", "1002", "1004", "1005"].map(id => ({
    id: `like-${id}`,
    op: "like",
    args: { id },
  }));

  seen.length = 0;
  const first = xBatchSubmit(client, ops, { concurrency: 2, checkpoint });
  expect(first.total).toBe(4);
  const run1 = await drain(first.batch);
  expect(run1.items).toHaveLength(4);
  expect(run1.summary).toMatchObject({
    total: 4,
    ok: 3,
    failed: 1,
    resumed: 0,
  });
  const terminal = run1.items.find(item => item.id === "like-1002");
  expect(terminal?.ok).toBe(false);
  expect(readFileSync(checkpoint, "utf8").trim().split("\n")).toHaveLength(4);
  expect(readFileSync(checkpoint, "utf8")).not.toContain("AUTH_TOKEN_PLACEHOLDER");
  const calls = seen.length;

  // The same batch again: every result is final, so every one is replayed, none is executed.
  const second = xBatchSubmit(client, ops, { concurrency: 2, checkpoint });
  const run2 = await drain(second.batch);
  expect(run2.items).toHaveLength(4);
  expect(run2.items.every(item => item.resumed === true)).toBe(true);
  expect(run2.summary?.resumed).toBe(4);
  expect(seen.length).toBe(calls);

  // A dead session stops the dispatch: the rest is reported not_run.
  const dead = xBatchSubmit(
    client,
    [
      { id: "d1", op: "like", args: { id: "1003" } },
      { id: "d2", op: "like", args: { id: "2001" } },
      { id: "d3", op: "like", args: { id: "2002" } },
    ],
    { concurrency: 1 },
  );
  const run3 = await drain(dead.batch);
  expect(run3.summary?.stopped_by).toBe("auth");
  expect(run3.summary?.not_run).toBeGreaterThan(0);
  xClientClose(client);
});

native("invalid batches are refused before anything runs, and a batch can be cancelled", async () => {
  const { xBatchCancel, xBatchPoll, xBatchSubmit, xClientClose, XNativeError } = await import("../src/x");
  const { client } = await openClient();
  seen.length = 0;
  expect(() =>
    xBatchSubmit(client, [
      { id: "x", op: "like", args: { id: "1" } },
      { id: "x", op: "like", args: { id: "2" } },
    ]),
  ).toThrow(XNativeError);
  expect(() => xBatchSubmit(0, [])).toThrow(/open client/);
  expect(seen.length).toBe(0);

  const many = xBatchSubmit(
    client,
    Array.from({ length: 200 }, (_, i) => ({
      id: `n${i}`,
      op: "like",
      args: { id: `${3000 + i}` },
    })),
    { concurrency: 1 },
  );
  expect(xBatchCancel(many.batch)).toBe(true);
  expect(xBatchCancel(many.batch)).toBe(false);
  expect(() => xBatchPoll(many.batch)).toThrow(XNativeError);
  xClientClose(client);
});
