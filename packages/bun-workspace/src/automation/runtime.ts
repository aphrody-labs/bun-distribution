import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { findWorkspaceRoot } from "@aphrody/paths";

export type InfraInvocation = {
  args: string[];
  cwd?: string;
  stdout?: "inherit" | "pipe";
  stderr?: "inherit" | "pipe";
  env?: Record<string, string | undefined>;
};

export type InfraResult = {
  command: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
};

export function infraRoot(environment: Record<string, string | undefined> = process.env, cwd = process.cwd()): string {
  const explicit = environment.BUN_OS_ROOT?.trim() || environment.APHRODY_WORKSPACE_ROOT?.trim();
  if (explicit) return findWorkspaceRoot(resolve(explicit), {});
  // The selected checkout owns operations even when the workstation still exports
  // APHRODY_ROOT for its independently installed capability owner.
  let candidate = resolve(cwd);
  for (;;) {
    if (existsSync(join(candidate, "sources.lock.json")) && existsSync(join(candidate, "package.json")))
      return candidate;
    const parent = dirname(candidate);
    if (candidate === parent) break;
    candidate = parent;
  }
  const fromSource = resolve(import.meta.dir, "..", "..", "..", "..");
  if (existsSync(join(fromSource, "sources.lock.json"))) return fromSource;
  const legacy = environment.APHRODY_ROOT?.trim();
  if (legacy) return findWorkspaceRoot(resolve(legacy), {});
  throw new Error("Bun OS workspace not found; configure BUN_OS_ROOT explicitly");
}

async function executable(path: string | null | undefined): Promise<string | undefined> {
  return path && (await Bun.file(path).exists()) ? path : undefined;
}

/** Installed runtime by default; source compilation requires explicit development opt-in. */
export async function infraExecutable(
  root = infraRoot(),
  environment: Record<string, string | undefined> = process.env,
): Promise<string[]> {
  const explicitBinary = environment.BUN_OS_INFRA_BIN ?? environment.APHRODY_INFRA_BIN;
  if (explicitBinary) {
    const direct = await executable(explicitBinary);
    if (!direct) throw new Error(`Configured Infra binary is missing: ${explicitBinary}`);
    return [direct];
  }
  if ((environment.BUN_OS_INFRA_BUILD_FROM_SOURCE ?? environment.APHRODY_INFRA_BUILD_FROM_SOURCE) === "1") {
    if ((environment.BUN_OS_NO_BUILD ?? environment.APHRODY_NO_BUILD) === "1")
      throw new Error("Source compilation is disabled by BUN_OS_NO_BUILD or APHRODY_NO_BUILD");
    return [
      process.execPath,
      join(root, "scripts/cargo.ts"),
      "exec",
      "--",
      "run",
      "--quiet",
      "--locked",
      "-p",
      "aphrody-infra",
      "--bin",
      "bunos-infra",
      "--",
    ];
  }
  if (environment.APHRODY_BIN) {
    const direct = await executable(environment.APHRODY_BIN);
    if (!direct) throw new Error(`Configured Aphrody binary is missing: ${environment.APHRODY_BIN}`);
    return [direct, "infra"];
  }
  const suffix = process.platform === "win32" ? ".exe" : "";
  const searchPath = Object.entries(environment).find(([key]) => key.toLowerCase() === "path")?.[1] ?? "";
  const home = environment.HOME ?? environment.USERPROFILE;
  const productBinary = await executable(Bun.which(`bunos-infra${suffix}`, { PATH: searchPath }));
  if (productBinary) return [productBinary];
  const canonical = await Promise.all(
    [
      Bun.which(`aphrody${suffix}`, { PATH: searchPath }),
      process.platform === "win32" && environment.LOCALAPPDATA
        ? join(environment.LOCALAPPDATA, "Aphrody", "bin", "aphrody.exe")
        : undefined,
      home && join(home, ".aphrody", "bin", `aphrody${suffix}`),
      home && join(home, ".local", "bin", `aphrody${suffix}`),
    ].map(executable),
  );
  const canonicalExecutable = canonical.find(path => path !== undefined);
  if (canonicalExecutable) return [canonicalExecutable, "infra"];
  const name = `aphrody-infra${suffix}`;
  for (const candidate of [home && join(home, ".local", "bin", name), Bun.which(name, { PATH: searchPath })]) {
    // oxlint-disable-next-line no-await-in-loop -- candidates are probed in PATH order; the first executable wins and later probes are skipped
    const direct = await executable(candidate);
    if (direct) return [direct];
  }
  throw new Error(
    "Infra binary is not installed; install aphrody, set APHRODY_BIN or APHRODY_INFRA_BIN, or explicitly enable APHRODY_INFRA_BUILD_FROM_SOURCE=1 for development",
  );
}

