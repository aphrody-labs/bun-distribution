// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import {
  applyPlan,
  hostPlan,
  pinnedSocketCheck,
  type UnitFacts,
  type Runner,
} from "../src/host/plan.ts";

const facts: UnitFacts = {
  unit: "aphrody-mcp-http.service",
  service: "aphrody-mcp-http",
  targetHost: "vps",
  user: "ubuntu",
  execStart: "/home/ubuntu/.local/bin/aphrody-mcp http --bind 127.0.0.1:8793",
  binary: "/home/ubuntu/.local/bin/aphrody-mcp",
  bind: { host: "127.0.0.1", port: 8793 },
  envFiles: [],
  writePaths: [],
};
async function guard(rows: string[], pid: number, active = true, required = false) {
  const quoted = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const command = pinnedSocketCheck(facts, ["10.200.77.1:8793"], required)
    .replace(
      'timeout 5 sudo -n ss -H -ltnp "sport = :8793"',
      `printf '%s\\n' ${quoted(rows.join("\n"))}`,
    )
    .replace("systemctl is-active --quiet 'aphrody-mcp-http.service'", active ? "true" : "false")
    .replace("systemctl show 'aphrody-mcp-http.service' -p MainPID --value", `printf %s ${pid}`);
  return Bun.spawn(["sh", "-c", command], { stdout: "ignore", stderr: "ignore" }).exited;
}
const listener = (address: string, pid?: number) =>
  `LISTEN 0 128 ${address}:8793 *:*${pid === undefined ? "" : ` users:((\"native\",pid=${pid},fd=9))`}`;

test("A pinned refresh accepts only its active MainPID on the exact native socket", async () => {
  expect(await guard([listener("127.0.0.1", 700), listener("10.200.77.1", 800)], 700)).toBe(0);
  expect(await guard([listener("127.0.0.1", 701)], 700)).toBe(1);
  expect(await guard([listener("127.0.0.1", 7000)], 700)).toBe(1);
  expect(await guard([listener("127.0.0.1", 700)], 700, false)).toBe(1);
  expect(await guard([listener("127.0.0.1")], 700)).toBe(1);
  expect(await guard([listener("0.0.0.0", 700)], 700)).toBe(1);
  expect(await guard([listener("127.0.0.1", 700), listener("10.200.77.4", 800)], 700)).toBe(1);
});

test("An unbound fresh pinned install is allowed; readiness requires the native listener", async () => {
  expect(await guard([listener("10.200.77.1", 800)], 0, false)).toBe(0);
  expect(await guard([listener("10.200.77.1", 800)], 0, false, true)).toBe(1);
});

test("An unpinned bootstrap keeps the strict port-free gate", () => {
  const bootstrap = hostPlan(["aphrody-mcp-http"], { target: "vps" });
  expect(bootstrap.steps.some((step) => step.id.endsWith("/port-free"))).toBe(true);
  expect(bootstrap.steps.some((step) => step.id.endsWith("/port-owner"))).toBe(false);
});

test("Failed pinned readiness restores the old unit and binary after a real restart", async () => {
  const plan = hostPlan(["aphrody-mcp-http"], {
    target: "vps",
    binary: { from: "/private/qualified/aphrody", sha256: "a".repeat(64) },
  });
  const commands: string[] = [];
  const run: Runner = async (_host, command) => {
    commands.push(command);
    return { code: command.includes("curl -fsS -m 5") ? 1 : 0, stdout: "", stderr: "" };
  };
  expect(await applyPlan(plan, run, () => {})).toEqual(["aphrody-mcp-http/health"]);
  expect(
    commands.some((command) => command.includes("systemctl restart aphrody-mcp-http.service")),
  ).toBe(true);
  expect(commands.at(-1)).toContain(".previous");
  expect(commands.at(-1)).toContain(".binary-installed");
  expect(commands.at(-1)).toContain(".was-active");
  expect(commands.at(-1)).toContain(".prev");
  expect(plan.steps.findIndex((step) => step.id.endsWith("/upgrade-state"))).toBeLessThan(
    plan.steps.findIndex((step) => step.id.endsWith("/install-binary")),
  );
});

test("A failed binary installation rolls back even before replacing the unit", async () => {
  const plan = hostPlan(["aphrody-jobs-worker-vps"], {
    binary: { from: "/private/qualified/aphrody", sha256: "a".repeat(64) },
  });
  const commands: string[] = [];
  const run: Runner = async (_host, command) => {
    commands.push(command);
    return { code: command.includes(".new && echo") ? 1 : 0, stdout: "", stderr: "" };
  };
  expect(await applyPlan(plan, run, () => {})).toEqual(["aphrody-jobs-worker-vps/install-binary"]);
  expect(commands.at(-1)).toContain(".previous");
  expect(commands.some((command) => command.includes("sudo install -o root"))).toBe(false);
});
