import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
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

export function infraRoot(): string {
  // From source the checkout is four levels up; in a compiled executable import.meta.dir is virtual,
  // so APHRODY_ROOT or the checkout enclosing the working directory decides.
  const env = process.env.APHRODY_ROOT?.trim();
  if (env) return resolve(env);
  const fromSource = resolve(import.meta.dir, "..", "..", "..", "..");
  if (existsSync(join(fromSource, "tools", "config"))) return fromSource;
  return findWorkspaceRoot();
}

async function executable(path: string | null | undefined): Promise<string | undefined> {
  return path && (await Bun.file(path).exists()) ? path : undefined;
}

/** Installed runtime by default; source compilation requires explicit development opt-in. */
export async function infraExecutable(
  root = infraRoot(),
  environment: Record<string, string | undefined> = process.env,
): Promise<string[]> {
  if (environment.APHRODY_INFRA_BIN) {
    const direct = await executable(environment.APHRODY_INFRA_BIN);
    if (!direct)
      throw new Error(`Configured Infra binary is missing: ${environment.APHRODY_INFRA_BIN}`);
    return [direct];
  }
  if (environment.APHRODY_INFRA_BUILD_FROM_SOURCE === "1") {
    if (environment.APHRODY_NO_BUILD === "1")
      throw new Error("Source compilation is disabled by APHRODY_NO_BUILD=1");
    return [
      join(root, "scripts/build/rust/cargo-serial.sh"),
      "run",
      "--quiet",
      "--locked",
      "--bin",
      "aphrody",
      "--",
      "infra",
    ];
  }
  if (environment.APHRODY_BIN) {
    const direct = await executable(environment.APHRODY_BIN);
    if (!direct)
      throw new Error(`Configured Aphrody binary is missing: ${environment.APHRODY_BIN}`);
    return [direct, "infra"];
  }
  const suffix = process.platform === "win32" ? ".exe" : "";
  const home = environment.HOME ?? environment.USERPROFILE;
  const canonical = await Promise.all(
    [
      Bun.which(`aphrody${suffix}`, { PATH: environment.PATH ?? "" }),
      process.platform === "win32" && environment.LOCALAPPDATA
        ? join(environment.LOCALAPPDATA, "Aphrody", "bin", "aphrody.exe")
        : undefined,
      home && join(home, ".aphrody", "bin", `aphrody${suffix}`),
      home && join(home, ".local", "bin", `aphrody${suffix}`),
    ].map(executable),
  );
  const canonicalExecutable = canonical.find((path) => path !== undefined);
  if (canonicalExecutable) return [canonicalExecutable, "infra"];
  const name = `aphrody-infra${suffix}`;
  for (const candidate of [
    home && join(home, ".local", "bin", name),
    Bun.which(name, { PATH: environment.PATH ?? "" }),
  ]) {
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
  if (ssh !== "ssh" || exec !== "exec" || hostFlag !== "--host" || cmdFlag !== "--cmd")
    return undefined;
  if (!host || !script || environment.APHRODY_BUILD_HOST !== host) return undefined;
  const seconds = Number(environment.APHRODY_SSH_COMMAND_TIMEOUT_SECS ?? "30");
  const deadline = Number.isInteger(seconds) && seconds >= 1 && seconds <= 86400 ? seconds : 30;
  return ["timeout", String(deadline), "bash", "-c", script];
}

export async function runInfra(invocation: InfraInvocation): Promise<InfraResult> {
  const root = infraRoot();
  const environment = { ...process.env, ...invocation.env };
  const command = localHostCommand(invocation.args, environment) ?? [
    ...(await infraExecutable(root, environment)),
    "--root",
    root,
    ...invocation.args,
  ];
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
