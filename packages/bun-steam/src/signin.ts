// SPDX-License-Identifier: Apache-2.0
/**
 * Steam sign-in for Bun.serve applications (play.aphrody.app and any Bun OS web surface).
 *
 * Steam offers third parties OpenID 2.0, not OAuth (partner OAuth needs Valve approval). This
 * module is a complete relying party on top of {@link openIdLoginUrl}/{@link openIdVerify}:
 *
 * - `GET  {base}`          redirects to steamcommunity.com/openid/login with a per-browser state;
 * - `GET  {base}/callback` checks the state cookie, `return_to`, `op_endpoint`, `claimed_id`, the
 *                          signed field list, the nonce (freshness and replay), then
 *                          `check_authentication` server-side, and issues the session cookie;
 * - `GET  {base}/session`  returns the SteamID64 and a session-bound CSRF token (`Bun.CSRF`);
 * - `GET  {base}/profile`  returns the public profile (Web API with a key, community XML without);
 * - `POST {base}/logout`   requires the `x-csrf-token` header.
 *
 * Sessions are HMAC-SHA256 signed cookies (`__Host-steam`, HttpOnly, Secure, SameSite=Lax). The
 * session key and the Steam Web API key come from the OS credential store (`Bun.secrets`, service
 * `aphrody.steam`) or explicit options; neither is ever logged, returned or written to disk here.
 */
import { timingSafeEqual } from "node:crypto";
import { openIdLoginUrl, openIdVerify } from "./openid.js";
import { webApiKey } from "./webapi.js";

const OP_ENDPOINT = "https://steamcommunity.com/openid/login";
const OPENID_NS = "http://specs.openid.net/auth/2.0";
const CLAIMED_ID = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;
const REQUIRED_SIGNED = ["op_endpoint", "claimed_id", "identity", "return_to", "response_nonce", "assoc_handle"];
const NONCE_SKEW_MS = 5 * 60_000;
const STATE_TTL_MS = 10 * 60_000;
const PROFILE_TTL_MS = 10 * 60_000;
const API = "https://api.steampowered.com";

export const SECRET_SERVICE = "aphrody.steam";

export interface SteamSession {
  /** SteamID64. */
  steamId: string;
  /** Random session identifier (binds CSRF tokens). */
  sid: string;
  iat: number;
  exp: number;
}

export interface SteamGame {
  appId: number;
  name: string;
  playtimeMinutes: number;
  playtime2WeeksMinutes?: number | undefined;
  iconUrl?: string | undefined;
}

export interface SteamProfile {
  steamId: string;
  personaName: string;
  profileUrl: string;
  avatar: string | null;
  visibility: "public" | "private" | "friendsonly" | "unknown";
  personaState?: number | undefined;
  countryCode?: string | undefined;
  memberSince?: string | undefined;
  ownedGames: SteamGame[] | null;
  gameCount: number | null;
  recentlyPlayed: SteamGame[];
  /** `webapi` with a key; `community-xml` when no key is configured (degraded). */
  source: "webapi" | "community-xml";
  degraded: boolean;
  reason?: string | undefined;
  fetchedAt: string;
}

export interface NonceStore {
  /** Records `nonce` until `expiresAt`; false when it was already used. */
  claim(nonce: string, expiresAt: number): boolean | Promise<boolean>;
}

export interface SteamSignInOptions {
  /** Public origin of the application, e.g. `https://play.aphrody.app`. */
  publicOrigin: string;
  /** Route prefix (default `/auth/steam`). */
  basePath?: string;
  /** Where the browser lands after sign-in (default `/`). */
  afterLogin?: string;
  /** Session lifetime in seconds (default 7 days). */
  sessionTtlSeconds?: number;
  /** Session cookie name (default `__Host-steam`). */
  cookieName?: string;
  /** Accept only these SteamID64s (default: every Steam account). */
  allow?: (steamId: string) => boolean | Promise<boolean>;
  /** HMAC key for sessions and CSRF; default: `Bun.secrets` `aphrody.steam/session-key`, created on first use. */
  sessionKey?: string;
  /** Steam Web API key; default: `Bun.secrets` `aphrody.steam/web-api-key`, then `STEAM_WEB_API_KEY`. */
  webApiKey?: string;
  /** Credential store service name (default `aphrody.steam`). */
  secretService?: string;
  /** Replay protection for OpenID nonces (default: in-memory, per process). */
  nonces?: NonceStore;
  /** Called after a successful sign-in. */
  onSignIn?: (session: SteamSession) => void | Promise<void>;
}

