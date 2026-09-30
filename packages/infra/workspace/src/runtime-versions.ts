function version(binary: string): string {
  const result = Bun.spawnSync([binary, "--version"], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`${binary} --version failed`);
  return new TextDecoder().decode(result.stdout).trim();
}

export function runRuntimeVersions(args: string[]): number {
  let bunExpected = "1.4.2";
  let uvExpected = "0.12.17";
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--bun") bunExpected = args[++index] ?? "";
    else if (arg === "--uv") uvExpected = args[++index] ?? "";
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: aphrody-ops runtime-versions [--bun <version>] [--uv <version>]");
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  const bun = version("bun");
  const uv = version("uv");
  if (bun !== bunExpected) throw new Error(`Bun expected ${bunExpected}, found ${bun}`);
  if (!uv.startsWith(`uv ${uvExpected} `))
    throw new Error(`uv expected ${uvExpected}, found ${uv}`);
  console.log(JSON.stringify({ bun, uv, status: "PASS" }));
  return 0;
}
