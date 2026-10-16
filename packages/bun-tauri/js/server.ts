// SPDX-License-Identifier: Apache-2.0 OR MIT
// Bun side of the `aphrody` plugin: the server the Tauri app starts (`plugins > aphrody > bun`).
// The plugin passes a free loopback port in `PORT` (Bun.serve's default) and `BUN_TAURI_PORT`.
import type { Serve, Server } from "bun";

/** True when this process was started by `tauri-plugin-aphrody`. */
export const isTauriSidecar = process.env.BUN_TAURI === "1";

/** Port chosen by the plugin, if any. */
export const tauriPort = process.env.BUN_TAURI_PORT ? Number(process.env.BUN_TAURI_PORT) : undefined;

/** `Bun.serve` bound to loopback on the port the plugin waits for. */
export function serveForTauri<T = undefined>(options: Serve.Options<T>): Server<T> {
  return Bun.serve({
    hostname: "127.0.0.1",
    ...options,
    port: tauriPort ?? (options as { port?: number }).port ?? 0,
  } as Serve.Options<T>);
}
