// SPDX-License-Identifier: Apache-2.0
//! One entry point for the web layer gates: configuration contract, Bun packages (typecheck,
//! lint, test), the engine build, the loopback smoke and, on request, the Rust gates and the UI
//! crawlability gate. Every stage names its command so a skipped or failing check is visible.
//!
//!   bun scripts/audit/web-verify.ts [--stage config,bun,build,smoke,crawlability,rust] [--rust]
//!                                   [--json] [--out FILE]
//!
//! Default stages: config, bun, build, smoke. `--rust` adds cargo check, clippy and test for the
//! web crates; `crawlability` runs only when its script exists.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { repositoryRoot, validateWebConfig } from "../../packages/web/agent-browser/src/config.ts";

export const WEB_CRATES = [
  "obscura",
  "obscura-browser",
  "obscura-cdp",
  "obscura-dom",
  "obscura-js",
  "obscura-mcp",
  "obscura-net",
  "obscura-render",
  "taffy",
  "aphrody-web-chromium",
  "aphrody-web-crawl",
  "aphrody-web-detect",
  "aphrody-web-engine",
  "aphrody-web-extract",
  "aphrody-web-index",
  "aphrody-web-service",
  "aphrody-x",
] as const;

export type StageId = "config" | "bun" | "build" | "smoke" | "crawlability" | "rust";

export interface Step {
  name: string;
  /** argv; `null` for in-process checks. */
  command: string[] | null;
  timeoutMs: number;
}

export interface Stage {
  id: StageId;
  steps: Step[];
}

export interface StepResult {
  stage: StageId;
  name: string;
  command: string;
  ok: boolean;
  ms: number;
  detail: string;
}

const MINUTE = 60_000;
const cargoPackages = WEB_CRATES.flatMap((name) => ["-p", name]);

/** Pure planning: which stages run and with which commands. */
export function planStages(options: {
  stages?: StageId[];
  rust?: boolean;
  crawlabilityAvailable?: boolean;
}): Stage[] {
  const all: Stage[] = [
    {
      id: "config",
      steps: [{ name: "config/web.json contract", command: null, timeoutMs: 30_000 }],
    },
    {
      id: "bun",
      steps: [
        ...["@aphrody/agent-browser", "@aphrody/web-test"].flatMap((pkg) =>
          ["typecheck", "lint", "test"].map((script) => ({
            name: `${pkg} ${script}`,
            command: ["bun", "run", "--filter", pkg, script],
            timeoutMs: 10 * MINUTE,
          })),
        ),
        {
          name: "web script tests",
          command: [
            "bun",
            "test",
            "scripts/audit/web-smoke.test.ts",
            "scripts/audit/web-verify.test.ts",
            "scripts/tools/web/web-crawl.test.ts",
          ],
          timeoutMs: 5 * MINUTE,
        },
      ],
    },
    {
      id: "build",
      steps: [
        {
          name: "cargo build aphrody-web-engine",
          command: [
            "scripts/build/rust/cargo-serial.sh",
            "build",
            "-p",
            "aphrody-web-engine",
            "--bins",
            "--locked",
          ],
          timeoutMs: 40 * MINUTE,
        },
      ],
    },
    {
      id: "smoke",
      steps: [
        {
          name: "loopback smoke",
          command: ["bun", "scripts/audit/web-smoke.ts"],
          timeoutMs: 5 * MINUTE,
        },
      ],
    },
    ...(options.crawlabilityAvailable === false
      ? []
      : [
          {
            id: "crawlability" as const,
            steps: [
              {
                name: "UI crawlability gate",
                command: ["bun", "scripts/audit/web-crawlability.ts"],
                timeoutMs: 10 * MINUTE,
              },
            ],
          },
        ]),
    {
      id: "rust",
      steps: [
        {
          name: "cargo check --all-targets",
          command: [
            "scripts/build/rust/cargo-serial.sh",
            "check",
            "--all-targets",
            "--locked",
            ...cargoPackages,
          ],
          timeoutMs: 60 * MINUTE,
        },
        {
          name: "cargo clippy -D warnings",
          command: [
            "scripts/build/rust/cargo-serial.sh",
            "clippy",
            "--all-targets",
            "--locked",
            ...cargoPackages,
            "--",
            "-D",
            "warnings",
          ],
          timeoutMs: 60 * MINUTE,
        },
        {
          name: "cargo test",
          command: [
            "scripts/build/rust/cargo-serial.sh",
            "test",
            "--locked",
            "--no-fail-fast",
            ...cargoPackages,
          ],
          timeoutMs: 90 * MINUTE,
        },
      ],
    },
  ];
  const wanted = new Set<StageId>(
    options.stages ?? [
      "config",
      "bun",
      "build",
      "smoke",
      ...(options.rust ? (["rust"] as const) : []),
    ],
  );
  return all.filter((stage) => wanted.has(stage.id));
}

