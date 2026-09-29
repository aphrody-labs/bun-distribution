// SPDX-License-Identifier: Apache-2.0
/**
 * Boucle continue d'OCR Databooks dont l'inférence PP-OCR est exécutée par Aphrody AI.
 *
 * Utilisation :
 *   bun scripts/ops/gpu-continuous-ocr.ts
 *   bun scripts/ops/gpu-continuous-ocr.ts --limite-lots 10
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { requireAiHttpToken, requireAiHttpUrl } from "@shenron/pipeline/ai/config";
import { legacyAuditProjection, runRemoteBatch } from "@shenron/pipeline/aphrody/remote-ocr";

const APHRODY_BIN = process.env.APHRODY_BIN?.trim() || "aphrody";
const WORK_DIR = join(process.cwd(), "data", "ocr-gpu");
const limitIndex = Bun.argv.indexOf("--limite-lots");
const limitLots = limitIndex < 0 ? null : Number(Bun.argv[limitIndex + 1]);
if (limitLots !== null && (!Number.isInteger(limitLots) || limitLots < 1)) {
	throw new Error("--limite-lots must be a positive integer");
}
const SHENRON_ADMIN_TOKEN = process.env.SHENRON_ADMIN_TOKEN?.trim();
if (!SHENRON_ADMIN_TOKEN) throw new Error("SHENRON_ADMIN_TOKEN is required.");
// aphrody-ai-http : adresse et jeton obligatoires (APHRODY_AI_HTTP_URL / _TOKEN ou alias), sans défaut.
requireAiHttpUrl(process.env);
requireAiHttpToken(process.env);

// Injection du token d'administration dans l'environnement pour les dépôts
process.env.SHENRON_ADMIN_TOKEN = SHENRON_ADMIN_TOKEN;
process.env.DBFR_TOKEN = SHENRON_ADMIN_TOKEN;

interface WorstRecord {
	id: number;
	missing: number;
	plates: number;
	title: string;
	transcribed: number;
	withImage: number;
}

interface SurveyResult {
	missing: number;
	plates: number;
	records: number;
	transcribed: number;
	withImage: number;
	worst: WorstRecord[];
}

async function obtenirStatutCorpus(): Promise<SurveyResult | null> {
	try {
		const proc = Bun.spawnSync([APHRODY_BIN, "ocr", "dbfr", "survey", "--json", "--top", "50"], {
			env: { ...process.env, SHENRON_ADMIN_TOKEN, DBFR_TOKEN: SHENRON_ADMIN_TOKEN },
		});
		if (proc.exitCode !== 0) return null;
		return JSON.parse(proc.stdout.toString()) as SurveyResult;
	} catch {
		return null;
	}
}

async function traiterOuvrage(record: WorstRecord): Promise<boolean> {
	console.log(`\n==========================================================`);
	console.log(`[GPU OCR] Livre #${record.id} : ${record.title}`);
	console.log(`          Planches totales : ${record.plates}, Manquantes : ${record.missing}`);
	console.log(`==========================================================`);

	const lotDir = join(WORK_DIR, String(record.id));
	const outJsonl = join(WORK_DIR, `${record.id}.jsonl`);
	await mkdir(lotDir, { recursive: true });

	// 1. Téléchargement des planches manquantes
	console.log(`1. Téléchargement des planches manquantes vers ${lotDir}...`);
	const fetchProc = Bun.spawnSync([
		APHRODY_BIN,
		"ocr",
		"dbfr",
		"fetch",
		String(record.id),
		"--dir",
		lotDir,
	], {
		env: { ...process.env, SHENRON_ADMIN_TOKEN, DBFR_TOKEN: SHENRON_ADMIN_TOKEN },
		stdio: ["inherit", "inherit", "inherit"],
	});
	if (fetchProc.exitCode !== 0) {
		console.error(`❌ Échec du fetch pour #${record.id}`);
		return false;
	}

	// 2. L'image est transmise à Aphrody AI. Le JSONL conserve le contrat OCR v2.
	console.log("2. Inférence PP-OCR sur Aphrody AI...");
	const t0 = Date.now();
	let added: number;
	try {
		added = await runRemoteBatch(lotDir, outJsonl, "ppocr-v5-mobile", (done, total) =>
			console.log(`   ${done}/${total} planches lues par Aphrody`)
		);
	} catch (error) {
		console.error(`❌ Échec de l'OCR distant pour #${record.id}:`, error);
		return false;
	}
	const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
	console.log(`✓ Lot #${record.id} : ${added} nouvelle(s) planche(s) sur Aphrody en ${elapsed}s.`);

	// Le dépositaire existant lit le store OCR local. On importe les preuves distantes
	// et on applique son audit avant tout dépôt éditorial.
	let projection: ReturnType<typeof legacyAuditProjection>;
	try {
		projection = legacyAuditProjection(await Bun.file(outJsonl).text());
	} catch (error) {
		console.error(`❌ Lot OCR #${record.id} contient une planche incertaine ou invalide:`, error);
		return false;
	}
	// Le CLI déjà installé lit l'ancien format pour audit. Cette projection
	// conserve les mêmes textes, tandis que le JSONL v2 garde la provenance.
	const auditPath = `${outJsonl}.audit.jsonl`;
	await Bun.write(auditPath, projection.jsonl);
	const auditProc = Bun.spawnSync([APHRODY_BIN, "ocr", "audit", auditPath, "--json"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	if (auditProc.exitCode !== 0) {
		console.error(`❌ Audit OCR bloquant pour #${record.id}: ${auditProc.stderr.toString().slice(0, 300)}`);
		return false;
	}
	const audit = JSON.parse(auditProc.stdout.toString()) as { examined?: number; invalid?: number; blocked_status?: number };
	if (audit.examined !== projection.expectedText || Number(audit.invalid ?? 0) > 0 || Number(audit.blocked_status ?? 0) > 0) {
		console.error(`❌ Audit OCR incomplet pour #${record.id}: ${String(audit.examined)} texte(s) examinés sur ${projection.expectedText}`);
		return false;
	}
	const ingestProc = Bun.spawnSync([APHRODY_BIN, "ocr", "db", "ingest", outJsonl, "--json"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	if (ingestProc.exitCode !== 0) {
		console.error(`❌ Import du JSONL OCR pour #${record.id}: ${ingestProc.stderr.toString().slice(0, 300)}`);
		return false;
	}
	const imported = JSON.parse(ingestProc.stdout.toString()) as { refused?: number; deposited?: number };
	if (imported.refused !== 0) {
		console.error(`❌ Import OCR incomplet pour #${record.id}: ${String(imported.refused)} ligne(s) refusée(s)`);
		return false;
	}

	// 3. Dépôt sécurisé des transcriptions dans PostgreSQL via l'API dbfr
	console.log(`3. Dépôt des transcriptions vers dragonballfr.com...`);
	const pushProc = Bun.spawnSync([
		APHRODY_BIN,
		"ocr",
		"dbfr",
		"push",
		String(record.id),
		"--lot",
		lotDir,
		"--apply",
	], {
		env: { ...process.env, SHENRON_ADMIN_TOKEN, DBFR_TOKEN: SHENRON_ADMIN_TOKEN },
		stdio: ["inherit", "inherit", "inherit"],
	});
	if (pushProc.exitCode !== 0) {
		console.error(`❌ Échec du push pour #${record.id}`);
		return false;
	}

	console.log(`✓ Dépôt complété avec succès pour le livre #${record.id} !`);
	return true;
}

async function main() {
	console.log("==========================================================");
	console.log("   SHENRON DATABOOK OCR VIA APHRODY AI                     ");
	console.log("==========================================================\n");

	await mkdir(WORK_DIR, { recursive: true });

	let boucleCount = 0;
	let totalTraitees = 0;
	let attemptedLots = 0;

	while (true) {
		boucleCount++;
		console.log(`\n>>> Scan du corpus en cours (Cycle #${boucleCount})...`);
		const survey = await obtenirStatutCorpus();
		if (!survey) {
			console.warn("⚠️ Impossible de sonder le corpus dbfr, nouvelle tentative dans 10s...");
			await new Promise((r) => setTimeout(r, 10000));
			continue;
		}

		console.log(`État corpus : ${survey.transcribed}/${survey.plates} transcrites (${survey.missing} manquantes)`);

		// Filtrer les ouvrages qui ont des planches avec image et sans texte
		const candidats = survey.worst.filter((w) => w.missing > 0 && w.withImage > 0);

		if (candidats.length === 0) {
			console.log("🎉 100% des planches avec image sont transcrites ! En veille active (60s)...");
			if (limitLots !== null) return;
			await new Promise((r) => setTimeout(r, 60000));
			continue;
		}

		for (const record of candidats) {
			const ok = await traiterOuvrage(record);
			attemptedLots++;
			if (ok) totalTraitees += record.missing;
			if (limitLots !== null && attemptedLots >= limitLots) {
				console.log(`${attemptedLots} lot(s) tenté(s), ${totalTraitees} planche(s) traitée(s)`);
				return;
			}
			// Petite pause de 1s pour laisser le bus PCIe souffler
			await new Promise((r) => setTimeout(r, 1000));
		}
	}
}

if (import.meta.main) {
	main().catch((err) => {
		console.error("Erreur critique GPU OCR:", err);
		process.exit(1);
	});
}
