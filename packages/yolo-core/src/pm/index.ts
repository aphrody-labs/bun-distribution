// SPDX-License-Identifier: Apache-2.0
import { existsSync, realpathSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

import { processes } from "../runtime";
import { yoloRoot } from "../host/index.ts";

/** The Aphrody Cargo serialization wrapper as an argv prefix: the Bun twin on Windows, the bash script elsewhere. */
export function cargoSerialArgv(root = yoloRoot()): string[] {
  const dir = join(root, "scripts", "build", "rust");
  return process.platform === "win32"
    ? [process.execPath, join(dir, "cargo-serial.ts")]
    : [join(dir, "cargo-serial.sh")];
}

export type PackageManager = "bun" | "uv" | "cargo";
export interface PackageSyncOptions {
  root?: string | undefined;
  managers?: readonly PackageManager[] | undefined;
  offline?: boolean | undefined;
  production?: boolean | undefined;
  /** Run Bun lifecycle scripts (trustedDependencies only, per Bun policy). Off by default. */
  lifecycleScripts?: boolean | undefined;
  apply?: boolean | undefined;
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
}
export interface PackageSyncStep {
  manager: PackageManager;
  manifest: string;
  lockfile: string;
  argv: string[];
  blockers: string[];
  inputHashes: Record<string, string>;
}
export interface PackageSyncPlan {
  schema: "yolo.packages.plan/1";
  root: string;
  ready: boolean;
  steps: PackageSyncStep[];
}
export interface PackageSyncResult {
  schema: "yolo.packages.sync/1";
  plan: PackageSyncPlan;
  applied: boolean;
  ok: boolean;
  results: Array<{
    manager: PackageManager;
    status: "pass" | "fail" | "skipped";
    exitCode: number | null;
    reason?: string;
    elapsedMs: number;
  }>;
}

const MANIFESTS = {
  bun: "package.json",
  uv: "pyproject.toml",
  cargo: "Cargo.toml",
} as const;
const hash = async (path: string) =>
  new Bun.CryptoHasher("sha256")
    .update(await Bun.file(path).arrayBuffer())
    .digest("hex");

/** Read-only preflight. It never installs a tool, updates a lock or executes a script. */
export async function planPackageSync(
  options: PackageSyncOptions = {},
): Promise<PackageSyncPlan> {
  const root = realpathSync(resolve(options.root ?? process.cwd()));
  if (!statSync(root).isDirectory())
    throw new Error("Package root must be a directory");
  const detected = (Object.keys(MANIFESTS) as PackageManager[]).filter(
    (manager) => existsSync(join(root, MANIFESTS[manager])),
  );
  const managers = options.managers ? [...options.managers] : detected;
  if (!managers.length) throw new Error("No supported package manifests found");
  if (
    new Set(managers).size !== managers.length ||
    managers.some((manager) => !Object.hasOwn(MANIFESTS, manager))
  )
    throw new Error("Choose unique managers: bun, uv, cargo");
  const steps: PackageSyncStep[] = [];
  for (const manager of managers) {
    const manifest = join(root, MANIFESTS[manager]);
    const lockfile = join(
      root,
      manager === "bun"
        ? existsSync(join(root, "bun.lock"))
          ? "bun.lock"
          : "bun.lockb"
        : manager === "uv"
          ? "uv.lock"
          : "Cargo.lock",
    );
    const blockers: string[] = [];
    const inputHashes: Record<string, string> = {};
    for (const path of [manifest, lockfile]) {
      if (!existsSync(path) || !statSync(path).isFile())
        blockers.push(`Missing required file: ${path}`);
      else if (dirname(realpathSync(path)) !== root)
        blockers.push(`Manifest or lock symlink escapes project: ${path}`);
      // oxlint-disable-next-line no-await-in-loop -- deux manifestes lus dans l ordre : les blockers restent déterministes
      else inputHashes[path] = await hash(path);
    }
    if (Object.hasOwn(inputHashes, manifest)) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- lecture séquentielle du manifeste avant analyse
        const text = await Bun.file(manifest).text();
        const value: unknown =
          manager === "bun" ? JSON.parse(text) : Bun.TOML.parse(text);
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error("Expected manifest object");
      } catch {
        blockers.push(`Invalid ${MANIFESTS[manager]}`);
      }
    }
    const binary = Bun.which(manager);
    if (!binary) blockers.push(`Global ${manager} binary unavailable`);
    let argv: string[];
    if (manager === "bun")
      argv = [
        binary ?? "bun",
        "install",
        "--frozen-lockfile",
        ...(options.lifecycleScripts ? [] : ["--ignore-scripts"]),
        "--no-progress",
        ...(options.production ? ["--production"] : []),
      ];
    else if (manager === "uv")
      argv = [
        binary ?? "uv",
        "sync",
        "--locked",
        "--no-python-downloads",
        "--no-progress",
        "--project",
        root,
        ...(options.production ? ["--no-dev"] : []),
      ];
    else {
      const wrapper = cargoSerialArgv();
      if (!existsSync(wrapper.at(-1)!))
        blockers.push(
          "Supported Aphrody Cargo serialization wrapper unavailable",
        );
      argv = [...wrapper, "fetch", "--locked"];
    }
    if (options.offline) argv.push("--offline");
    steps.push({ manager, manifest, lockfile, argv, blockers, inputHashes });
  }
  return {
    schema: "yolo.packages.plan/1",
    root,
    ready: steps.every((step) => !step.blockers.length),
    steps,
  };
}

