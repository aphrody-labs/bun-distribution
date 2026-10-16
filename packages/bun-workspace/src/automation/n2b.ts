export async function runN2b(args: string[]): Promise<number> {
  const child = Bun.spawn([process.execPath, "n2b", ...args], {
    windowsHide: true,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}
