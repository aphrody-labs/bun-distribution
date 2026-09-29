import "reflect-metadata";
import { container } from "tsyringe";
import { Client, DIService } from "discordx";
import { tsyringeDependencyRegistryEngine } from "@discordx/di";

DIService.engine = tsyringeDependencyRegistryEngine.setInjector(container);

import { Partials, Options } from "discord.js";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { env } from "./lib/env";
import { logger } from "./lib/logger";
import { DatabaseService } from "./db/index";
import { loadRaceLevelRoles } from "./lib/race-levels";
import { loadLevelThresholds } from "./lib/level-thresholds";
import { runBootAudit } from "./lib/boot-audit";
import { ApiServer } from "./api/server";
import { assertRagEmbeddingSpace } from "./lib/rag";
import { existsSync } from "node:fs";
import { PERSONAS, PERSONA_IDS, type PersonaId } from "./lib/personas";

// Side-effect barrel — charge toutes les classes decorées @Discord
import "./_entries";
import { CommandPermissions } from "./guards/CommandPermissions";

// Migrations DB AVANT la création des clients (DatabaseService est singleton partagé)
const dbService = container.resolve(DatabaseService);
if (existsSync("./src/db/migrations")) {
	try {
		migrate(dbService.db, { migrationsFolder: "./src/db/migrations" });
		logger.info("✓ DB migrations applied");
	} catch (err) {
		logger.warn({ err }, "DB migration step skipped (first run?)");
	}
}

// Espace d'embedding (contrat aphrody-infra `indexes.shenron-rag`) : un modèle ou
// une dimension configurés qui diffèrent de l'index sont une erreur fatale, jamais
// un mélange silencieux d'espaces vectoriels.
try {
	const space = assertRagEmbeddingSpace(dbService.sqlite);
	logger.info({ model: space.model, dimensions: space.dimensions }, "✓ RAG embedding space matches the index");
} catch (err) {
	logger.fatal({ err }, "RAG embedding space mismatch: refusing to start");
	process.exit(1);
}

// Hydrate le cache des rôles de palier PAR RACE depuis la DB (seed depuis
// RACE_LEVEL_ROLES si la table est vide) — APRÈS les migrations, AVANT tout
// level-up/sync de rôles (LevelService lit ce cache de façon synchrone).
try {
	loadRaceLevelRoles(dbService.db);
	logger.info("✓ race level roles loaded");
} catch (err) {
	logger.warn({ err }, "race level roles load skipped (first run?)");
}

// Hydrate la COURBE DE NIVEAUX éditable (guild_settings.xp.thresholds) — défaut
// en dur si absente. Lue par levelForXP/xpProgress (hot-path, synchrone).
try {
	loadLevelThresholds(dbService.db);
	logger.info("✓ level thresholds loaded");
} catch (err) {
	logger.warn({ err }, "level thresholds load skipped (first run?)");
}

// Un seul client Gateway : les anciens noms de personas restent des alias
// pour l'API et le dashboard, mais ne créent plus de connexions ni de caches.
const intents = [...new Set(Object.values(PERSONAS).flatMap((p) => p.intents))];
const client = new Client({
	botId: "shenron",
	intents,
	partials: [
		Partials.Channel,
		Partials.Message,
		Partials.GuildMember,
		Partials.User,
		Partials.Reaction,
	],
	silent: env.NODE_ENV === "production",
	botGuilds: [env.GUILD_ID],
	guards: [CommandPermissions],
	makeCache: Options.cacheWithLimits({
		MessageManager: 200,
		ThreadManager: 50,
		ReactionManager: 0,
	}),
	sweepers: {
		...Options.DefaultSweeperSettings,
		messages: { interval: 3600, lifetime: 1800 },
		threads: { interval: 3600, lifetime: 3600 },
	},
});
const clients = new Map<PersonaId, Client>(PERSONA_IDS.map((id) => [id, client]));

// Shenron est le client "principal" — exposé en singleton pour DI
// (LogService, MessageTemplateService, StatsService, ApiServer le résolvent
// implicitement via @inject(Client)).
const shenron = client;
container.registerInstance(Client, shenron);
container.register("ClientMap", { useValue: clients });

// ────────────────────────────────────────────────────────
// Wiring identique pour tous les clients :
// - clientReady : mono-guild lock + initApplicationCommands
// - guildCreate : leave instantané si invité hors GUILD_ID
// - interactionCreate : routage discordx (filtré par botIds)
// Seul Shenron déclenche l'API REST + le boot audit.
// ────────────────────────────────────────────────────────
client.once("clientReady", async () => {
	// Mono-guild forcé sur chaque persona
	for (const [gid, guild] of client.guilds.cache) {
		if (gid === env.GUILD_ID) continue;
		logger.warn(
			{ persona: "shenron", gid, name: guild.name },
			"guild non-prod détectée, leave en cours"
		);
		await guild.leave().catch((err) => logger.error({ err, gid }, "guild.leave failed"));
	}

	await client.initApplicationCommands();
	logger.info(`✓ Shenron connecté en tant que ${client.user?.username}`);
	await runBootAudit(client).catch((err) => logger.error({ err }, "boot-audit failed"));
	try {
		container.resolve(ApiServer).start();
	} catch (err) {
		logger.error({ err }, "ApiServer start failed");
	}
});

client.on("guildCreate", async (guild) => {
	if (guild.id === env.GUILD_ID) return;
	logger.warn({ gid: guild.id, name: guild.name }, "guild non-prod invitée, leave instantané");
	await guild.leave().catch((err) => logger.error({ err, gid: guild.id }, "guild.leave failed"));
});

client.on("interactionCreate", (interaction) => {
	client.executeInteraction(interaction);
});

async function shutdown(signal: string) {
	logger.info(`Received ${signal}, shutting down…`);
	try {
		await client.destroy();
		dbService.close();
	} catch (err) {
		logger.error({ err }, "Error during shutdown");
	}
	process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
	logger.error({ err: reason }, "Unhandled rejection");
});
process.on("uncaughtException", (err) => {
	logger.fatal({ err }, "Uncaught exception");
	process.exit(1);
});

// Login : Shenron en premier (ApiServer dépend de son clientReady),
// les 5 autres en parallèle (Discord rate-limit identify est par-token, pas global)
// → boot ~10 s → ~2-3 s.
// Non-bloquant : si un persona échoue (privileged intents, token révoqué…),
// on log et on continue avec les autres. Shenron reste obligatoire.
try {
	await client.login(PERSONAS.shenron.token);
} catch (err) {
	logger.fatal({ err }, "Shenron failed to start — aborting (no API REST possible)");
	process.exit(1);
}

// ── Auto-seed wiki si DB vide (self-healing après perte bot.db) ─────────
// Non-bloquant : tourne en background après boot, idempotent (skip si seedé).
// Évite que les endpoints `/api/public/wiki/*` répondent `{characters: []}`
// après un recovery comme commit 8d9fc49.
void (async () => {
	try {
		const { runWikiSeed } = await import("~/db/seed-wiki");
		const result = await runWikiSeed({
			log: (m) => logger.info({ subsystem: "wiki-seed" }, m),
		});
		if (!result.skipped) {
			logger.info(
				{
					planets: result.planets,
					characters: result.characters,
					transformations: result.transformations,
				},
				"wiki auto-seeded on boot"
			);
		}
	} catch (err) {
		logger.warn({ err }, "wiki auto-seed failed (non-fatal)");
	}
})();
