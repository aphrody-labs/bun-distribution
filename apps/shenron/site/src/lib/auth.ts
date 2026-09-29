import { betterAuth, type BetterAuthOptions } from "better-auth";
import { bearer } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import * as schema from "../db/schema";
import { env } from "./env";
import { and, eq } from "drizzle-orm";
import { purgeAccountData } from "./account-data";
import { invalidateCurrentUser } from "./current-user-cache";
import { AUTH_BASE_PATH, normalizeBaseUrl, resolveBetterAuthSecret } from "@shenron/auth";
import {
	createMemoryRateLimitStorage,
	siteRateLimitStorage,
	type BetterAuthRateLimitStorage,
} from "./auth-rate-limit";
import {
	SESSION_COOKIE_CACHE,
	advancedOptions,
	discordProvider,
	drizzleDebugLogs,
	loggingOptions,
} from "@shenron/auth/options";
import { siteAllowedHosts, siteTrustedOrigins } from "@shenron/auth/origins";

/** Variables d'env lues par la configuration Better Auth du site. */
export interface SiteAuthEnv {
	NODE_ENV: "development" | "production" | "test";
	BETTER_AUTH_URL?: string;
	BETTER_AUTH_SECRET: string;
	DISCORD_CLIENT_ID: string;
	DISCORD_CLIENT_SECRET: string;
}

/** Dépendances injectées dans {@link buildAuthOptions} (base, purge, cache). */
export interface SiteAuthDeps {
	env: SiteAuthEnv;
	db: typeof db;
	purgeAccountData: typeof purgeAccountData;
	invalidateCurrentUser: typeof invalidateCurrentUser;
	/** Stockage du rate limit ; défaut : compteur en mémoire (tests). */
	rateLimitStorage?: BetterAuthRateLimitStorage;
}

// Le hook `afterDelete` ne peut plus lire ba_account (supprimé en cascade par
// Better Auth). Le hook précédent mémorise donc uniquement l'identifiant
// métier non sensible, pour la durée de la même requête.
const PENDING_DELETION_TTL = 10 * 60_000;

function validateAvatarUrl(value: string | null | undefined): void {
	if (!value) return;
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new APIError("BAD_REQUEST", { message: "L’URL de l’avatar est invalide." });
	}
	if (parsed.protocol !== "https:") {
		throw new APIError("BAD_REQUEST", { message: "L’avatar doit utiliser une URL HTTPS." });
	}
}

/**
 * Configuration de l'adaptateur Drizzle. `debugLogs` suit `drizzleDebugLogs` :
 * l'adaptateur journalise les valeurs des clauses WHERE, dont le jeton de
 * session. Bavard en développement seulement.
 */
export function authDatabaseConfig(nodeEnv: string | undefined) {
	return {
		provider: "pg" as const,
		debugLogs: drizzleDebugLogs(nodeEnv),
		schema: {
			user: schema.baUser,
			session: schema.baSession,
			account: schema.baAccount,
			verification: schema.baVerification,
		},
	};
}

/**
 * Options Better Auth du site, sans effet de bord : les tests les construisent
 * avec des dépendances factices et vérifient crochets, journalisation et
 * fournisseur Discord sans ouvrir PostgreSQL.
 */
