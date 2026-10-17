// SPDX-License-Identifier: Apache-2.0
/**
 * The play NGINX engine, owned through `bun:nginx`: the pinned vendor/nginx + vendor/ngx-rust
 * executable with the Bun Rust module (`bun_nginx`), in a prefix this service owns. The template
 * lives in infra/config/host/nginx/play/engine.conf; this module renders it, validates, starts,
 * reloads (SIGHUP) and quits it, and reads the module's metadata with `readModuleInfo()`.
 */
import Nginx from "bun:nginx";

type NginxController = Nginx;
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readModuleInfo } from "../../../../toolchains/bun/packages/bun-nginx/src/module";
import { config } from "./config";

export interface EngineState {
  enabled: boolean;
  running: boolean;
  pid: number | null;
  version: string | null;
  capabilities: Record<string, unknown> | null;
  module: Awaited<ReturnType<typeof readModuleInfo>> | null;
  lastReload: string | null;
  error: string | null;
}

const state: EngineState = {
  enabled: config.nginx.enabled,
  running: false,
  pid: null,
  version: null,
  capabilities: null,
  module: null,
  lastReload: null,
  error: null,
};
let controller: NginxController | null = null;

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * A crashed controller leaves `.bun-nginx-owner` and `bun-nginx.pid`. They are removed only when
 * neither the recorded Bun owner nor the recorded master is alive (systemd's control group stops
 * both together), so a live foreign owner is never adopted.
 */
function recoverPrefix(prefix: string): void {
  const owner = join(prefix, ".bun-nginx-owner");
  const pidFile = join(prefix, "bun-nginx.pid");
  const ownerPid = existsSync(owner)
    ? Number(JSON.parse(readFileSync(owner, "utf8") || "{}").bunPID)
    : 0;
  const masterPid = existsSync(pidFile)
    ? Number(readFileSync(pidFile, "utf8").trim())
    : 0;
  if (ownerPid && ownerPid !== process.pid && isAlive(ownerPid))
    throw new Error(
      `NGINX prefix ${prefix} is owned by live process ${ownerPid}`,
    );
  if (masterPid && isAlive(masterPid))
    throw new Error(
      `NGINX master ${masterPid} from a previous owner is still alive`,
    );
  rmSync(owner, { force: true });
  rmSync(pidFile, { force: true });
}

function render(): string {
  const { nginx } = config;
  const values: Record<string, string> = {
    PREFIX: nginx.prefix,
    PUBLIC_ROOT: config.publicDir,
    EMULATION_ROOT: config.emulationDir,
    APP_UPSTREAM: `${config.hostname}:${config.port}`,
    LISTEN_LOOPBACK: nginx.loopbackListen,
    LISTEN_TUNNEL: nginx.tunnelListen,
    INFO_PORT: String(nginx.infoPort),
    PUBLIC_ORIGIN: config.publicOrigin,
  };
  return readFileSync(nginx.template, "utf8").replace(
    /\$\{([A-Z_]+)\}/g,
    (match, name: string) => {
      const value = values[name];
      if (value === undefined)
        throw new Error(`engine.conf: unknown placeholder ${match}`);
      return value;
    },
  );
}

async function writeConfig(): Promise<void> {
  for (const dir of ["conf", "logs", "temp"])
    mkdirSync(join(config.nginx.prefix, dir), { recursive: true });
  await Bun.write(join(config.nginx.prefix, "conf", "nginx.conf"), render());
}

async function refreshModule(): Promise<void> {
  if (!controller) return;
  const status = await controller.status();
  state.running = status.running;
  state.pid = status.pid;
  state.module = await readModuleInfo(
    controller,
    `http://127.0.0.1:${config.nginx.infoPort}/_bun/info`,
    {
      timeoutMs: 2000,
    },
  );
}

export async function startEngine(log: (line: string) => void): Promise<void> {
  if (!state.enabled) return;
  const { binary, prefix } = config.nginx;
  try {
    const provider = await Nginx.probe({ binary, timeoutMs: 5000 });
    if (!provider.available) throw new Error(provider.message);
    state.version = provider.version;
    state.capabilities = { ...provider.capabilities };
    recoverPrefix(prefix);
    await writeConfig();
    controller = await Nginx.create({
      binary,
      prefix,
      configFile: "conf/nginx.conf",
      timeoutMs: 10_000,
    });
    await controller.validate();
    const started = await controller.start();
    log(
      `[play] nginx engine ${state.version ?? ""} started, master ${started.pid}`,
    );
    await refreshModule();
    log(
      `[play] bun_nginx module ${state.module?.module} nginx ${state.module?.nginxVersion} master ${state.module?.masterPID}`,
    );
    state.error = null;
  } catch (error) {
    state.error =
      error instanceof Error
        ? `${(error as { code?: string }).code ?? "Error"}: ${error.message}`
        : String(error);
    log(`[play] nginx engine failed: ${state.error}`);
    throw error;
  }
}

/** Re-renders the configuration, validates it and reloads the same master. */
export async function reloadEngine(): Promise<EngineState> {
  if (!controller) throw new Error("NGINX engine is not running");
  await writeConfig();
  await controller.validate();
  await controller.reload();
  state.lastReload = new Date().toISOString();
  await refreshModule();
  return engineState();
}

export async function stopEngine(): Promise<void> {
  if (!controller) return;
  const owned = controller;
  controller = null;
  await owned.close().catch(() => undefined);
  state.running = false;
  state.pid = null;
}

export async function engineState(): Promise<EngineState> {
  if (controller)
    await refreshModule().catch((error) => (state.error = String(error)));
  return { ...state };
}
