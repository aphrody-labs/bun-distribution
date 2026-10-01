// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from "bun:test";
import {
  appendRemoteEnvelope,
  aphrodyA2aStoreEnabled,
  createRemoteTask,
  getRemoteTask,
  listRemoteEnvelopes,
  listRemoteTasks,
  putRemoteTask,
} from "../../src/aphrody/a2a-remote";
import type { A2AEnvelope, A2ATask } from "../../src/aphrody/a2a";

const ENV_KEYS = [
  "APHRODY_A2A_COORD_API",
  "APHRODY_A2A_COORD_TOKEN",
  "APHRODY_A2A_COORD_TIMEOUT_MS",
  "NODE_ENV",
] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function makeTask(id = "task-1"): A2ATask {
  return {
    id,
    target: "codex",
    status: "submitted",
    description: "fixture task",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    history: [],
    artifacts: [],
    metadata: {},
  };
}

function makeEnvelope(id = "env-1"): A2AEnvelope {
  return {
    v: 1,
    ts: "2026-10-01T10:00:00.000Z",
    id,
    from: "codex",
    to: "shenron-dragonball",
    kind: "ping",
    topic: "fixture",
    body: "ping",
    channel_hint: ["http_jsonrpc"],
  };
}

async function withApi(
  fetcher: (request: Request) => Response | Promise<Response>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const server = Bun.serve({ port: 0, fetch: fetcher });
  const previousApi = process.env.APHRODY_A2A_COORD_API;
  const previousToken = process.env.APHRODY_A2A_COORD_TOKEN;
  process.env.APHRODY_A2A_COORD_API = `${server.url.origin}/v1/`;
  process.env.APHRODY_A2A_COORD_TOKEN = "test-token";
  try {
    await run("/v1/coord/shenron-dragonball");
  } finally {
    if (previousApi === undefined) delete process.env.APHRODY_A2A_COORD_API;
    else process.env.APHRODY_A2A_COORD_API = previousApi;
    if (previousToken === undefined) delete process.env.APHRODY_A2A_COORD_TOKEN;
    else process.env.APHRODY_A2A_COORD_TOKEN = previousToken;
    server.stop(true);
  }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

describe("Aphrody A2A remote store configuration", () => {
  it("requires the namespaced API in production and accepts HTTP or HTTPS VPN endpoints", () => {
    process.env.NODE_ENV = "production";
    delete process.env.APHRODY_A2A_COORD_API;
    expect(() => aphrodyA2aStoreEnabled()).toThrow("APHRODY_A2A_COORD_API is required");

    process.env.NODE_ENV = "test";
    expect(aphrodyA2aStoreEnabled()).toBe(false);
    process.env.APHRODY_A2A_COORD_API = "http://a2a.internal:8788/v1";
    expect(aphrodyA2aStoreEnabled()).toBe(true);
    process.env.APHRODY_A2A_COORD_API = "https://a2a.example/v1";
    expect(aphrodyA2aStoreEnabled()).toBe(true);
  });

  it("rejects credentials and non-HTTP(S) API URLs", () => {
    for (const value of [
      "file:///tmp/a2a",
      "ftp://a2a.example",
      "https://user:secret@a2a.example",
    ]) {
      process.env.APHRODY_A2A_COORD_API = value;
      expect(() => aphrodyA2aStoreEnabled()).toThrow("credential-free HTTP(S) URL");
    }
  });
});

describe("Aphrody A2A HTTP client", () => {
  it("uses the Rust task/envelope REST response shapes and preserves the API base path", async () => {
    const task = makeTask();
    const envelope = makeEnvelope();
    const tasks = new Map<string, A2ATask>();
    const envelopes: A2AEnvelope[] = [];
    const calls: Array<{ method: string; path: string; authorization: string | null }> = [];
    await withApi(
      async (request) => {
        const url = new URL(request.url);
        calls.push({
          method: request.method,
          path: url.pathname,
          authorization: request.headers.get("authorization"),
        });
        if (url.pathname.endsWith("/tasks") && request.method === "POST") {
          const value = (await request.json()) as A2ATask;
          tasks.set(value.id, value);
          return json(value, 201);
        }
        if (url.pathname.endsWith("/tasks") && request.method === "GET") {
          return json({ tasks: [...tasks.values()], total: tasks.size });
        }
        if (url.pathname.endsWith(`/tasks/${task.id}`) && request.method === "PUT") {
          const value = (await request.json()) as A2ATask;
          tasks.set(value.id, value);
          return json(value);
        }
        if (url.pathname.endsWith(`/tasks/${task.id}`) && request.method === "GET") {
          return json(tasks.get(task.id) ?? task);
        }
        if (url.pathname.endsWith("/envelopes") && request.method === "POST") {
          const value = (await request.json()) as A2AEnvelope;
          envelopes.push(value);
          return json({ ok: true, id: value.id }, 201);
        }
        if (url.pathname.endsWith("/envelopes") && request.method === "GET") {
          return json({ envelopes, total: envelopes.length });
        }
        return json({ error: "not found" }, 404);
      },
      async (root) => {
        expect(await createRemoteTask(task)).toBeUndefined();
        const updated = { ...task, status: "working" as const };
        expect(await putRemoteTask(updated)).toBeUndefined();
        expect(await getRemoteTask(task.id)).toEqual(updated);
        expect(await listRemoteTasks("codex")).toEqual([updated]);
        await appendRemoteEnvelope(envelope);
        expect(await listRemoteEnvelopes()).toEqual([envelope]);
        expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
          `POST ${root}/tasks`,
          `PUT ${root}/tasks/${task.id}`,
          `GET ${root}/tasks/${task.id}`,
          `GET ${root}/tasks`,
          `POST ${root}/envelopes`,
          `GET ${root}/envelopes`,
        ]);
        expect(calls.every((call) => call.authorization === "Bearer test-token")).toBe(true);
      },
    );
  });

  it("returns missing only for the Rust task-not-found 404 and propagates other HTTP errors", async () => {
    await withApi(
      (request) => {
        const url = new URL(request.url);
        if (url.pathname.endsWith("/tasks/missing")) return json({ error: "task not found" }, 404);
        if (url.pathname.endsWith("/tasks/proxy-miss"))
          return json({ error: "route missing" }, 404);
        return json({ error: "store unavailable" }, 503);
      },
      async () => {
        expect(await getRemoteTask("missing")).toBeUndefined();
        await expect(getRemoteTask("proxy-miss")).rejects.toThrow(
          "Aphrody A2A store 404: route missing",
        );
        await expect(getRemoteTask("unavailable")).rejects.toThrow(
          "Aphrody A2A store 503: store unavailable",
        );
      },
    );
  });

  it("rejects malformed task and envelope responses rather than fabricating empty success", async () => {
    const task = makeTask();
    const envelope = makeEnvelope();
    let mode = "create";
    await withApi(
      async (request) => {
        const url = new URL(request.url);
        if (mode === "create") return json({}, 201);
        if (mode === "update") return json({ ...task, id: "wrong-id" });
        if (mode === "get") return json({ id: task.id, status: "submitted" });
        if (mode === "tasks") return json({ tasks: [task], total: "1" });
        if (mode === "append") return json({ ok: true, id: "wrong-id" }, 201);
        if (mode === "envelopes") return json({ envelopes: [{}], total: 1 });
        return json({ error: `unexpected ${request.method} ${url.pathname}` }, 500);
      },
      async () => {
        await expect(createRemoteTask(task)).rejects.toThrow("invalid task create response");
        mode = "update";
        await expect(putRemoteTask(task)).rejects.toThrow("invalid task update response");
        mode = "get";
        await expect(getRemoteTask(task.id)).rejects.toThrow("invalid task get response");
        mode = "tasks";
        await expect(listRemoteTasks()).rejects.toThrow("invalid task list response");
        mode = "append";
        await expect(appendRemoteEnvelope(envelope)).rejects.toThrow(
          "invalid envelope append response",
        );
        mode = "envelopes";
        await expect(listRemoteEnvelopes()).rejects.toThrow("invalid envelope list response");
      },
    );
  });

  it("bounds HTTP requests with an abort timeout", async () => {
    process.env.APHRODY_A2A_COORD_TIMEOUT_MS = "20";
    await withApi(
      () => new Promise<Response>(() => {}),
      async () => {
        await expect(getRemoteTask("slow")).rejects.toThrow("timed out after 20 ms");
      },
    );
  });
});
