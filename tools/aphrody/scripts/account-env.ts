// Typed readers for the account variables of tools/aphrody/config/secrets-contract.json.
// Values come from the process environment (Bun loads .env); they are never logged:
// errors name the variable, never its value, and `describe` only reports presence.

export type GoogleAccount = { email: string; password?: string };

function read(name: string, env: Record<string, string | undefined>): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function googleAccount(env: Record<string, string | undefined> = Bun.env): GoogleAccount {
  const email = read("GOOGLE_ACCOUNT_EMAIL", env);
  if (!email) throw new Error("GOOGLE_ACCOUNT_EMAIL is required");
  return { email, password: read("GOOGLE_ACCOUNT_PASSWORD", env) };
}

export function neonOrgId(env: Record<string, string | undefined> = Bun.env): string {
  const orgId = read("NEON_ORG_ID", env);
  if (!orgId) throw new Error("NEON_ORG_ID is required");
  return orgId;
}

/** Presence only, safe to print. */
export function describe(env: Record<string, string | undefined> = Bun.env): Record<string, boolean> {
  return Object.fromEntries(
    ["GOOGLE_ACCOUNT_EMAIL", "GOOGLE_ACCOUNT_PASSWORD", "NEON_ORG_ID", "MULLVAD_ACCOUNT"].map(name => [
      name,
      read(name, env) !== undefined,
    ]),
  );
}

if (import.meta.main) console.log(JSON.stringify(describe()));
