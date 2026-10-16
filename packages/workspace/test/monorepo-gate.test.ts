// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  buildMonorepoGatePlan,
  discoverMonorepoGatePlan,
  executeMonorepoGate,
  type WorkspacePackage,
} from "../src/monorepo-gate.ts";

const packages: WorkspacePackage[] = [
  {
    name: "@owner/app",
    path: "apps/owner/app",
    scripts: {
      "type-check": "bun --bun tsc --noEmit",
      lint: "oxlint src",
      "format:check": "oxfmt --check src",
      test: "bun test test",
      build: "bun build src/index.ts --outdir dist",
    },
  },
];

function fixture(
  overrides: Partial<Parameters<typeof buildMonorepoGatePlan>[0]> = {},
) {
  return buildMonorepoGatePlan({
    root: "/workspace/aphrody",
    packages,
    rootScripts: {
      typecheck: "bun run --filter @aphrody/workspace typecheck",
      "docs:check-links": "bun check-docs.ts",
    },
    hasCargoManifest: true,
    hasCargoLock: true,
    hasBunLock: true,
    ...overrides,
  });
}

test("gate plans locked all-target Rust checks, tests and release builds plus each package script", () => {
  const plan = fixture();
  expect(plan.gaps).toEqual([]);
  expect(plan.checks[0]!.command).toEqual([
    "bun",
    "install",
    "--frozen-lockfile",
  ]);
  for (const subcommand of ["check", "clippy", "test", "build"]) {
    const check = plan.checks.find((item) => {
      const wrapper = item.command.findIndex((arg) =>
        /cargo-serial.(?:sh|ps1|ts)$/.test(arg),
      );
      return wrapper >= 0 && item.command[wrapper + 1] === subcommand;
    })!;
    expect(check.command).toContain("--workspace");
    expect(check.command).toContain("--all-targets");
    expect(check.command).toContain("--locked");
  }
  expect(
    plan.checks.find((item) => item.name === "Rust release build")!.command,
  ).toContain("--release");
  expect(
    plan.checks.find((item) => item.name === "Rust Clippy")!.command.slice(-3),
  ).toEqual(["--", "-D", "warnings"]);
  expect(
    plan.checks.find((item) => item.name === "Rust documentation tests")!
      .command,
  ).toContain("--doc");
  const checks = plan.checks.filter((item) =>
    item.name.startsWith("@owner/app:"),
  );
  expect(checks).toHaveLength(5);
  expect(
    checks.every(
      (item) => item.cwd === resolve("/workspace/aphrody/apps/owner/app"),
    ),
  ).toBe(true);
  expect(checks.map((item) => item.command)).toContainEqual([
    "bun",
    "run",
    "type-check",
  ]);
  expect(checks.map((item) => item.command)).toContainEqual([
    "bun",
    "run",
    "format:check",
  ]);
  expect(plan.checks.some((item) => item.command.includes("--filter"))).toBe(
    false,
  );
  expect(plan.checks.at(-1)!.command).toEqual([
    "bun",
    "run",
    "docs:check-links",
  ]);
});

test("missing and placeholder scripts and absent locks prevent success even when every command exits zero", async () => {
  const plan = fixture({
    packages: [
      {
        name: "@owner/incomplete",
        path: "packages/incomplete",
        scripts: { test: "echo TODO", format: "oxfmt src" },
      },
    ],
    hasCargoLock: false,
    hasBunLock: false,
    rootScripts: { typecheck: "bun run --filter @aphrody/workspace typecheck" },
  });
  expect(plan.gaps.map((gap) => gap.check)).toEqual([
    "lockfile",
    "lockfile",
    "typecheck",
    "lint",
    "format",
    "test",
    "build",
    "documentation",
  ]);
  expect((await executeMonorepoGate(plan, async () => 0)).passed).toBe(false);
  expect(
    fixture({ rootScripts: { "docs:check": "echo TODO" } }).gaps.some(
      (gap) => gap.check === "documentation",
    ),
  ).toBe(true);
});

test("the executor collects failures and exceptions without hiding later checks", async () => {
  const plan = fixture();
  const calls: string[] = [];
  const report = await executeMonorepoGate(plan, async (check) => {
    calls.push(check.name);
    if (check.name === "Frozen Bun install") return 7;
    if (check.name === "Rust all-target check")
      throw new Error("cargo unavailable");
    return 0;
  });
  expect(calls).toHaveLength(plan.checks.length);
  expect(report.passed).toBe(false);
  expect(
    report.results.filter((result) => result.status === "failed"),
  ).toHaveLength(2);
  expect(report.results.find((result) => result.error)?.error).toBe(
    "cargo unavailable",
  );
  expect(report.results.at(-1)!.status).toBe("passed");
  expect((await executeMonorepoGate(plan, async () => 0)).passed).toBe(true);
});

test("an empty or duplicate-name workspace remains a coverage failure", () => {
  expect(
    fixture({ packages: [] }).gaps.some((gap) => gap.check === "workspace"),
  ).toBe(true);
  expect(
    fixture({
      packages: [...packages, { ...packages[0]!, path: "apps/duplicate" }],
    }).gaps.some((gap) => gap.reason.includes("Duplicate package name")),
  ).toBe(true);
});

