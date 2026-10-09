// SPDX-License-Identifier: Apache-2.0
// Common lifecycle owner for the existing Compose project and native host adapters.
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Subprocess } from "bun";
import { waitEngine } from "./container-service.ts";

export type ComposeGroup = {
  file: string;
  services: string[];
  profiles?: string[];
  envFile?: string;
};
export type NativeAdapter = { id: string; argv: string[]; envFile?: string };
export type MeshConfig = {
  version: 1;
  member: "aphro-pc" | "omar" | "vps" | "dbfr";
  root: string;
  home: string;
  compose: ComposeGroup[];
  adapters: NativeAdapter[];
  health: { id: string; url: string }[];
};

export function validateConfig(value: unknown): MeshConfig {
  const c = value as MeshConfig;
  if (!c || c.version !== 1 || !["aphro-pc", "omar", "vps", "dbfr"].includes(c.member))
    throw new Error("invalid mesh member/version");
  if (!isAbsolute(c.root) || !isAbsolute(c.home)) throw new Error("root/home must be absolute");
  if (
    !Array.isArray(c.compose) ||
    !c.compose.length ||
    !Array.isArray(c.adapters) ||
    !Array.isArray(c.health)
  )
    throw new Error("compose, adapters and health arrays required");
  const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
  for (const group of c.compose) {
    if (
      !isAbsolute(group.file) ||
      !Array.isArray(group.services) ||
      !group.services.length ||
      [...group.services, ...(group.profiles ?? [])].some((s) => !identifier.test(s))
    )
      throw new Error("invalid Compose selection");
  }
  const ids = new Set<string>();
  for (const adapter of c.adapters) {
    if (
      !identifier.test(adapter.id) ||
      ids.has(adapter.id) ||
      !Array.isArray(adapter.argv) ||
      !adapter.argv.length ||
      adapter.argv.some(
        (s) => typeof s !== "string" || /[\r\n\0]/.test(s) || /^(--token|--password)(=|$)/i.test(s),
      )
    )
      throw new Error("invalid adapter or credential in argv");
    ids.add(adapter.id);
  }
  for (const item of [...c.compose, ...c.adapters]) {
    if (item.envFile) {
      const relative = resolve(item.envFile).slice(resolve(c.home).length);
      const privateRoot = join(resolve(c.home), "private");
      if (
        !resolve(item.envFile).startsWith(
          privateRoot + (process.platform === "win32" ? "\\" : "/"),
        ) ||
        !relative
      )
        throw new Error("envFile must be in this host's protected home/private");
    }
  }
  for (const h of c.health) {
    const u = new URL(h.url);
    if (
      !identifier.test(h.id) ||
      !["http:", "https:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.hash ||
      u.search
    )
      throw new Error("invalid or credential-bearing health URL");
  }
  return c;
}

export function composeArgs(group: ComposeGroup, action: "config" | "up"): string[] {
  return [
    "docker",
    "compose",
    "-f",
    group.file,
    ...(group.envFile ? ["--env-file", group.envFile] : []),
    ...(group.profiles ?? []).flatMap((p) => ["--profile", p]),
    ...(action === "config"
      ? ["config", "--quiet"]
      : ["up", "-d", "--no-build", "--wait", "--wait-timeout", "120", ...group.services]),
  ];
}

export function environment(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error("invalid protected env file (expected NAME=value)");
    let value = match[2]!;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    result[match[1]!] = value;
  }
  return result;
}

async function command(argv: string[], root: string, timeout = 15_000): Promise<boolean> {
  const child = Bun.spawn(argv, {
    cwd: root,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    windowsHide: true,
  });
  const timer = setTimeout(() => child.kill(), timeout);
  try {
    return (await child.exited) === 0;
  } finally {
    clearTimeout(timer);
  }
}

export async function probes(
  config: MeshConfig,
): Promise<{ id: string; healthy: boolean; status: number | null }[]> {
  return Promise.all(
    config.health.map(async (h) => {
      try {
        const response = await fetch(h.url, {
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
        });
        await response.body?.cancel();
        return { id: h.id, healthy: response.status === 200, status: response.status };
      } catch {
        return { id: h.id, healthy: false, status: null };
      }
    }),
  );
}

async function windowsLock(member: string): Promise<() => void> {
  const { dlopen, FFIType, ptr } = await import("bun:ffi");
  const api = dlopen("kernel32.dll", {
    CreateMutexW: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.ptr },
    WaitForSingleObject: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
    ReleaseMutex: { args: [FFIType.ptr], returns: FFIType.i32 },
    CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
  });
  const name = Buffer.from(`Global\\AphrodyMesh-${member}\0`, "utf16le");
  const handle = api.symbols.CreateMutexW(null, 0, ptr(name));
  if (!handle) {
    api.close();
    throw new Error("mesh mutex creation failed");
  }
  const state = api.symbols.WaitForSingleObject(handle, 0);
  if (state !== 0 && state !== 0x80) {
    api.symbols.CloseHandle(handle);
    api.close();
    throw new Error("mesh supervisor already running");
  }
  return () => {
    api.symbols.ReleaseMutex(handle);
    api.symbols.CloseHandle(handle);
    api.close();
  };
}

