// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { createServer, type Socket } from "node:net";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { KernelClient } from "../src/index.ts";

async function endpoint(reply: boolean) {
  const root = await mkdtemp(join(tmpdir(), "aphrody-transport-"));
  const path =
    process.platform === "win32"
      ? `\\\\.\\pipe\\aphrody-transport-${crypto.randomUUID()}`
      : join(root, "kernel.sock");
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let buffer = "";
    socket.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        const request = JSON.parse(line);
        if (reply && request.method === "initialize")
          socket.write(
            JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }) +
              "\n",
          );
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  return {
    path,
    async dispose() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("a stalled MCP handshake times out and closes its connection", async () => {
  const server = await endpoint(false);
  try {
    await expect(KernelClient.connect(server.path, "test", 30)).rejects.toThrow(
      "timed out",
    );
  } finally {
    await server.dispose();
  }
});

test("request deadlines and shutdown reject waits, including calls made after close", async () => {
  const server = await endpoint(true);
  const client = await KernelClient.connect(server.path);
  try {
    await expect(client.call("stalled-tool", {}, 30)).rejects.toThrow(
      "timed out",
    );
    const pending = client.request("tools/list");
    client.close();
    await expect(pending).rejects.toThrow("closed");
    await client.closed;
    await expect(client.request("tools/list")).rejects.toThrow("closed");
  } finally {
    client.close();
    await server.dispose();
  }
});

test("invalid deadlines are refused before starting a connection", async () => {
  await expect(KernelClient.connect("/missing", "test", 0)).rejects.toThrow(
    "positive",
  );
});
