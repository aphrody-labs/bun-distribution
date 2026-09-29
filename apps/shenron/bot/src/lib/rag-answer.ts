/**
 * rag-answer.ts — RAG génératif : réponse conversationnelle ancrée sur les hits.
 *
 * Séparé de `rag.ts` (B3) : la recherche ne charge plus la génération LLM.
 * `rag.ts` réexporte `generateAnswer` par import dynamique.
 */
import type { Database } from "bun:sqlite";
import { generateLlmAnswer } from "./llm";
import type { RagHit } from "./rag";

/** Réponse du persona Whis à partir des faits récupérés. */
export async function generateAnswer(db: Database, query: string, hits: RagHit[]): Promise<string> {
	return generateLlmAnswer(db, query, hits, "whis");
}