/**
 * `ssh exec --host <h> --cmd <script>` addressed to the host this process runs on (the declared
 * APHRODY_BUILD_HOST marker): the host has no SSH alias for itself, so the script runs locally under the
 * same finite deadline instead of looping through SSH.
 */
export function localHostCommand(
  args: readonly string[],
  environment: Record<string, string | undefined>,
): string[] | undefined {
  if (process.platform === "win32" || args.length !== 6) return undefined;
  const [ssh, exec, hostFlag, host, cmdFlag, script] = args;
  if (ssh !== "ssh" || exec !== "exec" || hostFlag !== "--host" || cmdFlag !== "--cmd") return undefined;
  if (!host || !script || environment.APHRODY_BUILD_HOST !== host) return undefined;
  const seconds = Number(environment.APHRODY_SSH_COMMAND_TIMEOUT_SECS ?? "30");
  const deadline = Number.isInteger(seconds) && seconds >= 1 && seconds <= 86400 ? seconds : 30;
  return ["timeout", String(deadline), "bash", "-c", script];
}

/** Conservative UTF-16 bound including Windows quoting, escaping and the terminating NUL. */
export function windowsCommandBound(command: readonly string[]): number {
  return 1 + command.reduce((length, argument) => length + argument.length * 2 + 3, 0);
}

/** Compress only the declared SSH script; arguments never pass through a local shell. */
export function prepareInfraCommand(command: readonly string[], platform: string = process.platform): string[] {
  if (command.some(argument => argument.includes("\0"))) throw new Error("Infra arguments cannot contain NUL");
  const prepared = [...command];
  if (platform !== "win32" || windowsCommandBound(prepared) < 30000) return prepared;
  const offset = prepared.length - 6;
  if (
    offset < 1 ||
    prepared[offset] !== "ssh" ||
    prepared[offset + 1] !== "exec" ||
    prepared[offset + 2] !== "--host" ||
    prepared[offset + 4] !== "--cmd"
  )
    throw new Error("Infra invocation exceeds the Windows command-line budget");
  const encoded = Buffer.from(Bun.gzipSync(Buffer.from(prepared[offset + 5]!, "utf8"))).toString("base64");
  // A sentinel preserves trailing newlines removed by command substitution. pipefail
  // refuses decoder errors; exec preserves the original bash command's exit status.
  const script = `set -o pipefail; payload=$(printf '%s' '${encoded}' | base64 --decode | gzip --decompress && printf '.') || exit 125; exec bash -c "\${payload%.}"`;
  prepared[offset + 5] = `bash -c ${"'" + script.replaceAll("'", "'\\''") + "'"}`;
  if (windowsCommandBound(prepared) >= 30000)
    throw new Error("Compressed Infra invocation still exceeds the Windows command-line budget; nothing dispatched");
  return prepared;
}

export async function runInfra(invocation: InfraInvocation): Promise<InfraResult> {
  const environment = { ...process.env, ...invocation.env };
  const root = infraRoot(environment, invocation.cwd ?? process.cwd());
  const command = prepareInfraCommand(
    localHostCommand(invocation.args, environment) ?? [
      ...(await infraExecutable(root, environment)),
      "--root",
      root,
      ...invocation.args,
    ],
  );
  const child = Bun.spawn(command, {
    windowsHide: true,
    cwd: invocation.cwd ?? root,
    stdout: invocation.stdout ?? "pipe",
    stderr: invocation.stderr ?? "pipe",
    stdin: "inherit",
    env: environment,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    child.stdout ? new Response(child.stdout).text() : Promise.resolve(""),
    child.stderr ? new Response(child.stderr).text() : Promise.resolve(""),
    child.exited,
  ]);
  return { command, exitCode, stdout, stderr };
}
