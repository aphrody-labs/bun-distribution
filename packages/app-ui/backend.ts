// SPDX-License-Identifier: Apache-2.0
import { isIP } from "node:net";

export function isLoopbackHost(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, "");
  return hostname === "localhost" || hostname === "::1" || (isIP(hostname) === 4 && hostname.startsWith("127."));
}

/** The same native app-server transport serves the preview and M3 development UI. */
export function appServerProxy(
  target = process.env.APHRODY_APP_SERVER_URL ?? "http://127.0.0.1:8787",
): Record<string, string> {
  const url = new URL(target);
  if (
    url.protocol !== "http:" ||
    !isLoopbackHost(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("APHRODY_APP_SERVER_URL must be a loopback HTTP origin.");
  }
  return Object.fromEntries(
    ["/rpc", "/events", "/notifications", "/health", "/healthz"].map(path => [path, url.origin]),
  );
}
