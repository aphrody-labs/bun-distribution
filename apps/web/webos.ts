#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Runtime showcase owner: aphrody-labs/bun@499dbd0b9f1 packages/bun-webos.
import { startWebOS } from "@aphrody/bun-webos";

/** Separate origin preserves WebOS's loopback/same-origin permission boundary. */
export async function startForkWebOS() {
  const port = Number(process.env.BUN_WEBOS_PORT ?? 3001);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("BUN_WEBOS_PORT must be an integer from 0 to 65535");
  }
  return startWebOS({
    port,
    hostname: "127.0.0.1",
    hostAccess: process.env.BUN_WEBOS_HOST_ACCESS === "1",
    ...(process.env.BUN_WEBOS_ROOT ? { root: process.env.BUN_WEBOS_ROOT } : {}),
    ...(process.env.BUN_WEBOS_DATA ? { dataDir: process.env.BUN_WEBOS_DATA } : {}),
    development: process.env.NODE_ENV !== "production",
  });
}

if (import.meta.main) {
  const server = await startForkWebOS();
  console.log(`Bun WebOS: ${server.url}`);
}
