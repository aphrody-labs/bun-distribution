// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeUnit, hostRoot, loadCatalog } from "../../core/src/host/index.ts";
import {
  applyPlan,
  hostPlan,
  type Plan,
  renderPlan,
  type Runner,
  unitFacts,
} from "../../core/src/host/plan.ts";

const unitText = (bind: string) => `[Unit]
Description=fixture

[Service]
Type=simple
WorkingDirectory=/srv/x/shared/a2a
EnvironmentFile=-/etc/aphrody/x.env
ExecStart=/home/ubuntu/.local/bin/aphrody a2a serve --bind ${bind} --coord-dir /srv/x/shared/coord
ReadWritePaths=/srv/x/shared/a2a /srv/x/shared/coord
BindPaths=-/srv/x/shared/coord /srv/x/state:/srv/x/state
`;

const unit = (service: string, port: number, host = "vps") => ({
  service,
  unit: `${service}.service`,
  path: `systemd/aphrody/${service}.service`,
  dropIns: [],
  ownerRepo: "aphrody",
  targetHost: host,
  port,
});

let dir: string;
let root: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "host-plan-"));
  root = join(dir, "config/host");
  mkdirSync(join(root, "systemd/aphrody"), { recursive: true });
  mkdirSync(join(root, "systemd/shared"), { recursive: true });
  mkdirSync(join(dir, "scripts/tools/infra"), { recursive: true });
  writeFileSync(
    join(root, "catalog.json"),
    JSON.stringify({
      units: [
        unit("aphrody-a2a", 8788),
        unit("aphrody-mcp-http", 8789),
        unit("other", 9000, "dbfr"),
      ],
    }),
  );
  writeFileSync(join(root, "systemd/aphrody/aphrody-a2a.service"), unitText("127.0.0.1:8788"));
  writeFileSync(
    join(root, "systemd/aphrody/aphrody-mcp-http.service"),
    unitText("127.0.0.1:8789").replace("aphrody a2a serve", "aphrody-mcp http"),
  );
  writeFileSync(join(root, "systemd/aphrody/other.service"), unitText("127.0.0.1:9000"));
  writeFileSync(
    join(dir, "config/service-catalog.json"),
    JSON.stringify({
      services: [
        { id: "aphrody-a2a", port: 8788, health: "http://127.0.0.1:8788/ping" },
        { id: "aphrody-mcp-http", port: 8789, health: "http://127.0.0.1:8789/healthz" },
        { id: "other", port: 9001 },
      ],
    }),
  );
  writeFileSync(join(dir, "ai.json"), '{"id":"fixture"}\n');
  writeFileSync(join(dir, "scripts/tools/infra/mcp-tools-count.ts"), "// fixture\n");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("unit facts: binary, loopback bind, env files and writable paths come from the composed unit", () => {
  const entry = loadCatalog(root).units[0];
  const facts = unitFacts(entry, unitText("127.0.0.1:8788"));
  expect(facts.binary).toBe("/home/ubuntu/.local/bin/aphrody");
  expect(facts.bind).toEqual({ host: "127.0.0.1", port: 8788 });
  expect(facts.envFiles).toEqual([{ path: "/etc/aphrody/x.env", optional: true }]);
  expect(facts.writePaths).toEqual(["/srv/x/shared/a2a", "/srv/x/shared/coord", "/srv/x/state"]);
});

test("a unit that would bind anything but loopback is refused", () => {
  const entry = loadCatalog(root).units[0];
  for (const bind of ["0.0.0.0:8788", "51.77.147.152:8788", "[::]:8788"]) {
    expect(() => unitFacts(entry, unitText(bind))).toThrow("not a loopback address");
  }
  for (const bind of ["127.0.0.1:8788", "[::1]:8788", "localhost:8788"]) {
    expect(unitFacts(entry, unitText(bind)).bind?.port).toBe(8788);
  }
});

test("plan: preflight checks come first, then provision, install, verify and a rollback", () => {
  const plan = hostPlan(["aphrody-mcp-http", "aphrody-a2a"], { root, expectTools: 137 });
  expect(plan.target).toBe("vps");
  const mcp = plan.steps.filter((s) => s.unit === "aphrody-mcp-http.service");
  const phases = mcp.map((s) => s.phase);
  expect(phases).toEqual(phases.toSorted((a, b) => order(a) - order(b)));
  expect(mcp.find((s) => s.id.endsWith("/port-free"))?.run).toContain("sport = :8789");
  expect(mcp.find((s) => s.id.endsWith("/tools-count"))?.run).toContain("--expect 137");
  expect(mcp.find((s) => s.id.endsWith("/tools-count"))?.kind).toBe("check");
  expect(mcp.find((s) => s.id.endsWith("/health"))?.run).toContain("http://127.0.0.1:8789/healthz");
  const a2a = plan.steps.filter((s) => s.unit === "aphrody-a2a.service");
  expect(a2a.find((s) => s.id.endsWith("/ai-json"))?.run).toContain(
    Buffer.from('{"id":"fixture"}\n').toString("base64"),
  );
  expect(a2a.some((s) => s.id.endsWith("/tools-count"))).toBe(false);
  // nothing in the plan opens a public listener: every verify probe targets loopback
  for (const s of plan.steps.filter((x) => x.id.endsWith("/health")))
    expect(s.run).toContain("127.0.0.1");
});

