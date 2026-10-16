import {
  ACHILLEA_SESSION_COOKIE_NAME,
  verifyAchilleaSessionToken,
  type AchilleaSessionClaims,
} from "@rosegriffon/achillea-core/auth";

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(value.join("="));
    } catch {
      return null;
    }
  }
  return null;
}

function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/** Resolve the purpose-bound Achilléa session accepted by the unified API. */
export async function resolveAchilleaSession(headers: {
  authorization?: string;
  cookie?: string;
}): Promise<AchilleaSessionClaims | null> {
  const token = bearer(headers.authorization) ?? readCookie(headers.cookie, ACHILLEA_SESSION_COOKIE_NAME);
  const secret = process.env.JWT_SECRET_KEY;
  return token && secret ? verifyAchilleaSessionToken(token, secret) : null;
}
