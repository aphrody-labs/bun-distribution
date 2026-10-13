// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyGateEvidence,
  evidenceOutsideRoot,
  hostProbeCommand,
  hostServices,
  observeCommand,
  qualifyHost,
  sourceInventory,
} from "../src/infra-audit.ts";
import { sensitiveInventoryPath } from "../../../../scripts/tools/infra/check-infra.ts";

test("tracked inventory allows templates and SQL source but detects private runtime files", () => {
  expect(sensitiveInventoryPath("tools/config/local-ai.env.example")).toBe(false);
  expect(sensitiveInventoryPath("config/schema.sql")).toBe(false);
  expect(sensitiveInventoryPath("config/.env.production")).toBe(true);
  expect(sensitiveInventoryPath("inventory/private.key")).toBe(true);
  expect(sensitiveInventoryPath("inventory/data.db")).toBe(true);
});

test("host roles exclude retired/staged services and do not expect VPS applications on dbfr", () => {
  const services = [
    { id: "app", unit: "app.service" },
    { id: "old", unit: "old.service", status: "retired" },
    { id: "stage", unit: "stage.service", staged: true },
  ];
  expect(hostServices(services, "vps").map((service) => service.id)).toEqual(["app"]);
  expect(hostServices(services, "dbfr")).toEqual([]);
  expect(hostServices(services, "wsl")).toEqual([]);
});

test("observations drain stdout/stderr and retain a failing command's evidence", async () => {
  const result = await observeCommand(
    "fixture",
    [
      process.execPath,
      "-e",
      'process.stdout.write("evidence"); process.stderr.write("failure"); process.exit(7)',
    ],
    import.meta.dir,
  );
  expect(result.exitCode).toBe(7);
  expect(result.stdout).toBe("evidence");
  expect(result.stderr).toBe("failure");
  expect(result.startedAt).toMatch(/^\d{4}-/);
});

