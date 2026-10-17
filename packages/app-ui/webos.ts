#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { webosOwnerModule } from "../../scripts/aphrody/webos/fork";

/** The Bun fork serves WebOS on its own loopback origin, with host access disabled by default. */
export async function startForkWebOS() {
  const port = Number(process.env.BUN_WEBOS_PORT ?? 3001);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("BUN_WEBOS_PORT must be an integer from 0 to 65535");
  }
  const { startWebOS } = await import(webosOwnerModule("server.ts"));
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
