import "dotenv/config";

const API = "https://discord.com/api/v10";
const currentGuilds = new Set((process.env.BOT_COMMAND_GUILDS ?? "").split(",").map((id) => id.trim()).filter(Boolean));

async function api<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
	for (;;) {
		const response = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
		if (response.status === 429) {
			const body = (await response.json().catch(() => ({}))) as { retry_after?: number };
			await Bun.sleep(Math.ceil((body.retry_after ?? 1) * 1000));
			continue;
		}
		if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
		return (await response.json()) as T;
	}
}

type Command = Record<string, unknown>;
type Guild = { id: string };
type App = { id: string };

async function migrate(label: string, token: string, exclude: Set<string>) {
	const app = await api<App>(token, "/applications/@me");
	const global = await api<Command[]>(token, `/applications/${app.id}/commands`);
	const commands = global.map(({ id, application_id, version, ...command }) => command);
	const guilds = await api<Guild[]>(token, "/users/@me/guilds");
	await api(token, `/applications/${app.id}/commands`, { method: "PUT", body: "[]" });
	let synced = 0;
	for (const guild of guilds) {
		if (exclude.has(guild.id)) continue;
		await api(token, `/applications/${app.id}/guilds/${guild.id}/commands`, { method: "PUT", body: JSON.stringify(commands) });
		synced++;
	}
	console.log(`[discord] ${label}: app=${app.id}, globals_cleared=${global.length}, guilds_synced=${synced}`);
}

const botToken = process.env.BOT_TOKEN;
const legacyToken = process.env.DEV_BOT_TOKEN;
if (!botToken || !legacyToken) throw new Error("BOT_TOKEN et DEV_BOT_TOKEN sont requis");
await migrate("current", botToken, new Set());
await migrate("legacy", legacyToken, currentGuilds);
