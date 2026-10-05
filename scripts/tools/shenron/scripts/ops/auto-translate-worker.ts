// SPDX-License-Identifier: Apache-2.0
/**
 * Worker autonome de traduction des Databooks pour le mode /goal.
 *
 * Exécute en boucle la préparation des lots, l'appel aux subagents de traduction,
 * le démasquage canonique et le dépôt direct en base de données.
 *
 * Utilisation :
 *   bun scripts/ops/auto-translate-worker.ts --statut
 *   bun scripts/ops/auto-translate-worker.ts --databook 4 --taille 10
 *   bun scripts/ops/auto-translate-worker.ts --lot-suivant --taille 10
 */


import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
	arretSiGel,
	chargeOuvrages,
	connecte,
	deposerTraduction as deposerTraductionAtomique,
	texteDePlanche,
	traductionDePlanche,
	type PlancheBrute,
} from "../../../../../apps/shenron/site/scripts/_databooks-base";
import {
	masquerVocabulaire,
	verifierTexteSource,
} from "../../../../../apps/shenron/site/src/lib/ja/lexique-canonique";

// Gel des écrivains : sortie 3 avant toute connexion si .coord/FREEZE-databooks.json existe.
if (import.meta.main) arretSiGel("auto-translate-worker");

const args = process.argv.slice(2);
const opt = (nom: string, defaut?: string) => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : defaut;
};
const flag = (nom: string) => args.includes(`--${nom}`);

const STATUT = flag("statut");
const TAILLE = Number(opt("taille", "10"));
const DATABOOK_ID = opt("databook") ? Number(opt("databook")) : null;
const LOT_SUIVANT = flag("lot-suivant");

export interface PlanchePreparee {
	databookId: number;
	titre: string;
	pageNumber: number;
	texteJa: string;
	texteMasque: string;
	tokenMap: Map<string, { ja: string; fr: string; kind: string }>;
	termesCount: number;
}

export async function preparerProchainesPlanches(
	options: { databookId?: number; limite?: number } = {}
): Promise<PlanchePreparee[]> {
	const sql = await connecte();
	try {
		const ouvrages = await chargeOuvrages(sql, {
			ids: options.databookId ? [options.databookId] : undefined,
		});

		const planches: PlanchePreparee[] = [];
		const max = options.limite ?? 10;

		for (const o of ouvrages) {
			for (let i = 0; i < o.pages.length; i++) {
				if (planches.length >= max) break;
				const p = o.pages[i]!;
				const ja = texteDePlanche(p).trim();
				const fr = traductionDePlanche(p).trim();

				if (ja.length < 20 || fr.length > 0) continue;

				// Contrôle qualité du texte japonais
				const check = verifierTexteSource(ja);
				if (!check.traduisible) continue;

				// Masquage canonique
				const { texteMasque, tokenMap, termesTrouves } = masquerVocabulaire(ja);

				planches.push({
					databookId: o.id,
					titre: o.title ?? `Livre #${o.id}`,
					pageNumber: Number(p.number) || i + 1,
					texteJa: ja,
					texteMasque,
					tokenMap,
					termesCount: termesTrouves.length,
				});
			}
			if (planches.length >= max) break;
		}

		return planches;
	} finally {
		await sql.end();
	}
}

/**
 * Dépose la traduction d'UNE planche via le juge et l'écriture atomique
 * partagés (`_databooks-base.ts`). `texteJa` — le texte source traduit — est la
 * garde anti-désalignement : sans lui, la source est relue en base au moment du
 * dépôt, ce qui protège de la course mais pas d'une traduction préparée pour une
 * autre version de la planche.
 */
export async function deposerTraduction(
	databookId: number,
	pageNumber: number,
	texteFr: string,
	texteJa?: string
): Promise<boolean> {
	const sql = await connecte();
	try {
		const [book] = await sql<{ pages: PlancheBrute[] | null }[]>`
			SELECT pages FROM bot.db_databooks WHERE id = ${databookId}
		`;
		const planches = (book?.pages ?? []).filter((p) => Number(p.number) === pageNumber);
		if (planches.length !== 1) return false;
		const planche = planches[0]!;
		const res = await deposerTraductionAtomique(sql, {
			databookId,
			numero: pageNumber,
			image: planche.image ?? null,
			source: texteJa ?? texteDePlanche(planche),
			traduction: texteFr,
			par: "shenron-vps-subagent",
		});
		return res.statut === "ecrite";
	} finally {
		await sql.end();
	}
}

async function main() {
	if (STATUT) {
		const sql = await connecte();
		const stats = await sql`
			SELECT 
				count(*) as total_livres,
				sum(jsonb_array_length(pages)) as total_planches,
				sum((SELECT count(*) FROM jsonb_array_elements(pages) p WHERE (p->>'text') IS NOT NULL AND length(trim(p->>'text')) > 0)) as planches_ja,
				sum((SELECT count(*) FROM jsonb_array_elements(pages) p WHERE (p->>'text_fr') IS NOT NULL AND length(trim(p->>'text_fr')) > 0)) as planches_fr
			FROM bot.db_databooks
			WHERE pages IS NOT NULL
		`;
		console.log("=== État d'avancement Traduction Databooks ===");
		console.table(stats);
		await sql.end();
		return;
	}

	if (LOT_SUIVANT || DATABOOK_ID) {
		console.log(`Préparation d'un lot de ${TAILLE} planches à traduire...`);
		const planches = await preparerProchainesPlanches({
			databookId: DATABOOK_ID ?? undefined,
			limite: TAILLE,
		});

		console.log(`✓ ${planches.length} planches prêtes avec masquage canonique :`);
		for (const p of planches) {
			console.log(
				`  - Livre #${p.databookId} (${p.titre}) p.${p.pageNumber} : ${p.termesCount} termes masqués (${p.texteMasque.length} car)`
			);
		}

		// Sauvegarder dans un fichier de tâche prêt pour subagent
		const taskDir = join(process.cwd(), "data", "databooks-translation", "queue");
		await mkdir(taskDir, { recursive: true });
		const taskFile = join(taskDir, `current-task.json`);

		const taskData = planches.map((p) => ({
			databookId: p.databookId,
			pageNumber: p.pageNumber,
			titre: p.titre,
			texteMasque: p.texteMasque,
			tokenMap: Object.fromEntries(p.tokenMap.entries()),
		}));

		await Bun.write(taskFile, JSON.stringify(taskData, null, 2));
		console.log(`Fichier de lot prêt pour dispatch : ${taskFile}`);
	}
}

if (import.meta.main) {
	main().catch((err) => {
		console.error("Erreur worker:", err);
		process.exit(1);
	});
}
