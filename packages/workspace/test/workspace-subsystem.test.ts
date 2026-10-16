// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WORKSPACE_TOOLS,
  callWorkspaceTool,
} from "../src/workspace-subsystem.ts";

const repository = join(import.meta.dir, "../../../docs/aphrody");

test("the catalog publishes unique read-only tools with closed object schemas", async () => {
  const names = WORKSPACE_TOOLS.map((tool) => tool.name);
  expect(new Set(names).size).toBe(names.length);
  for (const tool of WORKSPACE_TOOLS) {
    expect(tool.name).toStartWith("workspace_");
    expect(tool.readOnly).toBe(true);
    expect(tool.inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
  }
  expect(
    await callWorkspaceTool("workspace_build_factory_status", {
      root: repository,
    }),
  ).toHaveProperty("route");
  await expect(callWorkspaceTool("workspace_missing")).rejects.toThrow(
    "Unknown workspace tool",
  );
});

test("serve registers through the kernel, answers routed calls and fails on kernel close", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-subsystem-"));
  const path = join(directory, "kernel.sock");
  const seen: {
    registration?: Record<string, unknown>;
    result?: Record<string, unknown>;
  } = {};
  const server = createServer((socket) => {
    let buffer = "";
    const send = (message: object) =>
      socket.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    socket.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        const message = JSON.parse(line);
        if (message.method === "initialize")
          send({ id: message.id, result: {} });
        else if (message.method === "system/register_subsystem") {
          seen.registration = message.params;
          send({ id: message.id, result: { registered: "workspace" } });
          send({
            id: "kernel-1",
            method: "tools/call",
            params: {
              name: "workspace_build_factory_status",
              arguments: { root: repository },
            },
          });
        } else if (message.id === "kernel-1") {
          seen.result = message.result;
          socket.end();
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  try {
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "../src/workspace-subsystem.ts"),
        "--serve",
      ],
      {
        windowsHide: true,
        env: { ...process.env, APHRODY_OS_SOCKET: path },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(await child.exited).toBe(1);
    expect(seen.registration).toMatchObject({
      name: "workspace",
      runtime: "bun",
    });
    expect(
      (seen.registration!.tools as { name: string }[]).map((tool) => tool.name),
    ).toEqual(WORKSPACE_TOOLS.map((tool) => tool.name));
    expect(seen.result).toMatchObject({ isError: false });
    expect(seen.result!.structuredContent).toHaveProperty("route");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
