import jwt, { type JwtPayload } from "jsonwebtoken";
import {
	ACHILLEA_AUTH_ISSUER,
	ACHILLEA_REALTIME_AUDIENCE,
	ACHILLEA_REALTIME_TTL_SECONDS,
	ACHILLEA_SESSION_AUDIENCE,
	ACHILLEA_SESSION_COOKIE_NAME,
	ACHILLEA_SESSION_TTL_SECONDS,
	type AchilleaSessionIdentity,
} from "@rosegriffon/achillea-core";

export const SESSION_COOKIE_NAME = ACHILLEA_SESSION_COOKIE_NAME;
export const AUTH_ISSUER = ACHILLEA_AUTH_ISSUER;
export const SESSION_AUDIENCE = ACHILLEA_SESSION_AUDIENCE;
export const REALTIME_AUDIENCE = ACHILLEA_REALTIME_AUDIENCE;
export const SESSION_TTL_SECONDS = ACHILLEA_SESSION_TTL_SECONDS;
export const REALTIME_TTL_SECONDS = ACHILLEA_REALTIME_TTL_SECONDS;

export type AuthTokenUse = "session" | "realtime";

export interface SessionIdentity extends AchilleaSessionIdentity {
	sim?: number;
}

type AuthPayload = JwtPayload &
	SessionIdentity & {
		tokenUse?: AuthTokenUse;
	};

function secret(): string {
	const value = process.env.JWT_SECRET_KEY;
	if (!value) throw new Error("JWT_SECRET_KEY missing");
	return value;
}

function audienceFor(use: AuthTokenUse): string {
	return use === "session" ? SESSION_AUDIENCE : REALTIME_AUDIENCE;
}

function normalizeIdentity(payload: AuthPayload): SessionIdentity {
	const id = typeof payload.id === "string" && payload.id ? payload.id : payload.sub;
	if (typeof id !== "string" || !id) throw new Error("Token sans id");
	if (payload.id && payload.sub && payload.id !== payload.sub) {
		throw new Error("Token identity mismatch");
	}

	return {
		id,
		username: typeof payload.username === "string" ? payload.username : undefined,
		avatar: typeof payload.avatar === "string" ? payload.avatar : undefined,
		sim: typeof payload.sim === "number" ? payload.sim : undefined,
	};
}

/** Verifies a signed Achillea token and enforces its intended use. */
function verifyAuthToken(token: string, acceptedUse: AuthTokenUse): SessionIdentity {
	const decoded = jwt.verify(token, secret(), { algorithms: ["HS256"] });
	if (typeof decoded === "string") throw new Error("Invalid token payload");
	const payload = decoded as AuthPayload;

	if (payload.tokenUse !== acceptedUse) throw new Error("Invalid token use");
	if (payload.iss !== AUTH_ISSUER) throw new Error("Invalid token issuer");
	const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
	if (!audiences.includes(audienceFor(acceptedUse))) throw new Error("Invalid token audience");
	if (typeof payload.exp !== "number") throw new Error("Token expiry missing");

	return normalizeIdentity(payload);
}

export function verifySessionToken(token: string): SessionIdentity {
	return verifyAuthToken(token, "session");
}

export function verifyRealtimeToken(token: string): SessionIdentity {
	return verifyAuthToken(token, "realtime");
}

export function getCookieValue(header: string | null | undefined, name: string): string | null {
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

export function sessionCookieOptions(secure: boolean) {
	const domain =
		process.env.SESSION_COOKIE_DOMAIN ??
		(secure && process.env.NODE_ENV === "production" ? ".rosegriffon.fr" : undefined);
	return {
		httpOnly: true,
		secure,
		sameSite: "lax" as const,
		maxAge: SESSION_TTL_SECONDS * 1000,
		path: "/",
		...(domain ? { domain } : {}),
	};
}

export function sessionClearCookieOptions(secure: boolean) {
	const { maxAge: _maxAge, ...options } = sessionCookieOptions(secure);
	return options;
}
