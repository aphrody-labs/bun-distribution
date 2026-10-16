// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { browserSessionStream } from "./browser-session-stream";

test("browser chat receives its native SSE notifications and releases the connection", () => {
  let closed = false;
  const source: Pick<EventSource, "onmessage" | "close"> = {
    onmessage: null,
    close: () => {
      closed = true;
    },
  };
  const messages: unknown[] = [];
  const stop = browserSessionStream(
    "owned",
    (message) => messages.push(message),
    source,
  );
  const deliver = source.onmessage!;
  const send = (data: string) =>
    deliver.call(source as EventSource, { data } as MessageEvent);
  send(
    '{"method":"item/agentMessage/delta","params":{"threadId":"owned","delta":"hello"}}',
  );
  send('{"method":"turn/completed","params":{"threadId":"other"}}');
  send("broken JSON");
  send("null");
  send('{"method":"thread/started","params":{"thread":{"id":"other"}}}');
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({ method: "item/agentMessage/delta" });
  stop();
  send('{"method":"turn/completed","params":{"threadId":"owned"}}');
  expect(messages).toHaveLength(1);
  expect(closed).toBe(true);
  expect(source.onmessage).toBeNull();
});
