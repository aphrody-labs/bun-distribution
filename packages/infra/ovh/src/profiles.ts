// SPDX-License-Identifier: Apache-2.0
/**
 * Profile management & multi-account credential resolution for OVHcloud.
 *
 * Reconciles the three segregated accounts and domain sets on the Aphrody infrastructure:
 *  - aphrody.com: aphrody.com (host secret file, env vars)
 *  - rosegriffon.fr: rosegriffon.fr (~/.ovh.conf)
 *  - dragonballfr.com: dragonballfr.com (~/.config/ovh/dbfr.conf)
 *
 * `rpbey.fr` was reported sold (operator decision, docs/PLAN.md) and is intentionally excluded
 * from the managed profile. A 2026-09-29 read-only zone-list call still showed it on the account;
 * visibility does not establish ownership or authorize changes.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { OvhClient, type OvhEndpoint, type OvhClientOptions } from "./client.js";

export interface ProfileDefinition {
  id: string;
  name: string;
  region: OvhEndpoint;
  domains: string[];
  candidatePaths: string[];
}

export const KNOWN_PROFILES: Record<string, ProfileDefinition> = {
  "aphrody.com": {
    id: "aphrody.com",
    name: "Aphrody Core (aphrody.com)",
    region: "ovh-eu",
    domains: ["aphrody.com"],
    candidatePaths: [
      join(homedir(), ".bash_secrets"),
      join(homedir(), ".config", "ovh", "aphrody.conf"),
    ],
  },
  "rosegriffon.fr": {
    id: "rosegriffon.fr",
    name: "Rose Griffon (rosegriffon.fr)",
    region: "ovh-eu",
    domains: ["rosegriffon.fr"],
    candidatePaths: [
      join(homedir(), ".ovh.conf"),
      join(homedir(), ".config", "ovh", "rosegriffon.conf"),
    ],
  },
  "dragonballfr.com": {
    id: "dragonballfr.com",
    name: "Dragon Ball FR (dragonballfr.com)",
    region: "ovh-eu",
    domains: ["dragonballfr.com"],
    candidatePaths: [
      join(homedir(), ".config", "ovh", "dbfr.conf"),
      "/etc/letsencrypt/ovh-dbfr.ini",
    ],
  },
};

export interface ResolvedCredentials {
  applicationKey: string;
  applicationSecret: string;
  consumerKey: string;
  endpoint: OvhEndpoint;
  source: string;
}

/**
 * Parses credentials from a bash export file, an INI file, or an env-like file.
 */
export function parseCredentialsText(
  content: string,
  _sourceLabel: string,
): OvhClientOptions | null {
  // 1. Try bash export pattern: export OVH_APPLICATION_KEY="..."
  const bashMatch = {
    ak: content.match(
      /^\s*(?:export\s+)?(?:OVH_)?APPLICATION_KEY\s*=\s*["']?([^"'\s#]+)["']?/m,
    )?.[1],
    as: content.match(
      /^\s*(?:export\s+)?(?:OVH_)?APPLICATION_SECRET\s*=\s*["']?([^"'\s#]+)["']?/m,
    )?.[1],
    ck: content.match(/^\s*(?:export\s+)?(?:OVH_)?CONSUMER_KEY\s*=\s*["']?([^"'\s#]+)["']?/m)?.[1],
    ep: content.match(/^\s*(?:export\s+)?(?:OVH_)?ENDPOINT\s*=\s*["']?([^"'\s#]+)["']?/m)?.[1],
  };

  if (bashMatch.ak && bashMatch.as && bashMatch.ck) {
    return {
      applicationKey: bashMatch.ak,
      applicationSecret: bashMatch.as,
      consumerKey: bashMatch.ck,
      endpoint: (bashMatch.ep as OvhEndpoint) || "ovh-eu",
    };
  }

  // 2. Try INI / config format (e.g. [ovh-eu] section or dns_ovh_* keys)
  const iniGet = (key: string): string | undefined => {
    const rx = new RegExp(`^\\s*(?:dns_ovh_)?${key}\\s*=\\s*(.+)\\s*$`, "m");
    return content
      .match(rx)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "");
  };

  const ak = iniGet("application_key") || iniGet("app_key");
  const as = iniGet("application_secret") || iniGet("app_secret");
  const ck = iniGet("consumer_key");
  const ep = iniGet("endpoint") || "ovh-eu";

  if (ak && as && ck) {
    return {
      applicationKey: ak,
      applicationSecret: as,
      consumerKey: ck,
      endpoint: ep as OvhEndpoint,
    };
  }

  return null;
}

