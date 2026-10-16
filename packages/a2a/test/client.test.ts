// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- stream consumers and sequential calls assert in order. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  A2AClient,
  A2ADiscoveryError,
  A2AError,
  A2ATransportError,
  AgentCardCache,
  applyStreamResponse,
  collectStream,
  dataPart,
  fetchAgentCard,
  isTerminalState,
  messageText,
  normalizeAgentCard,
  responseText,
  selectInterface,
  sendMessageRequest,
  taskText,
  userMessage,
  type StreamResponse,
  type SupportedBinding,
} from "../src/index.ts";
import { startFakeAgent, type FakeAgent } from "./fake-agent.ts";

let agent: FakeAgent;
beforeAll(() => {
  agent = startFakeAgent();
});
afterAll(() => agent.stop());

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of stream) items.push(item);
  return items;
}

describe("Agent Card discovery", () => {
  test("fetches the well-known card and connects to the preferred interface", async () => {
    const client = await A2AClient.connect(agent.url);
    expect(client.card?.name).toBe("Fake Agent");
    expect(client.binding).toBe("JSONRPC");
    expect(client.url).toBe(`${agent.url}/rpc`);
    expect(client.capabilities.streaming).toBe(true);
  });

  test("honours a base URL with a trailing slash and a direct card URL", async () => {
    expect((await fetchAgentCard(`${agent.url}/`)).name).toBe("Fake Agent");
    expect(
      (await fetchAgentCard(`${agent.url}/.well-known/agent-card.json`)).name,
    ).toBe("Fake Agent");
  });

  test("can prefer the HTTP+JSON interface", async () => {
    const client = await A2AClient.connect(agent.url, {
      bindings: ["HTTP+JSON"],
    });
    expect(client.binding).toBe("HTTP+JSON");
    expect(client.url).toBe(`${agent.url}/rest`);
  });

  test("revalidates a cached card with If-None-Match and reuses it on 304", async () => {
    const cache = new AgentCardCache();
    const before = agent.cardFetches;
    const first = await fetchAgentCard(agent.url, { cache });
    const second = await fetchAgentCard(agent.url, { cache });
    expect(agent.cardFetches - before).toBe(2);
    expect(agent.conditionalCardFetches).toBeGreaterThanOrEqual(1);
    expect(second).toBe(first);
  });

  test("a card with no 1.0 interface is refused instead of silently downgraded", async () => {
    const legacy = startFakeAgent({ legacyCard: true });
    try {
      const card = await fetchAgentCard(legacy.url);
      expect(card.supportedInterfaces).toEqual([
        {
          url: `${legacy.url}/rpc`,
          protocolBinding: "JSONRPC",
          protocolVersion: "0.3.0",
        },
      ]);
      expect(card.capabilities.extendedAgentCard).toBe(true);
      await expect(A2AClient.connect(legacy.url)).rejects.toBeInstanceOf(
        A2ADiscoveryError,
      );
      await expect(A2AClient.connect(legacy.url)).rejects.toThrow(
        /no JSONRPC\/HTTP\+JSON interface for A2A 1\.0/,
      );
    } finally {
      legacy.stop();
    }
  });

  test("failures are typed", async () => {
    await expect(fetchAgentCard(`${agent.url}/missing`)).rejects.toMatchObject({
      kind: "fetch",
      status: 404,
    });
    await expect(
      fetchAgentCard("http://127.0.0.1:1", { timeoutMs: 2000 }),
    ).rejects.toMatchObject({
      kind: "fetch",
    });
    expect(() => normalizeAgentCard({})).toThrow(A2ADiscoveryError);
    expect(() => normalizeAgentCard({ name: "x" })).toThrow(
      /declares no interface/,
    );
    const card = agent.card();
    expect(() => selectInterface(card, { protocolVersion: "2.0" })).toThrow(
      /for A2A 2\.0/,
    );
    expect(selectInterface(card, { protocolVersion: "1.0.3" }).binding).toBe(
      "JSONRPC",
    );
  });
});

