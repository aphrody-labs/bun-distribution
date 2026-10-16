import { createHmac } from "node:crypto";
import {
	ACHILLEA_AUTH_ISSUER,
	ACHILLEA_REALTIME_AUDIENCE,
	ACHILLEA_REALTIME_TTL_SECONDS,
	ACHILLEA_SESSION_AUDIENCE,
	ACHILLEA_SESSION_TTL_SECONDS,
	type AchilleaSessionIdentity,
} from "@rosegriffon/achillea-core/auth";

/**
 * Contract shared by the Rose Griffon identity bridge and Achilléa services.
 * Better Auth owns identity; this purpose-bound token only carries it to
 * Achilléa API, ranked, and realtime consumers.
 */
export {
	ACHILLEA_AUTH_ISSUER,
	ACHILLEA_SESSION_AUDIENCE,
	ACHILLEA_SESSION_TTL_SECONDS,
	type AchilleaSessionIdentity,
};
export { ACHILLEA_SESSION_COOKIE_NAME, ACHILLEA_REALTIME_AUDIENCE, ACHILLEA_REALTIME_TTL_SECONDS } from "@rosegriffon/achillea-core/auth";

function base64url(value: Buffer | string): string {
	return Buffer.from(value)
		.toString("base64")
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

/** Signs the web-session JWT consumed by Achilléa services. */
export function signAchilleaSessionToken(
	identity: AchilleaSessionIdentity,
	secret: string,
	now = Math.floor(Date.now() / 1000)
): string {
	if (!identity.id) throw new Error("Cannot sign an Achillea token without a Discord identifier");

	const payload = {
		id: identity.id,
		...(identity.username ? { username: identity.username } : {}),
		...(identity.avatar ? { avatar: identity.avatar } : {}),
		tokenUse: "session",
		sub: identity.id,
		iss: ACHILLEA_AUTH_ISSUER,
		aud: ACHILLEA_SESSION_AUDIENCE,
		iat: now,
		exp: now + ACHILLEA_SESSION_TTL_SECONDS,
	};

	const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
	const body = base64url(JSON.stringify(payload));
	const signature = base64url(createHmac("sha256", secret).update(`${header}.${body}`).digest());
	return `${header}.${body}.${signature}`;
}

/** Signs the short-lived purpose-bound token consumed by realtime/Colyseus. */
export function signAchilleaRealtimeToken(
	identity: AchilleaSessionIdentity,
	secret: string,
	now = Math.floor(Date.now() / 1000)
): string {
	if (!identity.id) throw new Error("Cannot sign an Achillea token without a user identifier");
	const payload = {
		id: identity.id,
		...(identity.username ? { username: identity.username } : {}),
		...(identity.avatar ? { avatar: identity.avatar } : {}),
		tokenUse: "realtime",
		sub: identity.id,
		iss: ACHILLEA_AUTH_ISSUER,
		aud: ACHILLEA_REALTIME_AUDIENCE,
		iat: now,
		exp: now + ACHILLEA_REALTIME_TTL_SECONDS,
	};
	const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
	const body = base64url(JSON.stringify(payload));
	const signature = base64url(createHmac("sha256", secret).update(`${header}.${body}`).digest());
	return `${header}.${body}.${signature}`;
}
