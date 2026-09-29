/**
 * command-exec.ts — Découverte + exécution HEADLESS de TOUTES les slash commands
 * du bot, hors Discord (page admin « Exécuter une commande »).
 *
 * - `buildCommandCatalog()` : liste chaque feuille `@Slash` (via
 *   `applicationCommandSlashesFlat`) avec son schéma d'options complet.
 * - `execCommand()` : construit une **interaction synthétique** (mock
 *   ChatInputCommandInteraction) et la passe à `client.executeInteraction` sur le
 *   client du persona propriétaire (`botIds[0]`). `user.id = OWNER_ID` → passe les
 *   guards (CommandPermissions/AdminOnly/…). Les `reply/editReply/followUp` sont
 *   CAPTURÉS (jamais envoyés à Discord) et renvoyés.
 *
 * Best-effort : les commandes interactives (pagination/modal/collector/voice/
 * canvas) lèvent ou ne renvoient que leur 1ère réponse — on renvoie ce qui a été
 * capturé + l'erreur. Endpoint admin-gated (server.ts).
 */
import {
	ApplicationCommandType,
	InteractionType,
	PermissionsBitField,
	type Client as DjsClient,
} from "discord.js";
import { container } from "tsyringe";
import { Client } from "discordx";
import { env } from "~/lib/env";

const OT_NAME: Record<number, string> = {
	1: "Subcommand",
	2: "SubcommandGroup",
	3: "String",
	4: "Integer",
	5: "Boolean",
	6: "User",
	7: "Channel",
	8: "Role",
	9: "Mentionable",
	10: "Number",
	11: "Attachment",
};

interface CommandOptionSpec {
	name: string;
	description: string;
	type: number;
	typeName: string;
	required: boolean;
	choices: { name: string; value: string | number }[] | null;
	minValue: number | null;
	maxValue: number | null;
	autocomplete: boolean;
}
export interface CommandSpec {
	persona: string | null;
	group: string | null;
	subgroup: string | null;
	name: string;
	invocation: string;
	description: string;
	options: CommandOptionSpec[];
}

function clientMap(): Map<string, Client> {
	return container.resolve<Map<string, Client>>("ClientMap");
}

// biome-ignore lint/suspicious/noExplicitAny: métadonnées discordx hétérogènes
type AnyCmd = any;

/** Catalogue complet des slash commands (feuilles) avec leurs options. */
export function buildCommandCatalog(): { commands: CommandSpec[]; count: number } {
	const clients = clientMap();
	const any = clients.values().next().value;
	const flat = (any?.applicationCommandSlashesFlat ?? []) as AnyCmd[];
	const commands: CommandSpec[] = flat
		.filter((c) => c.type === ApplicationCommandType.ChatInput)
		.map((c) => {
			const invocation = [c.group, c.subgroup, c.name].filter(Boolean).join(" ");
			return {
				persona: c.botIds?.[0] ?? null,
				group: c.group ?? null,
				subgroup: c.subgroup ?? null,
				name: c.name,
				invocation,
				description: c.description ?? "",
				options: ((c.options ?? []) as AnyCmd[]).map((o) => ({
					name: o.name,
					description: o.description ?? "",
					type: o.type,
					typeName: OT_NAME[o.type] ?? String(o.type),
					required: o.required ?? false,
					choices: o.choices?.map((ch: AnyCmd) => ({ name: ch.name, value: ch.value })) ?? null,
					minValue: o.minValue ?? null,
					maxValue: o.maxValue ?? null,
					autocomplete: Boolean(o.autocomplete),
				})),
			};
		})
		.toSorted((a, b) => a.invocation.localeCompare(b.invocation));
	return { commands, count: commands.length };
}

interface CapturedReply {
	method: string;
	content?: string;
	embeds?: unknown[];
	components?: number;
	files?: number;
	ephemeral?: boolean;
}

function serializePayload(p: unknown, method: string): CapturedReply {
	if (typeof p === "string") return { method, content: p };
	const o = (p ?? {}) as Record<string, unknown>;
	const flags = o.flags;
	const ephemeral =
		flags === 64 || (Array.isArray(flags) && flags.includes(64)) || o.ephemeral === true;
	const embeds = Array.isArray(o.embeds)
		? o.embeds.map((e) =>
				e && typeof (e as { toJSON?: () => unknown }).toJSON === "function"
					? (e as { toJSON: () => unknown }).toJSON()
					: e
			)
		: [];
	return {
		method,
		content: typeof o.content === "string" ? o.content : undefined,
		embeds,
		components: Array.isArray(o.components) ? o.components.length : 0,
		files: Array.isArray(o.files) ? o.files.length : 0,
		ephemeral,
	};
}

export interface ExecResult {
	ok: boolean;
	persona: string | null;
	invocation: string;
	replies: CapturedReply[];
	error?: string;
}

