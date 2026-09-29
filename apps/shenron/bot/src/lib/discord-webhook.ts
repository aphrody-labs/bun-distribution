/**
 * Helpers pour les Discord webhooks.
 *
 * Deux modes :
 *  1. Bot token (`Authorization: Bot <DISCORD_TOKEN>`) → list/create/delete sur un channel.
 *  2. Webhook token (URL `https://discord.com/api/webhooks/{id}/{token}`) → execute, edit,
 *     delete message. Pas d'auth bot requise.
 */

import { discordFetch } from "./discord-rest";

const WEBHOOK_URL_RE =
	/^https?:\/\/(?:discord(?:app)?|ptb\.discord|canary\.discord)\.com\/api(?:\/v\d+)?\/webhooks\/(\d{17,20})\/([\w-]+)/;

export interface ParsedWebhook {
	id: string;
	token: string;
}

export function parseWebhookUrl(url: string): ParsedWebhook | null {
	const m = WEBHOOK_URL_RE.exec(url.trim());
	if (!m) return null;
	return { id: m[1]!, token: m[2]! };
}

function buildWebhookUrl(id: string, token: string): string {
	return `https://discord.com/api/v10/webhooks/${id}/${token}`;
}

export interface DiscordWebhook {
	id: string;
	type: number;
	guild_id: string | null;
	channel_id: string | null;
	user?: { id: string; username: string; avatar: string | null };
	name: string | null;
	avatar: string | null;
	token?: string;
	application_id: string | null;
	url?: string;
}

interface EmbedField {
	name: string;
	value: string;
	inline?: boolean;
}

export interface Embed {
	title?: string;
	description?: string;
	url?: string;
	timestamp?: string;
	color?: number;
	footer?: { text: string; icon_url?: string };
	image?: { url: string };
	thumbnail?: { url: string };
	author?: { name: string; url?: string; icon_url?: string };
	fields?: EmbedField[];
}

export interface ExecuteWebhookPayload {
	content?: string;
	username?: string;
	avatar_url?: string;
	tts?: boolean;
	embeds?: Embed[];
	allowed_mentions?: {
		parse?: ("roles" | "users" | "everyone")[];
		roles?: string[];
		users?: string[];
		replied_user?: boolean;
	};
	flags?: number;
	thread_id?: string;
	thread_name?: string;
}

export async function listChannelWebhooks(channelId: string): Promise<DiscordWebhook[]> {
	const { data } = await discordFetch<DiscordWebhook[]>(`/channels/${channelId}/webhooks`, {
		mode: "Bot",
	});
	return data;
}

export async function listGuildWebhooks(guildId: string): Promise<DiscordWebhook[]> {
	const { data } = await discordFetch<DiscordWebhook[]>(`/guilds/${guildId}/webhooks`, {
		mode: "Bot",
	});
	return data;
}

export async function createChannelWebhook(
	channelId: string,
	body: { name: string; avatar?: string | null }
): Promise<DiscordWebhook> {
	const { data } = await discordFetch<DiscordWebhook>(`/channels/${channelId}/webhooks`, {
		mode: "Bot",
		method: "POST",
		body,
	});
	return data;
}

export async function deleteWebhook(webhookId: string, reason?: string): Promise<void> {
	await discordFetch<void>(`/webhooks/${webhookId}`, {
		mode: "Bot",
		method: "DELETE",
		body: reason ? { reason } : undefined,
	});
}

/**
 * Envoie un message via une webhook URL (id + token). Pas d'auth bot.
 * `wait=true` → renvoie le message créé ; sinon 204.
 */
export async function executeWebhook(
	url: string,
	payload: ExecuteWebhookPayload,
	opts: { wait?: boolean; threadId?: string } = {}
): Promise<{ id: string; channel_id: string } | null> {
	const parsed = parseWebhookUrl(url);
	if (!parsed) throw new Error("URL webhook invalide");
	const params = new URLSearchParams();
	if (opts.wait) params.set("wait", "true");
	if (opts.threadId) params.set("thread_id", opts.threadId);
	const target = `${buildWebhookUrl(parsed.id, parsed.token)}${params.toString() ? `?${params}` : ""}`;
	const res = await fetch(target, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`webhook execute ${res.status}: ${text || res.statusText}`);
	}
	if (res.status === 204) return null;
	return (await res.json()) as { id: string; channel_id: string };
}

async function editWebhookMessage(
	url: string,
	messageId: string,
	payload: ExecuteWebhookPayload
): Promise<void> {
	const parsed = parseWebhookUrl(url);
	if (!parsed) throw new Error("URL webhook invalide");
	const target = `${buildWebhookUrl(parsed.id, parsed.token)}/messages/${messageId}`;
	const res = await fetch(target, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
	if (!res.ok) throw new Error(`webhook edit ${res.status}`);
}

async function deleteWebhookMessage(url: string, messageId: string): Promise<void> {
	const parsed = parseWebhookUrl(url);
	if (!parsed) throw new Error("URL webhook invalide");
	const target = `${buildWebhookUrl(parsed.id, parsed.token)}/messages/${messageId}`;
	const res = await fetch(target, { method: "DELETE" });
	if (!res.ok && res.status !== 204) throw new Error(`webhook delete ${res.status}`);
}
