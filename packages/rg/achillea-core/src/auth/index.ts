/**
 * Portable session vocabulary shared by Achilléa adapters.
 *
 * The cryptographic implementation deliberately lives in the server auth
 * package; this module contains no Node APIs and can therefore be consumed by
 * browser, edge, bot, API, ranked, and realtime code.
 */
export const ACHILLEA_AUTH_ISSUER = "achillea";
export const ACHILLEA_SESSION_AUDIENCE = "achillea-web";
export const ACHILLEA_REALTIME_AUDIENCE = "achillea-realtime";
export const ACHILLEA_SESSION_COOKIE_NAME = "token";
export const ACHILLEA_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const ACHILLEA_REALTIME_TTL_SECONDS = 5 * 60;

export interface AchilleaSessionIdentity {
	id: string;
	username?: string | null;
	avatar?: string | null;
}

export interface AchilleaSessionClaims extends AchilleaSessionIdentity {
	expiresAt: number;
}

function decodeBase64Url(value: string): ArrayBuffer {
	const normalized = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
	const binary = atob(normalized);
	return Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer as ArrayBuffer;
}

/**
 * Verify the shared Achilléa web-session token without Node/JWT dependencies.
 *
 * The unified API, ranked and realtime adapters all consume this contract. Legacy
 * unsigned/untagged tokens are deliberately rejected here; the bot's compatibility
 * verifier remains permissive only during the cookie rollover window.
 */
export async function verifyAchilleaSessionToken(
	token: string,
	secret: string,
	now = Math.floor(Date.now() / 1000)
): Promise<AchilleaSessionClaims | null> {
	if (!token || !secret) return null;
	const parts = token.split(".");
	if (parts.length !== 3) return null;
	const [encodedHeader, encodedPayload, encodedSignature] = parts;
	if (!encodedHeader || !encodedPayload || !encodedSignature) return null;
	try {
		const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedHeader))) as { alg?: string; typ?: string };
		const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload))) as {
			id?: unknown;
			sub?: unknown;
			username?: unknown;
			avatar?: unknown;
			tokenUse?: unknown;
			iss?: unknown;
			aud?: unknown;
			exp?: unknown;
		};
		if (header.alg !== "HS256" || payload.tokenUse !== "session" || payload.iss !== ACHILLEA_AUTH_ISSUER) return null;
		const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
		if (!audience.includes(ACHILLEA_SESSION_AUDIENCE)) return null;
		if (typeof payload.exp !== "number" || payload.exp <= now) return null;
		const id = typeof payload.id === "string" && payload.id ? payload.id : payload.sub;
		if (typeof id !== "string" || !id || (payload.id !== undefined && payload.id !== payload.sub)) return null;

		const key = await crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(secret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["verify"]
		);
		const valid = await crypto.subtle.verify(
			"HMAC",
			key,
			decodeBase64Url(encodedSignature),
			new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
		);
		if (!valid) return null;
		return {
			id,
			username: typeof payload.username === "string" ? payload.username : undefined,
			avatar: typeof payload.avatar === "string" ? payload.avatar : undefined,
			expiresAt: payload.exp,
		};
	} catch {
		return null;
	}
}

/** Constant-time comparison for internal bearer secrets (portable Web runtime). */
export function verifyAdminBearerToken(token: unknown, expected: string | undefined): boolean {
	if (typeof token !== "string" || !expected) return false;
	const left = new TextEncoder().encode(token);
	const right = new TextEncoder().encode(expected);
	let diff = left.length ^ right.length;
	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index += 1) {
		diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
	}
	return diff === 0;
}