/** Exécute une commande par son invocation (ex. "admin reset-user") + options. */
export async function execCommand(
	invocation: string,
	options: Record<string, unknown>,
	channelId?: string
): Promise<ExecResult> {
	const clients = clientMap();
	const any = clients.values().next().value;
	const flat = (any?.applicationCommandSlashesFlat ?? []) as AnyCmd[];
	const cmd = flat.find(
		(c) =>
			c.type === ApplicationCommandType.ChatInput &&
			[c.group, c.subgroup, c.name].filter(Boolean).join(" ") === invocation
	);
	if (!cmd)
		return { ok: false, persona: null, invocation, replies: [], error: "Commande inconnue." };

	const persona = (cmd.botIds?.[0] ?? "shenron") as string;
	const client = clients.get(persona);
	if (!client) return { ok: false, persona, invocation, replies: [], error: "Persona hors-ligne." };

	const guild = client.guilds.cache.get(env.GUILD_ID);
	if (!guild) return { ok: false, persona, invocation, replies: [], error: "Guilde non chargée." };

	const commandName = cmd.group ?? cmd.name;
	const subgroup: string | null = cmd.group && cmd.subgroup ? cmd.subgroup : null;
	const subcommand: string | null = cmd.group ? cmd.name : null;

	// Résout chaque option vers l'objet discord.js attendu par les getters.
	const values: Record<string, unknown> = {};
	const leafData: AnyCmd[] = [];
	for (const opt of (cmd.options ?? []) as AnyCmd[]) {
		const v = options[opt.name];
		if (v == null || v === "") continue;
		let resolved: unknown = v;
		if (opt.type === 6) {
			resolved =
				(await guild.members.fetch(String(v)).catch(() => null)) ??
				(await client.users.fetch(String(v)).catch(() => null));
		} else if (opt.type === 8) resolved = guild.roles.cache.get(String(v)) ?? null;
		else if (opt.type === 7) resolved = guild.channels.cache.get(String(v)) ?? null;
		else if (opt.type === 4 || opt.type === 10) resolved = Number(v);
		else if (opt.type === 5) resolved = v === true || v === "true" || v === "1";
		values[opt.name] = resolved;
		leafData.push({ name: opt.name, type: opt.type, value: opt.type >= 6 ? String(v) : resolved });
	}

	let data: AnyCmd[];
	if (subgroup)
		data = [
			{ name: subgroup, type: 2, options: [{ name: subcommand, type: 1, options: leafData }] },
		];
	else if (subcommand) data = [{ name: subcommand, type: 1, options: leafData }];
	else data = leafData;

	const get = (n: string) => values[n] ?? null;
	const optionsResolver = {
		data,
		getSubcommand: () => subcommand,
		getSubcommandGroup: () => subgroup,
		getFocused: () => "",
		getString: get,
		getInteger: get,
		getNumber: get,
		getBoolean: get,
		getUser: get,
		getMember: get,
		getRole: get,
		getChannel: get,
		getMentionable: get,
		getAttachment: get,
		get,
	};

	const captured: CapturedReply[] = [];
	const fakeMsg = {
		id: "0",
		createMessageComponentCollector: () => ({ on() {}, stop() {} }),
		edit: async () => fakeMsg,
	};
	const member = await guild.members.fetch(env.OWNER_ID).catch(() => null);
	const user = member?.user ?? (await client.users.fetch(env.OWNER_ID).catch(() => null));
	if (!user) return { ok: false, persona, invocation, replies: [], error: "OWNER_ID introuvable." };
	const channel =
		client.channels.cache.get(channelId ?? env.COMMANDS_CHANNEL_ID ?? "") ??
		guild.channels.cache.get(env.COMMANDS_CHANNEL_ID ?? "") ??
		null;
	const allPerms = new PermissionsBitField(PermissionsBitField.All);
	const cap = (m: string) => async (p: unknown) => {
		captured.push(serializePayload(p, m));
		return fakeMsg;
	};

	// biome-ignore lint/suspicious/noExplicitAny: mock d'interaction (surface partielle)
	const interaction: any = {
		id: "0",
		applicationId: client.application?.id ?? "0",
		token: "mock",
		type: InteractionType.ApplicationCommand,
		commandType: ApplicationCommandType.ChatInput,
		commandName,
		commandId: "0",
		locale: "fr",
		guildLocale: "fr",
		client: client as unknown as DjsClient,
		guild,
		guildId: guild.id,
		channel,
		channelId: channel?.id ?? env.COMMANDS_CHANNEL_ID ?? null,
		user,
		member: member ?? { permissions: allPerms, roles: { cache: new Map() }, user },
		appPermissions: allPerms,
		memberPermissions: allPerms,
		replied: false,
		deferred: false,
		isPrimaryEntryPointCommand: () => false,
		isButton: () => false,
		isAnySelectMenu: () => false,
		isContextMenuCommand: () => false,
		isAutocomplete: () => false,
		isCommand: () => true,
		isChatInputCommand: () => true,
		isRepliable: () => true,
		inGuild: () => true,
		inCachedGuild: () => true,
		options: optionsResolver,
		async reply(p: unknown) {
			this.replied = true;
			captured.push(serializePayload(p, "reply"));
			return fakeMsg;
		},
		editReply: cap("editReply"),
		followUp: cap("followUp"),
		async deferReply(p: unknown) {
			this.deferred = true;
			captured.push(serializePayload(p ?? {}, "deferReply"));
			return fakeMsg;
		},
		fetchReply: async () => fakeMsg,
		deleteReply: async () => {},
		update: cap("update"),
		showModal: async () => {},
	};

	try {
		await client.executeInteraction(interaction);
		return { ok: true, persona, invocation, replies: captured };
	} catch (err) {
		return {
			ok: false,
			persona,
			invocation,
			replies: captured,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