test.skipIf(process.platform !== "win32")(
  "observations resolve local executables with the Windows PATH delimiter",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "infra-audit-path-"));
    try {
      const executable = "aphrody-audit-fixture.cmd";
      const bin = join(root, "node_modules", ".bin");
      await mkdir(bin, { recursive: true });
      await writeFile(join(bin, executable), "@echo off\r\necho local-bin\r\n");
      const command = process.env.ComSpec;
      expect(command).toBeTruthy();
      const result = await observeCommand("local-bin", [command!, "/d", "/c", executable], root);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("local-bin");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("an unavailable program records an explicit failure", async () => {
  const result = await observeCommand(
    "missing",
    ["/missing/aphrody-infra-fixture"],
    import.meta.dir,
  );
  expect(result.exitCode).toBeNull();
  expect(result.error).toBeDefined();
});

test("audit execution rejects Cargo compilation and Next builds before spawning them", async () => {
  const results = await Promise.all(
    [
      ["cargo", "test"],
      ["/fixture/cargo-serial.sh", "check"],
      ["/fixture/next", "build"],
    ].map((command) => observeCommand("forbidden", command, import.meta.dir)),
  );
  for (const result of results) {
    expect(result.exitCode).toBeNull();
    expect(result.error).toContain("excluded");
  }
});

test("remote probe transports URL data literally and parses as Python", async () => {
  const command = hostProbeCommand("vps", [
    { id: "test", unit: "test.service", health: "http://127.0.0.1/?x='$(touch /tmp/never)'" },
  ]);
  const encoded = command.match(/b64decode\("([A-Za-z0-9+/=]+)"\)/)![1]!;
  const script = Buffer.from(encoded, "base64").toString();
  const result = await observeCommand(
    "syntax",
    // Python is run through uv (repository policy; Windows' python3 is a Store stub) when available.
    [
      ...(Bun.which("uv") ? ["uv", "run", "--no-project", "--quiet", "python"] : ["python3"]),
      "-c",
      "import ast,sys;ast.parse(sys.argv[1])",
      script,
    ],
    import.meta.dir,
  );
  expect(result.exitCode).toBe(0);
  expect(script).toContain("NoRedirect");
  expect(script).toContain("deadline=time.monotonic()+90");
  expect(script).toContain("timeout=min(8,remaining)");
  expect(script).not.toContain("os.system");
});

function healthyHost() {
  return {
    hostname: "fixture-vps",
    observedAt: new Date().toISOString(),
    units: ["nginx.service", "postgresql.service", "redis-server.service", "app.service"].map(
      (name) => ({
        name,
        exitCode: 0,
        properties: { LoadState: "loaded", ActiveState: "active" },
      }),
    ),
    health: [{ id: "app", kind: "health", url: "http://127.0.0.1/health", status: 200, ok: true }],
    paths: [{ id: "app", path: "/home/ubuntu/apps/app/current", exists: true }],
    failedUnits: { exitCode: 0, units: [] as string[] },
    postgresqlReady: { exitCode: 0 },
    redis: { exitCode: 0, stdout: "PONG" },
  };
}

const app = {
  id: "app",
  unit: "app.service",
  health: "http://127.0.0.1/health",
  workingDirectory: "/home/ubuntu/apps/app/current",
};

test("host success requires service facts as well as a successful transport", () => {
  expect(qualifyHost("vps", healthyHost(), [app], 0).healthy).toBe(true);
  const snapshot = healthyHost();
  snapshot.health[0]!.status = 503;
  snapshot.health[0]!.ok = false;
  const result = qualifyHost("vps", snapshot, [app], 0);
  expect(result.observed).toBe(true);
  expect(result.healthy).toBe(false);
  expect(result.failures).toContain("app health failed (503)");
});

test("readiness missing, redirects and stopped units cannot qualify VPS production", () => {
  const snapshot = healthyHost();
  snapshot.health[0]!.status = 302;
  snapshot.units[3]!.properties.ActiveState = "inactive";
  const result = qualifyHost("vps", snapshot, [{ ...app, readiness: "http://127.0.0.1/ready" }], 0);
  expect(result.failures).toContain("app readiness failed (not observed)");
  expect(result.failures).toContain("app health failed (302)");
  expect(result.failures).toContain("Unit app.service is unavailable or inactive");
});

test("optional service faults and absent WSL database roles remain explicit optional findings", () => {
  const snapshot = healthyHost();
  snapshot.health[0]!.status = 503;
  snapshot.health[0]!.ok = false;
  const result = qualifyHost("vps", snapshot, [{ ...app, required: false }], 0);
  expect(result.healthy).toBe(true);
  expect(result.optionalFailures).toContain("app health failed (503)");
  const wsl = qualifyHost(
    "wsl",
    { hostname: "wsl", observedAt: "2026-10-01", failedUnits: { exitCode: 0, units: [] } },
    [],
    0,
  );
  expect(wsl.healthy).toBe(true);
  expect(wsl.optionalFailures).toContain("Redis readiness failed");
});

test("missing transport, core DB readiness and failed systemd units are required failures", () => {
  expect(qualifyHost("dbfr", {}, [], 0).healthy).toBe(false);
  expect(qualifyHost("dbfr", healthyHost(), [], 1).observed).toBe(false);
  const snapshot = healthyHost();
  snapshot.postgresqlReady.exitCode = 2;
  snapshot.failedUnits.units = ["broken.service"];
  const result = qualifyHost("dbfr", snapshot, [], 0);
  expect(result.failures).toContain("PostgreSQL readiness failed");
  expect(result.failures).toContain("Systemd unit broken.service is failed");
});

test("historical reports identify excluded commands without qualifying current source", () => {
  const current = { name: "TS", command: ["tsc", "--noEmit"], cwd: "/fixture" };
  const prior = {
    results: [
      { ...current, status: "passed" },
      { name: "TS", command: ["tsc", "--build"], cwd: "/fixture", status: "passed" },
      { name: "Rust check", command: ["cargo", "check"], cwd: "/fixture", status: "passed" },
    ],
  };
  const result = classifyGateEvidence(prior, [current]);
  expect(result.historical).toBe(true);
  expect(result.qualifiesCurrentSource).toBe(false);
  expect(result.matchingCurrentCommands).toBe(1);
  expect(result.excludedFromCurrentPlan).toHaveLength(2);
});

test("private evidence must be outside the repository, including dot-dot-prefixed child directories", () => {
  expect(evidenceOutsideRoot("/repo", "/repo/.private")).toBe(false);
  expect(evidenceOutsideRoot("/repo", "/repo/..private")).toBe(false);
  expect(evidenceOutsideRoot("/repo", "/repo")).toBe(false);
  expect(evidenceOutsideRoot("/repo", "/private")).toBe(true);
  expect(evidenceOutsideRoot("/repo", "/repo-sibling/evidence")).toBe(true);
});

test("source inventory parses actual TS/TSX syntax without executing adapters", async () => {
  const root = await mkdtemp(join(tmpdir(), "infra-audit-inventory-"));
  try {
    await mkdir(join(root, "packages/infra/fixture"), { recursive: true });
    await mkdir(join(root, "scripts/tools"), { recursive: true });
    await Bun.write(join(root, "Cargo.toml"), "[workspace]\nmembers=[]\n");
    await Bun.write(join(root, "packages/infra/fixture/invalid.ts"), "const value = ;");
    await Bun.write(
      join(root, "packages/infra/fixture/view.tsx"),
      "export const View = () => <div />;",
    );
    await Bun.write(
      join(root, "scripts/tools/fixture.ts"),
      `await Bun.write(${JSON.stringify(join(root, "executed"))}, "executed");\n`,
    );
    const result = await sourceInventory(root);
    expect(result.infraSources.find((source) => source.path.endsWith("invalid.ts"))?.syntax).toBe(
      "failed",
    );
    expect(result.infraSources.find((source) => source.path.endsWith("view.tsx"))?.syntax).toBe(
      "parsed",
    );
    expect(result.scripts[0]?.qualification).toBe("syntax-parsed; adapter not executed");
    expect(await Bun.file(join(root, "executed")).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
