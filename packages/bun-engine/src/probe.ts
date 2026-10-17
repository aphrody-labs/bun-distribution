import { existsSync } from "node:fs";
import { join } from "node:path";
import { findSteamcmd, IS_WINDOWS, resolveSteamRoot } from "@aphrody/bun-steam";

export interface ProbeResult {
  platform: NodeJS.Platform;
  steam: string | null;
  steamcmd: string | null;
  vulkan: string | null;
  kernel: string | null;
  userNamespaces: string | null;
}

async function commandPath(name: string): Promise<string | null> {
  const finder =
    process.platform === "win32"
      ? ["where.exe", name]
      : ["sh", "-lc", "command -v " + name];
  const result = Bun.spawnSync({
    cmd: finder,
    stdout: "pipe",
    stderr: "ignore",
  });
  return result.exitCode === 0
    ? result.stdout.toString().trim().split(/\r?\n/)[0] || null
    : null;
}

export async function probeHost(): Promise<ProbeResult> {
  const client = join(
    resolveSteamRoot(),
    IS_WINDOWS ? "steam.exe" : "steam.sh",
  );
  const steam = existsSync(client) ? client : await commandPath("steam");
  const steamcmd = findSteamcmd()?.exe ?? null;
  const vulkan = await commandPath("vulkaninfo");
  if (process.platform !== "linux") {
    return {
      platform: process.platform,
      steam,
      steamcmd,
      vulkan,
      kernel: null,
      userNamespaces: null,
    };
  }
  const kernel =
    Bun.spawnSync({ cmd: ["uname", "-r"], stdout: "pipe" })
      .stdout.toString()
      .trim() || null;
  const namespaces = Bun.file("/proc/sys/kernel/unprivileged_userns_clone");
  return {
    platform: process.platform,
    steam,
    steamcmd,
    vulkan,
    kernel,
    userNamespaces: (await namespaces.exists())
      ? (await namespaces.text()).trim()
      : null,
  };
}
