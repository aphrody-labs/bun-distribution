// SPDX-License-Identifier: Apache-2.0
// Body of the \Aphrody\Container task: the complete Aphrody container (compose profile `pc`) as a PC service, on the
// owner PC and on Omar's PC. Waits for the Docker engine (starting Docker Desktop once, hidden), brings the `pc`
// service up on the loopback API, then stays alive while the container runs so the task reports Running.
//
//   bun scripts/install/container-service.ts [--pc local|omar] [--compose <file>]
//
// Registration: boot catalog entry `Container` (tools/config/service-catalog.json), applied by
// `aphrody infra boot apply --host local --entry Container`: hidden Interactive task at logon, program wrapped in
// `conhost.exe --headless`, so no window appears. `--pc` defaults to APHRODY_PC (user variable, `omar` on Omar's PC)
// then `local`. The per-PC bearer token is generated once in ~/.aphrody/private/aphrody_mcp_http_token (owner-only
// ACL) and never printed. The image must already be loaded (scripts/release/container-image.ts ship) or buildable.
// oxlint-disable no-await-in-loop -- polls the Docker engine until it answers.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const CONTAINER = "aphrody-pc";
const ENGINE_WAIT_MS = 10 * 60_000;

export function tokenPath(home: string): string {
  return join(home, ".aphrody", "private", "aphrody_mcp_http_token");
}

/** Owner-only ACL on Windows (no inherited entries); 0600 elsewhere through the write mode. */
async function restrict(path: string): Promise<void> {
  if (process.platform !== "win32") return;
  const user = process.env.USERNAME;
  if (!user) throw new Error("USERNAME is not set: cannot restrict the token ACL");
  const proc = Bun.spawn(["icacls", path, "/inheritance:r", "/grant:r", `${user}:(R,W)`], {
    stdout: "ignore",
    stderr: "pipe",
    windowsHide: true,
  });
  if ((await proc.exited) !== 0)
    throw new Error(`icacls ${path}: ${(await new Response(proc.stderr).text()).trim()}`);
}

/**
 * Returns the per-PC token, creating it once. A token left by the former runner in `~/.aphrodyprivate` is moved
 * (same value, so existing clients keep working).
 */
export async function ensureToken(home: string, acl = restrict): Promise<string> {
  const path = tokenPath(home);
  const legacy = join(home, ".aphrodyprivate", "aphrody_mcp_http_token");
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(legacy)) {
      renameSync(legacy, path);
      try {
        rmdirSync(dirname(legacy));
      } catch {
        // other files remain there
      }
    } else {
      writeFileSync(path, randomBytes(32).toString("hex"), { mode: 0o600 });
    }
    await acl(path);
  }
  const token = readFileSync(path, "utf8").trim();
  if (!/^[0-9a-f]{32,}$/i.test(token)) throw new Error(`${path} does not hold a hex token`);
  return token;
}

export function composeUp(compose: string): string[] {
  return ["docker", "compose", "-f", compose, "--profile", "pc", "up", "-d", "--no-build", "pc"];
}

async function quiet(argv: string[], env?: Record<string, string>): Promise<number> {
  const proc = Bun.spawn(argv, {
    env: env ? { ...process.env, ...env } : undefined,
    stdout: "ignore",
    stderr: "ignore",
    windowsHide: true,
  });
  return proc.exited;
}

export async function waitEngine(): Promise<void> {
  const deadline = Date.now() + ENGINE_WAIT_MS;
  let started = false;
  while ((await quiet(["docker", "info"])) !== 0) {
    if (!started && process.platform === "win32") {
      const desktop = join(
        process.env.ProgramFiles ?? "C:\\Program Files",
        "Docker",
        "Docker",
        "Docker Desktop.exe",
      );
      if (existsSync(desktop))
        spawn(desktop, [], { detached: true, stdio: "ignore", windowsHide: true }).unref();
      started = true;
    }
    if (Date.now() > deadline) throw new Error("docker engine unavailable after 10 minutes");
    await Bun.sleep(5_000);
  }
}

export async function main(argv = Bun.argv.slice(2)): Promise<number> {
  if (argv[0] === "--mesh") return (await import("./mesh-supervisor.ts")).main(argv.slice(1));
  const value = (flag: string) => {
    const at = argv.indexOf(flag);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const pc = value("--pc") ?? process.env.APHRODY_PC ?? "local";
  if (!/^[a-z0-9-]+$/.test(pc)) throw new Error(`invalid --pc ${pc}`);
  const compose = resolve(
    value("--compose") ??
      join(import.meta.dir, "..", "..", "tools", "config", "container", "compose.yaml"),
  );
  if (!existsSync(compose)) throw new Error(`compose file not found: ${compose}`);
  const env = { APHRODY_PC: pc, APHRODY_MCP_HTTP_TOKEN: await ensureToken(homedir()) };
  await waitEngine();
  const up = Bun.spawn(composeUp(compose), {
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
    windowsHide: true,
  });
  const code = await up.exited;
  if (code !== 0) return code;
  console.log(`${CONTAINER} up (pc=${pc}); waiting for it to stop`);
  // The task restarts on failure: returning 1 when the container stops brings it back.
  await quiet(["docker", "wait", CONTAINER]);
  return 1;
}

if (import.meta.main) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`container-service: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