describe.each<SupportedBinding>(["JSONRPC", "HTTP+JSON"])(
  "operations over %s",
  (binding) => {
    let client: A2AClient;
    beforeAll(async () => {
      client = await A2AClient.connect(agent.url, { bindings: [binding] });
    });

    test("sendMessage with a string returns a completed task", async () => {
      const response = await client.sendMessage("hello");
      expect(response.task?.status.state).toBe("TASK_STATE_COMPLETED");
      expect(responseText(response)).toBe("echo: hello");
      expect(taskText(response.task!)).toBe("echo: hello");
      expect(response.task?.history?.[0]?.role).toBe("ROLE_USER");
    });

    test("sendMessage sends ProtoJSON with the service parameters", async () => {
      const before = agent.requests.length;
      await client.sendMessage(
        sendMessageRequest([{ text: "structured" }, dataPart({ n: 1 })], {
          contextId: "ctx-42",
          configuration: {
            acceptedOutputModes: ["text/plain"],
            historyLength: 5,
          },
          requestMetadata: { origin: "test" },
        }),
        { headers: { "x-trace": "abc" } },
      );
      const request = agent.requests
        .slice(before)
        .find((r) => r.method === "POST");
      expect(request?.headers.get("a2a-version")).toBe("1.0");
      expect(request?.headers.get("x-trace")).toBe("abc");
      const body = (
        binding === "JSONRPC"
          ? (request!.body as { params: unknown }).params
          : request?.body
      ) as Record<string, any>;
      expect(body.message.role).toBe("ROLE_USER");
      expect(body.message.contextId).toBe("ctx-42");
      expect(body.message.parts).toEqual([
        { text: "structured" },
        { data: { n: 1 }, mediaType: "application/json" },
      ]);
      expect(body.configuration).toEqual({
        acceptedOutputModes: ["text/plain"],
        historyLength: 5,
      });
      expect(body.metadata).toEqual({ origin: "test" });
      expect(body.tenant).toBeUndefined();
    });

    test("a direct agent message needs no task", async () => {
      const response = await client.sendMessage("message");
      expect(response.task).toBeUndefined();
      expect(messageText(response.message)).toBe("direct reply");
    });

    test("returnImmediately yields a working task that getTask can follow", async () => {
      const response = await client.sendMessage(
        sendMessageRequest("later", {
          configuration: { returnImmediately: true },
        }),
      );
      expect(response.task?.status.state).toBe("TASK_STATE_WORKING");
      const task = await client.getTask(response.task!.id);
      expect(task.id).toBe(response.task!.id);
      expect(isTerminalState(task.status.state)).toBe(false);
    });

    test("getTask honours historyLength", async () => {
      const { task } = await client.sendMessage("history");
      expect(
        (await client.getTask({ id: task!.id, historyLength: 0 })).history,
      ).toBeUndefined();
      expect(
        (await client.getTask({ id: task!.id, historyLength: 1 })).history,
      ).toHaveLength(1);
    });

    test("errors carry the A2A code, reason, domain and metadata", async () => {
      const failure = await client
        .getTask("does-not-exist")
        .catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(A2AError);
      const error = failure as A2AError;
      expect(error.code).toBe(-32001);
      expect(error.reason).toBe("TASK_NOT_FOUND");
      expect(error.is("TASK_NOT_FOUND")).toBe(true);
      expect(error.domain).toBe("a2a-protocol.org");
      expect(error.taskId).toBe("does-not-exist");
      expect(error.method).toBe("GetTask");
      if (binding === "HTTP+JSON") expect(error.httpStatus).toBe(404);
    });

    test("each A2A error type maps to its code", async () => {
      for (const [forced, code] of [
        ["CONTENT_TYPE_NOT_SUPPORTED", -32005],
        ["INVALID_AGENT_RESPONSE", -32006],
        ["PUSH_NOTIFICATION_NOT_SUPPORTED", -32003],
        ["EXTENSION_SUPPORT_REQUIRED", -32008],
      ] as const) {
        const error = (await client
          .sendMessage(`fail:${forced}`)
          .catch((e: unknown) => e)) as A2AError;
        expect(error.code).toBe(code);
        expect(error.reason).toBe(forced);
      }
    });

    test("listTasks filters, paginates and normalises omitted collections", async () => {
      const fresh = startFakeAgent();
      try {
        const c = await A2AClient.connect(fresh.url, { bindings: [binding] });
        const empty = await c.listTasks();
        expect(empty).toMatchObject({
          tasks: [],
          nextPageToken: "",
          totalSize: 0,
        });
        for (const text of ["a", "b", "c", "d", "e"]) await c.sendMessage(text);
        const page = await c.listTasks({ pageSize: 2 });
        expect(page.tasks).toHaveLength(2);
        expect(page.nextPageToken).not.toBe("");
        expect(page.totalSize).toBe(5);
        expect(
          (await collect(c.listAllTasks({ pageSize: 2 }))).map((t) =>
            taskText(t),
          ),
        ).toEqual(["echo: a", "echo: b", "echo: c", "echo: d", "echo: e"]);
        expect(
          (await c.listTasks({ status: "TASK_STATE_WORKING" })).tasks,
        ).toEqual([]);
        expect(
          (await c.listTasks({ status: "TASK_STATE_COMPLETED", pageSize: 100 }))
            .tasks,
        ).toHaveLength(5);
      } finally {
        fresh.stop();
      }
    });

    test("cancelTask cancels a working task and refuses a finished one", async () => {
      const { task } = await client.sendMessage(
        sendMessageRequest("cancel me", {
          configuration: { returnImmediately: true },
        }),
      );
      expect((await client.cancelTask(task!.id)).status.state).toBe(
        "TASK_STATE_CANCELED",
      );
      const again = (await client
        .cancelTask(task!.id)
        .catch((e: unknown) => e)) as A2AError;
      expect(again.reason).toBe("TASK_NOT_CANCELABLE");
      expect(again.code).toBe(-32002);
    });

    test("sendStreamingMessage yields the task, then status and artifact updates", async () => {
      const events = await collect(client.sendStreamingMessage("stream me"));
      expect(events.map((e) => Object.keys(e)[0])).toEqual([
        "task",
        "statusUpdate",
        "artifactUpdate",
        "artifactUpdate",
        "statusUpdate",
      ]);
      expect(events[0]?.task?.status.state).toBe("TASK_STATE_SUBMITTED");
      expect(events[3]?.artifactUpdate).toMatchObject({
        append: true,
        lastChunk: true,
      });
      const final = await collect(client.sendStreamingMessage("again")).then(
        (list) =>
          list.reduce<ReturnType<typeof applyStreamResponse>>(
            applyStreamResponse,
            undefined,
          ),
      );
      expect(final?.status.state).toBe("TASK_STATE_COMPLETED");
      expect(taskText(final!)).toBe("echo: \nagain");
    });

    test("collectStream returns the accumulated task or the single message", async () => {
      const task = await collectStream(client.sendStreamingMessage("collect"));
      expect(task?.task?.status.state).toBe("TASK_STATE_COMPLETED");
      expect(responseText(task!)).toBe("echo: \ncollect");
      const message = await collectStream(
        client.sendStreamingMessage("message"),
      );
      expect(message?.message && messageText(message.message)).toBe(
        "direct reply",
      );
    });

    test("a failure before the first event rejects, one after it rejects mid-stream", async () => {
      const before = (await collect(
        client.sendStreamingMessage("fail:UNSUPPORTED_OPERATION"),
      ).catch((e: unknown) => e)) as A2AError;
      expect(before).toBeInstanceOf(A2AError);
      expect(before.reason).toBe("UNSUPPORTED_OPERATION");

      const seen: StreamResponse[] = [];
      const failure = await (async () => {
        try {
          for await (const event of client.sendStreamingMessage("error-mid"))
            seen.push(event);
        } catch (e) {
          return e as A2AError;
        }
      })();
      expect(seen.length).toBe(3);
      expect(failure).toBeInstanceOf(A2AError);
      expect(failure?.reason).toBe("INTERNAL_ERROR");
    });

    test("subscribeToTask follows a live task and refuses a terminal one", async () => {
      const { task } = await client.sendMessage(
        sendMessageRequest("watch", {
          configuration: { returnImmediately: true },
        }),
      );
      const events = await collect(client.subscribeToTask(task!.id));
      expect(events.map((e) => Object.keys(e)[0])).toEqual([
        "task",
        "statusUpdate",
      ]);
      const refused = (await collect(client.subscribeToTask(task!.id)).catch(
        (e: unknown) => e,
      )) as A2AError;
      expect(refused.reason).toBe("UNSUPPORTED_OPERATION");
      const missing = (await collect(client.subscribeToTask("nope")).catch(
        (e: unknown) => e,
      )) as A2AError;
      expect(missing.reason).toBe("TASK_NOT_FOUND");
    });

    test("push notification configs: create, get, list, delete", async () => {
      const { task } = await client.sendMessage("push");
      const taskId = task!.id;
      const created = await client.createPushNotificationConfig({
        taskId,
        url: "https://hooks.example/a2a",
        token: "tok",
        authentication: { scheme: "Bearer", credentials: "secret" },
      });
      expect(created.id).toBeTruthy();
      expect(created.url).toBe("https://hooks.example/a2a");
      expect(
        await client.getPushNotificationConfig({ taskId, id: created.id! }),
      ).toMatchObject({
        authentication: { scheme: "Bearer" },
      });
      expect(
        (await client.listPushNotificationConfigs(taskId)).configs,
      ).toHaveLength(1);
      await client.deletePushNotificationConfig({ taskId, id: created.id! });
      expect(
        (await client.listPushNotificationConfigs({ taskId })).configs,
      ).toEqual([]);
    });

    test("getExtendedAgentCard returns the richer card", async () => {
      expect((await client.getExtendedAgentCard()).description).toBe(
        "extended",
      );
    });
  },
);

