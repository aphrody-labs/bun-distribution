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

/** Use the checkout's current Rust source by default; opt into an installed binary explicitly. */
export async function infraExecutable(root = infraRoot()): Promise<string[]> {
  if (!process.env.APHRODY_INFRA_BIN && process.env.APHRODY_INFRA_USE_INSTALLED !== "1") {
    return ["cargo", "run", "--quiet", "--bin", "aphrody-infra", "--"];
  }
  const home = process.env.HOME;
  for (const candidate of [
    process.env.APHRODY_INFRA_BIN,
    home && join(home, ".local", "bin", "aphrody-infra"),
    join(root, "target", "release", "aphrody-infra"),
    join(root, "target", "debug", "aphrody-infra"),
    Bun.which("aphrody-infra"),
  ]) {
    const direct = await executable(candidate);
    if (direct) return [direct];
  }
  return ["cargo", "run", "--quiet", "--bin", "aphrody-infra", "--"];
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
