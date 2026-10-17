import { launchTuning } from "@aphrody/bun-steam";
import { policyFor } from "./catalog";

export function launchCommand(appId: string, steam = "steam"): string[] {
  const policy = policyFor(appId);
  if (policy.support === "blocked")
    throw new Error(policy.name + " is blocked: " + policy.reason);
  return [steam, "-applaunch", appId];
}

/** Launches through the Steam client with the Bun OS Proton tuning of this host (bun-steam). */
export async function launch(appId: string): Promise<number> {
  const proc = Bun.spawn({
    cmd: launchCommand(appId),
    env: { ...process.env, ...launchTuning().env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}

export async function trace(
  appId: string,
  logDirectory = process.cwd(),
): Promise<number> {
  const proc = Bun.spawn({
    cmd: launchCommand(appId),
    env: {
      ...process.env,
      ...launchTuning().env,
      PROTON_LOG: "1",
      PROTON_LOG_DIR: logDirectory,
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}
