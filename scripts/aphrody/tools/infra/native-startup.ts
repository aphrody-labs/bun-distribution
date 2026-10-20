// SPDX-License-Identifier: Apache-2.0
/**
 * Native Aphrody startup on Windows, without PowerShell.
 *
 *   bun --no-env-file scripts/tools/infra/native-startup.ts plan   [--config <path>]
 *   bun --no-env-file scripts/tools/infra/native-startup.ts health [--config <path>]
 *   bun --no-env-file scripts/tools/infra/native-startup.ts run <id> --config <path>
 *
 * The host configuration (default `<APHRODY_HOME|~/.aphrody>/host/aphrody-startup.json`, schema
 * infra/config/host/windows/aphrody-startup.schema.json) declares the services. The hidden
 * `\Aphrody\Native\<id>` task that runs `run <id>` is a boot catalog entry
 * (infra/config/service-catalog.json) registered by `aphrody infra boot apply --entry <id>`;
 * `plan` checks that entry against the declared principal and trigger.
 *
 * `run` starts only the declared native executable (no console, inside a kill-on-close job),
 * waits up to 30 s for exactly one listener owned by that child, probes its health path,
 * atomically records `<service home>/run/native-services/<id>.json` and waits for the child.
 * `--no-env-file` keeps the checkout `.env` out of the service environment.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Subprocess } from "bun";
import { killWithThisProcess, type Listener, normalizeAddress, processStartedAt, tcpListeners } from "./win32-net.ts";

const repo = resolve(import.meta.dir, "../../../../");
export const TASK_PATH = "\\Aphrody\\Native\\";
const SCHEMA = join(repo, "infra/config/host/windows/aphrody-startup.schema.json");
const CATALOG = join(repo, "infra/config/service-catalog.json");
const SERVICE_ACCOUNTS = new Set(["SYSTEM", "LOCAL SERVICE", "NETWORK SERVICE"]);
const LISTENER_FLAG = /^--(?:bind|listen|host|hostname|port|app)(?:=|$)/;

export type Principal = {
  userId: string;
  logonType: "Interactive" | "S4U" | "ServiceAccount";
  runLevel: "Limited" | "Highest";
};
export type Trigger = { kind: "logon" | "boot" };
export type Service = {
  id: string;
  kind: "site" | "mcp" | "a2a";
  executable: string;
  enabled: boolean;
  bind: string;
  port: number;
  desiredPort?: number;
  home?: string;
  principal?: Principal;
  trigger?: Trigger;
  existingTask?: { path: string; name: string };
  arguments: string[];
  healthPath: string;
};
export type Config = {
  version: 1;
  home: string;
  root: string;
  principal: Principal;
  trigger: Trigger;
  services: Service[];
};
/** A service with its effective principal, trigger and home. */
export type Resolved = {
  service: Service;
  principal: Principal;
  trigger: Trigger;
  home: string;
};
export type BootTask = {
  host: string;
  kind: string;
  name?: string;
  path?: string;
  triggers?: string[];
  arguments?: string;
  principal?: string;
  runLevel?: string;
  desktop?: boolean;
};
export type Registry = {
  id: string;
  kind: Service["kind"];
  pid: number;
  processStartedAt: string;
  address: string;
  port: number;
  url: string;
  healthStatus: number | null;
  healthy: boolean;
  observedAt: string;
};

type Schema = {
  $ref?: string;
  type?: string;
  const?: unknown;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;
  items?: Schema;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
};

