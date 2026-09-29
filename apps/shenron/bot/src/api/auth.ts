import { timingSafeEqualString } from "@shenron/auth/crypto";
import {
	authorize,
	legacySessionStrategy,
	sessionStrategy,
	staticBearerStrategy,
	type AuthDecision,
} from "@shenron/auth/guards";
import type { StaffPolicy } from "@shenron/auth/staff";
import { env } from "~/lib/env";
import { getBetterAuthSession } from "~/lib/better-auth";
import { logger } from "~/lib/logger";
import { readCookie, verifySession, type SessionPayload } from "./session";
import { discordIdForBaUser, isBotStaff } from "./staff-check";
import { verifyActingUser } from "./user-auth";

/**
 * Auth admin pour les routes protégées de l'API.
 *
 * `authorize()` de `@shenron/auth/guards` sur trois stratégies, dans cet ordre
 * (inchangé) :
 *   1. **Bearer token** (`Authorization: Bearer <API_ADMIN_TOKEN>`, préfixe exact)
 *      — clients API. Un mauvais jeton est un 401 final ; jeton non configuré → 503.
 *   2. **Better Auth** (`shenron_ba_session_token` cookie + DB ba_session) —
 *      flow OAuth Discord moderne, géré par /api/auth/* (Better Auth handler).
 *   3. **Cookie session HMAC** (`shenron_session=<signed>`) — flow legacy
 *      `/auth/login` (token) ou `/auth/discord` (manuel).
 *
 * S1 (docs/STACK.md §2.2) : une session Better Auth ou un cookie hérité
 * `source=discord` n'ouvre l'admin que si le compte Discord est encore dans la
 * politique staff du bot (`staffPolicyFromEnv(env, "bot")`) ; sinon 403. Le
 * cookie hérité `source=token` (issu du jeton admin) reste accepté tel quel.
 *
 * Si aucun ne match → 401.
 */

/** Corps du refus S1 (session authentifiée mais hors politique staff). */
export const ADMIN_FORBIDDEN_MESSAGE = "Accès admin refusé.";

/** Dépendances de `checkAdmin`, injectables pour les tests. */
export interface CheckAdminDeps {
	/** `API_ADMIN_TOKEN`, lu à chaque appel. */
	adminToken(): string | undefined;
	/** Session Better Auth de la requête (jamais d'exception). */
	betterAuthSession(req: Request): Promise<{ user?: { id: string } | null } | null | undefined>;
	/** Snowflake Discord lié à un utilisateur Better Auth. */
	discordIdForBaUser(baUserId: string): Promise<string | null>;
	/** Cookie de session HMAC hérité, vérifié. */
	legacySession(req: Request): Promise<Pick<SessionPayload, "source" | "userId"> | null>;
	/** Politique staff du bot. */
	isStaff(discordId: string | null | undefined): boolean;
}

export const defaultCheckAdminDeps: CheckAdminDeps = {
	adminToken: () => env.API_ADMIN_TOKEN,
	betterAuthSession: (req) => getBetterAuthSession(req),
	discordIdForBaUser: (baUserId) => discordIdForBaUser(baUserId),
	legacySession: (req) => verifySession(readCookie(req, "shenron_session")),
	isStaff: isBotStaff,
};

/** Décision `@shenron/auth` pour la politique admin du bot. */
export function authorizeAdmin(
	req: Request,
	deps: CheckAdminDeps = defaultCheckAdminDeps
): Promise<AuthDecision> {
	const staff: StaffPolicy = { ids: new Set<string>(), isStaff: (id) => deps.isStaff(id) };
	return authorize(req, [
		staticBearerStrategy({
			tokens: () => [deps.adminToken()],
			as: { kind: "admin-token", via: "bearer" },
			wrongBearerIsFinal: true,
			unsetIs503: true,
			caseSensitive: true,
		}),
		sessionStrategy({
			async getSession() {
				const session = await deps.betterAuthSession(req);
				return session?.user ? { user: session.user } : null;
			},
			accounts: {
				async discordIdForUser(baUserId) {
					try {
						return await deps.discordIdForBaUser(baUserId);
					} catch (err) {
						// Fail closed : sans compte Discord lisible, pas d'accès admin.
						logger.error({ err, baUserId }, "Admin bot : lecture ba_account impossible");
						throw err;
					}
				},
			},
			staff,
			requireStaff: true,
		}),
		legacySessionStrategy({ verify: (request) => deps.legacySession(request), staff }),
	]);
}