export function parseArgs(argv: string[]): {
  stages?: StageId[];
  rust: boolean;
  json: boolean;
  out?: string;
} {
  const valid: StageId[] = ["config", "bun", "build", "smoke", "crawlability", "rust"];
  let stages: StageId[] | undefined;
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--stage") {
      stages = (argv[++i] ?? "").split(",").filter(Boolean) as StageId[];
      const unknown = stages.filter((stage) => !valid.includes(stage));
      if (unknown.length)
        throw new Error(`unknown stage ${unknown.join(", ")}; valid: ${valid.join(", ")}`);
    } else if (argv[i] === "--out") out = argv[++i];
  }
  return { stages, rust: argv.includes("--rust"), json: argv.includes("--json"), out };
}

/** In-process contract check of `config/web.json` and the documents it points at. */
export function checkConfigFile(root: string): string[] {
  const file = join(root, "config/web.json");
  if (!existsSync(file)) return ["config/web.json is missing"];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return [
      `config/web.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  const problems = validateWebConfig(raw);
  const docs = (raw as { docs?: Record<string, unknown> }).docs ?? {};
  for (const [name, path] of Object.entries(docs)) {
    if (typeof path !== "string" || !existsSync(join(root, path)))
      problems.push(`docs.${name} points at a missing file: ${String(path)}`);
  }
  const unit = (raw as { engine?: { systemdUnit?: unknown } }).engine?.systemdUnit;
  if (typeof unit === "string" && !unit.startsWith("yolo:units/"))
    problems.push(`engine.systemdUnit must reference the yolo unit catalog: ${unit}`);
  return problems;
}

async function runCommand(
  command: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ ok: boolean; detail: string }> {
  const child = Bun.spawn(command, {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const tail = `${stdout}\n${stderr}`.trim().split("\n").slice(-6).join("\n");
  if (child.signalCode === "SIGKILL")
    return { ok: false, detail: `timed out after ${Math.round(timeoutMs / 1000)} s\n${tail}` };
  return {
    ok: code === 0,
    detail: code === 0 ? tail.split("\n").slice(-2).join(" | ") : `exit ${code}\n${tail}`,
  };
}

export async function runStages(stages: Stage[], root: string): Promise<StepResult[]> {
  const results: StepResult[] = [];
  for (const stage of stages) {
    for (const step of stage.steps) {
      const started = performance.now();
      let outcome: { ok: boolean; detail: string };
      if (step.command === null) {
        const problems = checkConfigFile(root);
        outcome = {
          ok: problems.length === 0,
          detail: problems.length ? problems.join("; ") : "valid",
        };
      } else {
        // Stages run in order; a failing build makes the smoke meaningless, so later steps still run
        // and report their own failure rather than being silently skipped.
        // oxlint-disable-next-line no-await-in-loop
        outcome = await runCommand(step.command, root, step.timeoutMs);
      }
      results.push({
        stage: stage.id,
        name: step.name,
        command: step.command?.join(" ") ?? "(in-process)",
        ok: outcome.ok,
        ms: Math.round(performance.now() - started),
        detail: outcome.detail,
      });
    }
  }
  return results;
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  const root = repositoryRoot();
  const crawlabilityAvailable = existsSync(join(root, "scripts/audit/web-crawlability.ts"));
  const stages = planStages({ ...options, crawlabilityAvailable });
  const results = await runStages(stages, root);
  const failed = results.filter((result) => !result.ok);
  if (options.out) {
    const target = resolve(root, options.out);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      `${JSON.stringify({ schema: "aphrody-web.verify/1", ok: failed.length === 0, results }, null, 2)}\n`,
    );
  }
  if (options.json) console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2));
  else {
    for (const result of results) {
      console.log(
        `${result.ok ? "ok  " : "FAIL"} [${result.stage}] ${result.name} (${(result.ms / 1000).toFixed(1)} s)`,
      );
      if (!result.ok) console.log(result.detail.replace(/^/gm, "       "));
    }
    const skipped = ["rust", "crawlability"].filter(
      (id) => !stages.some((stage) => stage.id === id),
    );
    console.log(
      `\nweb verify: ${results.length - failed.length}/${results.length} steps passed${skipped.length ? `; not run: ${skipped.join(", ")}` : ""}`,
    );
  }
  process.exit(failed.length === 0 ? 0 : 1);
}
