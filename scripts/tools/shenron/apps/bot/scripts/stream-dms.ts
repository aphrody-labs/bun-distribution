/**
 * stream-dms.ts — Stream (poll REST) les DM de contributeurs et capture leurs
 * messages comme feedback d'entraînement de l'IA (data/dm-feedback.jsonl).
 *
 * Poll REST uniquement (GET /channels/{dm}/messages) → AUCUNE connexion gateway,
 * donc aucune collision de token avec la prod. Émet chaque nouveau message des
 * contributeurs sur stdout (1 ligne = 1 événement) ; saute les messages du bot.
 *
 * Au 1er passage : pose la ligne de base (dernier message vu) SANS logger l'historique
 * → on capture la conversation À PARTIR DE MAINTENANT (corrections, exemples, feedback).
 *
 * Usage : DISCORD_TOKEN=… bun apps/bot/scripts/stream-dms.ts [userId ...]
 * Env   : DM_POLL_MS (défaut 15000)
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
	console.error("✗ DISCORD_TOKEN absent");
	process.exit(1);
}
const USERS = process.argv.slice(2).length
	? process.argv.slice(2)
	: ["1323725494184841256", "281114294152724491"];
const POLL_MS = Number(process.env.DM_POLL_MS ?? 15000);
const FEEDBACK = new URL("../data/dm-feedback.jsonl", import.meta.url).pathname;
const STATE = new URL("../data/.dm-stream-state.json", import.meta.url).pathname;

const api = (path: string, init?: RequestInit) =>
	fetch(`https://discord.com/api/v10${path}`, {
		...init,
		headers: { Authorization: `Bot ${TOKEN}`, ...init?.headers },
	});

const me = (await (await api("/users/@me")).json()) as { id: string; username: string };
const BOT_ID = me.id;

// Résout les canaux DM (open ou existant) par utilisateur.
const dms: Record<string, string> = {};
for (const u of USERS) {
	const r = await api("/users/@me/channels", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ recipient_id: u }),
	});
	if (r.ok) dms[u] = ((await r.json()) as { id: string }).id;
	else console.error(`! DM ${u} indisponible: ${r.status}`);
}

let state: Record<string, string> = {};
try {
	state = JSON.parse(readFileSync(STATE, "utf-8"));
} catch {}

console.log(
	`[stream] ${Object.keys(dms).length} DM suivi(s) en tant que ${me.username}, poll ${POLL_MS}ms`
);

interface DiscordMsg {
	id: string;
	content: string;
	timestamp: string;
	author?: { id: string; username: string };
	attachments?: { filename: string; url: string }[];
}

async function poll(): Promise<void> {
	for (const [u, ch] of Object.entries(dms)) {
		const after = state[ch];
		try {
			const r = await api(`/channels/${ch}/messages?limit=50${after ? `&after=${after}` : ""}`);
			if (!r.ok) continue;
			const msgs = ((await r.json()) as DiscordMsg[]).toReversed(); // chronologique
			for (const m of msgs) {
				state[ch] = m.id;
				if (!after) continue; // 1er passage : ligne de base seulement
				if (m.author?.id === BOT_ID) continue; // saute nos propres messages
				const rec = {
					ts: m.timestamp,
					userId: u,
					author: m.author?.username ?? "?",
					content: m.content,
					attachments: (m.attachments ?? []).map((a) => a.filename),
				};
				appendFileSync(FEEDBACK, `${JSON.stringify(rec)}\n`);
				const att = rec.attachments.length ? ` [+${rec.attachments.length} PJ]` : "";
				console.log(
					`[DM ${rec.author}] ${(m.content || "").replace(/\n/g, " ").slice(0, 200)}${att}`
				);
			}
		} catch {
			// transient (réseau / rate-limit) — on réessaie au prochain tick
		}
	}
	writeFileSync(STATE, JSON.stringify(state));
}

for (;;) {
	await poll();
	await new Promise((r) => setTimeout(r, POLL_MS));
}