/**
 * Loads credentials for a profile, domain, or explicit file path.
 */
export function loadCredentials(profileOrDomain?: string): ResolvedCredentials {
  // Check process.env first if no profile specified
  const envAk = process.env.OVH_APPLICATION_KEY || process.env.OVH_APP_KEY;
  const envAs = process.env.OVH_APPLICATION_SECRET || process.env.OVH_APP_SECRET;
  const envCk = process.env.OVH_CONSUMER_KEY;
  const envEp = (process.env.OVH_ENDPOINT as OvhEndpoint) || "ovh-eu";

  if (!profileOrDomain && envAk && envAs && envCk) {
    return {
      applicationKey: envAk,
      applicationSecret: envAs,
      consumerKey: envCk,
      endpoint: envEp,
      source: "environment_variables",
    };
  }

  // If path directly provided and exists
  if (profileOrDomain && existsSync(profileOrDomain)) {
    const text = readFileSync(profileOrDomain, "utf8");
    const parsed = parseCredentialsText(text, profileOrDomain);
    if (parsed) {
      return {
        applicationKey: parsed.applicationKey,
        applicationSecret: parsed.applicationSecret,
        consumerKey: parsed.consumerKey,
        endpoint: (parsed.endpoint as OvhEndpoint) || "ovh-eu",
        source: profileOrDomain,
      };
    }
  }

  // Match by profile ID or domain
  const target = profileOrDomain?.toLowerCase() ?? "aphrody.com";
  let matchedProfile: ProfileDefinition | undefined = KNOWN_PROFILES[target];

  if (!matchedProfile) {
    for (const prof of Object.values(KNOWN_PROFILES)) {
      if (prof.domains.some((d) => d === target || target.endsWith(`.${d}`))) {
        matchedProfile = prof;
        break;
      }
    }
  }

  if (!matchedProfile) {
    // Check fallback aliases
    if (target === "aphrody" || target === "vps") matchedProfile = KNOWN_PROFILES["aphrody.com"];
    else if (target === "rosegriffon" || target === "rg")
      matchedProfile = KNOWN_PROFILES["rosegriffon.fr"];
    else if (target === "dbfr" || target === "dragonball")
      matchedProfile = KNOWN_PROFILES["dragonballfr.com"];
  }

  if (matchedProfile) {
    for (const path of matchedProfile.candidatePaths) {
      if (existsSync(path)) {
        try {
          const text = readFileSync(path, "utf8");
          const parsed = parseCredentialsText(text, path);
          if (parsed) {
            return {
              applicationKey: parsed.applicationKey,
              applicationSecret: parsed.applicationSecret,
              consumerKey: parsed.consumerKey,
              endpoint: (parsed.endpoint as OvhEndpoint) || matchedProfile.region,
              source: path,
            };
          }
        } catch {
          // try next path
        }
      }
    }
  }

  // Fallback to environment variables if present
  if (envAk && envAs && envCk) {
    return {
      applicationKey: envAk,
      applicationSecret: envAs,
      consumerKey: envCk,
      endpoint: envEp,
      source: "environment_variables",
    };
  }

  // Check default ~/.ovh.conf
  const defaultConf = join(homedir(), ".ovh.conf");
  if (existsSync(defaultConf)) {
    const text = readFileSync(defaultConf, "utf8");
    const parsed = parseCredentialsText(text, defaultConf);
    if (parsed) {
      return {
        applicationKey: parsed.applicationKey,
        applicationSecret: parsed.applicationSecret,
        consumerKey: parsed.consumerKey,
        endpoint: (parsed.endpoint as OvhEndpoint) || "ovh-eu",
        source: defaultConf,
      };
    }
  }

  throw new Error(
    `No valid OVH credentials found for '${profileOrDomain ?? "default"}'. ` +
      `Please provide OVH_APPLICATION_KEY, OVH_APPLICATION_SECRET, and OVH_CONSUMER_KEY in .env or configure ~/.ovh.conf.`,
  );
}

/**
 * Creates an authenticated OvhClient for the requested profile, domain or credentials source.
 */
export function createClient(profileOrDomain?: string): OvhClient {
  const creds = loadCredentials(profileOrDomain);
  return new OvhClient({
    applicationKey: creds.applicationKey,
    applicationSecret: creds.applicationSecret,
    consumerKey: creds.consumerKey,
    endpoint: creds.endpoint,
  });
}
