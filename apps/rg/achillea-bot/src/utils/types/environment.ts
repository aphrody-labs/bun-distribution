import process from "node:process";

import { cleanEnv, num, str, url } from "envalid";

export const env = cleanEnv(process.env, {
	NODE_ENV: str({ choices: ["development", "production", "test"], default: "development" }),

	// Profils Discord : `legacy` conserve l'ancien bot present sur les serveurs
	// historiques ; `current` utilise la nouvelle application. Token, client ID,
	// secret OAuth et cle publique sont toujours selectionnes ensemble.
	BOT_PROFILE: str({
		choices: ["legacy", "current"],
		default: "current",
	}),
	BOT_COMMAND_GUILDS: str({ default: undefined }),
	BOT_TOKEN: str({ default: undefined }),
	DEV_BOT_TOKEN: str({ default: undefined }),

	TEST_GUILD_ID: str({ default: undefined }),
	BOT_OWNER_ID: str(),

	DISCORD_CLIENT_ID: str({ default: undefined }),
	DISCORD_CLIENT_ID_DEV: str({ default: undefined }),
	DISCORD_CLIENT_SECRET: str({ default: undefined }),
	DISCORD_CLIENT_SECRET_DEV: str({ default: undefined }),
	DISCORD_PUBLIC_KEY: str({ default: undefined }),
	DISCORD_PUBLIC_KEY_DEV: str({ default: undefined }),

	// PostgreSQL/Supabase : URL complète prioritaire sur les variables historiques.
	DATABASE_URL: str({ default: undefined }),
	DATABASE_URL_DEV: str({ default: undefined }),
	TEST_DATABASE_URL: str({ default: undefined }),

	DATABASE_HOST: str({ default: undefined }),
	DATABASE_PORT: num({ default: undefined }),
	DATABASE_NAME: str({ default: undefined }),
	DATABASE_USER: str({ default: undefined }),
	DATABASE_PASSWORD: str({ default: undefined }),

	DATABASE_HOST_DEV: str({ default: undefined }),
	DATABASE_PORT_DEV: str({ default: undefined }),
	DATABASE_NAME_DEV: str({ default: undefined }),
	DATABASE_USER_DEV: str({ default: undefined }),
	DATABASE_PASSWORD_DEV: str({ default: undefined }),

	API_PORT: num({ default: 4000 }),
	API_HOST: str({ default: "127.0.0.1" }),
	API_ADMIN_TOKEN: str({ default: undefined }),
	TEST_API_PORT: num({ default: undefined }),

	SOCKET_PORT: num({ default: 4005 }),
	SOCKET_HOST: str({ default: "127.0.0.1" }),
	TEST_SOCKET_PORT: num({ default: undefined }),
	RANKED_HOST: str({ default: "127.0.0.1" }),
	RANKED_PORT: num({ default: 4002 }),
	RANKED_INTERNAL_SECRET: str({ default: undefined }),

	IMGUR_CLIENT_ID: str({ default: undefined }),

	TWITCH_CLIENT_ID: str({ default: undefined }),
	TWITCH_SECRET: str({ default: undefined }),

	IMAGE_SERVER_API_KEY: str({ default: undefined }),
	IMAGE_SERVER_URL: url({ default: undefined }),

	// Supabase Storage (stockage des images : preuves de litige ranked en priorité).
	// Le module ranked tourne en sous-process et lit ces mêmes vars via process.env.
	SUPABASE_URL: url({ default: undefined }),
	SUPABASE_SECRET_KEY: str({ default: undefined }), // clé secrète moderne, serveur uniquement
	SUPABASE_SERVICE_KEY: str({ default: undefined }), // alias legacy service_role
	SUPABASE_ANON_KEY: str({ default: undefined }),
	SUPABASE_STORAGE_BUCKET: str({ default: "images" }),
	SUPABASE_PRIVATE_STORAGE_BUCKET: str({ default: "ranked-proofs" }),
	SUPABASE_SIGNED_URL_TTL: num({ default: 3600 }),

	// URLs d'infra (source unique — cf. src/configs/urls.ts). Défauts LOCAUX
	// (monorepo autonome) ; fournir les domaines publics par env au déploiement.
	WEBSITE_URL: url({ default: "http://localhost:4200" }),
	PUBLIC_API_URL: url({ default: "http://localhost:4010" }),
	UNIFIED_API_URL: url({
		default:
			process.env.NODE_ENV === "production"
				? "https://api.rosegriffon.fr"
				: "http://127.0.0.1:8800",
	}),
	OAUTH_CALLBACK_BASE_URL: url({ default: "http://localhost:4010" }),
	WEB_ALLOWED_ORIGINS: str({ default: undefined }), // CSV d'origines CORS (sinon localhost + WEBSITE_URL)

	TWITCH_TOKENS_KEY: str({ default: undefined }),
	YOUTUBE_TOKENS_KEY: str({ default: undefined }),
	CHALLONGE_TOKENS_KEY: str({ default: undefined }),

	JWT_SECRET_KEY: str(),

	CHALLONGE_CLIENT_ID: str({ default: undefined }),
	CHALLONGE_CLIENT_ID_TEST: str({ default: undefined }),
	CHALLONGE_API_KEY: str({ default: undefined }),
	CHALLONGE_API_KEY_TEST: str({ default: undefined }),
	CHALLONGE_BASE_URL: str({ default: undefined }),
});

function isLocalHostname(hostname: string): boolean {
	return ["localhost", "127.0.0.1", "::1"].includes(hostname);
}

function assertStrongSecret(name: string, value: string | undefined): void {
	if (!value || new TextEncoder().encode(value).byteLength < 32) {
		throw new Error(`${name} doit contenir au moins 32 octets en production`);
	}
}

function assertPublicHttpsUrl(name: string, value: string): void {
	const parsed = new URL(value);
	if (parsed.protocol !== "https:" || isLocalHostname(parsed.hostname)) {
		throw new Error(`${name} doit être une URL HTTPS publique en production`);
	}
}

if (env.isProduction) {
	assertStrongSecret("JWT_SECRET_KEY", env.JWT_SECRET_KEY);
	assertStrongSecret("API_ADMIN_TOKEN", env.API_ADMIN_TOKEN);
	assertStrongSecret("RANKED_INTERNAL_SECRET", env.RANKED_INTERNAL_SECRET);
	assertStrongSecret("SUPABASE_SECRET_KEY", env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_KEY);
	assertPublicHttpsUrl("WEBSITE_URL", env.WEBSITE_URL);
	assertPublicHttpsUrl("PUBLIC_API_URL", env.PUBLIC_API_URL);
	assertPublicHttpsUrl("UNIFIED_API_URL", env.UNIFIED_API_URL);
	assertPublicHttpsUrl("OAUTH_CALLBACK_BASE_URL", env.OAUTH_CALLBACK_BASE_URL);
	for (const [name, port] of [
		["API_PORT", env.API_PORT],
		["SOCKET_PORT", env.SOCKET_PORT],
		["RANKED_PORT", env.RANKED_PORT],
	] as const) {
		if (!Number.isInteger(port) || port < 1 || port > 65_535) {
			throw new Error(`${name} doit être un port TCP valide`);
		}
	}
	if (!env.DATABASE_URL && !(env.DATABASE_HOST && env.DATABASE_NAME && env.DATABASE_USER)) {
		throw new Error("DATABASE_URL Supabase est requise en production");
	}
}
