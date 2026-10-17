// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- the reader loop consumes the network stream chunk by chunk. */
/** Server-Sent Events reader (WHATWG HTML section 9.2.6) over a fetch response body. */

export interface SseEvent {
  /** Event type, `message` when the stream does not name one. */
  event: string;
  /** `data` lines joined with `\n`. */
  data: string;
  id?: string;
  retry?: number;
}

/**
 * Yield the events of an SSE byte stream. Comment lines are skipped; an event cut by the end of the
 * stream (no terminating blank line) is dropped, as the specification requires. The reader is
 * cancelled when the consumer stops early.
 */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let first = true;
  let eventType = "";
  let data: string[] = [];
  let lastId: string | undefined;
  let retry: number | undefined;

  const dispatch = (): SseEvent | undefined => {
    const event: SseEvent | undefined =
      data.length > 0
        ? {
            event: eventType || "message",
            data: data.join("\n"),
            ...(lastId === undefined ? {} : { id: lastId }),
            ...(retry === undefined ? {} : { retry }),
          }
        : undefined;
    eventType = "";
    data = [];
    retry = undefined;
    return event;
  };

  const consumeLine = (line: string): SseEvent | undefined => {
    if (line === "") return dispatch();
    if (line.startsWith(":")) return undefined;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "event":
        eventType = value;
        break;
      case "data":
        data.push(value);
        break;
      case "id":
        if (!value.includes("\0")) lastId = value;
        break;
      case "retry":
        if (/^\d+$/.test(value)) retry = Number(value);
        break;
      default:
        break;
    }
    return undefined;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (first && buffer.length > 0) {
        buffer = buffer.replace(/^﻿/, "");
        first = false;
      }
      // A trailing "\r" may be the first half of "\r\n": wait for the next chunk.
      const limit = done || !buffer.endsWith("\r") ? buffer.length : buffer.length - 1;
      const text = buffer.slice(0, limit);
      let start = 0;
      const terminators = /\r\n|\n|\r/g;
      for (let match = terminators.exec(text); match; match = terminators.exec(text)) {
        const event = consumeLine(text.slice(start, match.index));
        start = match.index + match[0].length;
        if (event) yield event;
      }
      buffer = buffer.slice(start);
      if (done) break;
    }
    // A last line without terminator is still a complete field line, but never a dispatched event.
    if (buffer.length > 0) consumeLine(buffer);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
