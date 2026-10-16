// SPDX-License-Identifier: Apache-2.0
import { openSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { killWithThisProcess } from "./win32-net";

/** Scheduled tasks must own their SSH descendants when stopped or restarted. */
export async function runOwnedTunnel(
  argv: string[],
  cwd: string,
  logPath: string,
): Promise<number> {
  if (process.platform !== "win32")
    throw new Error("Windows task ownership required");
  const output = openSync(logPath, "a", 0o600);
  const child = Bun.spawn(argv, {
    cwd,
    stdin: "ignore",
    stdout: output,
    stderr: output,
    windowsHide: true,
  });
  try {
    killWithThisProcess(child.pid);
    return await child.exited;
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await child.exited;
    }
    closeSync(output);
  }
}

if (import.meta.main) {
  const repository = resolve(import.meta.dir, "../../../../docs/aphrody");
  const installed = join(homedir(), "AppData/Local/Aphrody/bin/aphrody.exe");
  const executable =
    Bun.which("aphrody") ??
    ((await Bun.file(installed).exists()) ? installed : null);
  if (!executable)
    throw new Error("Installed Aphrody Infra executable required");
  const command = [
    executable,
    "infra",
    "--root",
    repository,
    "ssh",
    "tunnel",
    "--catalog",
    join(repository, "tools/config/hub-tunnel-catalog.json"),
    "--services",
    "vps-hub-a2a,vps-hub-mcp",
    "--offset",
    "1000",
  ];
  process.exitCode = await runOwnedTunnel(
    command,
    repository,
    join(homedir(), ".aphrody/logs/hub-tunnel.log"),
  );
}
