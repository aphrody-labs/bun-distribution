#!/usr/bin/env bun
/**
 * Découvre tous les IDs de rôles et salons de la guild configurée, via REST Discord.
 *
 * Usage :
 *   bun scripts/discover-ids.ts            # affiche un bloc .env prêt à copier
 *   bun scripts/discover-ids.ts --patch    # patch .env en place (heuristique nom → clé)
 *   bun scripts/discover-ids.ts --json     # sort brut JSON
 *
 * N'ouvre PAS de connexion Gateway — juste REST /guilds/{id}/roles + /channels.
 */

import { parseArgs } from "node:util";

const { values: opts } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		patch: { type: "boolean", default: false },
		json: { type: "boolean", default: false },
		help: { type: "boolean", short: "h", default: false },
	},
});

if (opts.help) {
	console.log(`Usage: bun scripts/discover-ids.ts [--patch] [--json]

  (sans option)  Affiche un bloc .env prêt à copier
  --patch        Patch .env en place (remplit les clés vides par heuristique)
  --json         Sort roles + channels en JSON brut`);
	process.exit(0);
}

// ── Lecture .env ────────────────────────────────────────────────────────────
const envPath = ".env";
const envText = await Bun.file(envPath)
	.text()
	.catch(() => "");
if (!envText) {
	console.error("✗ .env introuvable. Lance d'abord : bash scripts/setup.sh");
	process.exit(1);
}
const envMap = new Map<string, string>();
for (const line of envText.split("\n")) {
	const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
	if (m) envMap.set(m[1]!, m[2]!.trim());
}
const TOKEN = envMap.get("DISCORD_TOKEN");
const GUILD_ID = envMap.get("GUILD_ID");
if (!TOKEN || !GUILD_ID || TOKEN === "ton-token-ici") {
	console.error("✗ DISCORD_TOKEN ou GUILD_ID manquants dans .env");
	process.exit(1);
}

