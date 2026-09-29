import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { DEFAULT_PUBLIC_ORIGINS } from "@shenron/config/public-urls";

/**
 * Env typé site (Next 16). Validation au boot, échec rapide en prod.
 * Toutes les vars utilisées dans `apps/shenron/site` doivent passer ici — interdire
 * `process.env.X` direct dans le reste du code.
 */
export const env = createEnv({
	server: {
		// `.trim()` partout : les env Vercel sont régulièrement pollués par un
		// `\n` final (posées via echo au lieu de printf). Un client_secret Discord
		// avec newline → Discord renvoie invalid_client à l'échange de code → aucun
		// ba_user créé → login "marche" mais ne persiste pas. Cf. mémoire
		// vercel-env-newline-pollution.
		DATABASE_URL: z.string().trim().url(),
		BETTER_AUTH_SECRET: z.string().trim().min(32),
		BETTER_AUTH_URL: z.string().trim().url().optional(),
		DISCORD_CLIENT_ID: z.string().trim().min(10),
		DISCORD_CLIENT_SECRET: z.string().trim().min(10),
		SHENRON_API_URL: z.string().trim().url().default(DEFAULT_PUBLIC_ORIGINS.api),
		SHENRON_ADMIN_TOKEN: z.string().trim().min(16).optional(),
		SHENRON_USER_SECRET: z.string().trim().min(32).optional(),
		OWNER_ID: z
			.string()
			.trim()
			.regex(/^\d{17,20}$/)
			.optional(),
		OAUTH_ALLOWED_USERS: z
			.string()
			.optional()
			.transform((v) =>
				v
					? v
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean)
					: []
			),
		NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
	},
	client: {
		NEXT_PUBLIC_SHENRON_ASSETS_URL: z.string().url().optional(),
		// Base publique de l'API bot (assets self-hostés) — utilisable côté client
		// (ex. assetUrl dans le jeu 2048). Distincte de SHENRON_API_URL (server-only).
		NEXT_PUBLIC_SHENRON_API_URL: z.string().url().optional(),
		// URL publique du site + invitation Discord — résolues dans `@/lib/config`
		// (source unique des URL). Déclarées ici pour validation/typage.
		NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
		NEXT_PUBLIC_DISCORD_INVITE_URL: z.string().url().optional(),
		NEXT_PUBLIC_GTM_ID: z.string().optional(),
		NEXT_PUBLIC_GA_ID: z.string().optional(),
		NEXT_PUBLIC_ADSENSE_CLIENT: z.string().optional(),
		// IDs des blocs AdSense (`data-ad-slot`, 10 chiffres). Résolus par
		// `@/lib/ads` ; un emplacement sans ID reste éteint. Les annonces
		// automatiques ne dépendent d'aucun de ces IDs.
		NEXT_PUBLIC_ADSENSE_SLOT_ARTICLE: z.string().optional(),
		NEXT_PUBLIC_ADSENSE_SLOT_DISPLAY: z.string().optional(),
		NEXT_PUBLIC_ADSENSE_SLOT_INFEED: z.string().optional(),
		NEXT_PUBLIC_ADSENSE_LAYOUT_KEY_INFEED: z.string().optional(),
		NEXT_PUBLIC_ADSENSE_SLOT_MULTIPLEX: z.string().optional(),
		NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: z.string().optional(),
	},
	experimental__runtimeEnv: {
		NEXT_PUBLIC_SHENRON_ASSETS_URL: process.env.NEXT_PUBLIC_SHENRON_ASSETS_URL,
		NEXT_PUBLIC_SHENRON_API_URL: process.env.NEXT_PUBLIC_SHENRON_API_URL,
		NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
		NEXT_PUBLIC_DISCORD_INVITE_URL: process.env.NEXT_PUBLIC_DISCORD_INVITE_URL,
		NEXT_PUBLIC_GTM_ID: process.env.NEXT_PUBLIC_GTM_ID,
		NEXT_PUBLIC_GA_ID: process.env.NEXT_PUBLIC_GA_ID,
		NEXT_PUBLIC_ADSENSE_CLIENT: process.env.NEXT_PUBLIC_ADSENSE_CLIENT,
		NEXT_PUBLIC_ADSENSE_SLOT_ARTICLE: process.env.NEXT_PUBLIC_ADSENSE_SLOT_ARTICLE,
		NEXT_PUBLIC_ADSENSE_SLOT_DISPLAY: process.env.NEXT_PUBLIC_ADSENSE_SLOT_DISPLAY,
		NEXT_PUBLIC_ADSENSE_SLOT_INFEED: process.env.NEXT_PUBLIC_ADSENSE_SLOT_INFEED,
		NEXT_PUBLIC_ADSENSE_LAYOUT_KEY_INFEED: process.env.NEXT_PUBLIC_ADSENSE_LAYOUT_KEY_INFEED,
		NEXT_PUBLIC_ADSENSE_SLOT_MULTIPLEX: process.env.NEXT_PUBLIC_ADSENSE_SLOT_MULTIPLEX,
		NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
	},
	// Skip validation au build (Vercel injecte les env vars au runtime,
	// pas toutes en build-time). Le runtime crash de toute façon si une
	// var manque (auth(), db(), etc. throwent leurs propres erreurs).
	skipValidation:
		process.env.SKIP_ENV_VALIDATION === "1" ||
		process.env.npm_lifecycle_event === "lint" ||
		process.env.npm_lifecycle_event === "build" ||
		process.env.NEXT_PHASE === "phase-production-build",
	emptyStringAsUndefined: true,
});
