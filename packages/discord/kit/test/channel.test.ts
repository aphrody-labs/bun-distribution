// SPDX-License-Identifier: Apache-2.0
// Inbox cursor consumption is intentionally sequential.
/* oxlint-disable no-await-in-loop */
import { expect, test } from "bun:test";
import { ChannelError, DiscordChannel } from "../src/messaging.ts";

const message = (id: number) => ({ id: String(id), channel_id: "c1", content: `message ${id}` });

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

test("sendText uses the configured transport and returns a message reference", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const channel = new DiscordChannel({
    token: "test-token",
    fetch: (async (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return json({ id: "message-1", channel_id: "room 1" });
    }) as typeof fetch,
  });

  expect(await channel.sendText("room 1", "Hello")).toEqual({
    id: "message-1",
    room: "room 1",
    channelId: "discord",
  });
  expect(requestedUrl).toBe("https://discord.com/api/v10/channels/room%201/messages");
  expect(requestedInit?.method).toBe("POST");
  expect(new Headers(requestedInit?.headers).get("authorization")).toBe("Bot test-token");
  expect(JSON.parse(String(requestedInit?.body))).toEqual({ content: "Hello" });
});

test("sendFile sends the file through multipart form data", async () => {
  let form: FormData | undefined;
  const channel = new DiscordChannel({
    token: "test-token",
    fetch: (async (_input, init) => {
      form = init?.body as FormData;
      return json({ id: "message-2", channel_id: "room-2" });
    }) as typeof fetch,
  });

  await channel.sendFile("room-2", new File(["data"], "note.txt"), "text/plain");
  expect(form?.get("payload_json")).toBe("{}");
  const upload = form?.get("files[0]");
  expect(upload).toBeInstanceOf(File);
  expect((upload as File).name).toBe("note.txt");
  expect(await (upload as File).text()).toBe("data");
});

test("Discord API errors retain the code and transport failures retain the cause", async () => {
  const api = new DiscordChannel({
    token: "test-token",
    fetch: (async () => json({ code: 50013, message: "Missing Permissions" }, 403)) as typeof fetch,
  });
  expect(api.sendText("room", "Hello")).rejects.toMatchObject({
    name: "ChannelError",
    message: "Missing Permissions",
    code: "50013",
  });

  const cause = new Error("connection lost");
  const failed = new DiscordChannel({
    token: "test-token",
    fetch: (async () => {
      throw cause;
    }) as typeof fetch,
  });
  try {
    await failed.sendText("room", "Hello");
    throw new Error("expected a transport error");
  } catch (error) {
    expect(error).toBeInstanceOf(ChannelError);
    expect((error as ChannelError).cause).toBe(cause);
  }
});

test("the shared REST client waits and retries a Discord 429", async () => {
  let attempts = 0;
  const channel = new DiscordChannel({
    token: "test-token",
    fetch: (async () => {
      attempts++;
      if (attempts === 1) {
        return Response.json(
          { message: "rate limited", retry_after: 0.001 },
          {
            status: 429,
            headers: { "retry-after": "0.001" },
          },
        );
      }
      return json({ id: "message-3", channel_id: "room-3" });
    }) as typeof fetch,
  });

  expect((await channel.sendText("room-3", "Hello")).id).toBe("message-3");
  expect(attempts).toBe(2);
});

test("rooms maps Discord channel kinds and tolerates one inaccessible guild", async () => {
  const channel = new DiscordChannel({
    token: "test-token",
    fetch: (async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("users/@me/guilds"))
        return json([
          { id: "g1", name: "one" },
          { id: "g2", name: "two" },
        ]);
      if (path.endsWith("guilds/g1/channels"))
        return json([
          { id: "c1", name: "general", type: 0 },
          { id: "t1", type: 11 },
        ]);
      return json({ code: 50001, message: "Missing Access" }, 403);
    }) as typeof fetch,
  });

  expect(await channel.rooms()).toEqual([
    { id: "c1", name: "general", kind: "channel", memberCount: null },
    { id: "t1", name: "", kind: "thread", memberCount: null },
  ]);
});

test("streamInbox makes no request when already cancelled", async () => {
  let requests = 0;
  const channel = new DiscordChannel({
    token: "test-token",
    fetch: (async () => {
      requests++;
      return json([]);
    }) as typeof fetch,
  });
  const controller = new AbortController();
  controller.abort();
  expect(await channel.streamInbox({ signal: controller.signal }).next()).toEqual({
    value: undefined,
    done: true,
  });
  expect(requests).toBe(0);
});

test("streamInbox aborts room discovery in flight", async () => {
  const controller = new AbortController();
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const channel = new DiscordChannel({
    token: "test-token",
    fetch: (async (_input, init) => {
      started();
      return new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          {
            once: true,
          },
        );
      });
    }) as typeof fetch,
  });
  const next = channel.streamInbox({ signal: controller.signal }).next();
  await requestStarted;
  controller.abort();
  expect(await next).toEqual({ value: undefined, done: true });
});

test("streamInbox backfills every page newer than its saved cursor", async () => {
  const queries: string[] = [];
  const channel = new DiscordChannel({
    token: "test-token",
    pollIntervalMs: 1,
    fetch: (async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("users/@me/guilds")) return json([{ id: "g1", name: "one" }]);
      if (url.pathname.endsWith("guilds/g1/channels"))
        return json([{ id: "c1", name: "general", type: 0 }]);
      queries.push(url.search);
      if (url.searchParams.get("after") === "0") return json([message(10)]);
      if (url.searchParams.get("after") === "10")
        return json(Array.from({ length: 100 }, (_, index) => message(112 - index)));
      if (url.searchParams.get("before") === "13")
        return json([message(12), message(11), message(10)]);
      throw new Error(`unexpected page: ${url.search}`);
    }) as typeof fetch,
  });
  const controller = new AbortController();
  const inbox = channel.streamInbox({ signal: controller.signal });
  const ids: string[] = [];
  for (let index = 0; index < 103; index++) ids.push((await inbox.next()).value!.id);
  controller.abort();
  expect(ids).toEqual(Array.from({ length: 103 }, (_, index) => String(index + 10)));
  expect(queries).toEqual(["?after=0&limit=100", "?after=10&limit=100", "?before=13&limit=100"]);
});

test("streamInbox stops within a page after cancellation", async () => {
  const controller = new AbortController();
  const channel = new DiscordChannel({
    token: "test-token",
    fetch: (async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("users/@me/guilds")) return json([{ id: "g1", name: "one" }]);
      if (path.endsWith("guilds/g1/channels"))
        return json([{ id: "c1", name: "general", type: 0 }]);
      return json([
        { id: "2", channel_id: "c1", content: "second" },
        { id: "1", channel_id: "c1", content: "first" },
      ]);
    }) as typeof fetch,
  });
  const inbox = channel.streamInbox({ signal: controller.signal });
  expect((await inbox.next()).value?.text).toBe("first");
  controller.abort();
  expect(await inbox.next()).toEqual({ value: undefined, done: true });
});