test("tools-count is informative, not a gate, when no expected count is given", () => {
  const plan = hostPlan(["aphrody-mcp-http"], { root });
  const step = plan.steps.find((s) => s.id.endsWith("/tools-count"));
  expect(step?.kind).toBe("info");
  expect(step?.run).not.toContain("--expect");
});

test("plan refuses an unknown unit, a foreign target and a port that differs from the service catalog", () => {
  expect(() => hostPlan(["nope"], { root })).toThrow("unknown unit");
  expect(() => hostPlan(["aphrody-a2a", "other"], { root })).toThrow("target");
  expect(() => hostPlan(["aphrody-a2a"], { root, target: "dbfr" })).toThrow("not dbfr");
  expect(() => hostPlan(["other"], { root })).toThrow("declares :9001");
});

test("rendering names every step and marks mutations", () => {
  const text = renderPlan(hostPlan(["aphrody-a2a"], { root }));
  expect(text).toContain("host-plan target=vps units=aphrody-a2a.service");
  expect(text).toContain("[MUTATE] aphrody-a2a/install");
  expect(text).toContain("[check ] aphrody-a2a/port-free");
});

const order = (p: string) => ["preflight", "provision", "install", "verify", "rollback"].indexOf(p);
const recorder = (fail: (command: string) => boolean = () => false) => {
  const commands: string[] = [];
  const run: Runner = async (_host, command) => {
    commands.push(command);
    return { code: fail(command) ? 1 : 0, stdout: "", stderr: "" };
  };
  return { commands, run };
};
const quiet = () => {};

test("apply: a failed preflight check stops before any mutation", async () => {
  const plan: Plan = hostPlan(["aphrody-mcp-http"], { root });
  const { commands, run } = recorder((c) => c.includes("sport = :8789") && c.startsWith("!"));
  const failed = await applyPlan(plan, run, quiet);
  expect(failed).toEqual(["aphrody-mcp-http/port-free"]);
  expect(
    commands.some(
      (c) =>
        c.includes("systemctl enable") || c.includes("sudo install") || c.includes("base64 -d"),
    ),
  ).toBe(false);
});

test("apply: runs preflight, provision, install and verify in order, no rollback when all pass", async () => {
  const plan = hostPlan(["aphrody-a2a"], { root });
  const { commands, run } = recorder();
  expect(await applyPlan(plan, run, quiet)).toEqual([]);
  const at = (needle: string) => commands.findIndex((c) => c.includes(needle));
  expect(at("test -x")).toBeLessThan(at("ai.json"));
  expect(at("ai.json")).toBeLessThan(at("sudo install"));
  expect(at("sudo install")).toBeLessThan(at("enable --now"));
  expect(at("enable --now")).toBeLessThan(at("curl -fsS"));
  expect(commands.some((c) => c.includes("disable --now"))).toBe(false);
});

test("apply: a failed verify check rolls the unit back and reports the step", async () => {
  const plan = hostPlan(["aphrody-a2a"], { root });
  const { commands, run } = recorder((c) => c.startsWith("curl -fsS"));
  expect(await applyPlan(plan, run, quiet)).toEqual(["aphrody-a2a/health"]);
  expect(commands.at(-1)).toContain("systemctl disable --now aphrody-a2a.service");
});

test("the declared loopback units plan against the real catalog", () => {
  const plan = hostPlan(["aphrody-mcp-http", "aphrody-a2a"], { root: hostRoot() });
  expect(plan.units).toEqual(["aphrody-mcp-http.service", "aphrody-a2a.service"]);
  const ports = plan.steps
    .filter((s) => s.id.endsWith("/port-free"))
    .map((s) => /:(\d+)"/.exec(s.run)?.[1]);
  expect(ports).toEqual(["8789", "8788"]);
  for (const name of ["aphrody-mcp-http.service", "aphrody-a2a.service"]) {
    const text = composeUnit(name);
    expect(text).toContain("User=ubuntu");
    expect(text).toContain("ProtectHome=tmpfs");
    expect(text).toContain("NoNewPrivileges=true");
    expect(text).toContain("--bind 127.0.0.1:");
    expect(text).toContain("Restart=on-failure");
    expect(text).not.toMatch(/(SECRET|TOKEN|PASSWORD|DATABASE_URL)=/);
  }
});
