// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { UnifiedInferenceEngine } from "../../core/src/gemma4/inference";
import {
  executeTool,
  TOOLS,
  ToolExecutionContext,
} from "../../core/src/tools/registry";
import { callTool } from "../../core/src/tools/host";
import { NativeRedisClient } from "../../core/src/redis/client";
import { createApiServer } from "../../core/src/server/http";

const root = resolve(import.meta.dir, "../../../docs/aphrody");
const entry = resolve(import.meta.dir, "../src/index.ts");

const withoutTiming = (value: Record<string, unknown>) => {
  const { latencyMs: _, ...rest } = value;
  return rest;
};

test("SDK, CLI, MCP and HTTP use the same provider contract and schema", async () => {
  const requests: unknown[] = [];
  const provider = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      requests.push(await req.json());
      return Response.json({
        model: "provider-model",
        choices: [{ message: { content: "actual fixture reply" } }],
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      });
    },
  });
  const endpointUrl = `http://127.0.0.1:${provider.port}/v1`;
  const engine = new UnifiedInferenceEngine("provider-model", { endpointUrl });
  const redis = new NativeRedisClient({ offline: true });
  const context = new ToolExecutionContext({
    inference: engine,
    redisClient: redis,
  });
  const api = createApiServer({ port: 0, rootDir: root, toolContext: context });
  const args = {
    prompt: "question",
    model: "provider-model",
    systemPrompt: "system",
    history: [{ role: "assistant" as const, content: "previous" }],
  };
  try {
    expect(TOOLS.length).toBeGreaterThan(0);
    const direct = await engine.infer(args);
    const core = await executeTool("yolo_ai_infer", args, root, context);
    const host = await callTool("yolo_ai_infer", args, root, context);
    const fromMcp = JSON.parse(host.content[0]!.text);
    const response = await fetch(
      `http://127.0.0.1:${api.port}/api/tools/call`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "yolo_ai_infer", arguments: args }),
      },
    );
    expect(response.status).toBe(200);
    const fromHttp = await response.json();
    const child = Bun.spawn(
      [
        process.execPath,
        entry,
        "ai",
        "call",
        "yolo_ai_infer",
        JSON.stringify(args),
      ],
      {
        windowsHide: true,
        cwd: root,
        env: { ...process.env, YOLO_INFERENCE_ENDPOINT: endpointUrl },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, stderr).toBe(0);
    const fromCli = JSON.parse(stdout);
    for (const result of [core, fromMcp, fromHttp, fromCli]) {
      expect(withoutTiming(result as Record<string, unknown>)).toEqual(
        withoutTiming(direct as unknown as Record<string, unknown>),
      );
    }
    expect(requests).toHaveLength(5);
    for (const request of requests) expect(request).toEqual(requests[0]);
  } finally {
    api.stop(true);
    context.close();
    redis.close();
    provider.stop(true);
  }
});

test("AI CLI lists the owner schemas and rejects invalid input without a provider", async () => {
  const list = Bun.spawn([process.execPath, entry, "ai", "list"], {
    windowsHide: true,
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const catalog = JSON.parse(await new Response(list.stdout).text());
  expect(await list.exited).toBe(0);
  expect(
    catalog.find((tool: { name: string }) => tool.name === "yolo_ai_infer"),
  ).toEqual(TOOLS.find((tool) => tool.name === "yolo_ai_infer"));
  const invalid = Bun.spawn(
    [
      process.execPath,
      entry,
      "ai",
      "call",
      "yolo_ai_infer",
      '{"prompt":"question","maxTokens":0}',
    ],
    { windowsHide: true, cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  expect(await invalid.exited).toBe(1);
  expect(await new Response(invalid.stderr).text()).toContain(
    "outside the allowed range",
  );
});

test("HTTP capability adapter bundles without the tool host", async () => {
  const result = await Bun.build({
    entrypoints: [resolve(root, "packages/engine/core/src/server/http.ts")],
    target: "bun",
    sourcemap: "external",
  });
  expect(result.success).toBe(true);
  const map = result.outputs.find((output) => output.path.endsWith(".map"));
  const sources = (await map!.json()).sources as string[];
  expect(sources.some((path) => path.endsWith("tools/registry.ts"))).toBe(true);
  expect(sources.some((path) => path.endsWith("tools/host.ts"))).toBe(false);
});
