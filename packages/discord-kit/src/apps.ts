// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";
import type { ManagedProcess, SpawnOptions } from "@aphrody/runtime-sdk";

export interface DiscordAppBuild {
  entrypoint: string;
  outfile: string;
  minify?: boolean;
  sourcemap?: boolean;
}

/** Compile a Bun-compatible Discord application. No login or application code is executed. */
export async function compileDiscordApp(options: DiscordAppBuild): Promise<string> {
  const entrypoint = resolve(options.entrypoint);
  const outfile = resolve(options.outfile);
  if (entrypoint === outfile) throw new Error("Output must differ from the source entrypoint");
  const { runtimeBundlerPlugin } = await import("@aphrody/runtime-sdk/bundler");
  const result = await Bun.build({
    entrypoints: [entrypoint],
    target: "bun",
    compile: { outfile },
    minify: options.minify ?? true,
    sourcemap: options.sourcemap ? "linked" : "none",
    plugins: [runtimeBundlerPlugin],
  });
  if (!result.success) throw new AggregateError(result.logs, "Discord application compilation failed");
  const executable = result.outputs.find(output => output.kind === "entry-point");
  if (!executable || !(await Bun.file(executable.path).exists()))
    throw new Error("Discord application compilation produced no executable");
  return resolve(executable.path);
}

export interface DiscordAppStart {
  /** An existing compiled executable, including applications built outside this package. */
  binary: string;
  args?: readonly string[];
  cwd?: string;
  /** Explicit Agent Home domain; a parent's workspace override is never inherited. */
  profile: string;
  env?: Readonly<Record<string, string | undefined>>;
  stdio?: SpawnOptions["stdio"];
}

/**
 * Use the native owner's process-group supervision, status, output and release.
 * Stop is graceful on Unix; Windows terminates the owned Job Object and its descendants.
 * The caller owns the returned handle (`using` or `release()`), including on startup failure.
 */
export async function startDiscordApp(options: DiscordAppStart): Promise<ManagedProcess> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(options.profile))
    throw new Error("A Discord application requires an explicit named Agent Home profile");
  const binary = resolve(options.binary);
  if (!(await Bun.file(binary).exists())) throw new Error(`Discord executable does not exist: ${binary}`);
  const { processes } = await import("@aphrody/runtime-sdk/modules");
  return processes.spawn({
    program: binary,
    args: options.args,
    cwd: options.cwd,
    env: {
      ...options.env,
      APHRODY_PROFILE: options.profile,
      APHRODY_WORKSPACE: undefined,
    },
    stdio: options.stdio ?? "capture",
  });
}