// ── REST helpers ────────────────────────────────────────────────────────────
const API = "https://discord.com/api/v10";
async function api<T>(path: string): Promise<T> {
	const res = await fetch(`${API}${path}`, {
		headers: { Authorization: `Bot ${TOKEN}` },
	});
	if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${await res.text()}`);
	return res.json() as Promise<T>;
}

interface Role {
	id: string;
	name: string;
	position: number;
	managed: boolean;
	color: number;
}
interface Channel {
	id: string;
	name: string;
	type: number;
	parent_id: string | null;
	position: number;
}

// ChannelType : 0 text, 2 voice, 4 category, 5 news, 13 stage, 15 forum
const TYPE_LABEL: Record<number, string> = {
	0: "text",
	2: "voice",
	4: "category",
	5: "news",
	10: "thread",
	11: "thread-public",
	12: "thread-private",
	13: "stage",
	15: "forum",
	16: "media",
};

const [roles, channels] = await Promise.all([
	api<Role[]>(`/guilds/${GUILD_ID}/roles`),
	api<Channel[]>(`/guilds/${GUILD_ID}/channels`),
]);

// ── Mode JSON ───────────────────────────────────────────────────────────────
if (opts.json) {
	console.log(JSON.stringify({ roles, channels }, null, 2));
	process.exit(0);
}

// ── Heuristique nom → clé ENV ──────────────────────────────────────────────
type Heuristic = {
	key: string;
	match: (name: string, type?: number) => boolean;
	scope: "role" | "channel";
};

const norm = (s: string) =>
	s
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

const HEURISTICS: Heuristic[] = [
	// Rôles
	{
		scope: "role",
		key: "JAIL_ROLE_ID",
		match: (n) => /^(jail|prison|muted?)$/.test(norm(n)),
	},
	{
		scope: "role",
		key: "URL_IN_BIO_ROLE_ID",
		match: (n) => /url|bio|vip|pub/.test(norm(n)),
	},
	// Salons (type 0 = text, 2 = voice, 4 = category)
	{
		scope: "channel",
		key: "LOG_MESSAGE_CHANNEL_ID",
		match: (n, t) => t === 0 && /log.*(message|msg)/.test(norm(n)),
	},
	{
		scope: "channel",
		key: "LOG_SANCTION_CHANNEL_ID",
		match: (n, t) => t === 0 && /log.*(sanction|mod|warn|ban|jail)/.test(norm(n)),
	},
	{
		scope: "channel",
		key: "LOG_ECONOMY_CHANNEL_ID",
		match: (n, t) => t === 0 && /log.*(econ|zeni|shop)/.test(norm(n)),
	},
	{
		scope: "channel",
		key: "LOG_JOIN_LEAVE_CHANNEL_ID",
		match: (n, t) => t === 0 && /log.*(join|leave|arriv|depart)/.test(norm(n)),
	},
	{
		scope: "channel",
		key: "LOG_LEVEL_ROLE_CHANNEL_ID",
		match: (n, t) => t === 0 && /log.*(level|niveau|role|grade)/.test(norm(n)),
	},
	{
		scope: "channel",
		key: "LOG_TICKET_CHANNEL_ID",
		match: (n, t) => t === 0 && /log.*(ticket|support)/.test(norm(n)),
	},
	{
		scope: "channel",
		key: "MOD_NOTIFY_CHANNEL_ID",
		match: (n, t) => t === 0 && /(notif|alert).*(mod|staff)|mod.*(notif|alert|staff)/.test(norm(n)),
	},
	{
		scope: "channel",
		key: "TICKET_CATEGORY_ID",
		match: (n, t) => t === 4 && /ticket|support/.test(norm(n)),
	},
	{
		scope: "channel",
		key: "VOCAL_TEMPO_HUB_ID",
		match: (n, t) => t === 2 && /(hub|tempo|creat|salon.*perso)/.test(norm(n)),
	},
];

function matchEntity(h: Heuristic): Role | Channel | undefined {
	if (h.scope === "role")
		return roles.find((r) => !r.managed && r.name !== "@everyone" && h.match(r.name));
	return channels.find((c) => h.match(c.name, c.type));
}

// ── Affichage .env ──────────────────────────────────────────────────────────
const dim = "\x1b[2m";
const bold = "\x1b[1m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";
const reset = "\x1b[0m";

console.log(`${bold}── Rôles (${roles.length}) ──${reset}`);
for (const r of [...roles].toSorted((a, b) => b.position - a.position)) {
	if (r.name === "@everyone") continue;
	const managed = r.managed ? `${dim} [bot/integration]${reset}` : "";
	console.log(`  ${r.id}  ${r.name}${managed}`);
}

const byType = new Map<number, Channel[]>();
for (const c of channels) {
	if (!byType.has(c.type)) byType.set(c.type, []);
	byType.get(c.type)!.push(c);
}
console.log(`\n${bold}── Salons (${channels.length}) ──${reset}`);
for (const [type, list] of [...byType.entries()].toSorted(([a], [b]) => a - b)) {
	const label = TYPE_LABEL[type] ?? `type-${type}`;
	console.log(`  ${dim}[${label}]${reset}`);
	for (const c of list.toSorted((a, b) => a.position - b.position)) {
		console.log(`    ${c.id}  ${c.name}`);
	}
}

// ── Bloc .env ───────────────────────────────────────────────────────────────
console.log(`\n${bold}── Bloc .env (heuristique) ──${reset}`);
const patches: Array<{ key: string; value: string; name: string }> = [];
for (const h of HEURISTICS) {
	const found = matchEntity(h);
	const current = envMap.get(h.key) ?? "";
	if (found) {
		const marker = current && current === found.id ? `${green}=${reset}` : `${yellow}→${reset}`;
		console.log(`  ${h.key}=${found.id}   ${marker} ${found.name}`);
		if (!current) patches.push({ key: h.key, value: found.id, name: found.name });
	} else {
		console.log(`  ${dim}${h.key}=   (pas de match auto — renseigne à la main)${reset}`);
	}
}

// ── Patch .env ──────────────────────────────────────────────────────────────
if (opts.patch) {
	if (patches.length === 0) {
		console.log(`\n${green}✓${reset} .env déjà complet pour les clés auto-détectables.`);
		process.exit(0);
	}
	let out = envText;
	for (const p of patches) {
		// Remplace "KEY=" ou "KEY=vide" ou "KEY=#commentaire" existante
		const re = new RegExp(`^(${p.key}=)(.*)$`, "m");
		if (re.test(out)) {
			out = out.replace(re, `${p.key}=${p.value}`);
		} else {
			out += `\n${p.key}=${p.value}`;
		}
	}
	await Bun.write(envPath, out);
	console.log(`\n${green}✓${reset} .env patché — ${patches.length} clé(s) ajoutée(s) :`);
	for (const p of patches) console.log(`  ${p.key}=${p.value}   (${p.name})`);
} else {
	const toPatch = patches.length;
	if (toPatch > 0) {
		console.log(
			`\n${yellow}!${reset} ${toPatch} clé(s) pourrai(en)t être auto-patchée(s). Lance avec --patch pour l'écrire dans .env.`
		);
	}
}
