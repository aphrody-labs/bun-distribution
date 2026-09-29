import { botStaffPolicy, env } from "~/lib/env";

/**
 * Discord OAuth2 authorization-code flow pour le dashboard.
 *
 * 1. GET /auth/discord → redirect vers discord.com/oauth2/authorize avec `state` aléatoire
 *    posé en cookie httpOnly SameSite=Lax (Strict bloque le cross-site redirect retour).
 * 2. Discord redirect → GET /auth/callback?code=&state= → on échange le code contre un
 *    access_token (server-side, le client_secret ne quitte pas le bot), on récupère le
 *    profil via /users/@me, on vérifie la whitelist, on pose un cookie session signé.
 *
 * Whitelist : OWNER_ID + OAUTH_ALLOWED_USERS (CSV). Si la whitelist est vide, seul
 * OWNER_ID peut se connecter.
 */

const DISCORD_AUTHORIZE = "https://discord.com/oauth2/authorize";
const DISCORD_TOKEN = "https://discord.com/api/oauth2/token";
const DISCORD_REVOKE = "https://discord.com/api/oauth2/token/revoke";
const DISCORD_USER = "https://discord.com/api/users/@me";
// identify : profil ; email : adresse + verified ; guilds : /users/@me/guilds ;
// guilds.members.read : membership/roles dans une guild sans privileged intent.
const SCOPES = ["identify", "email", "guilds", "guilds.members.read"];

export interface OAuthConfig {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
}

export function getOAuthConfig(): OAuthConfig | null {
	if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.OAUTH_REDIRECT_URI) {
		return null;
	}
	return {
		clientId: env.DISCORD_CLIENT_ID,
		clientSecret: env.DISCORD_CLIENT_SECRET,
		redirectUri: env.OAUTH_REDIRECT_URI,
	};
}

export function buildAuthorizeUrl(config: OAuthConfig, state: string): string {
	const url = new URL(DISCORD_AUTHORIZE);
	url.searchParams.set("client_id", config.clientId);
	url.searchParams.set("redirect_uri", config.redirectUri);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("scope", SCOPES.join(" "));
	url.searchParams.set("state", state);
	return url.toString();
}

export function generateState(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const SECURE = env.NODE_ENV === "production" ? "Secure; " : "";

export function buildStateCookie(state: string): string {
	// Lax requis pour survivre au redirect cross-site Discord → /auth/callback.
	// 10 min suffisent largement pour faire le flow.
	return `shenron_oauth_state=${state}; Path=/; HttpOnly; ${SECURE}SameSite=Lax; Max-Age=600`;
}

export function clearStateCookie(): string {
	return `shenron_oauth_state=; Path=/; HttpOnly; ${SECURE}SameSite=Lax; Max-Age=0`;
}

export interface TokenResponse {
	access_token: string;
	token_type: string;
	expires_in: number;
	refresh_token?: string;
	scope: string;
}

export async function exchangeCode(config: OAuthConfig, code: string): Promise<TokenResponse> {
	const body = new URLSearchParams({
		client_id: config.clientId,
		client_secret: config.clientSecret,
		grant_type: "authorization_code",
		code,
		redirect_uri: config.redirectUri,
	});
	const res = await fetch(DISCORD_TOKEN, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
	});
	if (!res.ok) throw new Error(`token exchange ${res.status}: ${await res.text().catch(() => "")}`);
	return (await res.json()) as TokenResponse;
}

export async function refreshTokens(
	config: OAuthConfig,
	refreshToken: string
): Promise<TokenResponse> {
	const body = new URLSearchParams({
		client_id: config.clientId,
		client_secret: config.clientSecret,
		grant_type: "refresh_token",
		refresh_token: refreshToken,
	});
	const res = await fetch(DISCORD_TOKEN, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
	});
	if (!res.ok) throw new Error(`refresh ${res.status}: ${await res.text().catch(() => "")}`);
	return (await res.json()) as TokenResponse;
}

export async function revokeToken(config: OAuthConfig, token: string): Promise<void> {
	const body = new URLSearchParams({
		client_id: config.clientId,
		client_secret: config.clientSecret,
		token,
	});
	await fetch(DISCORD_REVOKE, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
	}).catch(() => {});
}

export interface DiscordUser {
	id: string;
	username: string;
	global_name: string | null;
	avatar: string | null;
	banner?: string | null;
	accent_color?: number | null;
	email?: string;
	verified?: boolean;
	locale?: string;
}

export async function fetchUser(accessToken: string): Promise<DiscordUser> {
	const res = await fetch(DISCORD_USER, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (!res.ok) throw new Error(`/users/@me ${res.status}`);
	return (await res.json()) as DiscordUser;
}

export function isUserAllowed(userId: string): boolean {
	// Politique staff du bot (`staffPolicyFromEnv(env, "bot")`).
	return botStaffPolicy().isStaff(userId);
}
