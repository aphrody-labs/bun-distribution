import fs from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";

import boxen from "boxen";
import { constant } from "case";
import chalk from "chalk";
import dayjs from "dayjs";
import type { BaseMessageOptions, User } from "discord.js";
import { NewsChannel, TextChannel, ThreadChannel } from "discord.js";
import { Client, MetadataStorage } from "@aphrody/discordx";
import ora from "ora";
import type { StackFrame } from "stacktrace-parser";
import { parse } from "stacktrace-parser";
import { delay, inject } from "tsyringe";

import { apiConfig, logsConfig } from "@/configs";
import { Schedule, Service } from "@/decorators";
import { env } from "@/env";
import { locales } from "@/i18n";
import { PluginsManager } from "./PluginsManager";
import { Scheduler } from "./Scheduler";
import { redactSensitive, safeLogValue } from "../api/security/log-redaction";
import { fileOrDirectoryExists } from "../utils/functions/files";
import { formatDate } from "../utils/functions/date";
import {
	getTypeOfInteraction,
	resolveAction,
	resolveChannel,
	resolveGuild,
	resolveUser,
} from "../utils/functions/resolvers";
import { numberAlign, oneLine, validString } from "../utils/functions/string";
import { resolveDependency } from "../utils/functions/dependency";

const defaultConsole = { ...console };

@Service()
export class Logger {
	private readonly logPath: string = path.join(__dirname, "..", "..", "logs");
	private readonly logArchivePath: string = path.join(this.logPath, "archives");

	// SPAM GUARDS
	private disableFileLogging = false;
	private lastErrorSig = "";
	private lastErrorCount = 0;

	private readonly levels = ["info", "warn", "error"] as const;
	private embedLevelBuilder = {
		info: (message: string): BaseMessageOptions => ({
			embeds: [
				{
					title: "INFO",
					description: message,
					color: 0x007fe7,
					timestamp: new Date().toISOString(),
				},
			],
		}),
		warn: (message: string): BaseMessageOptions => ({
			embeds: [
				{
					title: "WARN",
					description: message,
					color: 0xf37100,
					timestamp: new Date().toISOString(),
				},
			],
		}),
		error: (message: string): BaseMessageOptions => ({
			embeds: [
				{
					title: "ERROR",
					description: message,
					color: 0x7c1715,
					timestamp: new Date().toISOString(),
				},
			],
		}),
	};

	private interactionTypeReadable: { [key in InteractionsConstants]: string } = {
		CHAT_INPUT_COMMAND_INTERACTION: "Slash command",
		SIMPLE_COMMAND_MESSAGE: "Simple command",
		CONTEXT_MENU_INTERACTION: "Context menu",
		BUTTON_INTERACTION: "Button",
		SELECT_MENU_INTERACTION: "Select menu",
		STRING_SELECT_MENU_INTERACTION: "Select menu",
		MODAL_SUBMIT_INTERACTION: "Modal submit",
	};

	private spinner = ora();

	private lastLogsTail: string[] = [];

	constructor(
		@inject(delay(() => Client)) private client: Client,
		@inject(delay(() => Scheduler)) private scheduler: Scheduler,
		@inject(delay(() => PluginsManager)) private pluginsManager: PluginsManager
	) {
		const loggerState = globalThis as typeof globalThis & { __roseGriffonLoggerConfigured?: boolean };
		if (!loggerState.__roseGriffonLoggerConfigured) {
			console.info = (...args) => this.baseLog("info", ...args);
			console.warn = (...args) => this.baseLog("warn", ...args);
			console.error = (...args) => this.baseLog("error", ...args);
			loggerState.__roseGriffonLoggerConfigured = true;
		}
	}

	// =================================
	// ======= Base log function =======
	// =================================

	private baseLog(level: (typeof this.levels)[number], ...args: unknown[]) {
		const excludedPatterns = ["[typesafe-i18n]"];

		const message = args.map(safeLogValue).join(", ");

		if (!excludedPatterns.some((pattern) => message.includes(pattern))) {
			this.log(message, level);
		}
	}

	// =================================
	// ======== Output Providers =======
	// =================================

