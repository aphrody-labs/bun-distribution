import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const ADMIN_LAB_CHANNEL_ID = process.env.ADMIN_LAB_CHANNEL_ID ?? "1548677623935139901";

let cachedToken: string | null = null;

async function getDiscordBotToken(): Promise<string> {
	if (cachedToken) return cachedToken;
	if (process.env.DISCORD_TOKEN_SHENRON) {
		cachedToken = process.env.DISCORD_TOKEN_SHENRON;
		return cachedToken;
	}
	if (process.env.DISCORD_TOKEN) {
		cachedToken = process.env.DISCORD_TOKEN;
		return cachedToken;
	}

	const envCandidates = [
		join(process.cwd(), "apps", "bot", ".env"),
		join(process.cwd(), ".env"),
		join(import.meta.dir, "..", "..", ".env"),
	];

	for (const path of envCandidates) {
		const content = await readFile(path, "utf8").catch(() => "");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (trimmed.startsWith("DISCORD_TOKEN_SHENRON=")) {
				cachedToken = trimmed.slice("DISCORD_TOKEN_SHENRON=".length).replace(/^['"]|['"]$/g, "").trim();
				return cachedToken;
			}
			if (trimmed.startsWith("DISCORD_TOKEN=")) {
				cachedToken = trimmed.slice("DISCORD_TOKEN=".length).replace(/^['"]|['"]$/g, "").trim();
				return cachedToken;
			}
		}
	}

	throw new Error("DISCORD_TOKEN introuvable pour communiquer avec le salon admin");
}

export interface AdminLabMessageOptions {
	content?: string;
	embeds?: any[];
	channelId?: string;
}

/**
 * Envoie un message au salon réservé aux administrateurs.
 * Utilisable par n'importe quel script, tâche cron ou sous-agent du monorepo.
 */
export async function sendAdminLabMessage(options: AdminLabMessageOptions | string): Promise<{ id: string; ok: boolean }> {
	if (process.env.NODE_ENV === "test") {
		return { id: "test-message-id", ok: true };
	}

	const token = await getDiscordBotToken();
	const payload = typeof options === "string" ? { content: options } : options;
	const channelId = payload.channelId ?? ADMIN_LAB_CHANNEL_ID;

	const bodyStr = JSON.stringify({
		content: payload.content,
		embeds: payload.embeds,
	});

	try {
		const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
			method: "POST",
			headers: {
				Authorization: `Bot ${token}`,
				"Content-Type": "application/json",
			},
			body: bodyStr,
			signal: AbortSignal.timeout(10000),
		});

		if (!res.ok) {
			const err = await res.text();
			throw new Error(`[AdminLab] Erreur d'envoi (${res.status}): ${err}`);
		}

		const data = (await res.json()) as { id: string };
		return { id: data.id, ok: true };
	} catch (e: any) {
		// Repli curl direct si Bun fetch échoue à cause du protocole proxy (ex: socks5h)
		if (e?.code === "UnsupportedProxyProtocol" || e?.message?.includes("UnsupportedProxyProtocol")) {
			const proc = Bun.spawnSync([
				"curl",
				"-s",
				"-X",
				"POST",
				`https://discord.com/api/v10/channels/${channelId}/messages`,
				"-H",
				`Authorization: Bot ${token}`,
				"-H",
				"Content-Type: application/json",
				"-d",
				bodyStr,
			], {
				env: {
					...process.env,
					http_proxy: "",
					https_proxy: "",
					all_proxy: "",
					HTTP_PROXY: "",
					HTTPS_PROXY: "",
					ALL_PROXY: "",
				},
			});

			if (proc.exitCode === 0) {
				try {
					const parsed = JSON.parse(proc.stdout.toString());
					if (parsed.id) return { id: parsed.id, ok: true };
				} catch {}
			}
		}
		throw e;
	}
}

/**
 * Récupère les derniers messages du salon admin pour permettre aux agents
 * de lire les requêtes et instructions des administrateurs.
 */
export async function getAdminLabRecentMessages(limit = 10, channelId = ADMIN_LAB_CHANNEL_ID): Promise<any[]> {
	if (process.env.NODE_ENV === "test") {
		return [];
	}

	const token = await getDiscordBotToken();

	try {
		const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}`, {
			headers: {
				Authorization: `Bot ${token}`,
			},
			signal: AbortSignal.timeout(8000),
		});

		if (!res.ok) {
			const err = await res.text();
			throw new Error(`[AdminLab] Erreur de lecture (${res.status}): ${err}`);
		}

		return (await res.json()) as any[];
	} catch (e: any) {
		if (e?.code === "UnsupportedProxyProtocol" || e?.message?.includes("UnsupportedProxyProtocol")) {
			const proc = Bun.spawnSync([
				"curl",
				"-s",
				`https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}`,
				"-H",
				`Authorization: Bot ${token}`,
			], {
				env: {
					...process.env,
					http_proxy: "",
					https_proxy: "",
					all_proxy: "",
					HTTP_PROXY: "",
					HTTPS_PROXY: "",
					ALL_PROXY: "",
				},
			});

			if (proc.exitCode === 0) {
				try {
					const parsed = JSON.parse(proc.stdout.toString());
					if (Array.isArray(parsed)) return parsed;
				} catch {}
			}
		}
		throw e;
	}
}
