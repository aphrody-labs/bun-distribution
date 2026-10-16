import type { Subprocess } from "bun";
import { realpathSync, rmSync } from "node:fs";
import { basename, dirname } from "node:path";
import { tmpdir } from "node:os";

export async function stopTestBrowser(
  child: Pick<Subprocess, "pid" | "exitCode" | "kill" | "exited">,
  profile: string,
) {
  if (process.platform === "win32" && child.exitCode === null) {
    Bun.spawnSync(["taskkill", "/PID", String(child.pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
    });
  } else child.kill();
  await child.exited;
  const canonical = realpathSync(profile);
  const parent = realpathSync(tmpdir());
  if (
    dirname(canonical).toLowerCase() !== parent.toLowerCase() ||
    !basename(canonical).startsWith("iecode-chromium-smoke-")
  )
    throw new Error("Unexpected browser test profile cleanup target");
  rmSync(canonical, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
