/**
 * Helpers pour récupérer un access_token Discord valide depuis une session OAuth.
 * Refresh transparent si expiré (skew 60s).
 *
 * Deux sources possibles :
 *   1. Cookie HMAC legacy `shenron_session` (flow `/auth/discord` manuel) — tokens dans le cookie.
 *   2. Better Auth (cookie `shenron_ba_session_token` + table `ba_account`) — tokens dans la DB.
 */

import { and, eq } from "drizzle-orm";
import { container } from "tsyringe";
import { DatabaseService } from "~/db/index";
import { baAccount } from "~/db/schema";
import { getBetterAuthSession } from "~/lib/better-auth";
import { logger } from "~/lib/logger";
import { getOAuthConfig, refreshTokens } from "./oauth";
import {
	buildSessionCookie,
	createSession,
	readCookie,
	verifySession,
	type SessionPayload,
} from "./session";

const SKEW_MS = 60_000;

export interface UsableSession {
	payload: SessionPayload;
	/**
	 * Si le token a été refresh, ce champ contient un nouveau cookie à attacher en
	 * Set-Cookie sur la réponse. Sinon `undefined`.
	 */
	refreshedCookie?: string;
}

export async function getDiscordSession(req: Request): Promise<UsableSession | null> {
	// Source 1 : cookie HMAC legacy
	const cookie = readCookie(req, "shenron_session");
	const payload = await verifySession(cookie);
	if (
		payload &&
		payload.source === "discord" &&
		payload.accessToken &&
		payload.refreshToken &&
		payload.accessTokenExpiresAt
	) {
		if (payload.accessTokenExpiresAt > Date.now() + SKEW_MS) return { payload };

		const config = getOAuthConfig();
		if (config) {
			try {
				const tokens = await refreshTokens(config, payload.refreshToken);
				const next = await createSession({
					userId: payload.userId!,
					username: payload.username!,
					avatar: payload.avatar ?? null,
					email: payload.email,
					accessToken: tokens.access_token,
					refreshToken: tokens.refresh_token ?? payload.refreshToken,
					accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
				});
				return {
					payload: {
						...payload,
						accessToken: tokens.access_token,
						refreshToken: tokens.refresh_token ?? payload.refreshToken,
						accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
					},
					refreshedCookie: buildSessionCookie(next),
				};
			} catch (err) {
				logger.warn({ err }, "OAuth refresh (legacy) failed");
			}
		}
	}

	// Source 2 : Better Auth — tokens dans ba_account
	const baSession = await getBetterAuthSession(req);
	if (!baSession?.user) return null;

	const dbs = container.resolve(DatabaseService);
	const accounts = await dbs.db
		.select()
		.from(baAccount)
		.where(and(eq(baAccount.userId, baSession.user.id), eq(baAccount.providerId, "discord")))
		.limit(1);
	const acc = accounts[0];
	if (!acc?.accessToken) return null;

	let accessToken = acc.accessToken;
	let refreshToken = acc.refreshToken ?? "";
	let expiresAt =
		acc.accessTokenExpiresAt instanceof Date
			? acc.accessTokenExpiresAt.getTime()
			: Number(acc.accessTokenExpiresAt) || 0;

	// Refresh si expiré
	if (expiresAt && expiresAt <= Date.now() + SKEW_MS && refreshToken) {
		const config = getOAuthConfig();
		if (config) {
			try {
				const tokens = await refreshTokens(config, refreshToken);
				accessToken = tokens.access_token;
				refreshToken = tokens.refresh_token ?? refreshToken;
				expiresAt = Date.now() + tokens.expires_in * 1000;
				await dbs.db
					.update(baAccount)
					.set({
						accessToken,
						refreshToken,
						accessTokenExpiresAt: new Date(expiresAt),
						updatedAt: new Date(),
					})
					.where(eq(baAccount.id, acc.id));
			} catch (err) {
				logger.warn({ err }, "OAuth refresh (better-auth) failed");
				return null;
			}
		}
	}

	return {
		payload: {
			source: "discord",
			userId: acc.accountId,
			username: baSession.user.name ?? baSession.user.email ?? "user",
			avatar: baSession.user.image ?? null,
			email: baSession.user.email ?? undefined,
			accessToken,
			refreshToken,
			accessTokenExpiresAt: expiresAt || undefined,
		} as SessionPayload,
	};
}
