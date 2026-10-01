import { join, resolve } from "node:path";

export type InfraInvocation = {
  args: string[];
  cwd?: string;
  stdout?: "inherit" | "pipe";
  stderr?: "inherit" | "pipe";
};

export type InfraResult = {
  command: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
};

export function infraRoot(): string {
  return resolve(import.meta.dir, "..", "..", "..", "..");
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
      "aphrody-infra",
      "--",
    ];
  }
  const name = `aphrody-infra${process.platform === "win32" ? ".exe" : ""}`;
  const home = environment.HOME ?? environment.USERPROFILE;
  for (const candidate of [
    home && join(home, ".local", "bin", name),
    Bun.which(name, { PATH: environment.PATH ?? "" }),
  ]) {
    const direct = await executable(candidate);
    if (direct) return [direct];
  }
  throw new Error(
    "Infra binary is not installed; set APHRODY_INFRA_BIN or explicitly enable APHRODY_INFRA_BUILD_FROM_SOURCE=1 for development",
  );
}

export async function runInfra(invocation: InfraInvocation): Promise<InfraResult> {
  const root = infraRoot();
  const command = [...(await infraExecutable(root)), "--root", root, ...invocation.args];
  const child = Bun.spawn(command, {
    cwd: invocation.cwd ?? root,
    stdout: invocation.stdout ?? "pipe",
    stderr: invocation.stderr ?? "pipe",
    stdin: "inherit",
    env: process.env,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    child.stdout ? new Response(child.stdout).text() : Promise.resolve(""),
    child.stderr ? new Response(child.stderr).text() : Promise.resolve(""),
    child.exited,
  ]);
  return { command, exitCode, stdout, stderr };
}
