import crypto from "node:crypto";
import { agentAuth } from "@better-auth/agent-auth";
import { apiKey } from "@better-auth/api-key";
import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { admin, bearer, genericOAuth, jwt } from "better-auth/plugins";
import { type AccountEmailSender, createAccountOptions } from "./account-options";
import { commonAuthOptions, ensureUserProfile, googleProvider } from "./core";
import { deuxFacteurs } from "./two-factor";
import { resolveAuthSecret, resolveTrustedOrigins } from "./runtime-config";

type BetterAuthDatabase = Parameters<typeof betterAuth>[0]["database"];

export interface PatreonAuthIntegration {
	authorizationUrl: string;
	tokenUrl: string;
	clientId: string;
	clientSecret: string;
	scopes: readonly string[];
	getUserInfo: (tokens: unknown) => Promise<{
		id: string | number;
		name?: string;
		email?: string | null;
		image?: string;
		emailVerified: boolean;
	} | null>;
	onAccountChanged?: (account: {
		id: string;
		userId: string;
		accountId: string;
		accessToken?: string | null;
		refreshToken?: string | null;
		accessTokenExpiresAt?: Date | null;
		scope?: string | null;
	}) => Promise<void>;
}

export interface RoseGriffonAuthOptions {
	database: BetterAuthDatabase;
	baseURL: string;
	secret?: string;
	sendEmail: AccountEmailSender;
	executerSql?: (requete: string, parametres: unknown[]) => Promise<unknown>;
	nextCookiesPlugin?: unknown;
	patreon?: PatreonAuthIntegration;
	passkey?: { rpID?: string; origin?: string };
}

/**
 * Single source of truth for the Rose Griffon website Better Auth instance.
 * App-specific transports are injected so this package stays independent of
 * Next.js path aliases and of the Patreon client implementation.
 */