	/**
	 * Log a message in the console.
	 * @param message the message to log
	 * @param level info (default) | warn | error
	 * @param ignoreTemplate if it should ignore the timestamp template (default to false)
	 */
	console(message: string, level: (typeof this.levels)[number] = "info", ignoreTemplate = false) {
		if (this.spinner.isSpinning) this.spinner.stop();

		message = redactSensitive(message);
		if (!validString(message)) return;

		let templatedMessage = ignoreTemplate
			? message
			: `${level} [${chalk.dim.gray(formatDate(new Date()))}] ${message}`;
		if (level === "error") templatedMessage = chalk.red(templatedMessage);

		defaultConsole[level](templatedMessage);

		// save the last logs tail queue
		if (this.lastLogsTail.length >= logsConfig.logTailMaxSize) this.lastLogsTail.shift();

		this.lastLogsTail.push(message);
	}

	/**
	 * Log a message in a log file.
	 * @param message the message to log
	 * @param level info (default) | warn | error
	 */
	file(message: string, level: (typeof this.levels)[number] = "info") {
		message = redactSensitive(message);
		if (!validString(message) || this.disableFileLogging) return;

		const templatedMessage = `[${formatDate(new Date())}] ${message}`;
		const fileName = `${this.logPath}/${level}.log`;

		try {
			if (!fileOrDirectoryExists(this.logPath)) fs.mkdirSync(this.logPath, { recursive: true });
			if (!fileOrDirectoryExists(fileName)) fs.writeFileSync(fileName, "");
			fs.appendFileSync(fileName, `${templatedMessage}\n`);
		} catch (err) {
			// ⬇️ IMPORTANT: never call this.logger.* here (no recursion)
			this.disableFileLogging = true;
			// log once to the real console only
			try {
				defaultConsole.error(
					"[Logger] File logging disabled due to write error:",
					(err as Error)?.message ?? err
				);
			} catch {
				/* ignore */
			}
		}
	}

	/**
	 * Log a message in a Discord channel using embeds.
	 * @param channelId the ID of the discord channel to log to
	 * @param message the message to log or a [MessageOptions](https://discord.js.org/#/docs/discord.js/main/typedef/BaseMessageOptions) compliant object (like embeds, components, etc)
	 * @param level info (default) | warn | error
	 */
	async discordChannel(
		channelId: string,
		message: string | BaseMessageOptions,
		level?: (typeof this.levels)[number]
	) {
		if (!this.client.token) return;

		const channel = await this.client.channels.fetch(channelId).catch(() => null);

		if (channel && (channel instanceof TextChannel || channel instanceof ThreadChannel)) {
			if (typeof message !== "string") return channel.send(message).catch(console.error);

			channel.send(this.embedLevelBuilder[level ?? "info"](message)).catch(console.error);
		}
	}

	async makeAnnouncement(channelId: string, message: BaseMessageOptions) {
		if (!this.client.token) return;

		const channel = await this.client.channels.fetch(channelId).catch(() => null);

		if (channel && channel instanceof NewsChannel) {
			try {
				const announcement = await channel.send(message);

				return await announcement?.crosspost();
			} catch (err) {
				console.error("Failed to make announcement:", err);
			}
		}
	}

	// =================================
	// =========== Archive =============
	// =================================

