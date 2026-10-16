// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { join } from "node:path";
import { composeUnit, loadCatalog } from "../src/host/index.ts";
import { applyPlan, hostPlan, trackProxyMutations } from "../src/host/plan.ts";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadTunnel, selectedProxySteps } from "../src/host/wireguard.ts";

const root = join(import.meta.dir, "../../../tools/aphrody/config/host");
const ctx = {
  root,
  catalog: loadCatalog(root),
  compose: (unit: string) => composeUnit(unit, root),
};

test("Selected DBFR proxy reuses only its owner steps, address and granted sources", () => {
  const projected = selectedProxySteps(loadTunnel(root), ctx, "mcp-http-dbfr");
  expect(projected.length).toBeGreaterThan(4);
  expect(projected.every((step) => step.host === "dbfr" && step.id.startsWith("dbfr.proxy-"))).toBe(
    true,
  );
  const commands = projected.map((step) => step.run ?? "").join("\n");
  expect(commands).not.toMatch(
    /wg genkey|wg-quick|wireguard\/wg1\.conf|useradd|authorized_keys|ufw reset/,
  );
  const socket = projected.find((step) => step.id === "dbfr.proxy-unit.socket")!.run!;
  const encoded = /echo ([A-Za-z0-9+/=]+) \| base64/.exec(socket)![1]!;
  const template = Buffer.from(encoded, "base64").toString();
  expect(template).toContain("ListenStream=10.200.77.3:%i");
  expect(template).not.toContain("10.200.77.1");
  expect(commands).toContain("aphrody-wg-proxy@8793.socket");
  expect(commands).not.toContain("aphrody-wg-proxy@8788");
  expect(commands).not.toMatch(/port (5432|6379)/);
});

test("The selected projection rejects public, foreign-host and unauthenticated services", () => {
  for (const patch of [
    { address: "10.200.77.1" },
    { address: "203.0.113.2" },
    { auth: "unverified" },
    { upstream: "0.0.0.0:8793" },
    { host: "vps" },
    { port: 5432 },
  ]) {
    const tunnel = loadTunnel(root);
    Object.assign(
      tunnel.services.find((service) => service.id === "mcp-http-dbfr")!,
      patch,
    );
    expect(() => selectedProxySteps(tunnel, ctx, "mcp-http-dbfr")).toThrow(
      "declared private authenticated loopback",
    );
  }
});

test("MCP DBFR plan checks existing templates and authenticates native service before proxy mutation", () => {
  const plan = hostPlan(["aphrody-mcp-http-dbfr"], { target: "dbfr" });
  expect(plan.steps.find((step) => step.id.endsWith("/wireguard-live"))?.run).toContain(
    "10.200.77.3/32",
  );
  const templates = plan.steps.filter((step) => step.id.includes("/wireguard-template:"));
  expect(templates).toHaveLength(2);
  expect(
    templates.every(
      (step) =>
        step.phase === "preflight" && step.kind === "check" && step.run.includes("sudo -n cat"),
    ),
  ).toBe(true);
  const auth = plan.steps.findIndex((step) => step.id.endsWith("/auth-wrong-token"));
  const proxy = plan.steps.findIndex((step) => step.id.includes("/wireguard:dbfr.proxy-unit"));
  expect(auth).toBeGreaterThan(0);
  expect(proxy).toBeGreaterThan(auth);
  expect(plan.steps.find((step) => step.id.endsWith("/private-auth-required"))?.run).toContain(
    "http://10.200.77.3:8793/mcp",
  );
  expect(
    plan.steps
      .filter((step) => step.id.includes("/wireguard:"))
      .every((step) => step.run.startsWith("sudo -n sh -c")),
  ).toBe(true);
});

