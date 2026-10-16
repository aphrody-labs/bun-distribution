import { readFileSync } from "node:fs";

function version(binary: string): string {
  const result = Bun.spawnSync([binary, "--version"], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(`${binary} --version failed`);
  return new TextDecoder().decode(result.stdout).trim();
}

export function runRuntimeVersions(args: string[]): number {
  // The pins live in tools/config/system-packages.json (kept in step by `yolo update pins`).
  const pins = JSON.parse(
    readFileSync(
      new URL(
        "../../../tools/aphrody/config/system-packages.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    toolchains: { bun: { version: string }; uv: { version: string } };
  };
  let bunExpected = pins.toolchains.bun.version;
  let uvExpected = pins.toolchains.uv.version;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--bun") bunExpected = args[++index] ?? "";
    else if (arg === "--uv") uvExpected = args[++index] ?? "";
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: yolo ops runtime-versions [--bun <version>] [--uv <version>]",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  const bun = version("bun");
  const uv = version("uv");
  if (bun !== bunExpected)
    throw new Error(`Bun expected ${bunExpected}, found ${bun}`);
  if (!uv.startsWith(`uv ${uvExpected} `))
    throw new Error(`uv expected ${uvExpected}, found ${uv}`);
  console.log(JSON.stringify({ bun, uv, status: "PASS" }));
  return 0;
}
