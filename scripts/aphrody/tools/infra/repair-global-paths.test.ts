// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditPathEntries,
  defaultRules,
  inspectPathRule,
  inspectRule,
  type PathRegistry,
  type PathRule,
  type Rule,
} from "./repair-global-paths";

const roots: string[] = [];
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "aphrody-path-repair-"));
  roots.push(root);
  const target = join(root, "bun.exe");
  const binary = Buffer.from([0x4d, 0x5a, 1, 2]);
  writeFileSync(target, binary);
  return { root, target, sha256: createHash("sha256").update(binary).digest("hex") };
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("TOML: missing System32 Bun is repaired only on apply, without modifying neighbors", async () => {
  const { root, target, sha256 } = fixture();
  const config = join(root, "config.toml");
  const from = "C:\\Windows\\System32\\bun.exe";
  const original = `[mcp_servers.bun]\ncommand = '${from}'\nargs = ['mcp']\n[mcp_servers.bun.env]\nPRIVATE = 'keep-me'\n`;
  writeFileSync(config, original);
  const rule: Rule = {
    id: "bun",
    config,
    format: "toml",
    key: "mcp_servers.bun.command",
    from,
    to: target,
    kind: "executable",
    sha256,
  };
  expect((await inspectRule(rule)).status).toBe("ready");
  expect(readFileSync(config, "utf8")).toBe(original);
  expect((await inspectRule(rule, true)).status).toBe("fixed");
  const updated = readFileSync(config, "utf8");
  expect(
    (Bun.TOML.parse(updated) as { mcp_servers: { bun: { command: string } } }).mcp_servers.bun
      .command,
  ).toBe(target);
  expect(updated).toContain("PRIVATE = 'keep-me'");
  expect((await inspectRule(rule, true)).status).toBe("current");
  expect(existsSync(join(root, "config.toml.bak"))).toBe(false);
});

test("JSON: only declared nested key changes and wrong hash blocks mutation", async () => {
  const { root, target, sha256 } = fixture();
  const config = join(root, "config.json");
  writeFileSync(
    config,
    JSON.stringify({ mcp: { command: "C:\\Windows\\System32\\bun.exe", secret: "keep" } }, null, 2),
  );
  const rule: Rule = {
    id: "json",
    config,
    format: "json",
    key: "mcp.command",
    from: "C:\\Windows\\System32\\bun.exe",
    to: target,
    kind: "executable",
    sha256,
  };
  expect((await inspectRule({ ...rule, sha256: "0".repeat(64) }, true)).status).toBe("unverified");
  expect(
    (JSON.parse(readFileSync(config, "utf8")) as { mcp: { command: string } }).mcp.command,
  ).toBe(rule.from);
  expect((await inspectRule(rule, true)).status).toBe("fixed");
  const updated = readFileSync(config, "utf8");
  expect(JSON.parse(updated).mcp).toEqual({ command: target, secret: "keep" });
  expect(updated).toContain('"secret": "keep"');
});

test("unrelated value and nonexistent target are never rewritten", async () => {
  const { root, target, sha256 } = fixture();
  const config = join(root, "config.toml");
  writeFileSync(config, "[mcp_servers.bun]\ncommand = 'C:\\Other\\bun.exe'\n");
  const rule: Rule = {
    id: "bun",
    config,
    format: "toml",
    key: "mcp_servers.bun.command",
    from: "C:\\Windows\\System32\\bun.exe",
    to: target,
    kind: "executable",
    sha256,
  };
  expect((await inspectRule(rule, true)).status).toBe("unmatched");
  writeFileSync(config, `[mcp_servers.bun]\ncommand = '${rule.from}'\n`);
  expect((await inspectRule({ ...rule, to: join(root, "absent.exe") }, true)).status).toBe(
    "unverified",
  );
});

test("default rule is scoped to Codex Bun MCP and running runtime", async () => {
  const [rule] = await defaultRules();
  expect(rule?.key).toBe("mcp_servers.bun.command");
  expect(rule?.provenance).toBe("aphrody-bun");
  expect(rule?.to).toBe(process.execPath);
});

test("PATH audit skips unresolved variables and never treats duplicate as missing", () => {
  const audit = auditPathEntries(
    "C:\\Windows;C:\\Windows;%USERPROFILE%\\bin;relative;C:\\Gone",
    (path) => path === "C:\\Windows",
  );
  expect(audit).toEqual({ checked: 2, missing: 1, duplicate: 1, skipped: 2 });
});

test("PATH registry rule replaces one exact entry, preserves order and is idempotent", async () => {
  const { root, sha256 } = fixture();
  const from = "C:\\Missing\\bin";
  const rule: PathRule = {
    id: "path",
    scope: "user",
    from,
    to: root,
    kind: "installation",
    anchor: "bun.exe",
    sha256,
  };
  let record: { value: string; type: "REG_SZ" } = {
    value: `C:\\Keep;${from};C:\\After`,
    type: "REG_SZ",
  };
  const registry: PathRegistry = {
    async read() {
      return { ...record };
    },
    async write(_scope, expected, next) {
      if (record.value !== expected.value || record.type !== expected.type) return false;
      record = { value: next, type: "REG_SZ" };
      return true;
    },
  };
  expect((await inspectPathRule(rule, false, registry)).status).toBe("ready");
  expect(record.value).toContain(from);
  expect((await inspectPathRule(rule, true, registry)).status).toBe("fixed");
  expect(record.value).toBe(`C:\\Keep;${root};C:\\After`);
  expect((await inspectPathRule(rule, true, registry)).status).toBe("current");
});

test("PATH rule refuses ambiguous duplicates and unverified directory", async () => {
  const { root, sha256 } = fixture();
  const rule: PathRule = {
    id: "path",
    scope: "user",
    from: "C:\\Old",
    to: root,
    kind: "installation",
    anchor: "bun.exe",
    sha256,
  };
  let value = "C:\\Old;C:\\Old";
  const registry: PathRegistry = {
    async read() {
      return { value, type: "REG_EXPAND_SZ" };
    },
    async write() {
      throw new Error("must not write");
    },
  };
  expect((await inspectPathRule(rule, true, registry)).status).toBe("unmatched");
  value = "C:\\Old";
  expect((await inspectPathRule({ ...rule, sha256: "0".repeat(64) }, true, registry)).status).toBe(
    "unverified",
  );
});