	/**
	 * Archive the logs in a zip file each day.
	 */
	@Schedule("5 0 * * *") // good: a slight delay vs midnight
	async archiveLogs() {
		if (!logsConfig.archive.enabled) return;

		const date = dayjs().subtract(1, "day").format("YYYY-MM-DD");

		if (!fileOrDirectoryExists(this.logArchivePath))
			fs.mkdirSync(this.logArchivePath, { recursive: true });

		// ⬇️ NEW: snapshot to a temp dir to avoid partial reads while files are open
		const tempDir = path.join(this.logPath, `.tmp-archive-${date}`);
		try {
			fs.mkdirSync(tempDir, { recursive: true });
			const currentLogs = fs.readdirSync(this.logPath).filter((f) => f.endsWith(".log"));
			for (const f of currentLogs) {
				// copy current state; avoids tar size mismatches
				fs.copyFileSync(path.join(this.logPath, f), path.join(tempDir, f));
			}

			const outputPath = `${this.logArchivePath}/logs-${date}.tar.gz`;
			const output = fs.createWriteStream(outputPath);

			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const archiver = require("archiver");
			const archive = archiver("tar", { gzip: true, gzipOptions: { level: 9 } });
			archive.on("error", (err: unknown) => {
				// never recurse; log only to default console
				defaultConsole.error("[Logger] Archive error:", err);
			});

			archive.pipe(output);

			for (const f of currentLogs) {
				archive.file(path.join(tempDir, f), { name: f });
			}

			await archive.finalize();

			// delete old logs (truncate) after successful archive
			await this.deleteCurrentLogs();

			// retention policy
			await this.deleteOldLogArchives();
		} catch (err) {
			defaultConsole.error("[Logger] archiveLogs failed:", err);
		} finally {
			// cleanup snapshot
			try {
				fs.rmSync(tempDir, { recursive: true, force: true });
			} catch {}
		}
	}

	private async deleteCurrentLogs() {
		const currentLogsPaths = fs.readdirSync(this.logPath).filter((file) => file.endsWith(".log"));
		for (const logPath of currentLogsPaths) {
			try {
				// truncate instead of rewrite; safer with open file handles
				fs.truncateSync(path.join(this.logPath, logPath), 0);
			} catch (err) {
				defaultConsole.error("[Logger] Failed to truncate log:", logPath, err);
			}
		}
	}

	private async deleteOldLogArchives() {
		const archives = fs.readdirSync(this.logArchivePath).filter((file) => file.endsWith(".tar.gz"));

		for (const archive of archives) {
			const date = dayjs(archive.split("logs-")[1].split(".tar.gz")[0]);
			console.info(date.format("YYYY-MM-DD"));
			if (date.isBefore(dayjs().subtract(logsConfig.archive.retention, "day")))
				await unlink(`${this.logArchivePath}/${archive}`);
		}
	}

	// =================================
	// =========== Shortcut ============
	// =================================

	/**
	 * Shortcut function that will log in the console, and optionally in a file or discord channel depending on params.
	 * @param message message to log
	 * @param level info (default) | warn | error
	 * @param saveToFile if true, the message will be saved to a file (default to true)
	 * @param channelId Discord channel to log to (if `null`, nothing will be logged to Discord)
	 */
	log(
		message: string,
		level: (typeof this.levels)[number] = "info",
		saveToFile: boolean = true,
		channelId: string | null = null
	) {
		message = redactSensitive(message);
		if (message === "") return;

		// log in the console
		this.console(message, level);

		// save log to file
		if (saveToFile) this.file(message, level);

		// send to discord channel
		if (channelId) this.discordChannel(channelId, message, level);
	}

	// =================================
	// ========= Log Templates =========
	// =================================

