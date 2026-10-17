// SPDX-License-Identifier: Apache-2.0
/**
 * Sign-in for play.aphrody.app. Two canonical identities, no passwords stored here:
 *
 * - Aphrody mesh: the NGINX engine maps a WireGuard mesh peer (10.200.77.0/24, the same geo map as
 *   infra/config/host/nginx/shared/source-tunnel-auth.conf) to `X-Aphrody-Tunnel-User` on its mesh
 *   listener. A one-time code minted there is redeemed on the public origin for a session.
 * - Steam OpenID 2.0 (`openIdLoginUrl`/`openIdVerify` of @aphrody/bun-steam), restricted to the
 *   SteamID64 allow list `PLAY_STEAM_IDS`.
 *
 * Sessions are HMAC-SHA256 signed cookies (`__Host-play`), HttpOnly, Secure, SameSite=Lax.
 */
import { openIdLoginUrl, openIdVerify } from "@aphrody/bun-steam";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { config } from "./config";

export interface Session {
  sub: string;
  via: "mesh" | "steam";
  exp: number;
}

const COOKIE = "__Host-play";
const CODE_TTL_MS = 60_000;
const TUNNEL_HEADER = "x-aphrody-tunnel-user";

function loadSecret(): Uint8Array {
  const path = join(config.secretsDir, "session.key");
  if (!existsSync(path)) {
    mkdirSync(config.secretsDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      path,
      Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"),
      {
        mode: 0o600,
        flag: "wx",
      },
    );
  }
  if (process.platform !== "win32") chmodSync(path, 0o600);
  const hex = readFileSync(path, "utf8").trim();
  if (!/^[0-9a-f]{64}$/.test(hex))
    throw new Error(`invalid session key in ${path}`);
  return Buffer.from(hex, "hex");
}

const secret = loadSecret();

function sign(payload: string): string {
  return new Bun.CryptoHasher("sha256", secret)
    .update(payload)
    .digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function issueCookie(sub: string, via: Session["via"]): string {
  const session: Session = {
    sub,
    via,
    exp: Date.now() + config.sessionHours * 3_600_000,
  };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const maxAge = Math.floor(config.sessionHours * 3600);
  return `${COOKIE}=${payload}.${sign(payload)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export const clearCookie = `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

/** The verified session of a request, or null. */
export function sessionOf(request: Request): Session | null {
  const raw = new Bun.CookieMap(request.headers.get("cookie") ?? "").get(
    COOKIE,
  );
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  if (!safeEqual(raw.slice(dot + 1), sign(payload))) return null;
  try {
    const session = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    ) as Session;
    return session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

/** Mutating requests must come from the public origin (or the dev origin of this server). */
export function sameOrigin(request: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  return (
    origin === config.publicOrigin || origin === new URL(request.url).origin
  );
}

export function unauthorized(): Response {
  return Response.json({ error: "authentication required" }, { status: 401 });
}

/** Wraps a route handler: a valid session, and a same-origin request for mutations. */
export function guarded<R extends Request, S>(
  handler: (request: R, server: S) => Response | Promise<Response>,
): (request: R, server: S) => Response | Promise<Response> {
  return (request, server) => {
    if (!sessionOf(request)) return unauthorized();
    if (!sameOrigin(request))
      return Response.json({ error: "cross-origin request" }, { status: 403 });
    return handler(request, server);
  };
}

const codes = new Map<string, { user: string; exp: number }>();

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  if (cookie) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

export function authRoutes() {
  return {
    "/api/session": {
      GET: (request: Request) => {
        const session = sessionOf(request);
        return Response.json(
          {
            authenticated: session !== null,
            user: session?.sub ?? null,
            via: session?.via ?? null,
            host: hostname(),
            methods: {
              mesh: `${config.tunnelOrigin}/auth/tunnel`,
              steam: config.steamIds.length > 0 ? "/auth/steam" : null,
            },
          },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
    // Reached only through the engine's mesh listener; the engine overwrites the header.
    "/auth/tunnel": {
      GET: (request: Request) => {
        const user = request.headers.get(TUNNEL_HEADER)?.trim();
        if (!user || !/^[a-z0-9._-]{1,64}$/.test(user))
          return new Response("Not on the Aphrody mesh", { status: 403 });
        const now = Date.now();
        for (const [code, entry] of codes)
          if (entry.exp < now) codes.delete(code);
        const code = Buffer.from(
          crypto.getRandomValues(new Uint8Array(32)),
        ).toString("base64url");
        codes.set(code, { user, exp: now + CODE_TTL_MS });
        return redirect(
          `${config.publicOrigin}/auth/tunnel/complete?code=${code}`,
        );
      },
    },
    "/auth/tunnel/complete": {
      GET: (request: Request) => {
        const code = new URL(request.url).searchParams.get("code") ?? "";
        const entry = codes.get(code);
        codes.delete(code);
        if (!entry || entry.exp < Date.now()) return redirect("/?auth=expired");
        return redirect("/", issueCookie(entry.user, "mesh"));
      },
    },
    "/auth/steam": {
      GET: () =>
        config.steamIds.length
          ? redirect(
              openIdLoginUrl(
                `${config.publicOrigin}/auth/steam/callback`,
                config.publicOrigin,
              ),
            )
          : new Response("Steam sign-in is not configured", { status: 404 }),
    },
    "/auth/steam/callback": {
      GET: async (request: Request) => {
        const query = new URL(request.url).searchParams;
        if (
          query.get("openid.return_to")?.split("?")[0] !==
          `${config.publicOrigin}/auth/steam/callback`
        )
          return redirect("/?auth=denied");
        const steamId = await openIdVerify(query).catch(() => null);
        if (!steamId || !config.steamIds.includes(steamId))
          return redirect("/?auth=denied");
        return redirect("/", issueCookie(`steam:${steamId}`, "steam"));
      },
    },
    "/auth/logout": {
      POST: (request: Request) =>
        sameOrigin(request)
          ? new Response(null, {
              status: 204,
              headers: { "set-cookie": clearCookie },
            })
          : Response.json({ error: "cross-origin request" }, { status: 403 }),
    },
  };
}
