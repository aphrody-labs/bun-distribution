/**
 * Better Auth — handler OAuth Discord robuste avec sessions DB-backed.
 *
 * Coexiste avec les routes legacy `/auth/*` (login token admin) :
 *  - Better Auth servi sur `/api/auth/*` (sign-in, callback, signout, get-session)
 *  - Mes routes legacy restent pour `/auth/login` (token admin)
 *
 * Tables : ba_user, ba_session, ba_account, ba_verification (cf. db/schema.ts).
 *
 * Endpoints principaux :
 *   GET  /api/auth/sign-in/social/discord  → redirect Discord OAuth
 *   GET  /api/auth/callback/discord        → handle code + create session
 *   POST /api/auth/sign-out                → clear session
 *   GET  /api/auth/get-session             → { user, session } | null
 *
 * Doc : https://www.better-auth.com/docs
 */

import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { container } from "tsyringe";
import { DatabaseService } from "~/db/index";
import { baAccount, baSession, baUser, baVerification } from "~/db/schema";
import { discordIdForBaUser, isBotStaff } from "~/api/staff-check";
import { env } from "./env";
import { logger } from "./logger";

import {
	AUTH_BASE_PATH,
	getSessionSafe,
	handleAuthRequest,
	normalizeBaseUrl,
	resolveBetterAuthSecret,
} from "@shenron/auth";
import { SESSION_COOKIE_CACHE, advancedOptions, discordProvider } from "@shenron/auth/options";
import { botTrustedOrigins } from "@shenron/auth/origins";

export { resolveBetterAuthSecret };

/** Dépendances du crochet S1b, injectables pour les tests. */
export interface StaffSessionGateDeps {
	discordIdForBaUser(baUserId: string): Promise<string | null>;
	isStaff(discordId: string | null | undefined): boolean;
}

const defaultStaffSessionGateDeps: StaffSessionGateDeps = {
	discordIdForBaUser: (baUserId) => discordIdForBaUser(baUserId),
	isStaff: isBotStaff,
};

/**
 * S1b — `databaseHooks.session.create.before` (contrat better-auth 1.7.5 :
 * renvoyer `false` annule la création ; le callback OAuth redirige alors vers
 * l'URL d'erreur avec `unable_to_create_session`). Un compte Discord retiré de
 * la liste blanche ne peut plus ouvrir de session, même s'il a déjà un
 * `ba_account`. Échec de lecture = refus (fail closed).
 */
export async function refuseNonStaffSession(
	session: { userId: string },
	deps: StaffSessionGateDeps = defaultStaffSessionGateDeps
): Promise<false | undefined> {
	let discordId: string | null = null;
	try {
		discordId = await deps.discordIdForBaUser(session.userId);
	} catch (err) {
		logger.error({ err, baUserId: session.userId }, "Better Auth — lecture ba_account impossible");
	}
	if (deps.isStaff(discordId)) return undefined;
	logger.warn(
		{ baUserId: session.userId, discordId },
		"Better Auth — session refusée (compte Discord hors politique staff)"
	);
	return false;
}

/** URL publique du handler Better Auth du bot (trim + sans slash final, B10). */
export function botAuthBaseUrl(
	source: Pick<typeof env, "BETTER_AUTH_URL" | "OAUTH_REDIRECT_URI"> = env
): string {
	return normalizeBaseUrl(
		source.BETTER_AUTH_URL ?? source.OAUTH_REDIRECT_URI?.replace(/\/auth\/callback$/, ""),
		"https://bot.dragonballfr.com"
	);
}

/**
 * B10 (docs/STACK.md §2.2) : fournisseur Discord aligné sur le preset partagé —
 * `prompt: "consent"`, portées supplémentaires dédoublonnées (`identify` et
 * `email` sont déjà ajoutées par Better Auth), e-mail de substitution pour les
 * comptes phone-only.
 */
function botDiscordProvider(clientId: string, clientSecret: string) {
	return discordProvider({
		clientId,
		clientSecret,
		extraScopes: ["guilds", "guilds.members.read"],
	});
}

/** Dépendances de {@link buildBotAuthOptions}. */
export interface BotAuthOptionsInput {
	// oxlint-disable-next-line no-explicit-any -- instance Drizzle bun:sqlite du bot
	db: any;
	secret: string;
	discordClientId: string;
	discordClientSecret: string;
	baseURL: string;
	nodeEnv: string | undefined;
}

