// SPDX-License-Identifier: Apache-2.0
/** Fresh-process CLI latency. No VM reuse, cache eviction, compilation or installation. */
import { mkdtempSync, realpathSync, rmSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, loadavg, release, tmpdir, cpus } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface StartupCommand {
  readonly id: string;
  readonly argv: readonly string[];
  readonly stdout: string;
}
export interface StartupOptions {
  readonly samples: number;
  readonly warmupPairs: number;
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly timeoutMs?: number;
}
interface Sample {
  readonly elapsedMs: number;
  readonly exitCode: number;
  readonly stdoutBytes: number;
  readonly stdoutSha256: string;
}
interface Pair {
  readonly index: number;
  readonly order: readonly string[];
  readonly reference: Sample;
  readonly candidate: Sample;
}
const sha256 = (data: string | Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(data).digest("hex");

function validate(options: StartupOptions): void {
  if (!Number.isInteger(options.samples) || options.samples < 10 || options.samples > 100)
    throw new Error("samples must be an integer in 10..100");
  if (!Number.isInteger(options.warmupPairs) || options.warmupPairs < 0 || options.warmupPairs > 20)
    throw new Error("warmupPairs must be an integer in 0..20");
  const timeout = options.timeoutMs ?? 3000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 5000)
    throw new Error("timeoutMs must be an integer in 1..5000");
}

function invoke(command: StartupCommand, options: StartupOptions): Sample {
  const started = Bun.nanoseconds();
  const process = Bun.spawnSync([...command.argv], {
    windowsHide: true,
    cwd: options.cwd,
    env: options.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: options.timeoutMs ?? 3000,
    killSignal: "SIGKILL",
  });
  const elapsedMs = (Bun.nanoseconds() - started) / 1e6;
  if (process.exitCode !== 0 || process.stderr.byteLength !== 0)
    throw new Error(
      `${command.id} failed (exit ${process.exitCode}, signal ${process.signalCode})`,
    );
  if (process.stdout.toString() !== command.stdout)
    throw new Error(`${command.id} output identity changed`);
  return {
    elapsedMs,
    exitCode: process.exitCode,
    stdoutBytes: process.stdout.byteLength,
    stdoutSha256: sha256(process.stdout),
  };
}

