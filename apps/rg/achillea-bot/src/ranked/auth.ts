// Adaptateurs transport pour le contrat d'auth centralisé.
import {
	getCookieValue,
	SESSION_COOKIE_NAME,
	type SessionIdentity,
	verifyRealtimeToken,
	verifySessionToken,
} from "@/auth";

export type SessionUser = SessionIdentity;

export function getCookie(cookieHeader: string | null, name: string): string | null {
	return getCookieValue(cookieHeader, name);
}

export function verifyToken(token: string): SessionUser {
	return verifyRealtimeToken(token);
}

export function authFromCookieHeader(header: string | null): SessionUser | null {
	const token = getCookie(header, SESSION_COOKIE_NAME);
	if (!token) return null;
	try {
		return verifySessionToken(token);
	} catch {
		return null;
	}
}

export function authFromAuthorization(header: string | null): SessionUser | null {
	if (!header) return null;
	const m = /^Bearer\s+(.+)$/i.exec(header);
	if (!m) return null;
	try {
		return verifyToken(m[1]);
	} catch {
		return null;
	}
}

// Lit un en-tête quel que soit le support : objet plain (`{ cookie: "..." }`)
// ou instance Web `Headers` (transport Bun WebSockets → `headers.get(name)`).
function readHeader(headers: unknown, name: string): string | null {
	if (!headers) return null;
	if (typeof (headers as Headers).get === "function") {
		return (headers as Headers).get(name);
	}
	const v = (headers as Record<string, unknown>)[name];
	return typeof v === "string" ? v : null;
}

// Auth unifiée pour Colyseus `onAuth(client, options, context)`.
// Colyseus 0.17 (transport Bun) fournit un `context = { token, headers, ip }` :
//   - `context.token` = `_authToken` (query) ?? Bearer de l'en-tête Authorization,
//   - `context.headers` = instance `Headers` (donc accès via `.get()`).
// On tente, dans l'ordre : context.token → cookie `token` → Authorization → options.token.
export function authFromColyseus(options: any, context: any): SessionUser | null {
	const ctxToken = typeof context?.token === "string" ? context.token : null;
	if (ctxToken) {
		try {
			return verifyToken(ctxToken);
		} catch {
			/* on continue avec les autres sources */
		}
	}
	const cookieHeader = readHeader(context?.headers, "cookie");
	const fromCookie = authFromCookieHeader(cookieHeader);
	if (fromCookie) return fromCookie;
	const authHeader = readHeader(context?.headers, "authorization");
	const fromAuth = authFromAuthorization(authHeader);
	if (fromAuth) return fromAuth;
	if (typeof options?.token === "string") {
		try {
			return verifyToken(options.token);
		} catch {
			return null;
		}
	}
	return null;
}
