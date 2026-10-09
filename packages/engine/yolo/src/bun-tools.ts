/**
 * `yolo rename|parse|docs|bench` run the built-in commands of the Bun fork (`bun rename`, `bun parse`,
 * `bun docs`, `bun bench`, src/js/eval/devtools.ts in aphrody-labs/bun). An upstream Bun on PATH
 * lacks them and treats the name as a script.
 */
export async function runBunTool(command: string, args: readonly string[], cwd: string): Promise<number> {
  const bun = Bun.which("bun") ?? process.execPath;
  await using proc = Bun.spawn({
    cmd: [bun, command, ...args],
    cwd,
    // A compiled yolo falls back to its own runtime, which BUN_BE_BUN turns back into the bun CLI.
    env: { ...process.env, BUN_BE_BUN: "1" },
    stdio: ["inherit", "inherit", "inherit"],
  });
  return await proc.exited;
}