/** Draft-07 subset used by the startup schema (types, const/enum, bounds, pattern, local $ref). */
export function schemaErrors(value: unknown, schema: Schema, root = schema, at = "$"): string[] {
  if (schema.$ref) {
    const target = schema.$ref
      .replace(/^#\//, "")
      .split("/")
      .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], root);
    return schemaErrors(value, target as Schema, root, at);
  }
  const kind = Array.isArray(value)
    ? "array"
    : value === null
      ? "null"
      : Number.isInteger(value)
        ? "integer"
        : typeof value;
  if (schema.type && kind !== schema.type && !(schema.type === "number" && kind === "integer"))
    return [`${at} : ${schema.type} attendu`];
  const errors: string[] = [];
  const fail = (why: string) => errors.push(`${at} : ${why}`);
  if ("const" in schema && value !== schema.const) fail(`${JSON.stringify(schema.const)} attendu`);
  if (schema.enum && !schema.enum.includes(value)) fail(`valeur hors de ${JSON.stringify(schema.enum)}`);
  if (typeof value === "string") {
    if (value.length < (schema.minLength ?? 0)) fail("trop court");
    if (value.length > (schema.maxLength ?? Infinity)) fail("trop long");
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) fail(`hors du motif ${schema.pattern}`);
  }
  if (typeof value === "number") {
    if (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) fail("hors bornes");
  }
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity))
      fail("nombre d'éléments hors bornes");
    if (schema.items) {
      const items = schema.items;
      value.forEach((item, i) => errors.push(...schemaErrors(item, items, root, `${at}[${i}]`)));
    }
  }
  if (kind === "object") {
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in object)) fail(`${key} requis`);
    for (const [key, item] of Object.entries(object)) {
      const property = schema.properties?.[key];
      if (property) errors.push(...schemaErrors(item, property, root, `${at}.${key}`));
      else if (schema.additionalProperties === false) fail(`propriété ${key} non déclarée`);
    }
  }
  return errors;
}

/** Fully qualified path (drive or UNC on Windows), never relative to a drive or cwd. */
export function qualified(path: string): boolean {
  return process.platform === "win32" ? /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/])/.test(path) : path.startsWith("/");
}

function isLoopback(address: string): boolean {
  return isIP(address) === 4 ? address.startsWith("127.") : normalizeAddress(address) === "::1";
}

const isDirectory = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** Checks the declaration beyond the schema and resolves each service's principal, trigger and home. */
export function resolveServices(config: Config, isDir: (path: string) => boolean = isDirectory): Resolved[] {
  for (const directory of [config.home, config.root])
    if (!qualified(directory) || !isDir(directory))
      throw new Error("home et root doivent être des répertoires absolus existants");
  const ids = new Set<string>();
  const ports = new Set<number>();
  return config.services.map(service => {
    const principal = service.principal ?? config.principal;
    const trigger = service.trigger ?? config.trigger;
    if (trigger.kind === "boot" && principal.logonType === "Interactive")
      throw new Error(`${service.id} : un principal Interactive exige un déclencheur logon`);
    if (principal.logonType === "ServiceAccount") {
      if (!SERVICE_ACCOUNTS.has(principal.userId))
        throw new Error(`${service.id} : compte de service invalide ${principal.userId}`);
      if (!service.home)
        throw new Error(`${service.id} : un compte de service exige son propre home, pas celui de l'utilisateur`);
    }
    const home = service.home ?? config.home;
    if (!qualified(home) || !isDir(home))
      throw new Error(`${service.id} : le home du service doit être un répertoire absolu existant`);
    if (service.kind !== "site" && (principal.logonType !== "Interactive" || trigger.kind !== "logon"))
      throw new Error(`${service.id} : MCP/A2A exigent le profil Interactive/logon de l'utilisateur`);
    if (ids.has(service.id)) throw new Error(`identifiant de service dupliqué ${service.id}`);
    ids.add(service.id);
    if (!qualified(service.executable) || service.executable.includes('"'))
      throw new Error(`${service.id} : l'exécutable doit être un chemin absolu sans guillemet`);
    if (!isIP(service.bind)) throw new Error(`${service.id} : bind doit être une adresse IP littérale`);
    if (service.kind !== "site" && !isLoopback(service.bind))
      throw new Error(`${service.id} : MCP et A2A écoutent en loopback ; seul le site peut être public`);
    if (service.port !== 0) {
      if (ports.has(service.port)) throw new Error(`port fixe ${service.port} déclaré deux fois`);
      ports.add(service.port);
    }
    for (const argument of service.arguments)
      if (LISTENER_FLAG.test(argument) || argument.includes("\0"))
        throw new Error(`${service.id} : l'écoute se déclare par bind/port, pas par argument (${argument})`);
    return { service, principal, trigger, home };
  });
}

