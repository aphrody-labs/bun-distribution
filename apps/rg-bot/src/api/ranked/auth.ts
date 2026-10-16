// Transport adapters for the shared purpose-bound Achillea contract.
import {
  ACHILLEA_SESSION_COOKIE_NAME,
  type AchilleaSessionIdentity,
  verifyAchilleaRealtimeToken,
  verifyAchilleaSessionToken,
} from "@rosegriffon/achillea-core/auth";

export type SessionUser = AchilleaSessionIdentity;

export function getCookie(cookieHeader: string | null, name: string): string | null {
  return cookieHeader ? new Bun.CookieMap(cookieHeader).get(name) : null;
}

export async function verifyToken(token: string): Promise<SessionUser> {
  const user = await verifyAchilleaRealtimeToken(token, process.env.JWT_SECRET_KEY ?? "");
  if (!user) throw new Error("Invalid realtime token");
  return user;
}

export async function authFromCookieHeader(header: string | null): Promise<SessionUser | null> {
  const token = getCookie(header, ACHILLEA_SESSION_COOKIE_NAME);
  return token ? verifyAchilleaSessionToken(token, process.env.JWT_SECRET_KEY ?? "") : null;
}

export async function authFromAuthorization(header: string | null): Promise<SessionUser | null> {
  const token = header ? /^Bearer\s+(.+)$/i.exec(header.trim())?.[1] : undefined;
  return token ? verifyAchilleaRealtimeToken(token, process.env.JWT_SECRET_KEY ?? "") : null;
}

function readField(value: unknown, name: string): unknown {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>)[name] : undefined;
}

function readHeader(headers: unknown, name: string): string | null {
  if (headers instanceof Headers) return headers.get(name);
  if (headers !== null && typeof headers === "object") {
    const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
    if (typeof entry?.[1] === "string") return entry[1];
  }
  return null;
}

/** Resolve Colyseus credentials in context, cookie, bearer, then options order. */
export async function authFromColyseus(options: unknown, context: unknown): Promise<SessionUser | null> {
  const ctxToken = readField(context, "token");
  if (typeof ctxToken === "string") {
    const user = await verifyAchilleaRealtimeToken(ctxToken, process.env.JWT_SECRET_KEY ?? "");
    if (user) return user;
  }
  const headers = readField(context, "headers");
  const fromCookie = await authFromCookieHeader(readHeader(headers, "cookie"));
  if (fromCookie) return fromCookie;
  const fromAuth = await authFromAuthorization(readHeader(headers, "authorization"));
  if (fromAuth) return fromAuth;
  const optionsToken = readField(options, "token");
  return typeof optionsToken === "string"
    ? verifyAchilleaRealtimeToken(optionsToken, process.env.JWT_SECRET_KEY ?? "")
    : null;
}