export function buildAuthOptions(deps: SiteAuthDeps) {
	const authEnv = deps.env;
	const production = authEnv.NODE_ENV === "production";
	// URL canonique du site. `normalizeBaseUrl` = `.trim()` + strip trailing slash :
	// défense contre une valeur d'env polluée (ex. BETTER_AUTH_URL posée via `echo`
	// qui ajoute un \n final → redirectURI malformé → Discord rejette le callback).
	const siteUrl = normalizeBaseUrl(authEnv.BETTER_AUTH_URL);
	const pendingDeletion = new Map<
		string,
		{ appUserId: string; discordId: string; expiresAt: number }
	>();

	return {
		appName: "DBFR",
		// Dynamic baseURL avec allowlist → cookie domain = host courant.
		// S2 (docs/STACK.md §2.2) : plus d'hôte générique `*.vercel.app` (un hôte
		// de confiance joker = redirection ouverte) ; seul l'alias nommé
		// dbfr.vercel.app reste (INFRA-4) et localhost n'existe que hors production.
		// Doc: https://better-auth.com/docs/guides/dynamic-base-url#vercel-deployment
		baseURL: {
			allowedHosts: siteAllowedHosts({ production }),
			protocol: "https" as const,
			// Fallback = domaine canonique (cf. CLAUDE.md). Doit matcher l'URL du
			// site et le redirectURI Discord pour que le cookie de state OAuth soit
			// posé et relu sur le même host (sinon "invalid_state").
			fallback: siteUrl,
		},

		basePath: AUTH_BASE_PATH,
		// Même résolution que le bot : >= 32 caractères, fail-closed en production.
		secret: resolveBetterAuthSecret({
			NODE_ENV: authEnv.NODE_ENV,
			BETTER_AUTH_SECRET: authEnv.BETTER_AUTH_SECRET,
		}).secret,
		// Limite de débit de /api/auth (règles spéciales par défaut de Better Auth,
		// plus strictes sur sign-in). Compteurs dans Redis, repli mémoire si Redis
		// tombe (lib/auth-rate-limit.ts). Pas de `secondaryStorage` global : il
		// déplacerait aussi les sessions dans Redis, et une panne Redis
		// déconnecterait tout le monde ; les sessions restent en PostgreSQL.
		rateLimit: {
			enabled: production,
			window: 60,
			max: 100,
			customStorage: deps.rateLimitStorage ?? createMemoryRateLimitStorage(),
		},
		// La suppression est immédiate pour une session fraîche. Les contenus qui
		// doivent rester publiés conservent leur auteur anonymisé ; les préférences
		// personnelles sont supprimées.
		user: {
			deleteUser: {
				enabled: true,
				beforeDelete: async (authUser: { id: string }) => {
					const now = Date.now();
					for (const [userId, entry] of pendingDeletion) {
						if (entry.expiresAt <= now) pendingDeletion.delete(userId);
					}
					const [linked] = await deps.db
						.select({ appUserId: schema.users.id, discordId: schema.users.discordId })
						.from(schema.baAccount)
						.innerJoin(schema.users, eq(schema.users.discordId, schema.baAccount.accountId))
						.where(
							and(
								eq(schema.baAccount.userId, authUser.id),
								eq(schema.baAccount.providerId, "discord")
							)
						)
						.limit(1);
					if (linked) {
						pendingDeletion.set(authUser.id, {
							...linked,
							expiresAt: now + PENDING_DELETION_TTL,
						});
					}
				},
				afterDelete: async (authUser: { id: string }) => {
					const linked = pendingDeletion.get(authUser.id);
					pendingDeletion.delete(authUser.id);
					if (!linked || linked.expiresAt <= Date.now()) return;
					await deps.purgeAccountData({
						authUserId: authUser.id,
						appUserId: linked.appUserId,
						discordId: linked.discordId,
					});
				},
			},
		},
		databaseHooks: {
			user: {
				update: {
					before: async (
						user: Partial<{ name: string; image?: string | null }> & Record<string, unknown>
					) => {
						const name = typeof user.name === "string" ? user.name.trim() : user.name;
						if (typeof name === "string" && (name.length < 2 || name.length > 48)) {
							throw new APIError("BAD_REQUEST", {
								message: "Le pseudo doit contenir entre 2 et 48 caractères.",
							});
						}
						validateAvatarUrl(user.image);
						return { data: { ...user, name } };
					},
					after: async (user: { id: string }) => {
						// Le profil métier est résynchronisé au prochain rendu. Sans cette
						// invalidation, le dashboard pouvait garder l'ancien pseudo/avatar
						// pendant le TTL de 60 secondes après un enregistrement réussi.
						deps.invalidateCurrentUser(user.id);
					},
				},
			},
		},
		// Cache de session signé en cookie (300 s, `SESSION_COOKIE_CACHE`) :
		// getSession lit le cookie au lieu de requêter ba_session à chaque appel.
		// ba_user ne porte que name/email/image : AUCUN champ additionnel (rôle
		// staff compris) n'est déclaré, car le cookie cache n'embarque pas les
		// champs custom et une vérification admin y lirait une valeur absente ou
		// périmée. roleAdmin est recalculé côté serveur à chaque requête
		// (lib/session.ts : politique staff + table users), jamais lu en session. maxAge borne la fenêtre
		// pendant laquelle une session révoquée reste acceptée.
		session: {
			cookieCache: { ...SESSION_COOKIE_CACHE },
			expiresIn: 60 * 60 * 24 * 30, // 30 jours durable
			updateAge: 60 * 60 * 24, // 24 heures
		},
		plugins: [bearer()],
		// Journal : en `debug`, Better Auth écrit le JETON DE SESSION EN CLAIR de
		// chaque visiteur connecté (constat du 2026-08-21, journal lisible par le
		// groupe `adm`). `loggingOptions` limite la production aux avertissements ;
		// `onAPIError` ci-dessous garde les traces qui servent vraiment.
		...loggingOptions(authEnv.NODE_ENV),
		// Capture explicite des erreurs d'API (sinon une exception au create user
		// ou à l'échange de code Discord est avalée → 302 vers errorURL sans trace).
		onAPIError: {
			throw: false,
			onError: (error: unknown, ctx: unknown) => {
				const e = error as { message?: string; stack?: string; cause?: unknown };
				const path = (ctx as { path?: string } | undefined)?.path ?? "?";
				console.error(
					"[better-auth][API ERROR]",
					path,
					e?.message ?? String(error),
					e?.cause ? `cause=${JSON.stringify(e.cause)}` : "",
					e?.stack ?? ""
				);
			},
		},
		database: drizzleAdapter(deps.db, authDatabaseConfig(authEnv.NODE_ENV)),
		socialProviders: {
			// Preset partagé : `prompt: "consent"` (sans lui Better Auth émet
			// `prompt=none` → `consent_required` pour tout nouvel utilisateur),
			// portées supplémentaires dédoublonnées (Better Auth ajoute déjà
			// `identify email`), e-mail de substitution pour les comptes phone-only.
			// Pas de redirectURI en dur : il est calculé depuis le baseURL dynamique.
			discord: discordProvider({
				clientId: authEnv.DISCORD_CLIENT_ID,
				clientSecret: authEnv.DISCORD_CLIENT_SECRET,
				extraScopes: ["guilds", "guilds.members.read"],
			}),
		},
		// Login ouvert à tous les membres Discord — le site est public. L'élévation
		// admin (roleAdmin) est décidée dans lib/session.ts (politique staff du site) ;
		// le user métier y est upserté paresseusement au premier appel post-login.
		// S2 : origines de production seulement en production (localhost hors prod).
		trustedOrigins: siteTrustedOrigins({ production }),

		// `ipAddress` : nginx tourne sur le même hôte et pose X-Real-IP ; seul le
		// loopback est un proxy de confiance pour dérouler X-Forwarded-For.
		advanced: advancedOptions({ production }),
	} satisfies BetterAuthOptions;
}

export const auth = betterAuth(
	buildAuthOptions({
		env,
		db,
		purgeAccountData,
		invalidateCurrentUser,
		rateLimitStorage: siteRateLimitStorage(),
	})
);