export function loadConfig(path: string): Config {
  const config = JSON.parse(readFileSync(path, "utf8")) as Config;
  const errors = schemaErrors(config, JSON.parse(readFileSync(SCHEMA, "utf8")) as Schema);
  if (errors.length) throw new Error(`configuration de démarrage invalide :\n  ${errors.join("\n  ")}`);
  return config;
}

/** The boot catalog entry registering `\Aphrody\Native\<id>`, and how it departs from the declaration. */
export function bootEntry(resolved: Resolved, entries: BootTask[]): { entry: string | null; drift: string[] } {
  const { service, principal, trigger } = resolved;
  const entry = entries.find(
    e =>
      e.kind === "scheduledTask" &&
      e.host === "local" &&
      e.name === service.id &&
      (e.path ?? "\\Aphrody\\") === TASK_PATH,
  );
  if (!entry)
    return {
      entry: null,
      drift: [`aucune entrée de boot ${TASK_PATH}${service.id}`],
    };
  const drift: string[] = [];
  const system = principal.logonType === "ServiceAccount";
  if (system && principal.userId !== "SYSTEM")
    drift.push(`principal ${principal.userId} non pris en charge par aphrody infra boot`);
  if ((entry.principal ?? "system") !== (system ? "system" : "user"))
    drift.push(`principal ${entry.principal ?? "system"} au lieu de ${principal.logonType}`);
  if (!system && Boolean(entry.desktop) !== (principal.logonType === "Interactive"))
    drift.push(`desktop ${Boolean(entry.desktop)} au lieu de ${principal.logonType}`);
  if (!system && (entry.runLevel ?? "highest") !== principal.runLevel.toLowerCase())
    drift.push(`runLevel ${entry.runLevel ?? "highest"} au lieu de ${principal.runLevel}`);
  const wanted = trigger.kind === "boot" ? "atStartup" : "atLogon";
  if (!entry.triggers?.includes(wanted)) drift.push(`déclencheur ${wanted} absent`);
  if (!entry.arguments?.includes(`native-startup.ts run ${service.id} `))
    drift.push(`action différente de native-startup.ts run ${service.id}`);
  return { entry: `${entry.host}:${entry.name}`, drift };
}

export function bootTasks(): BootTask[] {
  const catalog = JSON.parse(readFileSync(CATALOG, "utf8")) as {
    boot?: { entries?: BootTask[] };
  };
  return catalog.boot?.entries ?? [];
}

export type Observe = {
  exists(path: string): boolean;
  listeners(): Listener[];
  taskExists(fullPath: string): boolean;
};

const schtasksQuery = (fullPath: string) =>
  Bun.spawnSync(["schtasks.exe", "/Query", "/TN", fullPath], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    windowsHide: true,
  }).exitCode === 0;

export const observeHost: Observe = {
  exists: existsSync,
  listeners: tcpListeners,
  taskExists: schtasksQuery,
};