/** Sequential native dependency acquisition; it does not build engines or publish packages. */
const activeRoots = new Set<string>();

export async function syncPackages(
  options: PackageSyncOptions = {},
): Promise<PackageSyncResult> {
  const timeoutMs = options.timeoutMs ?? 300000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1800000)
    throw new RangeError("Package timeout must be 1..1800000 milliseconds");
  const plan = await planPackageSync(options);
  const report: PackageSyncResult = {
    schema: "yolo.packages.sync/1",
    plan,
    applied: options.apply === true && plan.ready,
    ok: plan.ready,
    results: [],
  };
  if (!report.applied) return report;
  if (activeRoots.has(plan.root))
    throw new Error("Package sync already running for this root");
  activeRoots.add(plan.root);
  try {
    for (const step of plan.steps) {
      const started = performance.now();
      if (!report.ok || options.signal?.aborted) {
        report.ok = false;
        report.results.push({
          manager: step.manager,
          status: "skipped",
          exitCode: null,
          reason: options.signal?.aborted
            ? "Cancelled"
            : "Previous manager failed",
          elapsedMs: 0,
        });
        continue;
      }
      for (const [path, expected] of Object.entries(step.inputHashes)) {
        // oxlint-disable-next-line no-await-in-loop -- contrôle des entrées séquentiel : arrêt à la première divergence
        if (!existsSync(path) || (await hash(path)) !== expected) {
          report.ok = false;
          report.results.push({
            manager: step.manager,
            status: "fail",
            exitCode: null,
            reason: "Manifest or lock changed after preflight",
            elapsedMs: performance.now() - started,
          });
          break;
        }
      }
      if (!report.ok) continue;
      let exitCode: number | null = null;
      let reason: string | undefined;
      try {
        options.signal?.throwIfAborted();
        // The serialization owner's flock has a bounded wait; keep global sccache untouched.
        const child = processes.spawn({
          program: step.argv[0]!,
          args: step.argv.slice(1),
          cwd: plan.root,
          env: {
            APHRODY_CARGO_LOCK_TIMEOUT_SECS: String(
              Math.max(1, Math.ceil(timeoutMs / 1000)),
            ),
          },
          stdio: "capture-lossless",
          maxOutputBytes: 262144,
        });
        try {
          // oxlint-disable-next-line no-await-in-loop -- une commande de build à la fois, sérialisée par le verrou du propriétaire
          const outcome = await child.collectOutput({
            timeoutMs,
            ...(options.signal ? { signal: options.signal } : {}),
          });
          exitCode = outcome.status.exitCode;
          if (outcome.status.signal)
            reason = `Stopped by signal ${outcome.status.signal}`;
        } finally {
          child.release();
        }
        for (const [path, expected] of Object.entries(step.inputHashes)) {
          // oxlint-disable-next-line no-await-in-loop -- contrôle des entrées après exécution, arrêt à la première divergence
          if (!existsSync(path) || (await hash(path)) !== expected) {
            reason = "Manifest or lock changed during sync";
            break;
          }
        }
      } catch (error) {
        reason = options.signal?.aborted
          ? "Cancelled"
          : error instanceof Error
            ? error.message
            : String(error);
      }
      const passed = exitCode === 0 && reason === undefined;
      if (!passed) report.ok = false;
      report.results.push({
        manager: step.manager,
        status: passed ? "pass" : "fail",
        exitCode,
        ...(reason ? { reason } : {}),
        elapsedMs: Math.round(performance.now() - started),
      });
    }
    return report;
  } finally {
    activeRoots.delete(plan.root);
  }
}
