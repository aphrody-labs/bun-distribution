/**
 * Résolution admin **directe** pour le proxy (`proxy.ts`), sans aller-retour
 * réseau vers `/api/me`.
 *
 * Historique : le proxy faisait `fetch("/api/me")` sur `request.nextUrl.origin`.
 * Côté VPS, cet origin est en `http://` (connexion interne nginx→Next) → nginx
 * répond `301 → https` et undici (fetch Node) **droppe l'en-tête Cookie** au
 * changement de schéma (origin cross) → `/api/me` ne voit plus la session → admin
 * traité comme anonyme et redirigé vers l'accueil (bug « je ne vois pas les pages
 * wiki/tierlist en tant qu'admin »). En prime : rate-limit nginx `/api/`, TLS et
 * timeout 2500 ms fail-closed.
 *
 * Le proxy Next 16 tourne en **runtime Node.js** (cf. docs `proxy.md` : « Proxy
 * defaults to using the Node.js runtime ») → on peut lire la session Better Auth
 * et la DB Postgres directement, en process, à partir des en-têtes/cookies de la
 * requête (jamais `next/headers`, indispo dans le proxy). Zéro réseau, zéro nginx.
 *
 * Même politique staff que `lib/session.ts` (`staffPolicyFromEnv(env, "site")`) : token admin OU
 * `roleAdmin` persisté OU Discord ∈ `OWNER_ID`/`OAUTH_ALLOWED_USERS`.
 */
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { parseBearer } from "@shenron/auth/crypto";
import { staffPolicyFromEnv } from "@shenron/auth/staff";
import { createDiscordAccountLookup } from "@shenron/db/repos/accounts";
import { env } from "@/lib/env";
import { ADMIN_COOKIE, verifyAdminCookie, verifyAdminTokenOrBearer } from "@/lib/admin-token";
import { authenticateAgent } from "@/lib/agent-keys";

export interface Visitor {
	/** Staff du site (token admin, `roleAdmin`, owner ou allowlist env). */
	isAdmin: boolean;
	/** Session Better Auth valide (compte lié, pas forcément Discord). */
	authenticated: boolean;
	/** Snowflake Discord lié à la session — nécessaire au gating par rôle. */
	discordId: string | null;
}

/** Lookup `ba_account` (provider discord), le même que `lib/session.ts`. */
const discordAccounts = createDiscordAccountLookup(db);

/**
 * Identité du visiteur en UN passage : le gating par rôle a besoin du couple
 * (staff ?, quel Discord ?), et refaire deux fois la lecture de session +
 * jointure `baAccount` doublerait le coût sur le hot-path du proxy.
 */
export async function resolveVisitor(request: NextRequest): Promise<Visitor> {
	// 1) Admin par cookie signé HMAC
	if (verifyAdminCookie(request.cookies.get(ADMIN_COOKIE)?.value)) {
		return { isAdmin: true, authenticated: true, discordId: null };
	}

	// 2) Admin par en-tête explicite x-admin-token
	const xAdminToken = request.headers.get("x-admin-token");
	if (xAdminToken && verifyAdminTokenOrBearer(xAdminToken)) {
		return { isAdmin: true, authenticated: true, discordId: null };
	}

	// 3) Admin par Authorization: Bearer
	const bearer = parseBearer(request.headers);
	if (bearer) {
		if (verifyAdminTokenOrBearer(bearer)) {
			return { isAdmin: true, authenticated: true, discordId: null };
		}
		if (bearer.startsWith("dbfr_agent_")) {
			const agent = await authenticateAgent(request).catch(() => null);
			if (
				agent &&
				(agent.scopes.includes("moderate") ||
					agent.scopes.includes("publish:articles") ||
					agent.scopes.includes("write:articles"))
			) {
				return { isAdmin: true, authenticated: true, discordId: null };
			}
		}
	}

	// 4) Session Discord (Better Auth) lue depuis les en-têtes de la requête.
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session?.user) return { isAdmin: false, authenticated: false, discordId: null };

	// Discord ID lié (même lookup que `session.ts`) → clé du user métier et de
	// la politique staff du site.
	const discordId = await discordAccounts.discordIdForUser(session.user.id);
	if (!discordId) return { isAdmin: false, authenticated: true, discordId: null };

	let isAdmin = staffPolicyFromEnv(
		{ OWNER_ID: env.OWNER_ID, OAUTH_ALLOWED_USERS: env.OAUTH_ALLOWED_USERS.join(",") },
		"site"
	).isStaff(discordId);
	if (!isAdmin) {
		const [row] = await db
			.select({ roleAdmin: users.roleAdmin })
			.from(users)
			.where(eq(users.discordId, discordId))
			.limit(1);
		isAdmin = row?.roleAdmin === true;
	}

	return { isAdmin, authenticated: true, discordId };
}

async function isRequestAdmin(request: NextRequest): Promise<boolean> {
	return (await resolveVisitor(request)).isAdmin;
}
