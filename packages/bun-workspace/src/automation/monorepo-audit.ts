// SPDX-License-Identifier: Apache-2.0
/** Execute the shared Bun monorepo audit contract from any repository root. */
import { dirname, join, resolve } from "node:path";
import { loadBunDocuments, searchBunDocs } from "./bun-reference.ts";

export const MONOREPO_AUDIT_STEPS = ["workspace", "lockfile", "security", "knip", "imports"] as const;
export type MonorepoAuditStep = (typeof MONOREPO_AUDIT_STEPS)[number];

type Result = {
  name: MonorepoAuditStep;
  command: string[];
  status: "passed" | "failed";
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  error?: string;
};

const TASKS: Record<MonorepoAuditStep, string[]> = {
  workspace: ["run", "bun:check"],
  lockfile: ["run", "bun:lock-check"],
  security: ["run", "bun:audit"],
  knip: ["run", "audit:knip"],
  imports: ["run", "audit:imports"],
};

async function findRoot(start: string): Promise<string> {
  let current = resolve(start);
  while (true) {
    // oxlint-disable-next-line no-await-in-loop -- remontée séquentielle : le premier package.json rencontré en remontant définit la racine
    if (await Bun.file(join(current, "package.json")).exists()) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("No package.json found; provide --root <path>.");
}

function bunCli(explicit?: string): string {
  const candidate = explicit ?? process.env.BUN_BINARY ?? Bun.which("bun");
  if (!candidate) throw new Error("Bun CLI is required; install Bun or pass --bun <path>.");
  return resolve(candidate);
}

async function runStep(root: string, name: MonorepoAuditStep, bun?: string): Promise<Result> {
  const started = performance.now();
  let command: string[];
  try {
    command = [bunCli(bun), ...TASKS[name]];
  } catch (error) {
    return {
      name,
      command: [],
      status: "failed",
      exitCode: null,
      durationMs: Math.round(performance.now() - started),
      stdout: "",
      stderr: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
  try {
    const child = Bun.spawn(command, {
      windowsHide: true,
      cwd: root,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(15 * 60 * 1000),
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return {
      name,
      command,
      status: exitCode === 0 ? "passed" : "failed",
      exitCode,
      durationMs: Math.round(performance.now() - started),
      stdout,
      stderr,
      ...(exitCode === 0 ? {} : { error: `process exited with status ${exitCode}` }),
    };
  } catch (error) {
    return {
      name,
      command,
      status: "failed",
      exitCode: null,
      durationMs: Math.round(performance.now() - started),
      stdout: "",
      stderr: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseArgs(args: string[]) {
  let root: string | undefined;
  let bun: string | undefined;
  let json = false;
  let quiet = false;
  let compile = false;
  let docs: string | undefined;
  let outfile: string | undefined;
  let steps: MonorepoAuditStep[] = [...MONOREPO_AUDIT_STEPS];
  let jobs = 3;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") root = args[++index];
    else if (arg === "--bun") bun = args[++index];
    else if (arg === "--only") steps = (args[++index] ?? "").split(",") as MonorepoAuditStep[];
    else if (arg === "--jobs") jobs = Number(args[++index]);
    else if (arg === "--compile") compile = true;
    else if (arg === "--docs") docs = args[++index] ?? "";
    else if (arg === "--outfile") outfile = args[++index];
    else if (arg === "--json") json = true;
    else if (arg === "--quiet") quiet = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: yolo ops monorepo-audit [--root path] [--bun path] [--only workspace,lockfile,security,knip,imports] [--jobs 1..5] [--json] [--quiet] [--docs terms] [--compile] [--outfile path]",
      );
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (steps.some(name => !MONOREPO_AUDIT_STEPS.includes(name)))
    throw new Error("--only contains an unknown audit step");
  if (!Number.isSafeInteger(jobs) || jobs < 1 || jobs > 5) throw new Error("--jobs must be an integer from 1 to 5");
  return { root, bun, json, quiet, docs, compile, outfile, steps, jobs };
}

export async function runMonorepoAudit(args: string[]): Promise<number> {
  const options = parseArgs(args);
  if (options.docs !== undefined) {
    const matches = options.docs
      ? await searchBunDocs(options.docs, 12)
      : (await loadBunDocuments()).map(({ title, source, content }) => ({
          title,
          source,
          score: 0,
          excerpt: `${content.length} characters`,
        }));
    console.log(JSON.stringify(matches, null, 2));
    return 0;
  }
  if (options.compile) {
    const output = resolve(options.outfile ?? "target/aphrody/monorepo-audit");
    const result = await Bun.build({
      entrypoints: [import.meta.path],
      compile: { outfile: output },
      minify: true,
      sourcemap: "none",
    });
    if (!result.success) throw new AggregateError(result.logs, "Could not compile monorepo-audit");
    console.log(output);
    return 0;
  }
  const root = options.root ? resolve(options.root) : await findRoot(process.cwd());
  const results: Result[] = [];
  let cursor = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: Math.min(options.jobs, options.steps.length) }, async () => {
      while (cursor < options.steps.length) {
        const index = cursor++;
        const name = options.steps[index];
        if (!name) continue;
        if (!options.quiet && !options.json) console.error(`▶ ${name}`);
        // oxlint-disable-next-line no-await-in-loop -- pool de workers borné par --jobs (1..5) : chaque worker enchaîne ses étapes, la concurrence est volontairement limitée
        results[index] = await runStep(root, name, options.bun);
      }
    }),
  );
  const report = {
    root,
    durationMs: Math.round(performance.now() - started),
    passed: results.every(result => result.status === "passed"),
    steps: results,
  };
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else
    for (const result of results) {
      console.log(
        `${result.status === "passed" ? "✓" : "✗"} ${result.name} (${(result.durationMs / 1000).toFixed(1)}s)`,
      );
      if (result.stdout) console.log(result.stdout);
      if (result.stderr) console.error(result.stderr);
      if (result.error) console.error(`${result.name}: ${result.error}`);
    }
  return report.passed ? 0 : 1;
}

if (import.meta.main) process.exit(await runMonorepoAudit(process.argv.slice(2)));