export interface SteamSignIn {
  /** Route table for `Bun.serve({ routes: { ...signIn.routes } })`. */
  routes: Record<string, Record<string, (request: Request) => Response | Promise<Response>>>;
  /** The verified session of a request, or null. */
  session(request: Request): SteamSession | null;
  /** A CSRF token bound to the session. */
  csrfToken(session: SteamSession): string;
  /** True when the request carries a valid `x-csrf-token` (or `_csrf` form field value passed in). */
  verifyCsrf(request: Request, token?: string | null): boolean;
  /** Public profile of a SteamID64 (cached). */
  profile(steamId: string): Promise<SteamProfile>;
  /** Whether a Web API key is configured (no key material is exposed). */
  readonly hasWebApiKey: boolean;
}

/** In-memory nonce store with expiry. */
export function memoryNonceStore(): NonceStore {
  const seen = new Map<string, number>();
  return {
    claim(nonce, expiresAt) {
      const now = Date.now();
      for (const [key, exp] of seen) if (exp < now) seen.delete(key);
      if (seen.has(nonce)) return false;
      seen.set(nonce, expiresAt);
      return true;
    },
  };
}

async function storedSecret(service: string, name: string): Promise<string | undefined> {
  try {
    return (await Bun.secrets.get({ service, name })) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The session key from the credential store, created (32 random bytes) on first use. */
async function ensureSessionKey(service: string): Promise<string> {
  const existing = Bun.env.STEAM_SIGNIN_SESSION_KEY || (await storedSecret(service, "session-key"));
  if (existing) return existing;
  const value = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  await Bun.secrets.set({ service, name: "session-key", value });
  return value;
}

const b64 = (value: string) => Buffer.from(value).toString("base64url");
const unb64 = (value: string) => Buffer.from(value, "base64url").toString("utf8");
const randomId = () => Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

/** Parses `openid.response_nonce` (`2026-10-17T12:00:00Z<unique>`) into its timestamp. */
export function nonceTime(nonce: string): number | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/.exec(nonce);
  if (!match) return null;
  const time = Date.parse(match[1]!);
  return Number.isFinite(time) ? time : null;
}

/**
 * Validates the positive assertion fields that `check_authentication` does not cover for the
 * relying party (OpenID 2.0 section 11). Returns the claimed SteamID64 or a reason.
 */
export function checkAssertion(
  query: URLSearchParams,
  expectedReturnTo: string,
  now = Date.now(),
): { steamId: string } | { error: string } {
  if (query.get("openid.ns") !== OPENID_NS) return { error: "namespace" };
  if (query.get("openid.mode") !== "id_res") return { error: "mode" };
  if (query.get("openid.op_endpoint") !== OP_ENDPOINT) return { error: "op_endpoint" };
  if (query.get("openid.return_to") !== expectedReturnTo) return { error: "return_to" };
  const claimed = query.get("openid.claimed_id") ?? "";
  if (claimed !== query.get("openid.identity")) return { error: "identity" };
  const steamId = CLAIMED_ID.exec(claimed)?.[1];
  if (!steamId) return { error: "claimed_id" };
  const signed = new Set((query.get("openid.signed") ?? "").split(","));
  if (!REQUIRED_SIGNED.every(field => signed.has(field))) return { error: "signed fields" };
  const issued = nonceTime(query.get("openid.response_nonce") ?? "");
  if (issued === null || Math.abs(now - issued) > NONCE_SKEW_MS) return { error: "nonce" };
  return { steamId };
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} ${url.replace(/key=[^&]+/, "key=***")}`);
  return res.json();
}

const VISIBILITY: Record<number, SteamProfile["visibility"]> = {
  1: "private",
  2: "friendsonly",
  3: "public",
};

async function profileFromWebApi(key: string, steamId: string): Promise<SteamProfile> {
  const q = (extra: string) => `?key=${encodeURIComponent(key)}&steamid=${steamId}${extra}`;
  const [summary, owned, recent] = await Promise.all([
    getJson(`${API}/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(key)}&steamids=${steamId}`),
    getJson(`${API}/IPlayerService/GetOwnedGames/v1/${q("&include_appinfo=1&include_played_free_games=1")}`).catch(
      () => null,
    ),
    getJson(`${API}/IPlayerService/GetRecentlyPlayedGames/v1/${q("&count=10")}`).catch(() => null),
  ]);
  const player = summary?.response?.players?.[0];
  if (!player) throw new Error(`no Steam profile for ${steamId}`);
  const game = (g: any): SteamGame => ({
    appId: g.appid,
    name: g.name ?? String(g.appid),
    playtimeMinutes: g.playtime_forever ?? 0,
    playtime2WeeksMinutes: g.playtime_2weeks,
    iconUrl: g.img_icon_url
      ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg`
      : undefined,
  });
  const ownedList: any[] | undefined = owned?.response?.games;
  return {
    steamId,
    personaName: player.personaname,
    profileUrl: player.profileurl,
    avatar: player.avatarfull ?? null,
    visibility: VISIBILITY[player.communityvisibilitystate] ?? "unknown",
    personaState: player.personastate,
    countryCode: player.loccountrycode,
    memberSince: player.timecreated ? new Date(player.timecreated * 1000).toISOString() : undefined,
    ownedGames: ownedList ? ownedList.map(game) : null,
    gameCount: owned?.response?.game_count ?? null,
    recentlyPlayed: (recent?.response?.games ?? []).map(game),
    source: "webapi",
    degraded: false,
    fetchedAt: new Date().toISOString(),
  };
}

