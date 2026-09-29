import "reflect-metadata";
import "dotenv/config";

import process from "node:process";

import { resolve } from "@aphrody/importer";
import type { EntityManager } from "@mikro-orm/core";
import { RequestContext } from "@mikro-orm/core";
import chalk from "chalk";
import chokidar from "chokidar";
import discordLogs from "discord-logs";
import {
	Client,
	DIService,
	MetadataStorage,
	tsyringeDependencyRegistryEngine,
} from "@aphrody/discordx";
import { container } from "tsyringe";
import type { constructor } from "tsyringe/dist/typings/types";

import { Server } from "@/api/server";
import { apiConfig, discordBotProfile } from "@/configs";
import { keptInstances } from "@/decorators";
import { env } from "@/env";
import { NoBotTokenError } from "@/errors";
import {
	Database,
	ErrorHandler,
	EventManager,
	Logger,
	PluginsManager,
	Scheduler,
	Store,
} from "@/services";
import { checkEnvironmentVariables, initDataTable, resolveDependency } from "@/utils/functions";

import {
	assertDiscordTokenMatchesProfile,
	clientConfig,
	resolveGrantedIntents,
} from "./client";
import { CastReminders } from "./cron/CastReminders";
import { WorkerService } from "./services/WorkerService";
import { startSocketServer, stopSocketServer } from "./websockets/socket-server";

// eslint-disable-next-line node/no-path-concat
const importPattern = `${__dirname}/{events,commands}/**/*.{ts,js}`;

let activeApi: Awaited<ReturnType<typeof Server.start>> | undefined;
let activeClient: Client | undefined;
let activeDatabase: Database | undefined;
let activeRankedProcess: ReturnType<typeof Bun.spawn> | undefined;
let activeScheduler: Scheduler | undefined;
let activeWatcher: ReturnType<typeof chokidar.watch> | undefined;
let activeWorkerService: WorkerService | undefined;
let socketServerStarted = false;
let shuttingDown = false;

async function shutdownStep(label: string, action: (() => Promise<unknown> | unknown) | undefined) {
	if (!action) return false;
	try {
		await action();
		return false;
	} catch (error) {
		console.error(`[shutdown] ${label} failed`, error);
		return true;
	}
}

async function stopRankedProcess(): Promise<void> {
	const rankedProcess = activeRankedProcess;
	if (!rankedProcess) return;

	activeRankedProcess = undefined;
	rankedProcess.kill("SIGTERM");
	const gracefulExit = rankedProcess.exited.then(() => undefined);
	const forceExit = Bun.sleep(5_000).then(() => {
		try {
			rankedProcess.kill("SIGKILL");
		} catch {
			// The process exited between the grace timeout and the kill attempt.
		}
	});
	await Promise.race([gracefulExit, forceExit]);
}

async function gracefulShutdown(reason: string, requestedExitCode = 0): Promise<never> {
	if (shuttingDown) {
		await new Promise<never>(() => {});
	}
	shuttingDown = true;
	console.info(`[shutdown] ${reason}`);

	const hardStop = setTimeout(() => {
		console.error("[shutdown] grace period exceeded");
		process.exit(1);
	}, 15_000);
	hardStop.unref();

	let failed = false;
	failed = (await shutdownStep("API", activeApi ? () => activeApi!.stop() : undefined)) || failed;
	failed =
		(await shutdownStep("Socket.IO", socketServerStarted ? () => stopSocketServer() : undefined)) ||
		failed;
	failed =
		(await shutdownStep(
			"file watcher",
			activeWatcher ? () => activeWatcher!.close() : undefined
		)) || failed;
	activeScheduler?.stopAllJobs();
	failed =
		(await shutdownStep(
			"BullMQ workers",
			activeWorkerService ? () => activeWorkerService!.close() : undefined
		)) || failed;
	failed =
		(await shutdownStep(
			"Discord client",
			activeClient ? () => activeClient!.destroy() : undefined
		)) || failed;
	failed = (await shutdownStep("ranked process", stopRankedProcess)) || failed;
	failed =
		(await shutdownStep("database", activeDatabase ? () => activeDatabase!.close() : undefined)) ||
		failed;

	clearTimeout(hardStop);
	process.exit(failed ? 1 : requestedExitCode);
}

