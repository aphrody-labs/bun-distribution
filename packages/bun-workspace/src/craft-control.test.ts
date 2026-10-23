// SPDX-License-Identifier: MIT AND Apache-2.0
import { expect, test } from "bun:test";
import { callCraftControl, CraftControlError } from "./craft-control";

test("rejects an incomplete UTF-8 sequence after the JSON-lines frame", async () => {
  const frame = new TextEncoder().encode('{"id":1,"ok":true}\n');
  const response = new Uint8Array(frame.byteLength + 1);
  response.set(frame);
  response[frame.byteLength] = 0xe2; // A UTF-8 lead byte without its continuation bytes.

  let replied = false;
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open() {},
      data(socket) {
        if (replied) return;
        replied = true;
        socket.end(response);
      },
    },
  });

  try {
    await expect(
      callCraftControl({ libraryId: "cadcraft", port: server.port }, "list", {}, { timeoutMs: 1_000 }),
    ).rejects.toMatchObject({
      name: "CraftControlError",
      code: "INVALID_RESPONSE",
    } satisfies Partial<CraftControlError>);
  } finally {
    server.stop(true);
  }
});
