import "server-only";
import { AphrodyComputeClient, type AphrodyRagHit } from "@shenron/pipeline/aphrody";
import { aphrodyComputeFromChat } from "@shenron/pipeline/aphrody/compute";
import { resolveChatModel } from "@shenron/pipeline/ai/config";
import { buildGroundingInstructions } from "@shenron/pipeline/ai/prompts";
import { createShenronProvider } from "@shenron/pipeline/ai/provider";
import { generateText } from "ai";

export function usesAphrodyRag(): boolean {
	return process.env.RAG_BACKEND === "aphrody";
}

function aphrodyRagClient(): AphrodyComputeClient {
	return new AphrodyComputeClient();
}

export async function searchAphrodyRag(
	query: string,
	limit: number,
	filters: { lang?: string; entity?: string; sourceId?: string } = {},
	client = aphrodyRagClient(),
): Promise<{ q: string; mode: string; results: AphrodyRagHit[] }> {
	const { results, mode } = await client.ragSearchWithMode(query, limit, filters);
	return { q: query, mode, results };
}

/**
 * Fournisseur Shenron dont le modèle `chat` passe par le client injecté (façade
 * ou double de test) : les adresses et le jeton restent ceux de la façade.
 */
function chatProvider(client: Pick<AphrodyComputeClient, "chat">, chatModel: string) {
	return createShenronProvider({ embed: null, chatModel }, {
		compute: aphrodyComputeFromChat((messages, model) => client.chat(messages, model)),
	});
}

export async function chatAphrodyRag(
	query: string,
	persona: string,
	options: { context?: string; lang?: string; entity?: string; sourceId?: string } = {},
	client = aphrodyRagClient(),
): Promise<{ answer: string; hits: AphrodyRagHit[]; mode: string }> {
	const { results: hits, mode } = await client.ragSearchWithMode(query, 5, {
		lang: options.lang,
		entity: options.entity,
		sourceId: options.sourceId,
	});
	if (hits.length === 0 && !options.context?.trim()) return { answer: "", hits, mode };
	const sources = hits.map((hit, index) =>
		`[${index + 1}] ${hit.title}\n${(hit.content || hit.snippet).slice(0, 900)}\nSource: ${hit.url}`
	).join("\n\n");
	const context = options.context?.trim()
		? `[Page consultée] ${options.context.trim().slice(0, 2600)}\n\n${sources}`
		: sources;
	// `APHRODY_AI_CHAT_MODEL`, puis les alias hérités (résolveur unique @shenron/pipeline/ai/config).
	const chatModel = resolveChatModel(process.env);
	// Voix « Whis » pour le persona whis, « Shenron » sinon (règle historique du site).
	const instructions = buildGroundingInstructions(persona === "whis" ? "whis" : "shenron", "site-short");
	const { text } = await generateText({
		model: chatProvider(client, chatModel).languageModel("chat"),
		instructions,
		messages: [{ role: "user", content: `Sources :\n${context}\n\nQuestion : ${query}` }],
		maxRetries: 0,
	});
	return { answer: text, hits, mode };
}
