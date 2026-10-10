#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";
import { resolveRustAphrody } from "../../../bin/aphrody.ts";

export const workspaceRoot = resolve(import.meta.dir, "../../..");

/** Rust owns HTTP and serves the canonical app-ui build. */
export function siteArguments(env: NodeJS.ProcessEnv = process.env, args: string[] = []) {
  const bind = env.APHRODY_SITE_BIND || `127.0.0.1:${env.PORT || "3000"}`;
  return [
    "site",
    "serve",
    "--root",
    env.APHRODY_WORKSPACE_ROOT || workspaceRoot,
    "--app",
    "--bind",
    bind,
    ...args,
  ];
}

if (import.meta.main) {
  const native = resolveRustAphrody(workspaceRoot);
  if (!native)
    throw new Error("Install the native Aphrody CLI or set APHRODY_BIN before serving app-ui.");
  const child = Bun.spawn([native, ...siteArguments(process.env, process.argv.slice(2))], {
    windowsHide: true,
    cwd: workspaceRoot,
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(await child.exited);
}