test("A private authentication failure triggers selective proxy rollback and native unit rollback", async () => {
  const plan = hostPlan(["aphrody-mcp-http-dbfr"], { target: "dbfr" });
  const seen: string[] = [];
  const failed = await applyPlan(
    plan,
    async (_host, command) => {
      seen.push(command);
      return {
        code: command.includes("http://10.200.77.3:8793/mcp") ? 1 : 0,
        stdout: "",
        stderr: "",
      };
    },
    () => {},
  );
  expect(failed).toEqual(["aphrody-mcp-http-dbfr/private-auth-required"]);
  const rollback = seen.at(-1)!;
  expect(rollback).toContain("new-template.socket");
  expect(rollback).toContain("new-rule.0");
  expect(rollback).toContain("ufw --force delete allow in on wg1");
  expect(rollback).toContain("disable --now aphrody-mcp-http-dbfr.service");
  expect(rollback).not.toMatch(/ufw reset|wg-quick|wireguard\/wg1\.conf/);
});

test("Rollback removes newly owned templates and grants while keeping prior live resources", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proxy-rollback-"));
  try {
    const state = join(dir, "state"),
      units = join(dir, "units"),
      log = join(dir, "calls");
    mkdirSync(state);
    mkdirSync(units);
    const projection = selectedProxySteps(loadTunnel(root), ctx, "mcp-http-dbfr");
    const tracked = trackProxyMutations(projection, state, 8793);
    for (const marker of [
      "ready",
      "active.socket",
      "active.service",
      "enabled.socket",
      "new-template.service",
      "new-rule.1",
    ])
      writeFileSync(join(state, marker), "");
    writeFileSync(join(units, "aphrody-wg-proxy@.socket"), "prior template");
    writeFileSync(join(units, "aphrody-wg-proxy@.service"), "new template");
    const command = `systemctl() { printf 'systemctl %s\\n' "$*" >> "$TASK_PROXY_LOG"; }; ufw() { printf 'ufw %s\\n' "$*" >> "$TASK_PROXY_LOG"; }; ${tracked.rollback.replaceAll("/etc/systemd/system", units.replaceAll("\\", "/"))}`;
    expect(
      await Bun.spawn(["sh", "-c", command], {
        windowsHide: true,
        env: { ...process.env, TASK_PROXY_LOG: log },
        stdout: "ignore",
        stderr: "ignore",
      }).exited,
    ).toBe(0);
    expect(readFileSync(join(units, "aphrody-wg-proxy@.socket"), "utf8")).toBe("prior template");
    expect(existsSync(join(units, "aphrody-wg-proxy@.service"))).toBe(false);
    const calls = readFileSync(log, "utf8");
    const rules = projection.filter((step) => step.id.includes(".proxy-ufw."));
    expect(calls).toContain(
      rules[1]!.run!.replace(/^ufw /, "ufw --force delete ").replaceAll("'", ""),
    );
    expect(calls).not.toContain(
      rules[0]!.run!.replace(/^ufw /, "ufw --force delete ").replaceAll("'", ""),
    );
    expect(calls).not.toContain("systemctl stop");
    expect(calls).not.toContain("systemctl disable");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Firewall tracking preserves canonical existing rules and refuses ambiguous foreign tuples", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proxy-rule-"));
  try {
    const projection = selectedProxySteps(loadTunnel(root), ctx, "mcp-http-dbfr");
    const tracked = trackProxyMutations(projection, dir, 8793);
    const rule = projection.find((step) => step.id.includes(".proxy-ufw."))!.run!;
    const command = tracked.steps.find((step) => step.id.includes(".proxy-ufw."))!.run!;
    const marker = join(dir, "new-rule.0"),
      log = join(dir, "calls");
    const run = async (known: string, code = 0) =>
      await Bun.spawn(
        [
          "sh",
          "-c",
          `ufw() { if [ "$1" = show ]; then printf '%s\\n' "$TASK_KNOWN_RULE"; return ${code}; else printf '%s\\n' "$*" >> "$TASK_PROXY_LOG"; fi; }; ${command}`,
        ],
        {
          windowsHide: true,
          env: { ...process.env, TASK_KNOWN_RULE: known, TASK_PROXY_LOG: log },
          stdout: "ignore",
          stderr: "ignore",
        },
      ).exited;
    expect(await run(rule)).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(await run(rule.replace(/comment .*/, "comment 'foreign-owner'"))).toBe(1);
    expect(existsSync(marker)).toBe(false);
    expect(await run("", 1)).toBe(1);
    expect(existsSync(marker)).toBe(false);
    expect(await run("")).toBe(0);
    expect(existsSync(marker)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
