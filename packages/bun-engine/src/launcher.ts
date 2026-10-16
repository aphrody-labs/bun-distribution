import { policyFor } from "./catalog";

export function launchCommand(appId: string, steam = "steam"): string[] {
  const policy = policyFor(appId);
  if (policy.support === "blocked") throw new Error(policy.name + " is blocked: " + policy.reason);
  return [steam, "-applaunch", appId];
}

export async function launch(appId: string): Promise<number> {
  const proc = Bun.spawn({ cmd: launchCommand(appId), stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  return await proc.exited;
}

export async function trace(appId: string, logDirectory = process.cwd()): Promise<number> {
  const proc = Bun.spawn({
    cmd: launchCommand(appId),
    env: { ...process.env, PROTON_LOG: "1", PROTON_LOG_DIR: logDirectory },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}
