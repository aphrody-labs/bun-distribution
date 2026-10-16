// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- stream consumers read events in order. */
import { describe, expect, test } from "bun:test";
import { readSse, type SseEvent } from "../src/index.ts";

function streamOf(
  chunks: (string | Uint8Array)[],
  onCancel?: () => void,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[i++];
      if (chunk === undefined) controller.close();
      else
        controller.enqueue(
          typeof chunk === "string" ? encoder.encode(chunk) : chunk,
        );
    },
    cancel() {
      onCancel?.();
    },
  });
}

async function collect(chunks: (string | Uint8Array)[]): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of readSse(streamOf(chunks))) events.push(event);
  return events;
}

describe("readSse", () => {
  test("yields one event per blank line, with the default type", async () => {
    expect(await collect(["data: one\n\ndata: two\n\n"])).toEqual([
      { event: "message", data: "one" },
      { event: "message", data: "two" },
    ]);
  });

  test("joins multi-line data and keeps event, id and retry fields", async () => {
    const events = await collect([
      "event: update\nid: 7\nretry: 1500\ndata: a\ndata: b\n\n",
    ]);
    expect(events).toEqual([
      { event: "update", data: "a\nb", id: "7", retry: 1500 },
    ]);
  });

  test("handles events split across chunks, including inside a field and between CR and LF", async () => {
    const whole = 'data: {"a":1}\r\n\r\ndata: x\r\ndata: y\r\n\r\n';
    for (let cut = 1; cut < whole.length; cut++) {
      const events = await collect([whole.slice(0, cut), whole.slice(cut)]);
      expect(events.map((e) => e.data)).toEqual(['{"a":1}', "x\ny"]);
    }
  });

  test("accepts LF, CRLF and bare CR terminators", async () => {
    const events = await collect(["data: a\r\rdata: b\n\ndata: c\r\n\r\n"]);
    expect(events.map((e) => e.data)).toEqual(["a", "b", "c"]);
  });

  test("skips comments and unknown fields, strips one leading space only", async () => {
    const events = await collect([": keep-alive\nfoo: bar\ndata:  padded\n\n"]);
    expect(events).toEqual([{ event: "message", data: " padded" }]);
  });

  test("drops a trailing event that is not terminated by a blank line", async () => {
    expect(
      (await collect(["data: done\n\ndata: cut"])).map((e) => e.data),
    ).toEqual(["done"]);
  });

  test("ignores events without data and a leading byte order mark", async () => {
    const events = await collect(["﻿event: ping\n\ndata: ok\n\n"]);
    expect(events.map((e) => e.data)).toEqual(["ok"]);
  });

  test("decodes multi-byte characters split across chunks", async () => {
    const bytes = new TextEncoder().encode("data: héllo €\n\n");
    const events = await collect([bytes.slice(0, 8), bytes.slice(8)]);
    expect(events[0]?.data).toBe("héllo €");
  });

  test("cancels the underlying stream when the consumer stops early", async () => {
    let cancelled = false;
    const stream = streamOf(
      ["data: 1\n\n", "data: 2\n\n", "data: 3\n\n"],
      () => {
        cancelled = true;
      },
    );
    for await (const event of readSse(stream)) {
      expect(event.data).toBe("1");
      break;
    }
    expect(cancelled).toBe(true);
  });
});