test("discovery uses actual root workspace members, exclusions and overlapping patterns", async () => {
  const root = await mkdtemp(join(tmpdir(), "monorepo-gate-"));
  try {
    const entries = [
      { ...packages[0]!, path: "apps/owner/app" },
      { ...packages[0]!, name: "@owner/legacy", path: "apps/owner/legacy" },
      { ...packages[0]!, name: "@owner/vendor", path: "upstream/vendor" },
      {
        ...packages[0]!,
        name: "@owner/nested",
        path: "apps/owner/app/node_modules/nested",
      },
    ];
    await Promise.all(
      entries.map(async (pkg) => {
        const path = join(root, pkg.path, "package.json");
        await mkdir(dirname(path), { recursive: true });
        await writeFile(
          path,
          JSON.stringify({ name: pkg.name, scripts: pkg.scripts }),
        );
      }),
    );
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        workspaces: [
          "apps/owner/*",
          "apps/owner/app",
          "!apps/owner/legacy",
          "missing/*",
        ],
        scripts: { "docs:check-links": "bun check-docs.ts" },
      }),
    );
    await Promise.all(
      ["Cargo.toml", "Cargo.lock", "bun.lock"].map((name) =>
        writeFile(join(root, name), ""),
      ),
    );
    const plan = await discoverMonorepoGatePlan(root);
    expect(plan.packages.map((pkg) => pkg.name)).toEqual(["@owner/app"]);
    expect(plan.gaps).toEqual([
      {
        path: "missing/*",
        check: "workspace",
        reason: "Declared workspace pattern has no package manifests",
      },
    ]);
    expect(
      plan.checks.filter((check) => check.name.startsWith("@owner/app:")),
    ).toHaveLength(5);
    const child = Bun.spawn(
      [
        "bun",
        join(import.meta.dir, "../src/monorepo-gate.ts"),
        "--root",
        root,
        "--plan",
        "--json",
      ],
      { windowsHide: true, stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, output] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
    ]);
    expect(exitCode).toBe(1);
    const report = JSON.parse(output);
    expect(report.executed).toBe(false);
    expect(report.status).toBe("planned");
    expect(report).not.toHaveProperty("passed");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        workspaces: { packages: ["apps/owner/app", "../outside/*"] },
        scripts: { "docs:check-links": "bun check-docs.ts" },
      }),
    );
    const objectPlan = await discoverMonorepoGatePlan(root);
    expect(objectPlan.packages.map((pkg) => pkg.name)).toEqual(["@owner/app"]);
    expect(objectPlan.gaps[0]!.reason).toBe(
      "Workspace pattern escapes repository",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("no-build excludes Cargo compilation, arbitrary adapters, unsafe test hooks and Next builds", async () => {
  const plan = fixture({
    noBuild: true,
    packages: [
      {
        ...packages[0]!,
        scripts: {
          typecheck: "bun check",
          lint: "bun lint src",
          "format:check": "bun fmt --check src",
          test: "bun test",
          build: "next build",
          pretypecheck: "cargo build",
        },
      },
      {
        name: "@owner/hook",
        path: "packages/owner/hook",
        scripts: {
          typecheck: "bun scripts/check.ts",
          test: "cargo test",
          build: "bun run build-native",
        },
      },
    ],
  });
  expect(plan.noBuild).toBe(true);
  expect(plan.checks[0]!.command).toContain("--ignore-scripts");
  expect(plan.checks[0]!.command).toContain("--dry-run");
  expect(
    plan.checks.some((check) =>
      check.command.some((arg) => /cargo-serial/.test(arg)),
    ),
  ).toBe(false);
  expect(
    plan.checks.find((check) => check.name === "@owner/app: typecheck")!
      .command,
  ).toEqual(["bun", "check", "--noEmit"]);
  expect(
    plan.checks.every(
      (check) => !(check.command[0] === "bun" && check.command[1] === "run"),
    ),
  ).toBe(true);
  expect(
    plan.checks.find((check) => check.name === "@owner/app: lint")!.command,
  ).toEqual(["bun", "lint", "src"]);
  expect(
    plan.checks.find((check) => check.name === "@owner/app: format")!.command,
  ).toEqual(["bun", "fmt", "--check", "src"]);
  expect(plan.deferred!.some((check) => check.script === "next build")).toBe(
    true,
  );
  expect(plan.deferred!.some((check) => check.script === "bun test")).toBe(
    true,
  );
  expect((await executeMonorepoGate(plan, async () => 0)).passed).toBe(false);
});

test("an inline interpreter baseline adds a read-only ratchet kept in no-build mode", () => {
  expect(
    fixture().checks.some(
      (check) => check.name === "Inline interpreter ratchet",
    ),
  ).toBe(false);
  for (const noBuild of [false, true]) {
    const check = fixture({ hasInlineBaseline: true, noBuild }).checks.find(
      (item) => item.name === "Inline interpreter ratchet",
    )!;
    expect(check.command[1]!.endsWith("automation-inventory.ts")).toBe(true);
    expect(check.command.slice(2)).toEqual([
      "--inline",
      "--check",
      "--markdown",
      "--root",
      resolve("/workspace/aphrody"),
    ]);
  }
});