function distribution(values: readonly number[]) {
  const sorted = [...values].toSorted((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.ceil(p * sorted.length) - 1]!;
  return {
    count: sorted.length,
    min: sorted[0]!,
    p50: percentile(0.5),
    p90: percentile(0.9),
    p95: percentile(0.95),
    max: sorted.at(-1)!,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}

export function measureStartupComparison(
  reference: StartupCommand,
  candidate: StartupCommand,
  options: StartupOptions,
) {
  validate(options);
  const pair = (index: number): Pair => {
    const order = index % 2 === 0 ? [reference, candidate] : [candidate, reference];
    const first = invoke(order[0]!, options);
    const second = invoke(order[1]!, options);
    return {
      index,
      order: order.map((command) => command.id),
      reference: index % 2 === 0 ? first : second,
      candidate: index % 2 === 0 ? second : first,
    };
  };
  const series = () => {
    const pairs = Array.from({ length: options.samples }, (_, index) => pair(index));
    return {
      summary: {
        referenceMs: distribution(pairs.map((entry) => entry.reference.elapsedMs)),
        candidateMs: distribution(pairs.map((entry) => entry.candidate.elapsedMs)),
        pairedCandidateMinusReferenceMs: distribution(
          pairs.map((entry) => entry.candidate.elapsedMs - entry.reference.elapsedMs),
        ),
      },
      pairs,
    };
  };
  const initialFreshProcesses = series();
  for (let index = 0; index < options.warmupPairs; index++) pair(index);
  return {
    reference,
    candidate,
    identicalOutput: reference.stdout === candidate.stdout,
    initialFreshProcesses,
    primedFreshProcesses: series(),
  };
}

async function fingerprint(file: string) {
  const path = realpathSync(file);
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const bytes of Bun.file(path).stream()) hasher.update(bytes);
  return { path, bytes: statSync(path).size, sha256: hasher.digest("hex") };
}

function probe(argv: string[], cwd: string, env: Record<string, string>): string {
  const result = Bun.spawnSync(argv, {
    windowsHide: true,
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 3000,
  });
  if (result.exitCode !== 0 || result.stderr.byteLength !== 0)
    throw new Error("Version/provenance probe failed: " + argv[0]);
  return result.stdout.toString();
}

export async function runStartupBenchmark(
  options: {
    samples?: number;
    warmupPairs?: number;
    repository?: string;
    installedYolo?: string;
    bun?: string;
  } = {},
) {
  const root = resolve(options.repository ?? join(import.meta.dir, "../../../../docs/aphrody"));
  const bun = realpathSync(options.bun ?? Bun.which("bun") ?? process.execPath);
  const installed = resolve(options.installedYolo ?? join(homedir(), ".yolo/bin/yolo"));
  const launcher = join(root, "scripts/dev/cli/yolo");
  const cwd = mkdtempSync(join(tmpdir(), "yolo-startup-"));
  const env = {
    PATH: [dirname(bun), "/usr/bin", "/bin"].join(process.platform === "win32" ? ";" : ":"),
    HOME: cwd,
    NO_COLOR: "1",
    ...(process.platform === "win32"
      ? { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" }
      : {}),
  };
  try {
    const settings: StartupOptions = {
      samples: options.samples ?? 30,
      warmupPairs: options.warmupPairs ?? 5,
      cwd,
      env,
    };
    validate(settings);
    const files = [
      bun,
      installed,
      launcher,
      join(root, "packages/engine/yolo/src/index.ts"),
      join(root, "VERSION"),
    ];
    const before = await Promise.all(files.map(fingerprint));
    const installedLine = probe([installed, "version"], cwd, env);
    const sourceLine = probe([launcher, "version"], cwd, env);
    const bunLine = probe([bun, "--version"], cwd, env);
    for (const line of [installedLine, sourceLine])
      if (!/^yolo \S+ \(\S+, Bun \S+\)\n$/.test(line))
        throw new Error("Expected a Yolo version-line workload");
    const reference: StartupCommand = {
      id: "bun-cli-version",
      argv: [bun, "--version"],
      stdout: bunLine,
    };
    const installedCommand: StartupCommand = {
      id: "installed-yolo-version",
      argv: [installed, "version"],
      stdout: installedLine,
    };
    const sourceCommand: StartupCommand = {
      id: "source-shell-launcher-version",
      argv: [launcher, "version"],
      stdout: sourceLine,
    };
    const identicalLine: StartupCommand = {
      id: "bun-js-print-installed-version-line",
      argv: [bun, "-e", `console.log(${JSON.stringify(installedLine.trimEnd())})`],
      stdout: installedLine,
    };
    const loadBefore = loadavg();
    const comparisons = [
      measureStartupComparison(reference, installedCommand, settings),
      measureStartupComparison(reference, sourceCommand, settings),
      measureStartupComparison(identicalLine, installedCommand, settings),
    ];
    const loadAfter = loadavg();
    const after = await Promise.all(files.map(fingerprint));
    if (before.some((file, index) => file.sha256 !== after[index]?.sha256))
      throw new Error("Measured executable or source files changed during the benchmark");
    const installedHelp = probe([installed, "--help"], cwd, env);
    return {
      schema: "yolo.startup-benchmark/1",
      timestamp: new Date().toISOString(),
      host: {
        platform: process.platform,
        arch: process.arch,
        release: release(),
        cpu: cpus()[0]?.model,
        loadBefore,
        loadAfter,
      },
      tool: { bunVersion: Bun.version, bunRevision: Bun.revision },
      provenance: {
        files: before,
        sourceCommit: probe(["git", "-C", root, "rev-parse", "HEAD"], cwd, env).trim(),
        sourceDirty: probe(["git", "-C", root, "status", "--porcelain", "-uno"], cwd, env) !== "",
        installedVersionLine: installedLine.trimEnd(),
        sourceVersionLine: sourceLine.trimEnd(),
        installedBunRevision: installedHelp.match(/Runtime: Bun \S+ \(([^)]+)\)/)?.[1] ?? null,
        globalBunRevision: probe([bun, "--revision"], cwd, env).trim(),
        installedSourceCommit: null,
      },
      protocol: {
        samplesPerCommandPerSeries: settings.samples,
        unmeasuredWarmupPairsBeforePrimedSeries: settings.warmupPairs,
        order:
          "Alternating reference/candidate and candidate/reference; sequential, no competing benchmark children",
        timing:
          "Parent Bun.spawnSync call through captured stdout/stderr and process exit; includes spawn/wait/collection overhead",
        initialFreshProcesses:
          "Fresh VM/process each sample; version probes and file hashing already ran; OS cache state is uncontrolled",
        primedFreshProcesses:
          "Fresh VM/process each sample after unmeasured pairs; warm repeated launch conditions, never a reused warm VM",
        environment:
          "Disposable empty cwd/HOME, explicit PATH resolving source launcher's global Bun; no inherited project dotenv or domain credentials",
        workloads:
          "Named version commands, plus minimal Bun -e printing exactly the installed Yolo version line; version-command work differs",
        limit:
          "CLI process lifecycle only; no desktop window, engine fork, VM initialization isolation, cold page-cache, memory, Rust compute or parity qualification",
      },
      comparisons,
    };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

export async function runStartupBenchCli(args: readonly string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: bun scripts/bench/startup.ts [--samples 10..100] [--warmup-pairs 0..20] [--installed FILE] [--out FILE]. Measures fresh version-command processes; no builds/installations or desktop/VM parity claim.",
    );
    return 0;
  }
  const options: Parameters<typeof runStartupBenchmark>[0] = {};
  let out: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!["--samples", "--warmup-pairs", "--installed", "--out"].includes(argument!))
      throw new Error("Unknown startup option: " + argument);
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error("Missing value for " + argument);
    if (argument === "--samples") options.samples = Number(value);
    else if (argument === "--warmup-pairs") options.warmupPairs = Number(value);
    else if (argument === "--installed") options.installedYolo = value;
    else out = resolve(value);
  }
  const report = await runStartupBenchmark(options);
  const json = JSON.stringify(report, null, 2) + "\n";
  if (out) {
    mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
    writeFileSync(out, json, { mode: 0o600 });
  }
  console.log(json);
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await runStartupBenchCli(Bun.argv.slice(2));
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
