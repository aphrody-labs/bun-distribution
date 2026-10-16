// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  McpConfigError,
  claudeCodeState,
  configureClaudeCode,
  configureDesktop,
  desktopConfigFiles,
  desktopState,
  mcpSpec,
  mergeDesktopConfig,
  probeMcp,
} from "../../src/admin/lib/mcp.ts";
import { testContext } from "./helpers.ts";

const spec = mcpSpec("C:\\Users\\Omar\\.local\\bin\\aphrody.exe");

test("the launch line is the plugin's: aphrody mcp-server", () => {
  expect(spec).toEqual({
    command: "C:\\Users\\Omar\\.local\\bin\\aphrody.exe",
    args: ["mcp-server"],
  });
});

test("merge adds only mcpServers.aphrody and keeps everything else", () => {
  const existing = JSON.stringify({
    theme: "dark",
    mcpServers: { other: { command: "x", args: ["1"] } },
  });
  const merged = mergeDesktopConfig(existing, spec);
  expect(merged.changed).toBe(true);
  expect(JSON.parse(merged.text)).toEqual({
    theme: "dark",
    mcpServers: { other: { command: "x", args: ["1"] }, aphrody: spec },
  });
  expect(mergeDesktopConfig(merged.text, spec)).toEqual({
    text: merged.text,
    changed: false,
  });
  expect(JSON.parse(mergeDesktopConfig(undefined, spec).text)).toEqual({
    mcpServers: { aphrody: spec },
  });
  expect(
    JSON.parse(mergeDesktopConfig("  ", spec).text).mcpServers.aphrody,
  ).toEqual(spec);
});

test("an old aphrody entry is updated, a broken file is never overwritten", () => {
  const stale = JSON.stringify({
    mcpServers: { aphrody: { command: "old.exe", args: [] } },
  });
  expect(
    JSON.parse(mergeDesktopConfig(stale, spec).text).mcpServers.aphrody,
  ).toEqual(spec);
  expect(() => mergeDesktopConfig("{not json", spec)).toThrow(McpConfigError);
  expect(() => mergeDesktopConfig("[1]", spec)).toThrow(McpConfigError);
});

test("Claude Desktop is configured where installed, with a backup of the previous file", async () => {
  const { ctx } = testContext();
  expect(await configureDesktop(ctx.paths, spec, new Date())).toEqual([]);
  expect(await desktopState(ctx.paths, spec)).toBe("aucun");
  const file = desktopConfigFiles(ctx.paths)[0]!;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ keep: true }));
  expect(await desktopState(ctx.paths, spec)).toBe("pas-declare");
  const done = await configureDesktop(
    ctx.paths,
    spec,
    new Date("2026-10-06T12:00:00Z"),
  );
  expect(done).toEqual([
    { client: "claude-desktop", state: "configure", detail: file },
  ]);
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
    keep: true,
    mcpServers: { aphrody: spec },
  });
  const backups = readdirSync(dirname(file)).filter((name) =>
    name.includes("avant-aphrody"),
  );
  expect(backups).toHaveLength(1);
  expect(
    JSON.parse(readFileSync(join(dirname(file), backups[0]!), "utf8")),
  ).toEqual({
    keep: true,
  });
  expect(await desktopState(ctx.paths, spec)).toBe("configure");
  expect((await configureDesktop(ctx.paths, spec, new Date()))[0]!.state).toBe(
    "deja",
  );
  writeFileSync(file, "{broken");
  expect((await configureDesktop(ctx.paths, spec, new Date()))[0]!.state).toBe(
    "echec",
  );
  expect(readFileSync(file, "utf8")).toBe("{broken");
});

test("Claude Code is configured through its own CLI", async () => {
  const { ctx, sys } = testContext();
  expect((await configureClaudeCode(sys, undefined, spec)).state).toBe(
    "ignore",
  );
  expect(await claudeCodeState(sys, undefined, spec)).toBe("aucun");
  sys.handlers.push(
    { match: "claude mcp get", result: { code: 1 } },
    { match: "claude mcp add", result: {} },
  );
  const added = await configureClaudeCode(sys, "claude", spec);
  expect(added.state).toBe("configure");
  expect(sys.calls.at(-1)!.argv).toEqual([
    "claude",
    "mcp",
    "add",
    "--scope",
    "user",
    "aphrody",
    "--",
    spec.command,
    ...spec.args,
  ]);
  sys.handlers.unshift({
    match: "claude mcp get",
    result: { stdout: `aphrody: ${spec.command} mcp-server` },
  });
  expect((await configureClaudeCode(sys, "claude", spec)).state).toBe("deja");
  expect(await claudeCodeState(sys, "claude", spec)).toBe("configure");
  expect(ctx).toBeDefined();
});

const FAKE_SERVER = `
const lines = require("node:readline").createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake", version: "0" } } }));
  if (msg.method === "tools/list") console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "a" }, { name: "b" }, { name: "c" }] } }));
});
console.log("log line that is not json");
`;

test("probeMcp performs a real initialize + tools/list handshake over stdio", async () => {
  const { root } = testContext();
  const script = join(root, "server.js");
  writeFileSync(script, FAKE_SERVER);
  expect(
    await probeMcp({ command: process.execPath, args: [script] }, 10_000),
  ).toEqual({
    ok: true,
    tools: 3,
  });
});

test("probeMcp reports a missing program and a silent server", async () => {
  const missing = await probeMcp(
    { command: "/definitely/not/here", args: [] },
    2000,
  );
  expect(missing.ok).toBe(false);
  const { root } = testContext();
  const script = join(root, "silent.js");
  writeFileSync(script, "setTimeout(() => {}, 30000);");
  const silent = await probeMcp(
    { command: process.execPath, args: [script] },
    500,
  );
  expect(silent.ok).toBe(false);
});

test("canonical MCP binary wins over the multicall fallback", () => {
  expect(mcpSpec("aphrody.exe", "aphrody-mcp.exe")).toEqual({
    command: "aphrody-mcp.exe",
    args: [],
  });
});
