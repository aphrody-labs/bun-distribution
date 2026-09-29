import { timingSafeEqualString } from "@shenron/auth/crypto";
import { env } from "~/lib/env";
import { logger } from "~/lib/logger";
import { container } from "tsyringe";
import { SettingsService } from "~/services/SettingsService";

/**
 * Sessions signées simples — HMAC SHA-256 sur `expiresAt`.
 *
 * Le cookie `shenron_session=<base64url payload>.<base64url sig>` est posé après
 * un POST /auth/login réussi (token == API_ADMIN_TOKEN). Vérifié à chaque
 * requête via `verifySession()`.
 *
 * Pas de DB, pas de stockage côté serveur — stateless. Si l'admin token tourne,
 * toutes les sessions sont invalidées (le secret HMAC dérive du token).
 */

const DEFAULT_TTL_DAYS = 7;
/** TTL dynamique read at runtime — admin peut changer via /admin/settings api.session_ttl_days */
async function getTtlMs(): Promise<number> {
	try {
		const days = await container
			.resolve(SettingsService)
			.getInt("api.session_ttl_days", DEFAULT_TTL_DAYS);
		return days * 24 * 60 * 60 * 1000;
	} catch {
		return DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000;
	}
}
const TTL_MS = DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000; // fallback synchrone

export interface SessionPayload {
	v: 2;
	expiresAt: number;
	createdAt: number;
	// OAuth user (présent pour sessions Discord, absent pour sessions token admin)
	userId?: string;
	username?: string;
	avatar?: string | null;
	email?: string;
	source: "token" | "discord";
	// Tokens Discord (uniquement pour source=discord). Restent côté serveur — JAMAIS
	// exposés via /auth/me. Le cookie httpOnly + signature HMAC empêche un XSS de les lire.
	accessToken?: string;
	refreshToken?: string;
	accessTokenExpiresAt?: number;
}

/**
 * Avertissement S10 (docs/STACK.md §2.2), émis une fois par processus quand la
 * clé HMAC retombe sur API_ADMIN_TOKEN. Ne contient jamais de valeur.
 */
export const SESSION_SECRET_FALLBACK_WARNING =
	"[auth] SESSION_SECRET absent : repli sur API_ADMIN_TOKEN (déprécié, cf. INFRA-2)";

let sessionSecretFallbackWarned = false;

/** Réarme l'avertissement S10 (tests uniquement). */
export function resetSessionSecretFallbackWarning(): void {
	sessionSecretFallbackWarned = false;
}

function getSecret(): string {
	// SESSION_SECRET dédié si défini ; sinon dérive d'API_ADMIN_TOKEN (rétro-compat).
	// Avantage : rotation API_ADMIN_TOKEN sans invalider les sessions OAuth.
	if (env.SESSION_SECRET) return env.SESSION_SECRET;
	if (!env.API_ADMIN_TOKEN) throw new Error("SESSION_SECRET ou API_ADMIN_TOKEN requis");
	// S10 : repli conservé en Phase 1 (les cookies déjà signés restent valides),
	// mais signalé ; la bascule suit la confirmation de SESSION_SECRET (INFRA-2).
	if (!sessionSecretFallbackWarned) {
		sessionSecretFallbackWarned = true;
		logger.warn(SESSION_SECRET_FALLBACK_WARNING);
	}
	return env.API_ADMIN_TOKEN;
}

function b64url(buf: ArrayBuffer | Uint8Array): string {
	const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
	const norm = s.replace(/-/g, "+").replace(/_/g, "/");
	const pad = norm.length % 4 ? 4 - (norm.length % 4) : 0;
	const bin = atob(norm + "=".repeat(pad));
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

async function hmac(payload: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(getSecret()),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"]
	);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
	return b64url(sig);
}

interface CreateSessionUser {
	userId: string;
	username: string;
	avatar: string | null;
	email?: string;
	accessToken: string;
	refreshToken: string;
	accessTokenExpiresAt: number;
}

export async function createSession(user?: CreateSessionUser): Promise<string> {
	const ttlMs = await getTtlMs();
	const payload: SessionPayload = {
		v: 2,
		createdAt: Date.now(),
		expiresAt: Date.now() + ttlMs,
		source: user ? "discord" : "token",
		...user,
	};
	const json = JSON.stringify(payload);
	const encoded = b64url(new TextEncoder().encode(json));
	const sig = await hmac(encoded);
	return `${encoded}.${sig}`;
}

export async function verifySession(cookie: string | null): Promise<SessionPayload | null> {
	if (!cookie) return null;
	const [encoded, sig] = cookie.split(".");
	if (!encoded || !sig) return null;
	try {
		const expected = await hmac(encoded);
		// Comparaison constant-time (`@shenron/auth/crypto`)
		if (!timingSafeEqualString(sig, expected)) return null;
		const json = new TextDecoder().decode(b64urlDecode(encoded));
		const payload = JSON.parse(json) as SessionPayload;
		if (payload.expiresAt < Date.now()) return null;
		if (!payload.source) payload.source = "token"; // migration v1 → v2
		return payload;
	} catch {
		return null;
	}
}

// `Secure` cookie attribute n'est posé qu'en prod : sur localhost HTTP, Chrome ignore
// les cookies marqués Secure → impossible de se connecter en dev local.
const SECURE = env.NODE_ENV === "production" ? "Secure; " : "";

export function buildSessionCookie(value: string): string {
	const maxAge = Math.floor(TTL_MS / 1000);
	return `shenron_session=${value}; Path=/; HttpOnly; ${SECURE}SameSite=Lax; Max-Age=${maxAge}`;
}

export function buildLogoutCookie(): string {
	return `shenron_session=; Path=/; HttpOnly; ${SECURE}SameSite=Lax; Max-Age=0`;
}

export function readCookie(req: Request, name: string): string | null {
	const header = req.headers.get("cookie");
	if (!header) return null;
	for (const part of header.split(";")) {
		const [k, ...rest] = part.trim().split("=");
		if (k === name) return rest.join("=");
	}
	return null;
}