describe("service parameters, credentials and tenants", () => {
  test("static and dynamic headers, extensions and the protocol version reach the agent", async () => {
    const secured = startFakeAgent({ bearer: "s3cret" });
    try {
      let issued = 0;
      const client = await A2AClient.connect(secured.url, {
        headers: () => ({
          authorization: `Bearer ${issued++ === 0 ? "s3cret" : "s3cret"}`,
        }),
        extensions: [
          "https://example.com/ext/a/v1",
          "https://example.com/ext/b/v1",
        ],
      });
      await client.sendMessage("hi");
      await client.listTasks();
      expect(issued).toBe(3); // the card request and the two calls
      const call = secured.requests.findLast((r) => r.path === "/rpc");
      expect(call?.headers.get("a2a-extensions")).toBe(
        "https://example.com/ext/a/v1,https://example.com/ext/b/v1",
      );
      expect(call?.headers.get("a2a-version")).toBe("1.0");
    } finally {
      secured.stop();
    }
  });

  test("an unauthorised exchange is a typed HTTP failure, not an A2A error", async () => {
    const secured = startFakeAgent({ bearer: "s3cret" });
    try {
      const client = new A2AClient({
        url: `${secured.url}/rpc`,
        headers: { authorization: "Bearer wrong" },
      });
      const failure = (await client
        .sendMessage("hi")
        .catch((e: unknown) => e)) as A2ATransportError;
      expect(failure).toBeInstanceOf(A2ATransportError);
      expect(failure.kind).toBe("http");
      expect(failure.status).toBe(401);
    } finally {
      secured.stop();
    }
  });

  test("the version is always declared: an agent that checks it accepts the client", async () => {
    // The fake agent answers VERSION_NOT_SUPPORTED when the header is missing or not 1.0.
    const raw = await fetch(`${agent.url}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "ListTasks",
        params: {},
      }),
    });
    expect(((await raw.json()) as { error: { code: number } }).error.code).toBe(
      -32009,
    );
    await expect(
      new A2AClient({ url: `${agent.url}/rpc` }).listTasks(),
    ).resolves.toBeDefined();
  });

  test("the tenant of the selected interface is applied on both bindings", async () => {
    const tenanted = startFakeAgent({ tenant: "acme" });
    try {
      for (const binding of ["JSONRPC", "HTTP+JSON"] as const) {
        const client = await A2AClient.connect(tenanted.url, {
          bindings: [binding],
        });
        expect(client.tenant).toBe("acme");
        const before = tenanted.requests.length;
        await client.sendMessage("tenant");
        const request = tenanted.requests
          .slice(before)
          .find((r) => r.method === "POST")!;
        if (binding === "JSONRPC")
          expect((request.body as any).params.tenant).toBe("acme");
        else expect(request.path).toBe("/rest/acme/message:send");
      }
    } finally {
      tenanted.stop();
    }
  });
});

describe("transport behaviour", () => {
  test("a deadline turns into a timeout error, an aborted signal into an aborted error", async () => {
    const slow = startFakeAgent({ streamDelayMs: 400 });
    try {
      const client = await A2AClient.connect(slow.url);
      const controller = new AbortController();
      const stream = client.sendStreamingMessage("slow", {
        signal: controller.signal,
      });
      const first = await stream.next();
      expect(first.value?.task).toBeDefined();
      controller.abort();
      const aborted = (await stream
        .next()
        .catch((e: unknown) => e)) as A2ATransportError;
      expect(aborted).toBeInstanceOf(A2ATransportError);
      expect(aborted.kind).toBe("aborted");

      const hung = new A2AClient({
        url: `${slow.url}/rpc`,
        timeoutMs: 50,
        fetch: ((_url: unknown, init?: RequestInit) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            ),
          )) as unknown as typeof fetch,
      });
      const timeout = (await hung
        .listTasks()
        .catch((e: unknown) => e)) as A2ATransportError;
      expect(timeout.kind).toBe("timeout");
    } finally {
      slow.stop();
    }
  });

  test("a connection failure is a network error", async () => {
    const failure = (await new A2AClient({
      url: "http://127.0.0.1:1/rpc",
      timeoutMs: 2000,
    })
      .listTasks()
      .catch((e: unknown) => e)) as A2ATransportError;
    expect(failure.kind).toBe("network");
  });

  test("a non JSON-RPC answer is a protocol error", async () => {
    const client = new A2AClient({
      url: "http://agent.invalid/rpc",
      fetch: (async () =>
        new Response('{"hello":"world"}', {
          headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch,
    });
    const failure = (await client
      .listTasks()
      .catch((e: unknown) => e)) as A2ATransportError;
    expect(failure.kind).toBe("protocol");
  });

  test("a stream cut by the network is a stream error", async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"jsonrpc":"2.0","id":1,"result":{"task":{"id":"t","status":{"state":"TASK_STATE_WORKING"}}}}\n\n',
          ),
        );
      },
      pull() {
        throw new Error("connection reset");
      },
    });
    const client = new A2AClient({
      url: "http://agent.invalid/rpc",
      fetch: (async () =>
        new Response(broken, {
          headers: { "content-type": "text/event-stream" },
        })) as unknown as typeof fetch,
    });
    const stream = client.sendStreamingMessage("x");
    expect((await stream.next()).value?.task?.id).toBe("t");
    const failure = (await stream
      .next()
      .catch((e: unknown) => e)) as A2ATransportError;
    expect(failure.kind).toBe("stream");
  });

  test("custom fetch and message builders compose", async () => {
    const seen: string[] = [];
    const client = new A2AClient({
      url: "http://agent.invalid/rpc",
      fetch: (async (url: string, init: RequestInit) => {
        seen.push(`${init.method} ${url}`);
        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { message: userMessage("pong") },
        });
      }) as unknown as typeof fetch,
    });
    expect(responseText(await client.sendMessage("ping"))).toBe("pong");
    expect(seen).toEqual(["POST http://agent.invalid/rpc"]);
  });
});
