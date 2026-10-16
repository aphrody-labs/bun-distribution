import { randomBytes } from "node:crypto";

type AuthEnvironment = {
  BETTER_AUTH_SECRET?: string;
  NODE_ENV?: string;
  NEXT_PHASE?: string;
};

export function resolveAuthSecret(
  environment: AuthEnvironment = process.env,
  configured = environment.BETTER_AUTH_SECRET,
): string {
  const secret = configured?.trim();
  const production = environment.NODE_ENV === "production";
  if (secret) {
    if (
      production &&
      (secret.length < 32 || secret.includes("build-placeholder-secret") || secret === "better-auth-secret")
    ) {
      throw new Error("BETTER_AUTH_SECRET must be a private, high-entropy secret of at least 32 characters");
    }
    return secret;
  }
  if (production && environment.NEXT_PHASE !== "phase-production-build") {
    throw new Error("BETTER_AUTH_SECRET is required for production authentication");
  }
  // Next sets this phase before collecting routes; the emitted server resolves its own secret at startup.
  return randomBytes(32).toString("base64url");
}

export function resolveTrustedOrigins(baseURL: string, production = process.env.NODE_ENV === "production"): string[] {
  const base = new URL(baseURL);
  if (!/^https?:$/.test(base.protocol) || base.username || base.password) {
    throw new Error("Better Auth baseURL must be an HTTP origin without credentials");
  }
  if (production && base.protocol !== "https:") {
    throw new Error("Production Better Auth baseURL must use HTTPS");
  }
  if (
    production &&
    (base.hostname === "localhost" ||
      base.hostname.endsWith(".localhost") ||
      base.hostname.startsWith("127.") ||
      base.hostname === "[::1]")
  ) {
    throw new Error("Production Better Auth baseURL cannot use a loopback host");
  }
  const origins = [
    "https://rg.aphrody.com",
    "https://rosegriffon.fr",
    "https://www.rosegriffon.fr",
    "https://achillea.rosegriffon.fr",
    "https://ranked.rosegriffon.fr",
    "https://azalee.rosegriffon.fr",
    "https://dragonballfr.com",
    "https://www.dragonballfr.com",
    "tauri://localhost",
    "http://tauri.localhost",
    base.origin,
    ...(!production
      ? ["http://localhost:3000", "http://localhost:3001", "http://localhost:5011", "http://127.0.0.1:5011"]
      : []),
  ];
  return [...new Set(origins)];
}