const xmlTag = (xml: string, tag: string): string | undefined => {
  const match = new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${tag}>`).exec(xml);
  return match ? (match[1] ?? match[2] ?? "").trim() : undefined;
};

/** Public community profile (`?xml=1`): no key needed, no owned-games list. */
async function profileFromCommunity(steamId: string, reason: string): Promise<SteamProfile> {
  const res = await fetch(`https://steamcommunity.com/profiles/${steamId}/?xml=1`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${res.status} community profile ${steamId}`);
  const xml = await res.text();
  const recentlyPlayed: SteamGame[] = [];
  for (const block of xml.matchAll(/<mostPlayedGame>([\s\S]*?)<\/mostPlayedGame>/g)) {
    const body = block[1]!;
    const link = xmlTag(body, "gameLink") ?? "";
    recentlyPlayed.push({
      appId: Number(/\/app\/(\d+)/.exec(link)?.[1] ?? 0),
      name: xmlTag(body, "gameName") ?? "",
      playtimeMinutes: Math.round(Number(xmlTag(body, "hoursOnRecord")?.replace(/,/g, "") ?? 0) * 60),
      playtime2WeeksMinutes: Math.round(Number(xmlTag(body, "hoursPlayed") ?? 0) * 60),
      iconUrl: xmlTag(body, "gameIcon"),
    });
  }
  const privacy = xmlTag(xml, "privacyState");
  return {
    steamId,
    personaName: xmlTag(xml, "steamID") ?? steamId,
    profileUrl: `https://steamcommunity.com/profiles/${steamId}/`,
    avatar: xmlTag(xml, "avatarFull") ?? null,
    visibility: privacy === "public" || privacy === "private" || privacy === "friendsonly" ? privacy : "unknown",
    memberSince: xmlTag(xml, "memberSince"),
    ownedGames: null,
    gameCount: null,
    recentlyPlayed,
    source: "community-xml",
    degraded: true,
    reason,
    fetchedAt: new Date().toISOString(),
  };
}

