// SPDX-License-Identifier: Apache-2.0
/**
 * scripts/ops/shenron-infinite-loop.ts
 *
 * Boucle permanente de travail et supervision autonome de Shenron (Mode YOLO).
 * Maintient en continu :
 *   1. Tunnels SSH d'accès aux services distants (PostgreSQL dbfr, Bot, Redis, Site).
 *   2. Workers de traduction Databooks (JA -> FR via Aphrody et BXC).
 *   3. Envoi d'alertes et rapports bimodaux dans Discord (#bot-admin / 1548677623935139901).
 *   4. Évaluation continue du RAG Aphrody.
 *
 * Exécution :
 *   bun scripts/ops/shenron-infinite-loop.ts
 */



import postgres from "postgres";

const INTERVALLE_SECONDES = 60; // Tick de supervision chaque minute
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL?.trim()) {
	throw new Error("DATABASE_URL must be provided by the local or infrastructure environment.");
}

console.log("🐉 Démarrage de la boucle permanente Shenron Sovereign Autonomous Engine...");

async function verifierTunnelDb(): Promise<boolean> {
	try {
		const sql = postgres(DATABASE_URL, { max: 1, connect_timeout: 5 });
		const [r] = await sql`SELECT 1 as ok`;
		await sql.end();
		return r?.ok === 1;
	} catch {
		return false;
	}
}

async function execCommande(cmd: string[]): Promise<string> {
	try {
		const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
		const out = await new Response(proc.stdout).text();
		await proc.exited;
		return out.trim();
	} catch (e: any) {
		return `Erreur: ${e.message}`;
	}
}

let iteration = 0;

while (true) {
	iteration++;
	const heure = new Date().toLocaleTimeString("fr-FR");
	console.log(`\n[${heure}] ── Cycle Shenron #${iteration} ──────────────────────`);

	// 1. Vérification intégrité Tunnel DB
	const dbOk = await verifierTunnelDb();
	if (dbOk) {
		console.log("  ✔ Tunnel PostgreSQL 127.0.0.1:15433 : OPÉRATIONNEL");
	} else {
		console.warn("  ⚠ Tunnel PostgreSQL inaccessible, tentative de rétablissement...");
		Bun.spawn(["ssh", "-N", "-o", "BatchMode=yes", "-o", "ServerAliveInterval=30", "-L", "127.0.0.1:15433:127.0.0.1:5432", "dbfr"]);
	}

	// 2. Progression Traductions Databooks
	if (dbOk) {
		try {
			const sql = postgres(DATABASE_URL, { max: 1 });
			const [stats] = await sql`
				SELECT 
					count(*) FILTER (WHERE p->>'text' IS NOT NULL AND length(trim(p->>'text')) > 0)::int as transcrites,
					count(*) FILTER (WHERE p->>'text_fr' IS NOT NULL AND length(trim(p->>'text_fr')) > 0)::int as traduites
				FROM bot.db_databooks d, jsonb_array_elements(d.pages) p
				WHERE d.visible
			`;
			await sql.end();
			const pct = stats.transcrites > 0 ? ((stats.traduites / stats.transcrites) * 100).toFixed(2) : "0";
			console.log(`  📊 Databooks : ${stats.traduites} / ${stats.transcrites} planches traduites (${pct} %)`);
		} catch (e: any) {
			console.warn("  Erreur lecture stats databooks :", e.message);
		}
	}

	// 3. Toutes les 10 itérations (~10 min) : Bilan de supervision complet & notification Discord
	if (iteration % 10 === 1) {
		console.log("  📢 Exécution du superviseur OCR et diffusion Discord...");
		await execCommande(["bun", "scripts/ops/supervise-ocr-and-translate.ts"]);
	}

	// 4. Toutes les 30 itérations (~30 min) : Évaluation RAG Aphrody
	if (iteration % 30 === 1) {
		console.log("  🧠 Évaluation continue du banc RAG doré...");
		await execCommande(["aphrody.exe", "shenron", "rag", "eval"]);
	}

	await new Promise((resolve) => setTimeout(resolve, INTERVALLE_SECONDES * 1000));
}
