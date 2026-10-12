#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";
import { serveM3Site } from "@aphrody/bun-m3/site";

export const workspaceRoot = resolve(import.meta.dir, "../../..");

/** Bun owns the app-ui HTTP listener; the UI remains an independent artifact. */
export function siteOptions(env: NodeJS.ProcessEnv = process.env) {
  const [hostname = "127.0.0.1", portText = env.PORT || "3000"] = (env.APHRODY_SITE_BIND || "").split(":");
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid app-ui port");
  return {
    staticRoot: env.APHRODY_APP_UI_ROOT || resolve(env.APHRODY_WORKSPACE_ROOT || workspaceRoot, "crates/ui/app/ui-dist"),
    hostname,
    port,
  } as const;
}

if (import.meta.main) {
  const server = await serveM3Site(siteOptions());
  console.log(`app-ui served by Bun at http://${server.hostname}:${server.port}`);
}
