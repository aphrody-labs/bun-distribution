export async function runN2b(args: string[]): Promise<number> {
  const binary = process.env.N2B_BIN ?? Bun.which("n2b");
  if (!binary)
    throw new Error(
      "n2b is unavailable; install the Aphrody Compat release or set N2B_BIN",
    );
  const child = Bun.spawn([binary, ...args], {
    windowsHide: true,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}
