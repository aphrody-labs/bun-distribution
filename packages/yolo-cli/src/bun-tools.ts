import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Reuse the configured fork's actual devtools owner while its built-ins await activation. */
export function bunToolArgv(
  bun: string,
  command: string,
  args: readonly string[],
  missingBuiltin: boolean,
  forkCheckout = process.env.APHRODY_BUN_CHECKOUT,
): string[] {
  if (missingBuiltin && forkCheckout) {
    const entry = join(forkCheckout, "src", "js", "eval", "devtools.ts");
    if (!existsSync(entry)) throw new Error(`Configured Bun fork has no devtools owner: ${entry}`);
    return [bun, entry, command, ...args];
  }
  return [bun, command, ...args];
}

export async function runBunTool(command: string, args: readonly string[], cwd: string): Promise<number> {
  const bun = Bun.which("bun") ?? process.execPath;
  // A package script named after the built-in (the checkout's `docs`, `bench`) shadows it; Bun keeps the built-in
  // when the running lifecycle event carries the command's own name.
  const env = { ...process.env, BUN_BE_BUN: "1", npm_lifecycle_event: command };
  // Probe help only: never replay a potentially mutating command after it fails.
  const probe = Bun.spawnSync([bun, command, "--help"], {
    windowsHide: true,
    cwd: tmpdir(),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const missingBuiltin = probe.exitCode !== 0 && probe.stderr.toString().includes("Script not found");
  const argv = bunToolArgv(bun, command, args, missingBuiltin);
  await using proc = Bun.spawn({
    windowsHide: true,
    cmd: argv,
    cwd,
    // A compiled yolo falls back to its own runtime, which BUN_BE_BUN turns back into the bun CLI.
    env,
    stdio: ["inherit", "inherit", "inherit"],
  });
  return await proc.exited;
}