export function plan(resolved: Resolved[], entries: BootTask[], observe: Observe = observeHost) {
  const listeners = observe.listeners();
  const on = (port: number) => listeners.filter(l => l.port === port);
  return resolved.map(r => {
    const { service } = r;
    const existingTask = service.existingTask ?? null;
    if (existingTask && !observe.taskExists(`${existingTask.path}${existingTask.name}`))
      throw new Error(
        `${service.id} : la tâche existante déclarée ${existingTask.path}${existingTask.name} est absente`,
      );
    const occupied = service.port === 0 ? [] : on(service.port);
    const reason = !service.enabled
      ? "declared-disabled"
      : !observe.exists(service.executable)
        ? "missing-executable"
        : occupied.length > 0
          ? "occupied-port"
          : "ready";
    const desiredPort = service.desiredPort ?? service.port;
    return {
      id: service.id,
      kind: service.kind,
      taskPath: TASK_PATH,
      enabled: reason === "ready",
      reason,
      bind: service.bind,
      port: service.port,
      listenerPids: [...new Set(occupied.map(l => l.pid))],
      principal: r.principal,
      trigger: r.trigger,
      existingTask,
      home: r.home,
      desiredPort,
      desiredPortBlocked: desiredPort !== service.port ? on(desiredPort).length > 0 : occupied.length > 0,
      boot: existingTask ? null : bootEntry(r, entries),
    };
  });
}

/** Address used to probe a listener bound to `bind`. */
export function probeHost(bind: string): string {
  if (bind === "0.0.0.0") return "127.0.0.1";
  if (bind === "::") return "[::1]";
  return bind.includes(":") ? `[${bind}]` : bind;
}

/** Program and arguments of a service: the owner command with its listener, then declared extras. */
export function serviceArgv(service: Service, root: string, home: string): string[] {
  const endpoint = service.bind.includes(":") ? `[${service.bind}]:${service.port}` : `${service.bind}:${service.port}`;
  const owner = {
    site: ["--root", root, "--bind", endpoint],
    mcp: ["http", "--bind", endpoint],
    a2a: ["a2a", "serve", "--bind", endpoint],
  }[service.kind];
  const extra = service.arguments.map(a => a.replaceAll("{{home}}", home).replaceAll("{{root}}", root));
  return [service.executable, ...owner, ...extra];
}

/** HTTP status of a bounded GET without following redirects, `null` when unreachable. */
export async function httpStatus(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    await response.body?.cancel();
    return response.status;
  } catch {
    return null;
  }
}

const healthy = (status: number | null) => status !== null && status >= 200 && status < 300;

export function registryPath(home: string, id: string): string {
  return join(home, "run", "native-services", `${id}.json`);
}

/** Writes the registry record atomically (temporary file, then replacing rename). */
export function writeRegistry(home: string, record: Registry): void {
  const directory = join(home, "run", "native-services");
  mkdirSync(directory, { recursive: true });
  const temporary = join(directory, `${record.id}.${crypto.randomUUID().replaceAll("-", "")}.tmp`);
  writeFileSync(temporary, JSON.stringify(record));
  renameSync(temporary, registryPath(home, record.id));
}

const owns = (service: Service, pid: number) => (l: Listener) =>
  l.pid === pid && (service.port === 0 || l.port === service.port) && l.address === normalizeAddress(service.bind);

/**
 * Starts `argv` (no console, killed with this process), waits up to `deadlineMs` for exactly one
 * listener owned by the child on the declared address, probes it and records the registry.
 * The child is stopped when activation fails; on success it is returned still running.
 */
