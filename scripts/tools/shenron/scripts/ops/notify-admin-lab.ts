#!/usr/bin/env bun
/**
 * notify-admin-lab.ts — Outil universel pour les agents de code et scripts du monorepo.
 *
 * Permet à N'IMPORTE QUEL agent autonome (subagent, CI, script ops, pipeline OCR)
 * d'envoyer un rapport, un diagnostic ou de lire les instructions des administrateurs
 * dans le salon privé `🤖・lab-ia-admin` (1548677623935139901).
 *
 * Exemples d'usage :
 *   bun scripts/ops/notify-admin-lab.ts "Rapport de build terminé avec succès."
 *   bun scripts/ops/notify-admin-lab.ts --title "🎯 Évaluation RAG" --text "Recall@1: 97%, Recall@5: 100%" --kind success
 *   bun scripts/ops/notify-admin-lab.ts --read 5
 */
import { sendAdminLabMessage, getAdminLabRecentMessages, ADMIN_LAB_CHANNEL_ID } from "../../../../../apps/shenron/bot/src/lib/admin-lab";

const args = process.argv.slice(2);

async function run() {
	if (args.includes("--read")) {
		const limitIdx = args.indexOf("--read") + 1;
		const limit = limitIdx < args.length && !args[limitIdx]?.startsWith("--") ? Number(args[limitIdx]) : 5;
		console.log(`Lecture des ${limit} derniers messages du salon admin (${ADMIN_LAB_CHANNEL_ID})...\n`);
		const msgs = await getAdminLabRecentMessages(limit);
		for (const m of msgs.toReversed()) {
			const author = m.author?.username ?? "Inconnu";
			const time = new Date(m.timestamp).toLocaleTimeString();
			console.log(`[${time}] ${author}: ${m.content || "(Embed)"}`);
			if (m.embeds && m.embeds.length > 0) {
				for (const e of m.embeds) {
					if (e.title) console.log(`  > [Embed: ${e.title}]`);
					if (e.description) console.log(`  > ${e.description.slice(0, 150)}...`);
				}
			}
		}
		return;
	}

	// Mode envoi avec arguments structurés
	let title: string | undefined;
	let text: string | undefined;
	let kind = "brand";

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--title" && args[i + 1]) {
			title = args[++i];
		} else if (args[i] === "--text" && args[i + 1]) {
			text = args[++i];
		} else if (args[i] === "--kind" && args[i + 1]) {
			kind = args[++i]!;
		}
	}

	if (title || text) {
		const color = kind === "success" ? 0x22c55e : kind === "error" ? 0xef4444 : 0xf59e0b;
		const embed = {
			color,
			title: title ?? "📢 Notification Agent",
			description: text ?? "",
			footer: { text: "Shenron Autonomous Agent Relay" },
			timestamp: new Date().toISOString(),
		};
		const res = await sendAdminLabMessage({ embeds: [embed] });
		console.log(`✓ Embed envoyé avec succès dans le salon admin (Message ID: ${res.id})`);
		return;
	}

	// Mode texte simple
	const simpleMsg = args.join(" ").trim();
	if (!simpleMsg) {
		console.log("Usage: bun scripts/ops/notify-admin-lab.ts <message> OU --title <titre> --text <texte> OU --read");
		process.exit(1);
	}

	const res = await sendAdminLabMessage(simpleMsg);
	console.log(`✓ Message envoyé avec succès dans le salon admin (Message ID: ${res.id})`);
}

run().catch((err) => {
	console.error("❌ Échec notify-admin-lab:", err.message);
	process.exit(1);
});