/** Corps historiques des refus de `checkAdmin` (inchangés). */
function denial(decision: Extract<AuthDecision, { ok: false }>): Response {
	switch (decision.code) {
		case "not_configured":
			return Response.json(
				{ error: "API_ADMIN_TOKEN non configuré côté bot — route admin désactivée." },
				{ status: 503 }
			);
		case "invalid_token":
			return Response.json({ error: "Token invalide." }, { status: 401 });
		case "forbidden":
			return Response.json({ error: ADMIN_FORBIDDEN_MESSAGE }, { status: 403 });
		default:
			return Response.json({ error: "Authorization requise." }, { status: 401 });
	}
}

export async function checkAdmin(
	req: Request,
	deps: CheckAdminDeps = defaultCheckAdminDeps
): Promise<Response | null> {
	const decision = await authorizeAdmin(req, deps);
	if (decision.ok) return null;
	if (decision.code === "forbidden") {
		logger.warn("Admin bot refusé : session hors politique staff (S1)");
	}
	return denial(decision);
}

/** Égalité à durée constante (`timingSafeEqualString` de `@shenron/auth/crypto`). */
function constantTimeEqual(a: string, b: string): boolean {
	return timingSafeEqualString(a, b);
}

export { constantTimeEqual };

// ── S7 : téléversement d'assets par un membre signé (acting-user) ─────────

/**
 * Sous-dossiers de `/api/assets/upload` ouverts à une signature acting-user
 * (S7) : uniquement les images de tierlist des membres. Tout autre périmètre
 * (assets wiki curés) reste réservé à `checkAdmin`.
 */
export const ACTING_USER_UPLOAD_SUBDIRS: ReadonlySet<string> = new Set(["tierlists"]);

export type AssetUploadAuth =
	| { ok: true; via: "admin" }
	| { ok: true; via: "acting-user"; discordId: string }
	| { ok: false; response: Response };

export interface AssetUploadDeps {
	checkAdmin(req: Request): Promise<Response | null>;
	actingUser(req: Request): string | null;
}

const defaultAssetUploadDeps: AssetUploadDeps = {
	checkAdmin: (req) => checkAdmin(req),
	actingUser: (req) => verifyActingUser(req),
};

/**
 * Auth de `/api/assets/upload` : le Bearer admin (et toute la politique
 * `checkAdmin`) passe inchangé ; à défaut, une signature acting-user valide
 * est admise, le périmètre étant vérifié après lecture du formulaire par
 * {@link assetUploadScopeDenied}. Sans l'un ni l'autre : refus de `checkAdmin`.
 */
export async function authorizeAssetUpload(
	req: Request,
	deps: AssetUploadDeps = defaultAssetUploadDeps
): Promise<AssetUploadAuth> {
	const denied = await deps.checkAdmin(req);
	if (!denied) return { ok: true, via: "admin" };
	const discordId = deps.actingUser(req);
	if (discordId) return { ok: true, via: "acting-user", discordId };
	return { ok: false, response: denied };
}

/** Refus 403 quand un membre signé vise un périmètre autre que la tierlist. */
export function assetUploadScopeDenied(
	auth: Extract<AssetUploadAuth, { ok: true }>,
	subdir: string
): Response | null {
	if (auth.via === "admin" || ACTING_USER_UPLOAD_SUBDIRS.has(subdir)) return null;
	return Response.json({ error: "Périmètre de téléversement refusé." }, { status: 403 });
}