export async function activate(
  r: Resolved,
  root: string,
  argv: string[],
  deadlineMs = 30_000,
): Promise<{ child: Subprocess; record: Registry }> {
  const { service, home } = r;
  // No credential is imported or copied: the task principal keeps its own protected stores.
  const child = Bun.spawn(argv, {
    cwd: root,
    env: { ...process.env, APHRODY_HOME: home, APHRODY_WORKSPACE_ROOT: root },
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
    windowsHide: true,
  });
  try {
    killWithThisProcess(child.pid);
    const deadline = Date.now() + deadlineMs;
    let owned: Listener[] = [];
    for (;;) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`${service.id} s'est arrêté avant d'ouvrir son listener déclaré`);
      owned = tcpListeners().filter(owns(service, child.pid));
      if (owned.length > 0 || Date.now() >= deadline) break;
      // oxlint-disable-next-line no-await-in-loop -- bounded wait for the child's own listener
      await Bun.sleep(200);
    }
    if (owned.length !== 1)
      throw new Error(`${service.id} : ${owned.length} listener(s) du processus enfant au lieu d'un seul`);
    const port = owned[0]!.port;
    const url = `http://${probeHost(service.bind)}:${port}`;
    const status = await httpStatus(`${url}${service.healthPath}`);
    const startedAt = processStartedAt(child.pid);
    if (!startedAt) throw new Error(`${service.id} : heure de démarrage du processus illisible`);
    const record: Registry = {
      id: service.id,
      kind: service.kind,
      pid: child.pid,
      processStartedAt: startedAt,
      address: service.bind,
      port,
      url,
      healthStatus: status,
      healthy: healthy(status),
      observedAt: new Date().toISOString(),
    };
    writeRegistry(home, record);
    return { child, record };
  } catch (error) {
    // Only the child owned by this runner is stopped on failed activation.
    child.kill();
    await child.exited;
    throw error;
  }
}

/** Health of each declared service; dynamic ports resolve through the live registry record. */
export async function health(resolved: Resolved[]) {
  const results: { id: string; status: number | null; healthy: boolean }[] = [];
  for (const { service, home } of resolved) {
    const down = { id: service.id, status: null, healthy: false };
    let port = service.port;
    if (port === 0) {
      const path = registryPath(home, service.id);
      if (!existsSync(path)) {
        results.push(down);
        continue;
      }
      const record = JSON.parse(readFileSync(path, "utf8")) as Registry;
      const live =
        processStartedAt(record.pid) === record.processStartedAt &&
        tcpListeners().some(l => l.pid === record.pid && l.port === record.port);
      if (!live) {
        results.push(down);
        continue;
      }
      port = record.port;
    }
    // oxlint-disable-next-line no-await-in-loop -- one bounded probe per service, in declaration order
    const status = await httpStatus(`http://${probeHost(service.bind)}:${port}${service.healthPath}`);
    results.push({ id: service.id, status, healthy: healthy(status) });
  }
  return results;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  const configPath =
    option(rest, "--config") ??
    join(process.env.APHRODY_HOME ?? join(homedir(), ".aphrody"), "host", "aphrody-startup.json");
  if (process.platform !== "win32") throw new Error("le démarrage natif Windows exige Windows");
  const config = loadConfig(configPath);
  const resolved = resolveServices(config);
  switch (command) {
    case "plan": {
      const rows = plan(resolved, bootTasks());
      console.log(JSON.stringify(rows, null, 2));
      const pending = rows.filter(row => row.boot?.drift.length);
      for (const row of pending)
        console.error(`${row.id} : ${row.boot!.drift.join(" ; ")} (aphrody infra boot apply --entry ${row.id})`);
      return pending.length ? 1 : 0;
    }
    case "health": {
      const results = await health(resolved);
      console.log(JSON.stringify(results, null, 2));
      return results.every(r => r.healthy) ? 0 : 1;
    }
    case "run": {
      const id = rest.find((a, i) => !a.startsWith("--") && rest[i - 1] !== "--config");
      const r = resolved.find(x => x.service.id === id);
      if (!r?.service.enabled) throw new Error(`service ${id ?? "?"} absent ou désactivé`);
      const row = plan([r], [])[0]!;
      if (!row.enabled) throw new Error(`service ${r.service.id} indisponible : ${row.reason}`);
      const { child, record } = await activate(r, config.root, serviceArgv(r.service, config.root, r.home));
      console.error(
        `${record.id} : pid ${record.pid} sur ${record.url} (santé ${record.healthStatus ?? "injoignable"})`,
      );
      return await child.exited;
    }
    default:
      console.error("usage : native-startup.ts plan|health|run <id> [--config <chemin>]");
      return 2;
  }
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    console.error(`native-startup : ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
