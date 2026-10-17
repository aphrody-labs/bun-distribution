// SPDX-License-Identifier: Apache-2.0
/* eslint-disable no-await-in-loop -- The existing factory child handles one bounded remote job at a time. */
import { sourceJobRun } from "../build/container/shenron-source-job";

export interface SourceControllerProfile {
  host: "dbfr";
  runtime: { path: string; sha256: string };
  owner: { path: string; sha256: string };
  jobConfig: { path: string; sha256: string };
}
export interface SourceControllerPorts {
  remote?: (host: "dbfr", command: string, signal?: AbortSignal) => Promise<string>;
  signal?: AbortSignal;
}
const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
export function sourceControllerCommand(profile: SourceControllerProfile) {
  if (profile.host !== "dbfr") throw new Error("The source controller targets only the declared DBFR bot");
  for (const artifact of [profile.runtime, profile.owner, profile.jobConfig]) {
    if (
      !/^\/[A-Za-z0-9_./-]+$/.test(artifact.path) ||
      artifact.path.split("/").includes("..") ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256)
    )
      throw new Error("Source controller requires fixed absolute pinned artifacts");
  }
  const guards = [profile.runtime, profile.owner, profile.jobConfig].map(
    artifact =>
      `test "$(sha256sum -- ${shellQuote(artifact.path)} | cut -d ' ' -f 1)" = ${shellQuote(artifact.sha256)}`,
  );
  return [
    "hostname >/dev/null",
    'test "$(id -u)" = 1000',
    ...guards,
    `BUN_BE_BUN=1 ${shellQuote(profile.runtime.path)} ${shellQuote(profile.owner.path)} source-job drain --config ${shellQuote(profile.jobConfig.path)} --config-sha256 ${shellQuote(profile.jobConfig.sha256)}`,
  ].join(" && ");
}
export async function drainSourceController(profile: SourceControllerProfile, ports: SourceControllerPorts = {}) {
  const command = sourceControllerCommand(profile);
  const remote =
    ports.remote ??
    (async (host, text, signal) => {
      const result = await sourceJobRun(["aphrody", "infra", "ssh", "exec", "--host", host, "-c", text], {
        timeoutMs: 1100000,
        signal,
      });
      if (result.code !== 0) throw new Error("Source controller remote owner failed");
      return result.stdout;
    });
  const result = JSON.parse(await remote(profile.host, command, ports.signal)) as Record<string, unknown>;
  if (
    !["idle", "busy", "complete", "failed"].includes(String(result.status)) ||
    ![0, 1].includes(Number(result.handled))
  )
    throw new Error("Source controller returned an invalid bounded receipt");
  return result;
}

export interface ControllerWorker {
  stop(): Promise<void>;
}
/** One supervised child of the existing factory; no independent service or timer. */
export async function startSourceControllerWorker(
  runtime: string,
  entry: string,
  environment: Record<string, string | undefined>,
  limits: { joinMs?: number; killMs?: number; reapMs?: number } = {},
): Promise<ControllerWorker> {
  let ready!: () => void;
  const readiness = new Promise<void>(resolve => {
    ready = resolve;
  });
  const child = Bun.spawn([runtime, entry, "source-controller"], {
    env: { ...environment, BUN_BE_BUN: "1" },
    detached: true,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
    ipc(message: unknown) {
      if (
        message &&
        typeof message === "object" &&
        (message as { schema?: unknown }).schema === "shenron-source-controller-ready/v1"
      )
        ready();
    },
  });
  let exited = false;
  void child.exited.then(code => {
    exited = true;
    return code;
  });
  const groupSignal = (signal: NodeJS.Signals) => {
    if (!exited) {
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if ((error as { code?: string }).code !== "ESRCH") throw error;
      }
    }
  };
  let startup: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      readiness,
      child.exited.then(() => {
        throw Error("Source controller exited before readiness");
      }),
      new Promise<never>((_, reject) => {
        startup = setTimeout(() => reject(Error("Source controller readiness deadline exceeded")), 10000);
      }),
    ]);
  } catch (error) {
    groupSignal("SIGKILL");
    let reap: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        child.exited,
        new Promise<never>((_, reject) => {
          reap = setTimeout(
            () => reject(new Error("Source controller startup teardown uncertain")),
            limits.reapMs ?? 2500,
          );
        }),
      ]);
    } finally {
      if (reap) clearTimeout(reap);
    }
    throw error;
  } finally {
    if (startup) clearTimeout(startup);
  }
  return {
    async stop() {
      if (exited) {
        if ((await child.exited) !== 0) throw new Error("Source controller worker failed");
        return;
      }
      child.kill("SIGUSR1");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const finished = await Promise.race([
          child.exited.then(code => ({ code })),
          new Promise<null>(resolve => {
            timer = setTimeout(() => resolve(null), limits.joinMs ?? 1110000);
          }),
        ]);
        if (finished === null) {
          groupSignal("SIGTERM");
          let escalation: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              child.exited,
              new Promise<void>(resolve => {
                escalation = setTimeout(() => {
                  groupSignal("SIGKILL");
                  resolve();
                }, limits.killMs ?? 250);
              }),
            ]);
          } finally {
            if (escalation) clearTimeout(escalation);
          }
          let reap: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              child.exited,
              new Promise<never>((_, reject) => {
                reap = setTimeout(
                  () => reject(new Error("Source controller group teardown uncertain")),
                  limits.reapMs ?? 2500,
                );
              }),
            ]);
          } finally {
            if (reap) clearTimeout(reap);
          }
          throw new Error("Source controller exceeded its join deadline");
        }
        if (finished.code !== 0) throw new Error("Source controller worker failed");
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

export async function runSourceControllerLoop(profile: SourceControllerProfile, ports: SourceControllerPorts = {}) {
  sourceControllerCommand(profile);
  let stopping = false,
    wake: (() => void) | undefined;
  const stop = () => {
    stopping = true;
    wake?.();
  };
  process.on("SIGUSR1", stop);
  if (typeof process.send === "function") process.send({ schema: "shenron-source-controller-ready/v1" });
  const abort = () => stop();
  ports.signal?.addEventListener("abort", abort, { once: true });
  if (ports.signal?.aborted) stop();
  try {
    while (true) {
      if (stopping) break;
      try {
        const result = await drainSourceController(profile, ports);
        console.log(
          JSON.stringify({
            schema: "shenron-source-controller-tick/v1",
            status: result.status,
            handled: result.handled,
          }),
        );
      } catch {
        console.log(
          JSON.stringify({
            schema: "shenron-source-controller-tick/v1",
            status: "failed",
            handled: 0,
            errorCode: "ERR_SOURCE_CONTROLLER_OWNER",
          }),
        );
      }
      if (stopping) break;
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => {
          wake = undefined;
          resolve();
        }, 120000);
        wake = () => {
          clearTimeout(timer);
          wake = undefined;
          resolve();
        };
      });
    }
  } finally {
    process.off("SIGUSR1", stop);
    ports.signal?.removeEventListener("abort", abort);
    if (typeof process.disconnect === "function" && process.connected) process.disconnect();
  }
}
