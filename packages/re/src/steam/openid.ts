// SPDX-License-Identifier: Apache-2.0
/** Steam OpenID 2.0 relying party. Stores only the verified SteamID64, never credentials or tokens. */
import type { Database } from "bun:sqlite";

const ENDPOINT = "https://steamcommunity.com/openid/login";
const NS = "http://specs.openid.net/auth/2.0";

/** Builds the redirect URL that sends the user to Steam. */
export function openIdLoginUrl(
  returnTo: string,
  realm = new URL(returnTo).origin,
): string {
  const p = new URLSearchParams({
    "openid.ns": NS,
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": realm,
    "openid.identity": `${NS}/identifier_select`,
    "openid.claimed_id": `${NS}/identifier_select`,
  });
  return `${ENDPOINT}?${p}`;
}

/** Verifies a callback query (check_authentication) and returns the SteamID64 or null. */
export async function openIdVerify(
  query: URLSearchParams | string,
): Promise<string | null> {
  const q = new URLSearchParams(
    typeof query === "string" ? query.replace(/^\?/, "") : query,
  );
  if (q.get("openid.mode") !== "id_res") return null;
  const body = new URLSearchParams(q);
  body.set("openid.mode", "check_authentication");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok || !/is_valid\s*:\s*true/.test(await res.text())) return null;
  return (
    /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(
      q.get("openid.claimed_id") ?? "",
    )?.[1] ?? null
  );
}

/** Records a login attempt/result in auth_session (no secret material). */
export function recordAuthSession(
  db: Database,
  kind: string,
  returnTo: string,
  steamid64: string | null,
): void {
  const ts = new Date().toISOString();
  db.run(
    "INSERT INTO auth_session(kind,steamid64,realm,return_to,created_at,verified_at,nonce) VALUES(?,?,?,?,?,?,?)",
    [
      kind,
      steamid64,
      new URL(returnTo).origin,
      returnTo,
      ts,
      steamid64 ? ts : null,
      null,
    ],
  );
}