	/**
	 * Logs any interaction that is not excluded in the config.
	 * @param interaction
	 */
	logInteraction(interaction: AllInteractions) {
		const type = constant(getTypeOfInteraction(interaction)) as InteractionsConstants;
		if (logsConfig.interaction.exclude.includes(type)) return;

		const action = resolveAction(interaction);
		const channel = resolveChannel(interaction);
		const guild = resolveGuild(interaction);
		const user = resolveUser(interaction);

		const message = oneLine`
            (${type})
            "${action}"
            ${channel instanceof TextChannel || channel instanceof ThreadChannel ? `in channel #${channel.name}` : ""}
            ${guild ? `in guild ${guild.name}` : ""}
            ${user ? `by ${user.username}#${user.discriminator}` : ""}
        `;

		const chalkedMessage = oneLine`
            (${chalk.bold.white(type)})
            "${chalk.bold.green(action)}"
            ${
							channel instanceof TextChannel || channel instanceof ThreadChannel
								? `${chalk.dim.italic.gray("in channel")} ${chalk.bold.blue(`#${channel.name}`)}`
								: ""
						}
            ${
							guild
								? `${chalk.dim.italic.gray("in guild")} ${chalk.bold.blue(`${guild.name}`)}`
								: ""
						}
            ${
							user
								? `${chalk.dim.italic.gray("by")} ${chalk.bold.blue(`${user.username}#${user.discriminator}`)}`
								: ""
						}
        `;

		if (logsConfig.interaction.console) this.console(chalkedMessage);
		if (logsConfig.interaction.file) this.file(message);
		if (logsConfig.interaction.channel) {
			this.discordChannel(logsConfig.interaction.channel, {
				embeds: [
					{
						author: {
							name: user ? `${user.username}#${user.discriminator}` : "Unknown user",
							icon_url: user?.avatar
								? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}`
								: "",
						},
						title: `Interaction`,
						thumbnail: {
							url: guild?.iconURL({ forceStatic: true }) ?? "",
						},
						fields: [
							{
								name: "Type",
								value: this.interactionTypeReadable[type],
								inline: true,
							},
							{
								name: "\u200B",
								value: "\u200B",
								inline: true,
							},
							{
								name: "Action",
								value: action,
								inline: true,
							},
							{
								name: "Guild",
								value: guild ? guild.name : "Unknown",
								inline: true,
							},
							{
								name: "\u200B",
								value: "\u200B",
								inline: true,
							},
							{
								name: "Channel",
								value:
									channel instanceof TextChannel || channel instanceof ThreadChannel
										? `#${channel.name}`
										: "Unknown",
								inline: true,
							},
						],
						color: 0xdb5c21,
						timestamp: new Date().toISOString(),
					},
				],
			});
		}
	}

	/**
	 * Logs all new users.
	 * @param user
	 */
	logNewUser(user: User) {
		const message = `(NEW_USER) ${user.tag} (${user.id}) has been added to the db`;
		const chalkedMessage = `(${chalk.bold.white("NEW_USER")}) ${chalk.bold.green(user.tag)} (${chalk.bold.blue(user.id)}) ${chalk.dim.italic.gray("has been added to the db")}`;

		if (logsConfig.newUser.console) this.console(chalkedMessage);
		if (logsConfig.newUser.file) this.file(message);
		if (logsConfig.newUser.channel) {
			this.discordChannel(logsConfig.newUser.channel, {
				embeds: [
					{
						title: "New user",
						description: `**${user.tag}**`,
						thumbnail: {
							url: user.displayAvatarURL({ forceStatic: false }),
						},
						color: 0x83dd80,
						timestamp: new Date().toISOString(),
						footer: {
							text: user.id,
						},
					},
				],
			});
		}
	}

	/**
	 * Logs all 'actions' (create, delete, etc) of a guild.
	 * @param type NEW_GUILD, DELETE_GUILD, RECOVER_GUILD
	 * @param guildId
	 */
	logGuild(type: "NEW_GUILD" | "DELETE_GUILD" | "RECOVER_GUILD", guildId: string) {
		const additionalMessage =
			type === "NEW_GUILD"
				? "has been added to the db"
				: type === "DELETE_GUILD"
					? "has been deleted"
					: type === "RECOVER_GUILD"
						? "has been recovered"
						: "";

		resolveDependency(Client).then(async (client) => {
			const guild = await client.guilds.fetch(guildId).catch(() => null);

			const message = `(${type}) Guild ${guild ? `${guild.name} (${guildId})` : guildId} ${additionalMessage}`;
			const chalkedMessage = oneLine`
                (${chalk.bold.white(type)})
                ${chalk.dim.italic.gray("Guild")}
                ${guild ? `${chalk.bold.green(guild.name)} (${chalk.bold.blue(guildId)})` : guildId}
                ${chalk.dim.italic.gray(additionalMessage)}
            `;

			if (logsConfig.guild.console) this.console(chalkedMessage);
			if (logsConfig.guild.file) this.file(message);
			if (logsConfig.guild.channel) {
				this.discordChannel(logsConfig.guild.channel, {
					embeds: [
						{
							title:
								type === "NEW_GUILD"
									? "New guild"
									: type === "DELETE_GUILD"
										? "Deleted guild"
										: "Recovered guild",

							// description: `**${guild.name} (\`${guild.id}\`)**\n${guild.memberCount} members`,
							fields: [
								{
									name: guild?.name ?? "Unknown",
									value: `${guild?.memberCount ?? "N/A"} members`,
								},
							],
							footer: {
								text: guild?.id ?? "Unknown",
							},
							thumbnail: {
								url: guild?.iconURL() ?? "",
							},
							color:
								type === "NEW_GUILD" ? 0x02fd77 : type === "DELETE_GUILD" ? 0xff0000 : 0xfffb00,
							timestamp: new Date().toISOString(),
						},
					],
				});
			}
		});
	}

	/**
	 * Logs errors.
	 * @param error
	 * @param type uncaughtException, unhandledRejection
	 * @param trace
	 */
	async logError(
		error: Error | any,
		type: "Exception" | "unhandledRejection",
		trace: StackFrame[] = parse(error.stack ?? "")
	) {
		// Build a short signature to suppress insane spam of the exact same line
		const sig = `${type}:${error?.message ?? String(error)}:${trace?.[0]?.file ?? ""}:${trace?.[0]?.lineNumber ?? ""}`;
		if (sig === this.lastErrorSig) {
			this.lastErrorCount++;
			// Only surface every 100th duplicate to the console, never to file
			if (this.lastErrorCount % 100 !== 0) {
				return;
			}
		} else {
			this.lastErrorSig = sig;
			this.lastErrorCount = 0;
		}

		let message = "(ERROR)";
		let embedMessage = "";
		let embedTitle = "";
		let chalkedMessage = `(${chalk.bold.white("ERROR")})`;

		if (trace && trace[0]) {
			message += ` ${type === "Exception" ? "Exception" : "Unhandled rejection"} : ${error.message}\n${trace.map((frame: StackFrame) => `\t> ${frame.file}:${frame.lineNumber}`).join("\n")}`;
			embedMessage += `\`\`\`\n${trace.map((frame: StackFrame) => `> ${frame.file}:${frame.lineNumber}`).join("\n")}\n\`\`\``;
			embedTitle += `***${type === "Exception" ? "Exception" : "Unhandled rejection"}* : ${error.message}**`;
			chalkedMessage += ` ${chalk.dim.italic.gray(type === "Exception" ? "Exception" : "Unhandled rejection")} : ${error.message}\n${chalk.dim.italic(trace.map((frame: StackFrame) => `\t> ${frame.file}:${frame.lineNumber}`).join("\n"))}`;
		} else {
			if (type === "Exception") {
				message += `An exception as occurred in a unknown file\n\t> ${error.message}`;
				embedMessage += `An exception as occurred in a unknown file\n${error.message}`;
			} else {
				message += `An unhandled rejection as occurred in a unknown file\n\t> ${error}`;
				embedMessage += `An unhandled rejection as occurred in a unknown file\n${error}`;
			}
		}

		if (embedMessage.length >= 4096) {
			embedMessage = `Error was too big to log, head to the console or log files for more infos`;
		}

		if (logsConfig.error.console) this.console(chalkedMessage, "error");
		if (logsConfig.error.file) this.file(message, "error");
		if (logsConfig.error.channel && env.NODE_ENV === "production") {
			this.discordChannel(
				logsConfig.error.channel,
				{
					embeds: [
						{
							title: embedTitle.length >= 256 ? `${embedTitle.substring(0, 252)}...` : embedTitle,
							description: embedMessage,
							color: 0x7c1715,
							timestamp: new Date().toISOString(),
						},
					],
				},
				"error"
			);
		}
	}

	// =================================
	// ============= Other =============
	// =================================

	getLastLogs() {
		return this.lastLogsTail;
	}

	startSpinner(text: string) {
		this.spinner.start(text);
	}

	async logStartingConsole() {
		const symbol = "✓";
		const tab = "\u200B  \u200B";

		this.spinner.stop();

		this.console(chalk.dim.gray("\n━━━━━━━━━━ Started! ━━━━━━━━━━\n"), "info", true);

		// commands
		const slashCommands = MetadataStorage.instance.applicationCommandSlashes;
		const simpleCommands = MetadataStorage.instance.simpleCommands;
		const contextMenus = [
			...MetadataStorage.instance.applicationCommandMessages,
			...MetadataStorage.instance.applicationCommandUsers,
		];
		const commandsSum = slashCommands.length + simpleCommands.length + contextMenus.length;

		this.console(
			chalk.blue(`${symbol} ${numberAlign(commandsSum)} ${chalk.bold("commands")} loaded`),
			"info",
			true
		);
		this.console(
			chalk.dim.gray(
				`${tab}┝──╾ ${numberAlign(slashCommands.length)} slash commands\n${tab}┝──╾ ${numberAlign(simpleCommands.length)} simple commands\n${tab}╰──╾ ${numberAlign(contextMenus.length)} context menus`
			),
			"info",
			true
		);

		// events
		const events = MetadataStorage.instance.events;

		this.console(
			chalk.yellowBright(`${symbol} ${numberAlign(events.length)} ${chalk.bold("events")} loaded`),
			"info",
			true
		);

		// entities
		const entities = fs
			.readdirSync(path.join(__dirname, "..", "entities"))
			.filter((entity) => !entity.startsWith("index") && !entity.startsWith("BaseEntity"));

		const pluginsEntitesCount = this.pluginsManager.plugins.reduce(
			(acc, plugin) => acc + Object.values(plugin.entities).length,
			0
		);

		this.console(
			chalk.red(
				`${symbol} ${numberAlign(entities.length + pluginsEntitesCount)} ${chalk.bold("entities")} loaded`
			),
			"info",
			true
		);

		// services
		const services = fs
			.readdirSync(path.join(__dirname, "..", "services"))
			.filter((service) => !service.startsWith("index"));

		const pluginsServicesCount = this.pluginsManager.plugins.reduce(
			(acc, plugin) => acc + Object.values(plugin.services).length,
			0
		);

		this.console(
			chalk.hex("ffc107")(
				`${symbol} ${numberAlign(services.length + pluginsServicesCount)} ${chalk.bold("services")} loaded`
			),
			"info",
			true
		);

		// api
		if (apiConfig.enabled) {
			const controllers = await import("@/api/controllers");
			const endpointsCount = Object.values(controllers).reduce((acc, controller) => {
				const methodsName = Object.getOwnPropertyNames(controller.prototype).filter(
					(methodName) => methodName !== "constructor"
				);

				return acc + methodsName.length;
			}, 0);

			this.console(
				chalk.cyan(
					`${symbol} ${numberAlign(endpointsCount)} ${chalk.bold("api endpoints")} loaded`
				),
				"info",
				true
			);
		}

		// scheduled jobs
		const scheduledJobs = this.scheduler.jobs.size;
		this.console(
			chalk.green(`${symbol} ${numberAlign(scheduledJobs)} ${chalk.bold("scheduled jobs")} loaded`),
			"info",
			true
		);

		// translations
		this.console(
			chalk.hex("ab47bc")(
				`${symbol} ${numberAlign(locales.length)} ${chalk.bold("translations")} loaded`
			),
			"info",
			true
		);

		// plugins
		const pluginsCount = this.pluginsManager.plugins.length;

		this.console(
			chalk.hex("#47d188")(
				`${symbol} ${numberAlign(pluginsCount)} ${chalk.bold(`plugin${pluginsCount > 1 ? "s" : ""}`)} loaded`
			),
			"info",
			true
		);

		// connected
		if (apiConfig.enabled) {
			this.console(
				chalk.gray(
					boxen(` API Server listening on port ${chalk.bold(apiConfig.port)} `, {
						padding: 0,
						margin: {
							top: 1,
							bottom: 0,
							left: 1,
							right: 1,
						},
						borderStyle: "round",
						dimBorder: true,
					})
				),
				"info",
				true
			);
		}

		this.console(
			chalk.hex("7289DA")(
				boxen(
					` ${this.client.user ? `${chalk.bold(this.client.user.tag)}` : "Bot"} is ${chalk.green("connected")}! `,
					{
						padding: 0,
						margin: {
							top: 1,
							bottom: 1,
							left: 1 * 3,
							right: 1 * 3,
						},
						borderStyle: "round",
						dimBorder: true,
					}
				)
			),
			"info",
			true
		);
	}
}
