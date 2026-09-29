/**
 * rag-eval.ts — mesure de la récupération RAG sur le jeu doré (adaptateur).
 *
 * La définition unique de « trouver la bonne source » (matchers, rang, nDCG,
 * agrégats, parseur JSONL) vit dans `@shenron/pipeline/ai/eval`, partagée avec le site
 * et les scripts du pipeline. Ce module la réexporte sous ses noms historiques,
 * typée sur `RagHit`.
 *
 * Un cas du jeu doré :
 *   - `q`           la question ;
 *   - `expectUrl`   (préféré) préfixes d'URL de la source attendue ;
 *   - `expectTitle` sous-chaîne du TITRE de la source attendue ;
 *   - `expect`      (historique) sous-chaînes cherchées dans le titre ou l'extrait ;
 *   - `tags`        rubriques libres pour ventiler les scores.
 */
import {
	aggregate,
	aggregateByTag,
	type CaseResult,
	firstHitRank as sharedFirstHitRank,
	type GoldCase,
	isHit,
	matchesExpectedUrl,
	type Metrics,
	ndcgAtK as sharedNdcgAtK,
	normalizeUrl,
	parseGold,
	RANKS,
	runCase as sharedRunCase,
} from "@shenron/pipeline/ai/eval";
import type { RagHit } from "./rag";

export {
	aggregate,
	aggregateByTag,
	type CaseResult,
	type GoldCase,
	isHit,
	matchesExpectedUrl,
	type Metrics,
	normalizeUrl,
	parseGold,
	RANKS,
};

/** Rang 1-based du premier hit juste, 0 si aucun. */
export function firstHitRank(results: RagHit[], c: GoldCase): number {
	return sharedFirstHitRank(results, c);
}

/** nDCG@k à gain binaire (IDCG : tous les hits justes trouvés en tête). */
export function ndcgAtK(results: RagHit[], c: GoldCase, k = 10): number {
	return sharedNdcgAtK(results, c, k);
}

/** Exécute un cas avec la fonction de recherche fournie. */
export async function runCase(
	c: GoldCase,
	search: (q: string) => Promise<{ results: RagHit[]; mode: string }>
): Promise<CaseResult> {
	return sharedRunCase(c, search);
}