/** Creates the Steam sign-in surface. Resolves secrets once at startup. */
export async function createSteamSignIn(options: SteamSignInOptions): Promise<SteamSignIn> {
  const origin = new URL(options.publicOrigin).origin;
  const base = (options.basePath ?? "/auth/steam").replace(/\/$/, "");
  const cookie = options.cookieName ?? "__Host-steam";
  const stateCookie = `${cookie}-state`;
  const ttl = (options.sessionTtlSeconds ?? 7 * 86_400) * 1000;
  const service = options.secretService ?? SECRET_SERVICE;
  const key = options.sessionKey ?? (await ensureSessionKey(service));
  const apiKey = options.webApiKey ?? (await storedSecret(service, "web-api-key")) ?? webApiKey();
  const nonces = options.nonces ?? memoryNonceStore();
  const callbackUrl = `${origin}${base}/callback`;
  const profiles = new Map<string, { at: number; value: SteamProfile }>();

  const sign = (payload: string) => new Bun.CryptoHasher("sha256", key).update(payload).digest("base64url");
  const seal = (value: unknown) => {
    const payload = b64(JSON.stringify(value));
    return `${payload}.${sign(payload)}`;
  };
  const open = <T>(raw: string | null | undefined): T | null => {
    if (!raw) return null;
    const dot = raw.lastIndexOf(".");
    if (dot <= 0) return null;
    const payload = raw.slice(0, dot);
    if (!safeEqual(raw.slice(dot + 1), sign(payload))) return null;
    try {
      return JSON.parse(unb64(payload)) as T;
    } catch {
      return null;
    }
  };
  const cookies = (request: Request) => new Bun.CookieMap(request.headers.get("cookie") ?? "");
  const setCookie = (name: string, value: string, maxAgeMs: number) =>
    `${name}=${value}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}; HttpOnly; Secure; SameSite=Lax`;

  const session = (request: Request): SteamSession | null => {
    const value = open<SteamSession>(cookies(request).get(cookie));
    return value && value.exp > Date.now() && /^\d{17}$/.test(value.steamId) ? value : null;
  };
  const csrfToken = (s: SteamSession) => Bun.CSRF.generate(key, { sessionId: s.sid, expiresIn: 2 * 3_600_000 });
  const verifyCsrf = (request: Request, token?: string | null) => {
    const s = session(request);
    const value = token ?? request.headers.get("x-csrf-token");
    return (
      !!s &&
      !!value &&
      Bun.CSRF.verify(value, {
        secret: key,
        sessionId: s.sid,
        maxAge: 2 * 3_600_000,
      })
    );
  };
  const profile = async (steamId: string): Promise<SteamProfile> => {
    if (!/^\d{17}$/.test(steamId)) throw new Error("invalid SteamID64");
    const cached = profiles.get(steamId);
    if (cached && Date.now() - cached.at < PROFILE_TTL_MS) return cached.value;
    const value = apiKey
      ? await profileFromWebApi(apiKey, steamId).catch(error =>
          profileFromCommunity(steamId, `Web API failed: ${(error as Error).message}`),
        )
      : await profileFromCommunity(
          steamId,
          "no Steam Web API key configured (Bun.secrets aphrody.steam/web-api-key or STEAM_WEB_API_KEY)",
        );
    profiles.set(steamId, { at: Date.now(), value });
    return value;
  };

  const routes: SteamSignIn["routes"] = {
    [base]: {
      GET: () => {
        const state = randomId();
        const returnTo = `${callbackUrl}?state=${state}`;
        return redirect(openIdLoginUrl(returnTo, origin), [
          setCookie(stateCookie, seal({ state, exp: Date.now() + STATE_TTL_MS }), STATE_TTL_MS),
        ]);
      },
    },
    [`${base}/callback`]: {
      GET: async request => {
        const url = new URL(request.url);
        const query = url.searchParams;
        const clearState = setCookie(stateCookie, "", 0);
        const denied = (reason: string) =>
          redirect(`${options.afterLogin ?? "/"}?auth=denied&reason=${encodeURIComponent(reason)}`, [clearState]);
        const stored = open<{ state: string; exp: number }>(cookies(request).get(stateCookie));
        const state = query.get("state") ?? "";
        if (!stored || stored.exp < Date.now() || !safeEqual(stored.state, state)) return denied("state");
        // The assertion must name this exact callback, and this request must be that callback.
        const expected = `${callbackUrl}?state=${state}`;
        if (`${origin}${url.pathname}` !== callbackUrl) return denied("origin");
        const checked = checkAssertion(query, expected);
        if ("error" in checked) return denied(checked.error);
        const nonce = query.get("openid.response_nonce")!;
        if (!(await nonces.claim(nonce, Date.now() + 2 * NONCE_SKEW_MS))) return denied("replay");
        const assertion = new URLSearchParams([...query].filter(([name]) => name.startsWith("openid.")));
        const verified = await openIdVerify(assertion).catch(() => null);
        if (!verified || verified !== checked.steamId) return denied("check_authentication");
        if (options.allow && !(await options.allow(verified))) return denied("not allowed");
        const now = Date.now();
        const s: SteamSession = {
          steamId: verified,
          sid: randomId(),
          iat: now,
          exp: now + ttl,
        };
        await options.onSignIn?.(s);
        return redirect(options.afterLogin ?? "/", [clearState, setCookie(cookie, seal(s), ttl)]);
      },
    },
    [`${base}/session`]: {
      GET: request => {
        const s = session(request);
        return Response.json(
          s
            ? {
                authenticated: true,
                steamId: s.steamId,
                expiresAt: new Date(s.exp).toISOString(),
                csrfToken: csrfToken(s),
                webApi: !!apiKey,
              }
            : { authenticated: false, login: base },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
    [`${base}/profile`]: {
      GET: async request => {
        const s = session(request);
        if (!s) return Response.json({ error: "authentication required" }, { status: 401 });
        try {
          return Response.json(await profile(s.steamId), {
            headers: { "cache-control": "private, max-age=60" },
          });
        } catch (error) {
          return Response.json({ error: (error as Error).message }, { status: 502 });
        }
      },
    },
    [`${base}/logout`]: {
      POST: request => {
        if (!verifyCsrf(request)) return Response.json({ error: "invalid CSRF token" }, { status: 403 });
        return new Response(null, {
          status: 204,
          headers: { "set-cookie": setCookie(cookie, "", 0) },
        });
      },
    },
  };

  return {
    routes,
    session,
    csrfToken,
    verifyCsrf,
    profile,
    hasWebApiKey: !!apiKey,
  };
}