/**
 * Options Better Auth du bot, sans effet de bord (les tests les construisent
 * sans base ni secret de production).
 */
export function buildBotAuthOptions(input: BotAuthOptionsInput) {
	const production = input.nodeEnv === "production";
	return {
		appName: "Shenron",
		baseURL: input.baseURL,
		basePath: AUTH_BASE_PATH,

		secret: input.secret,

		// bun:sqlite via drizzle (mêmes tables que le bot, préfixe ba_)
		database: drizzleAdapter(input.db, {
			provider: "sqlite",
			schema: {
				user: baUser,
				session: baSession,
				account: baAccount,
				verification: baVerification,
			},
		}),

		// Pas de signup local — uniquement OAuth Discord
		emailAndPassword: { enabled: false },

		socialProviders: {
			discord: botDiscordProvider(input.discordClientId, input.discordClientSecret),
		},

		session: {
			// Session 7 jours, renouvelée à chaque requête (sliding window)
			expiresIn: 60 * 60 * 24 * 7,
			updateAge: 60 * 60 * 24, // refresh expiry 1×/jour
			cookieCache: { ...SESSION_COOKIE_CACHE },
		},

		advanced: advancedOptions({ production, cookiePrefix: "shenron_ba" }),

		// Whitelist : seule la politique staff du bot peut se connecter.
		// On hook avant création du compte Discord pour rejeter les non-whitelistés.
		databaseHooks: {
			account: {
				create: {
					before: async (account: { providerId: string; accountId: string }) => {
						if (account.providerId !== "discord") return;
						const discordId = account.accountId;
						if (!isBotStaff(discordId)) {
							logger.warn(
								{ discordId, providerId: account.providerId },
								"Better Auth — login Discord refusé (hors whitelist)"
							);
							throw new Error(
								`Accès refusé : votre ID Discord (${discordId}) n'est pas whitelisté.`
							);
						}
						logger.info({ discordId }, "Better Auth — login Discord whitelisté");
					},
				},
			},
			// S1b : la politique staff est revérifiée à chaque ouverture de session,
			// pas seulement à la création du compte.
			session: {
				create: {
					before: (session: { userId: string }) => refuseNonStaffSession(session),
				},
			},
		},

		// CORS / origin trust : autorise le bot lui-même et le site public.
		// S2 : localhost seulement hors production, plus d'hôte générique.
		trustedOrigins: botTrustedOrigins({ production }),
	} satisfies BetterAuthOptions;
}

// any-typed pour éviter les inférences inter-versions Better Auth qui se
// resserrent à chaque release.
let _auth: any = null;

function getAuth() {
	if (_auth) return _auth;

	if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
		throw new Error("Better Auth requires DISCORD_CLIENT_ID + DISCORD_CLIENT_SECRET in .env");
	}

	const { secret, origin } = resolveBetterAuthSecret(Bun.env);
	if (origin !== "env") {
		logger.warn({ origin }, "Better Auth — secret de développement (hors production uniquement)");
	}

	const dbs = container.resolve(DatabaseService);

	_auth = betterAuth(
		buildBotAuthOptions({
			db: dbs.db,
			secret,
			discordClientId: env.DISCORD_CLIENT_ID,
			discordClientSecret: env.DISCORD_CLIENT_SECRET,
			baseURL: botAuthBaseUrl(),
			nodeEnv: env.NODE_ENV,
		})
	);

	return _auth;
}

/**
 * Handler à appeler depuis Bun.serve. Retourne `Response | null` :
 *  - Response : Better Auth a matché et géré la requête
 *  - null : route non gérée par Better Auth, laisser passer aux autres routes
 */
export async function handleBetterAuthRequest(req: Request): Promise<Response | null> {
	if (!new URL(req.url).pathname.startsWith(`${AUTH_BASE_PATH}/`)) return null;
	return handleAuthRequest(getAuth(), req);
}

/**
 * Récupère la session Better Auth depuis les headers de la requête.
 * Retourne `null` si pas de session valide.
 */
export async function getBetterAuthSession(req: Request) {
	try {
		return await getSessionSafe(getAuth(), req.headers);
	} catch {
		return null;
	}
}