process.once("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.once("SIGINT", () => void gracefulShutdown("SIGINT"));
process.once("exit", () => {
	try {
		activeRankedProcess?.kill("SIGTERM");
	} catch {
		// Best-effort synchronous fallback for abrupt parent exits.
	}
});

/**
 * Import files
 * @param path glob pattern
 */
async function loadFiles(path: string): Promise<void> {
	const files = await resolve(path);
	await Promise.all(
		// eslint-disable-next-line array-callback-return
		files.map((file) => {
			const newFileName = file.replace("file://", "");
			delete require.cache[newFileName];
			return import(newFileName);
		})
	);
}

/**
 * Hot reload
 */
async function reload(client: Client) {
	const store = await resolveDependency(Store);
	store.set("botHasBeenReloaded", true);

	const logger = await resolveDependency(Logger);
	console.info("\n");
	logger.startSpinner("Hot reloading...");

	// remove events
	client.removeEvents();

	// get all instances to keep
	const instancesToKeep: Map<constructor<any>, any> = new Map();
	for (const target of keptInstances) {
		const instance = await resolveDependency(target);
		instancesToKeep.set(target, instance);
	}

	// cleanup
	MetadataStorage.clear();
	DIService.engine.clearAllServices();

	// transfer store instance to the new container in order to keep the same states
	for (const [target, instance] of instancesToKeep) {
		container.registerInstance(target, instance);
	}

	// re-register the client instance
	container.registerInstance(Client, client);

	// reload files
	await loadFiles(importPattern);

	// rebuild
	await MetadataStorage.instance.build();
	await client.initApplicationCommands();
	client.initEvents();

	// re-init services

	const pluginManager = await resolveDependency(PluginsManager);
	await pluginManager.loadPlugins();

	const db = await resolveDependency(Database);
	await db.initialize();

	logger.log(chalk.whiteBright("Hot reloaded\n"));
}

async function init() {
	const logger = await resolveDependency(Logger);

	// check environment variables
	checkEnvironmentVariables();

	// init error handler
	await resolveDependency(ErrorHandler);

	// init plugins
	const pluginManager = await resolveDependency(PluginsManager);
	await pluginManager.loadPlugins();
	await pluginManager.syncTranslations();

	// strart spinner
	console.info("\n");
	logger.startSpinner("Starting...");

	// init the database
	const db = await resolveDependency(Database);
	activeDatabase = db;
	await db.initialize();

	const SOCKET_PORT = Number(env.isProduction ? env.SOCKET_PORT : env.TEST_SOCKET_PORT);
	await startSocketServer(SOCKET_PORT, env.SOCKET_HOST);
	socketServerStarted = true;

	// Sub-process Colyseus ranked — exécuté en ESM Bun direct (le bot tourne en
	// CJS compilé pour cycles Mikro-ORM, Colyseus 0.17 + @colyseus/schema sont
	// ESM-only). Vit/meurt avec le bot ; logs streamés sur le journal du service.
	if (process.env.RANKED_DISABLED !== "1") {
		// Entrée ranked résolue relativement au cwd du bot (override via RANKED_ENTRY),
		// lancée avec le runtime Bun courant — aucun chemin machine en dur.
		const defaultRankedEntry = env.isProduction
			? `${__dirname}/ranked/main.js`
			: `${__dirname}/ranked/main.ts`;
		const rankedSrc = process.env.RANKED_ENTRY ?? defaultRankedEntry;
		const rankedProc = Bun.spawn([process.execPath, rankedSrc], {
			stdio: ["ignore", "inherit", "inherit"],
			env: {
				...process.env,
				RANKED_HOST: env.RANKED_HOST,
				RANKED_PORT: String(env.RANKED_PORT),
			},
			cwd: process.cwd(),
		});
		activeRankedProcess = rankedProc;
		console.info(`[bot] Ranked sub-process spawned (pid=${rankedProc.pid})`);
		void rankedProc.exited.then((exitCode) => {
			if (!shuttingDown) {
				console.error(`[bot] Ranked sub-process exited unexpectedly (code=${exitCode})`);
				void gracefulShutdown("ranked process failure", 1);
			}
		});
	}

	// init the client
	DIService.engine = tsyringeDependencyRegistryEngine.setInjector(container);
	// Les intents sont résolus AVANT la construction : `client.options.intents` est
	// figé ensuite, et Discord refuse la connexion entière si l'un des intents
	// privilégiés demandés n'est pas activé sur l'application.
	let bootToken = discordBotProfile.token;
	let intents;
	if (bootToken) {
		try {
			await assertDiscordTokenMatchesProfile(bootToken, discordBotProfile);
			intents = await resolveGrantedIntents(bootToken);
			console.info(
				`[bot] Profil Discord ${discordBotProfile.name} valide — application=${discordBotProfile.clientId}, intents=${intents.length}`
			);
		} catch (error) {
			console.error(
				`[bot] Profil Discord ${discordBotProfile.name} refuse — REST/Socket.IO/ranked restent actifs :`,
				error instanceof Error ? error.message : error
			);
			bootToken = undefined;
		}
	}
	const client = new Client(clientConfig(intents));
	activeClient = client;
	(globalThis as typeof globalThis & { __roseGriffonDiscordClient?: Client }).__roseGriffonDiscordClient = client;

	// Load all new events
	discordLogs(client, { debug: false });
	container.registerInstance(Client, client);

	// import all the commands and events
	await loadFiles(importPattern);
	await pluginManager.importCommands();
	await pluginManager.importEvents();

	// Cast nécessaire : PostgreSqlEntityManager n'est pas structurellement assignable
	// à EntityManager<IDatabaseDriver<Connection>> en MikrORM v7, mais en est une sous-classe.
	await RequestContext.create(db.orm.em as unknown as EntityManager, async () => {
		const watcher = env.NODE_ENV === "development" ? chokidar.watch(importPattern) : null;
		activeWatcher = watcher ?? undefined;

		// init the data table if it doesn't exist
		await initDataTable();

		// init plugins services
		await pluginManager.initServices();

		// init the plugin main file
		await pluginManager.execMains();

		// L'API REST et le bus `ready` NE DOIVENT PAS dépendre du login Discord :
		// s'ils vivent dans le `.then()` du login, un token invalide laisse le port
		// API fermé et le proxy ranked (/api/* -> 127.0.0.1:API_PORT) boucle en
		// ECONNREFUSED, donc tout le site tombe alors que seul Discord est HS.
		if (apiConfig.enabled) {
			activeApi = await Server.start();
		}
		activeScheduler = await resolveDependency(Scheduler);

		const store = await container.resolve(Store);
		store.select("ready").subscribe(async (ready) => {
			// check that all properties that are not null are set to true
			if (
				Object.values(ready)
					.filter((value) => value !== null)
					.every((value) => value === true)
			) {
				const eventManager = await resolveDependency(EventManager);
				eventManager.emit("templateReady"); // the template is fully ready!
			}
		});

		// log in with the bot token
		const botToken = bootToken;

		// Token absent : même politique que login KO ci-dessous — Discord est HS mais
		// l'API REST, Socket.IO et le ranked déjà démarrés doivent rester debout.
		if (!botToken) {
			console.error("[bot] Discord désactivé :", new NoBotTokenError().message);
			return;
		}

		// build event/command metadata storage and wire events BEFORE login,
		// so that @Once('clientReady') / @On(...) / @Slash(...) handlers fire on first boot
		// (sans ça, seul reload() les enregistrait — donc 0 commandes registered au boot)
		await MetadataStorage.instance.build();
		client.initEvents();

		client
			.login(botToken)
			.then(async () => {
				if (env.NODE_ENV === "development") {
					// reload commands and events when a file changes
					watcher?.on("change", () => reload(client));

					// reload commands and events when a file is added
					watcher?.on("add", () => reload(client));

					// reload commands and events when a file is deleted
					watcher?.on("unlink", () => reload(client));
				}

				// sync slash commands sur Discord (global en prod via botGuilds=undefined)
				// appelé ici directement après login pour ne pas dépendre du @Once('clientReady')
				// (qui peut ne pas trigger correctement avec les intents réduits)
				try {
					// Des commandes globales residuelles d'une ancienne installation
					// provoquent un doublon avec les commandes guild-scoped.
					if (env.BOT_COMMAND_GUILDS && discordBotProfile.name === "current") {
						await client.application?.commands.set([]);
						console.info("Discord global commands cleared (guild-scoped profile)");
					}
					await client.initApplicationCommands();
					const globalCmds = await client.application?.commands.fetch().catch(() => null);
					console.info(
						`Discord commands synced — local=${MetadataStorage.instance.applicationCommands.length}, global=${globalCmds?.size ?? 0}(${[...(globalCmds?.values() ?? [])].map((c) => c.name).join(", ")}), guilds_joined=${client.guilds.cache.size}`
					);
				} catch (e) {
					console.error("[ERROR] initApplicationCommands failed:", e);
				}

				// FALLBACK : @Once('clientReady') du ReadyEvent ne fire pas (bug
				// discordx-rpbey + intents réduits). On force manuellement
				// l'émission de l'event pour déclencher tous les @Once/@Schedule.
				try {
					client.emit("clientReady" as any, client);
					// Idempotent — si discordx a quand même wired et qu'il fire,
					// les handlers `@Once` ignorent le 2eme appel.
				} catch (e) {
					console.error("[bot] manual clientReady emit failed:", e);
				}

				// start the workers
				activeWorkerService = new WorkerService(db, client);
				await activeWorkerService.init();
			})
			.catch((err) => {
				// Le client Discord ne peut pas se connecter (token invalide / réseau).
				// On ne tue PAS le process : le ranked sub-process tourne déjà,
				// et tuer ici killerait aussi le matchmaking. On loggue et on continue.
				console.error(
					"[bot] Discord login failed — bot Discord HS, ranked sub-process et REST/Socket.IO continuent :",
					err?.message ?? err
				);
			});
	});
}

init().catch((err) => {
	console.error("[FATAL] init() failed:", err);
	void gracefulShutdown("startup failure", 1);
});
