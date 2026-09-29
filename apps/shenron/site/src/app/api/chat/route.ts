import { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/config";
import { createMemoryRateLimiter } from "@/lib/memory-rate-limit";
import { clientIp } from "@/app/api/_client-ip";
import { chatAphrodyRag, usesAphrodyRag } from "@/lib/site-rag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * API Route Next.js proxying requests to the bot's grounded RAG chat endpoint.
 */

/**
 * Anti-abus : une question déclenche en amont une recherche hybride puis un
 * appel au modèle — c'est, de loin, la route publique la plus coûteuse du site,
 * et la seule sans compte ni jeton. 20 questions par minute et par IP laissent
 * une conversation soutenue confortable tout en fermant la boucle de scraping.
 */
const chatRateLimit = createMemoryRateLimiter({
	windowMs: 60_000,
	limit: 20,
	namespace: "chat-ip",
});

/**
 * Longueur maximale des paramètres relayés tels quels.
 *
 * `q` était seul borné : `context`, `session`, `entity`… partaient dans l'URL
 * amont sans plafond, où quelques dizaines de kilo-octets suffisent à faire
 * refuser la requête (414) ou à gonfler l'invite du modèle.
 *
 * La borne de `context` n'est PAS arbitraire : l'appelant historique (l'assistant
 * flottant, retiré des pages publiques le 2026-09-12) sérialisait le texte de la
 * page et le coupait à 2 500 signes avant d'ajouter « … », soit 2 503 signes
 * envoyés. Une borne serveur plus basse amputerait silencieusement le contexte
 * d'une question posée depuis une fiche — le bot l'injecte tel quel en document
 * prioritaire du RAG, sans le retailler. 2 600 couvre l'appelant avec de la
 * marge ; abaisser cette valeur exige d'abaisser d'abord celle de l'appelant.
 */
const BORNES = {
	q: 600,
	persona: 32,
	context: 2600,
	session: 64,
	lang: 16,
	entity: 128,
	sourceId: 128,
} as const;

/** Paramètre lu, taillé à sa borne. */
function param(searchParams: URLSearchParams, nom: keyof typeof BORNES, defaut = ""): string {
	const brut = searchParams.get(nom);
	if (brut === null) return defaut;
	return brut.slice(0, BORNES[nom]);
}

export async function GET(req: NextRequest) {
	const { searchParams } = new URL(req.url);
	const q = param(searchParams, "q");
	const persona = param(searchParams, "persona", "whis");
	const context = param(searchParams, "context");
	const session = param(searchParams, "session"); // mémoire de conversation par navigateur
	const lang = param(searchParams, "lang");
	const entity = param(searchParams, "entity");
	const sourceId = param(searchParams, "sourceId");

	if (!q) {
		return NextResponse.json({ error: "Missing query parameter 'q'" }, { status: 400 });
	}
	// Borne la longueur de `q` : évite une requête RAG/LLM amont démesurée.
	// (`param` a déjà tronqué ; on refuse explicitement plutôt que de répondre à
	// une question amputée sans le dire.)
	if ((searchParams.get("q") ?? "").length > BORNES.q) {
		return NextResponse.json({ error: "query too long" }, { status: 400 });
	}

	const rate = await chatRateLimit.consume(clientIp(req));
	if (rate.limited) {
		return NextResponse.json(
			{ error: "Trop de questions d'affilée. Réessaie dans une minute." },
			{ status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
		);
	}

	try {
		// The bot keeps per-session conversation history while its retrieval and
		// inference are delegated to Aphrody. Stateless calls can bypass it.
		if (usesAphrodyRag() && !session) {
			const result = await chatAphrodyRag(q, persona, { context, lang, entity, sourceId });
			return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
		}
		let botUrl =
			`${API_URL}/api/public/rag/chat?q=${encodeURIComponent(q)}&persona=${encodeURIComponent(persona)}` +
			`&context=${encodeURIComponent(context)}${session ? `&session=${encodeURIComponent(session)}` : ""}`;
		if (lang) botUrl += `&lang=${encodeURIComponent(lang)}`;
		if (entity) botUrl += `&entity=${encodeURIComponent(entity)}`;
		if (sourceId) botUrl += `&sourceId=${encodeURIComponent(sourceId)}`;

		const res = await fetch(botUrl, {
			method: "GET",
			// Caching disabled for real-time conversation queries
			cache: "no-store",
			// Propage l'annulation client + borne l'amont RAG/LLM (potentiellement
			// lent/indisponible) à 30 s pour ne pas laisser de requête Next pendante.
			signal: AbortSignal.any([req.signal, AbortSignal.timeout(30_000)]),
		});

		if (!res.ok) {
			throw new Error(`Bot API returned HTTP ${res.status}`);
		}

		const data = await res.json();
		return NextResponse.json(data);
	} catch (err) {
		// Timeout amont (AbortSignal.timeout) ou annulation client → 504.
		if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
			return NextResponse.json({ error: "Upstream timeout" }, { status: 504 });
		}
		console.error("[NEXT CHAT] RAG chat unavailable:", err);
		return NextResponse.json({ error: "RAG chat unavailable" }, { status: 503 });
	}
}
