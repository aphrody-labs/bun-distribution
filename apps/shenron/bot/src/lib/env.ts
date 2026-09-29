import { z } from "zod";
import { staffPolicyFromEnv, type StaffEnvSource, type StaffPolicy } from "@shenron/auth/staff";

const schema = z.object({
	// ────────────────────────────────────────────────────────
	// Tokens & Application IDs (multi-bot)
	// Shenron = bot principal (admin + API REST). Les 5 autres personas (Beerus,
	// Whis, Grand Prêtre, Enma, Kaïo) sont des applications Discord distinctes
	// avec leur propre token. Tous tournent dans le même process Bun.
	// Le DISCORD_TOKEN historique sert d'alias pour DISCORD_TOKEN_SHENRON.
	// ────────────────────────────────────────────────────────
	DISCORD_TOKEN: z.string().min(1).optional(),
	DISCORD_TOKEN_SHENRON: z.string().min(1).optional(),
	DISCORD_TOKEN_BEERUS: z.string().min(1).optional(),
	DISCORD_TOKEN_WHIS: z.string().min(1).optional(),
	DISCORD_TOKEN_GRAND_PRETRE: z.string().min(1).optional(),
	DISCORD_TOKEN_ENMA: z.string().min(1).optional(),
	DISCORD_TOKEN_KAIO: z.string().min(1).optional(),

	GUILD_ID: z.string().regex(/^\d{17,20}$/, "GUILD_ID must be a Discord snowflake"),
	OWNER_ID: z.string().regex(/^\d{17,20}$/, "OWNER_ID must be a Discord snowflake"),
	// Owners additionnels : OWNER_ID reste la clé historique, cette liste permet
	// d'accorder le même bypass sans remplacer le propriétaire existant.
	OWNER_IDS: z
		.string()
		.optional()
		.transform((v) =>
			v
				? v
						.split(",")
						.map((s) => s.trim())
						.filter(Boolean)
				: []
		)
		.refine(
			(ids) => ids.every((id) => /^\d{17,20}$/.test(id)),
			"OWNER_IDS must contain Discord snowflakes"
		),
	BOT_DEV_ID: z
		.string()
		.regex(/^\d{17,20}$/, "BOT_DEV_ID must be a Discord snowflake")
		.optional(),

	APPLICATION_ID: z
		.string()
		.regex(/^\d{17,20}$/, "APPLICATION_ID must be a Discord snowflake")
		.optional(),
	APPLICATION_ID_SHENRON: z
		.string()
		.regex(/^\d{17,20}$/)
		.optional(),
	APPLICATION_ID_BEERUS: z
		.string()
		.regex(/^\d{17,20}$/)
		.optional(),
	APPLICATION_ID_WHIS: z
		.string()
		.regex(/^\d{17,20}$/)
		.optional(),
	APPLICATION_ID_GRAND_PRETRE: z
		.string()
		.regex(/^\d{17,20}$/)
		.optional(),
	APPLICATION_ID_ENMA: z
		.string()
		.regex(/^\d{17,20}$/)
		.optional(),
	APPLICATION_ID_KAIO: z
		.string()
		.regex(/^\d{17,20}$/)
		.optional(),

	DISCORD_PUBLIC_KEY: z
		.string()
		.regex(/^[0-9a-f]{64}$/i, "DISCORD_PUBLIC_KEY must be a 64-hex-char key")
		.optional(),

	DATABASE_PATH: z.string().default("./data/bot.db"),

	LOG_MESSAGE_CHANNEL_ID: z.string().optional(),
	LOG_SANCTION_CHANNEL_ID: z.string().optional(),
	LOG_ECONOMY_CHANNEL_ID: z.string().optional(),
	LOG_JOIN_LEAVE_CHANNEL_ID: z.string().optional(),
	LOG_LEVEL_ROLE_CHANNEL_ID: z.string().optional(),
	LOG_TICKET_CHANNEL_ID: z.string().optional(),
	MOD_NOTIFY_CHANNEL_ID: z.string().optional(),
	COMMANDS_CHANNEL_ID: z.string().optional(),
	ADMIN_LAB_CHANNEL_ID: z.string().optional().default("1548677623935139901"),
	ANNOUNCE_CHANNEL_ID: z.string().optional(),
	ACHIEVEMENT_CHANNEL_ID: z.string().optional(),
	LEVEL_CHANNEL_ID: z.string().optional(),

	// /translate (OCR Aphrody + cascade providers sans clé)
	// - Lingva Translate (proxy Google, instances publiques rotatives)
	// - Google translate.googleapis.com `gtx` (endpoint Chrome, sans clé)
	// - LibreTranslate (self-host, fallback)
	LIBRETRANSLATE_URL: z.string().url().optional(), // défaut : @shenron/config/services
	LIBRETRANSLATE_API_KEY: z.string().optional(),
	// Override l'instance Lingva primaire (ex: https://lingva.ml). Si absent,
	// on essaie en cascade les instances publiques connues.
	LINGVA_INSTANCE: z.string().url().optional(),

	// API REST (Bun.serve) — surface tscord-compatible pour dashboard
	API_PORT: z.coerce.number().int().min(1).max(65535).default(5006),
	API_HOST: z.string().default("127.0.0.1"),
	API_ADMIN_TOKEN: z.string().min(16).optional(), // bearer token requis sur les routes /bot, /database, /stats, /health/monitoring|/logs
	// Shared secret entre site Next et bot pour les routes user-authentifiées
	// (`/api/games/*`, `/api/me/*`). Le site signe `discordId` via HMAC-SHA256
	// et le bot vérifie. Permet au site d'agir au nom d'un user sans qu'un
	// utilisateur browser puisse forger l'identité.
	API_USER_SECRET: z.string().min(32).optional(),
	API_ENABLED: z.coerce.boolean().default(true),

	// OAuth2 Discord (login dashboard)
	// Le client_secret ne doit JAMAIS être commit ; uniquement dans .env (gitignored).
	// SESSION_SECRET = clé HMAC pour signer le cookie session (séparée d'API_ADMIN_TOKEN
	// pour que rotation token n'invalide pas les sessions OAuth en cours).
	DISCORD_CLIENT_ID: z
		.string()
		.regex(/^\d{17,20}$/)
		.optional(),
	DISCORD_CLIENT_SECRET: z.string().min(16).optional(),
	OAUTH_REDIRECT_URI: z.string().url().optional(),
	// CSV de snowflakes autorisés à se connecter ; OWNER_ID est implicitement whitelisté.
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
	SESSION_SECRET: z.string().min(32).optional(),
	BETTER_AUTH_URL: z.string().url().optional(),

	JAIL_ROLE_ID: z.string().optional(),
	URL_IN_BIO_ROLE_ID: z.string().optional(),

	TICKET_CATEGORY_ID: z.string().optional(),
	VOCAL_TEMPO_HUB_ID: z.string().optional(),

	SERVER_INVITE_URL: z.string().default("discord.gg/"),

	LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
	NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

const parsed = schema.safeParse(Bun.env);
if (!parsed.success) {
	console.error("✗ Invalid environment:");
	for (const issue of parsed.error.issues) {
		console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
	}
	process.exit(1);
}

const raw = parsed.data;
const shenronToken = raw.DISCORD_TOKEN_SHENRON ?? raw.DISCORD_TOKEN;
if (!shenronToken) {
	console.error("✗ Invalid environment:");
	console.error("  - DISCORD_TOKEN_SHENRON (or legacy DISCORD_TOKEN) is required");
	process.exit(1);
}
const shenronAppId = raw.APPLICATION_ID_SHENRON ?? raw.APPLICATION_ID;

export const env = {
	...raw,
	DISCORD_TOKEN: shenronToken,
	DISCORD_TOKEN_SHENRON: shenronToken,
	DISCORD_TOKEN_BEERUS: shenronToken,
	DISCORD_TOKEN_WHIS: shenronToken,
	DISCORD_TOKEN_GRAND_PRETRE: shenronToken,
	DISCORD_TOKEN_ENMA: shenronToken,
	DISCORD_TOKEN_KAIO: shenronToken,
	APPLICATION_ID: shenronAppId,
	APPLICATION_ID_SHENRON: shenronAppId,
};
export type Env = typeof env;

/**
 * Source d'env de la politique staff du bot (`staffPolicyFromEnv(env, "bot")`,
 * docs/STACK.md D6), recomposée depuis les valeurs validées ci-dessus (lue à
 * chaque appel : les tests et le rechargement de config mutent `env`).
 */
export function botStaffEnv(): StaffEnvSource {
	return {
		OWNER_ID: env.OWNER_ID,
		OWNER_IDS: env.OWNER_IDS.join(","),
		BOT_DEV_ID: env.BOT_DEV_ID,
		OAUTH_ALLOWED_USERS: env.OAUTH_ALLOWED_USERS.join(","),
	};
}

/** Politique staff du bot : OWNER_ID ∪ OWNER_IDS ∪ BOT_DEV_ID ∪ OAUTH_ALLOWED_USERS. */
export function botStaffPolicy(): StaffPolicy {
	return staffPolicyFromEnv(botStaffEnv(), "bot");
}

/**
 * OWNER_ID/BOT_DEV_ID historiques + owners additionnels configurés par CSV.
 * Même politique `bot`, sans la liste blanche OAuth (un membre autorisé à se
 * connecter au dashboard n'est pas propriétaire du bot).
 */
export function isBotOwner(discordId: string): boolean {
	return staffPolicyFromEnv({ ...botStaffEnv(), OAUTH_ALLOWED_USERS: undefined }, "bot").isStaff(
		discordId
	);
}