export function createRoseGriffonAuth(options: RoseGriffonAuthOptions) {
	const secret = resolveAuthSecret(process.env, options.secret);
	const patreon = options.patreon;
	const discordClientId = process.env.DISCORD_CLIENT_ID ?? "";
	const discordClientSecret = process.env.DISCORD_CLIENT_SECRET ?? "";
	const twitchClientId = process.env.TWITCH_AUTH_CLIENT_ID ?? process.env.TWITCH_CLIENT_ID ?? "";
	const twitchClientSecret =
		process.env.TWITCH_AUTH_CLIENT_SECRET ?? process.env.TWITCH_CLIENT_SECRET ?? "";
	const githubClientId = process.env.GITHUB_CLIENT_ID ?? process.env.AUTH_GITHUB_ID ?? "";
	const githubClientSecret =
		process.env.GITHUB_CLIENT_SECRET ?? process.env.AUTH_GITHUB_SECRET ?? "";
	const configuredSocialProviders = {
		...(discordClientId && discordClientSecret
			? {
					discord: {
						clientId: discordClientId,
						clientSecret: discordClientSecret,
						overrideUserInfoOnSignIn: true,
						prompt: "consent" as const,
					},
				}
			: {}),
		...(twitchClientId && twitchClientSecret
			? {
					twitch: {
						clientId: twitchClientId,
						clientSecret: twitchClientSecret,
						scope: ["user:read:email", "user:read:follows", "user:read:subscriptions"],
					},
				}
			: {}),
		...(githubClientId && githubClientSecret
			? {
					github: {
						clientId: githubClientId,
						clientSecret: githubClientSecret,
					},
				}
			: {}),
		...(googleProvider.google.clientId && googleProvider.google.clientSecret ? googleProvider : {}),
	};
	const trustedSocialProviders = Object.keys(configuredSocialProviders);
	const plugins = [
		admin({ defaultRole: "user", adminRoles: ["admin"] }),
		apiKey({
			defaultPrefix: "rg_",
			requireName: true,
			enableMetadata: true,
			rateLimit: { enabled: true, maxRequests: 1_000, timeWindow: 60 * 60 * 1_000 },
		}) as unknown as ReturnType<typeof admin>,
		jwt(),
		oauthProvider({
			loginPage: "/login",
			consentPage: "/oauth/consent",
			// The Next.js app exposes the RFC 8414 route at
			// /.well-known/oauth-authorization-server/[issuer-path].
			silenceWarnings: { oauthAuthServerConfig: true },
		}),
		agentAuth({
			providerName: "Rose Griffon",
			providerDescription: "Rose Griffon authentication and community capabilities.",
			deviceAuthorizationPage: "/device/capabilities",
			capabilities: [
				{
					name: "profile.read",
					description: "Read the authenticated Rose Griffon profile.",
					input: { type: "object", properties: {}, additionalProperties: false },
				},
			],
			onExecute: async ({ capability, agentSession }) => {
				if (capability !== "profile.read") throw new Error("Unsupported capability");
				return { user: agentSession.user };
			},
		}),
		deuxFacteurs("Rose Griffon"),
		bearer(),
		...(options.passkey ? [passkey(options.passkey)] : []),
		...(patreon
			? [
					genericOAuth({
						config: [
							{
								authorizationUrl: patreon.authorizationUrl,
								clientId: patreon.clientId,
								clientSecret: patreon.clientSecret,
								getUserInfo: patreon.getUserInfo as any,
								providerId: "patreon",
								scopes: [...patreon.scopes],
								tokenUrl: patreon.tokenUrl,
							},
						],
					}),
				]
			: []),
		...(options.nextCookiesPlugin ? [options.nextCookiesPlugin] : []),
	] as any[];

	return betterAuth({
		...commonAuthOptions,
		database: options.database,
		baseURL: options.baseURL,
		secret,
		user: {
			...commonAuthOptions.user,
			...createAccountOptions({
				appName: "Rose Griffon",
				executerSql: options.executerSql,
				sendEmail: options.sendEmail,
			}),
		},
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: true,
			minPasswordLength: 12,
			sendResetPassword: async ({ user, url }) => {
				await options.sendEmail({
					to: user.email,
					subject: "Réinitialiser ton mot de passe — Rose Griffon",
					html: `<p>Utilise ce lien pour réinitialiser ton mot de passe :</p><p><a href="${url}">Continuer</a></p>`,
				});
			},
		},
		emailVerification: {
			sendVerificationEmail: async ({ user, url }) => {
				await options.sendEmail({
					to: user.email,
					subject: "Confirme ton adresse — Rose Griffon",
					html: `<p>Confirme ton adresse email :</p><p><a href="${url}">Vérifier mon adresse</a></p>`,
				});
			},
		},
		socialProviders: configuredSocialProviders,
		account: {
			...commonAuthOptions.account,
			storeStateStrategy: "database",
			encryptOAuthTokens: true,
			accountLinking: {
				enabled: true,
				trustedProviders: [...trustedSocialProviders, ...(patreon ? ["patreon"] : [])],
			},
		},
		trustedOrigins: resolveTrustedOrigins(options.baseURL),
		advanced: {
			...commonAuthOptions.advanced,
			database: { generateId: () => crypto.randomUUID() },
		},
		logger: {
			level: process.env.NODE_ENV === "production" ? "error" : "debug",
		},
		databaseHooks: {
			account: {
				create: {
					after: async (account) => {
						await patreon?.onAccountChanged?.(account);
					},
				},
				update: {
					after: async (account) => {
						await patreon?.onAccountChanged?.(account);
					},
				},
			},
			session: {
				create: {
					after: async (session) => {
						try {
							await ensureUserProfile(
								session.user as {
									id: string;
									name?: string | null;
									email?: string | null;
									image?: string | null;
								},
								undefined,
								{ appName: "Rose Griffon" },
							);
						} catch (error) {
							console.error("[auth] session profile sync failed", error);
						}
					},
				},
			},
			user: {
				create: {
					after: async (user) => {
						await ensureUserProfile(user);
					},
				},
			},
		},
		plugins,
	});
}

export type RoseGriffonAuth = ReturnType<typeof createRoseGriffonAuth>;
