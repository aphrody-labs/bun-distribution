/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { WebService } from "@aphrody/agent-browser/service";
import { webDnsRecon, webGetChromiumCookies } from "@aphrody/bun/web";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

export interface EndpointProbeResult {
  url: string;
  status: number;
  latencyMs: number;
  reachable: boolean;
}

export interface FutReconSummary {
  domain: string;
  subdomains: string[];
  probes: EndpointProbeResult[];
}

/**
 * Standard known EA Sports FC Ultimate Team endpoints across worldwide clusters.
 */
export const KNOWN_EA_UTAS_ENDPOINTS = [
  "https://utas.mob.v1.fut.ea.com",
  "https://utas.external.s2.fut.ea.com",
  "https://utas.fut.ea.com",
  "https://accounts.ea.com",
  "https://gateway.ea.com",
  "https://futmin.ea.com",
];

/**
 * Executes DNS reconnaissance via Rust FFI to discover live subdomains and CDN nodes.
 */
export function reconFutDns(domain = "ea.com"): string[] {
  try {
    const value: unknown = JSON.parse(webDnsRecon(domain));
    if (!Array.isArray(value) || value.some((host) => typeof host !== "string"))
      throw new Error("invalid native DNS response");
    return value;
  } catch {
    // Fallback when network or FFI fails
    return [domain];
  }
}

/**
 * Finds default Chromium user data directory on Linux / macOS / Windows.
 */
export function getDefaultChromiumUserDataDir(): string | null {
  const home = homedir();
  const candidates = [
    join(home, ".config/google-chrome"),
    join(home, ".config/chromium"),
    join(home, ".config/BraveSoftware/Brave-Browser"),
    join(home, "AppData/Local/Google/Chrome/User Data"),
    join(home, "AppData/Local/BraveSoftware/Brave-Browser/User Data"),
  ];

  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
}

/**
 * Harvests EA session cookies directly from local Chromium SQLite cookie jar via Rust FFI.
 * Enables instant authentication for EaUtasClient without opening a browser or logging in manually.
 */
export function harvestEaChromiumCookies(
  customUserDataDir?: string,
  profile = "Default",
): Record<string, string> {
  const dir = customUserDataDir ?? getDefaultChromiumUserDataDir();
  if (!dir) return {};

  // The OAuth login cookies (`remid`, `sid`) live on accounts.ea.com, not on
  // the shared .ea.com domain, so harvest both host keys.
  const hostKeys = [".ea.com", "accounts.ea.com", ".accounts.ea.com"];
  const cookies: Record<string, string> = {};
  for (const hostKey of hostKeys) {
    try {
      const rawCookies = webGetChromiumCookies(dir, profile, hostKey) as Array<{
        name?: string;
        value?: string;
      }>;
      if (!Array.isArray(rawCookies)) continue;
      for (const c of rawCookies) {
        if (c.name && c.value && !(c.name in cookies)) {
          cookies[c.name] = c.value;
        }
      }
    } catch {
      // Host key not present or locked profile: try the next one.
    }
  }
  return cookies;
}

/**
 * Probes latency and availability of EA UTAS endpoints using Bun's native HTTP stack.
 */
export async function probeEaEndpoints(
  endpoints: string[] = KNOWN_EA_UTAS_ENDPOINTS,
): Promise<EndpointProbeResult[]> {
  const results: EndpointProbeResult[] = [];

  for (const url of endpoints) {
    const start = performance.now();
    try {
      const resp = await new WebService().response(url, { maxBytes: 1, timeoutSecs: 4 });
      const latencyMs = Math.round((performance.now() - start) * 100) / 100;
      results.push({
        url,
        status: resp.status,
        latencyMs,
        reachable: true,
      });
    } catch {
      const latencyMs = Math.round((performance.now() - start) * 100) / 100;
      results.push({
        url,
        status: 0,
        latencyMs,
        reachable: false,
      });
    }
  }

  return results;
}