async function supervise(config: MeshConfig): Promise<void> {
  await waitEngine();
  for (const group of config.compose) {
    // oxlint-disable-next-line no-await-in-loop -- ordered startup of selected existing projects
    if (!(await command(composeArgs(group, "up"), config.root, 150_000)))
      throw new Error("Compose activation failed; existing containers preserved");
  }
  const children = new Map<string, Subprocess>();
  const logs = new Map<string, number>();
  let stopping = false;
  const stop = () => {
    stopping = true;
    for (const child of children.values()) child.kill();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const receipt = join(config.home, "run", "mesh.json");
  mkdirSync(dirname(receipt), { recursive: true });
  mkdirSync(join(config.home, "logs"), { recursive: true });
  try {
    while (!stopping) {
      if (!(await command(["docker", "info"], config.root)))
        throw new Error("Docker engine unavailable");
      for (const adapter of config.adapters) {
        const previous = children.get(adapter.id);
        if (previous && previous.exitCode === null) continue;
        const env = adapter.envFile ? environment(readFileSync(adapter.envFile, "utf8")) : {};
        let log = logs.get(adapter.id);
        if (log === undefined) {
          log = openSync(join(config.home, "logs", `mesh-${adapter.id}.log`), "a", 0o600);
          logs.set(adapter.id, log);
        }
        const child = Bun.spawn(adapter.argv, {
          cwd: config.root,
          env: { ...process.env, ...env, APHRODY_HOME: config.home },
          stdin: "ignore",
          stdout: log,
          stderr: log,
          windowsHide: true,
        });
        children.set(adapter.id, child);
        if (process.platform === "win32") {
          const { killWithThisProcess } = await import("../tools/infra/win32-net.ts");
          killWithThisProcess(child.pid);
        }
      }
      const health = await probes(config);
      writeFileSync(
        `${receipt}.new`,
        JSON.stringify(
          {
            member: config.member,
            pid: process.pid,
            observedAt: new Date().toISOString(),
            health,
            adapters: [...children].map(([id, child]) => ({
              id,
              pid: child.pid,
              exitCode: child.exitCode,
            })),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      renameSync(`${receipt}.new`, receipt);
      await Bun.sleep(5000);
    }
  } finally {
    stop();
    const killDeadline = setTimeout(() => {
      for (const child of children.values()) if (child.exitCode === null) child.kill("SIGKILL");
    }, 5000);
    await Promise.all([...children.values()].map((child) => child.exited));
    clearTimeout(killDeadline);
    for (const fd of logs.values()) closeSync(fd);
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
  }
}

export async function main(argv = Bun.argv.slice(2)): Promise<number> {
  const [action] = argv;
  const at = argv.indexOf("--config");
  const path =
    at < 0
      ? join(process.env.APHRODY_HOME ?? join(homedir(), ".aphrody"), "host", "mesh.json")
      : argv[at + 1];
  if (!path || !["plan", "health", "run"].includes(action ?? ""))
    throw new Error("usage: container-service.ts --mesh plan|health|run [--config path]");
  const config = validateConfig(JSON.parse(readFileSync(path, "utf8")));
  if (!existsSync(config.root)) throw new Error("configured checkout missing");
  for (const item of [...config.compose, ...config.adapters]) {
    if (item.envFile && !existsSync(item.envFile))
      throw new Error("configured protected env file missing");
  }
  if (action === "health") {
    const rows = await probes(config);
    console.log(JSON.stringify(rows));
    return rows.every((r) => r.healthy) ? 0 : 1;
  }
  for (const group of config.compose) {
    // oxlint-disable-next-line no-await-in-loop -- each independently installed existing project must validate
    if (!(await command(composeArgs(group, "config"), config.root)))
      throw new Error("Compose configuration invalid");
  }
  if (action === "plan") {
    console.log(
      JSON.stringify(
        {
          member: config.member,
          compose: config.compose.map((g) => composeArgs(g, "up")),
          adapters: config.adapters.map((a) => ({ id: a.id, executable: a.argv[0] })),
          health: config.health,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  if (process.platform !== "win32" && !argv.includes("--locked")) {
    const lock = join(config.home, "run", "mesh.lock");
    mkdirSync(dirname(lock), { recursive: true });
    const child = Bun.spawn(
      [
        "flock",
        "--close",
        "--nonblock",
        lock,
        process.execPath,
        "--no-env-file",
        import.meta.path,
        ...argv,
        "--locked",
      ],
      { stdin: "ignore", stdout: "inherit", stderr: "inherit" },
    );
    return await child.exited;
  }
  const release = process.platform === "win32" ? await windowsLock(config.member) : () => {};
  try {
    await supervise(config);
    return 0;
  } finally {
    release();
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "mesh failed");
    process.exitCode = 1;
  }
}
