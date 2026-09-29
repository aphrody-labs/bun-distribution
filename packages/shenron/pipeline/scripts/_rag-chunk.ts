/**
 * _rag-chunk.ts — le découpage sémantique du RAG, partagé.
 *
 * Extrait de `rag-build.ts` : `ingest-aphrody-rag.ts` doit produire des chunks
 * de la MÊME forme que le build complet, sinon un corpus injecté à chaud
 * ressortirait avec des tailles et des préfixes de section différents de ses
 * voisins — et se classerait autrement à qualité égale.
 */

function splitIntoSentences(text: string): string[] {
	const sentences: string[] = [];
	let current = "";
	// Split simple par ponctuation (. ! ?) suivi d'un espace ou fin de ligne
	const parts = text.split(/([.!?](?:\s+|$))/);
	for (let i = 0; i < parts.length; i++) {
		const p = parts[i];
		if (!p) continue;
		if (i % 2 === 1) {
			current += p;
			sentences.push(current.trim());
			current = "";
		} else {
			current += p;
		}
	}
	if (current.trim()) {
		sentences.push(current.trim());
	}
	return sentences;
}

export interface Chunk {
	content: string;
	section: string;
}

export function chunkDocument(markdown: string, maxChunkChars = 1400, overlapPct = 0.15): Chunk[] {
	const chunks: Chunk[] = [];
	const lines = markdown.split("\n");

	let currentSection = "";
	let currentSectionHierarchy: string[] = [];
	let currentSectionTextLines: string[] = [];

	const emitSectionChunks = (secTitle: string, secLines: string[]) => {
		if (secLines.length === 0) return;
		const text = secLines.join("\n").trim();
		if (!text) return;

		const sentences = splitIntoSentences(text);
		const overlapChars = Math.floor(maxChunkChars * overlapPct);

		let currentChunkSentences: string[] = [];
		let currentChunkLen = 0;

		// Le titre de section sert de préfixe de contexte pour le chunk
		const contextPrefix = secTitle ? `[${secTitle}] ` : "";

		for (let i = 0; i < sentences.length; i++) {
			const s = sentences[i];
			const sLen = s.length;

			if (currentChunkLen + sLen > maxChunkChars && currentChunkSentences.length > 0) {
				// Emit chunk
				chunks.push({
					content: contextPrefix + currentChunkSentences.join(" "),
					section: secTitle,
				});

				// Calcul du chevauchement (overlap 15% en fin de chunk)
				const overlapSentences: string[] = [];
				let overlapLen = 0;
				for (let j = currentChunkSentences.length - 1; j >= 0; j--) {
					const os = currentChunkSentences[j];
					if (overlapLen + os.length <= overlapChars) {
						overlapSentences.unshift(os);
						overlapLen += os.length;
					} else {
						break;
					}
				}
				currentChunkSentences = overlapSentences;
				currentChunkLen = overlapLen;
			}

			currentChunkSentences.push(s);
			currentChunkLen += sLen;
		}

		if (currentChunkSentences.length > 0) {
			chunks.push({
				content: contextPrefix + currentChunkSentences.join(" "),
				section: secTitle,
			});
		}
	};

	for (const line of lines) {
		const match = line.match(/^(#{1,6})\s+(.+)$/);
		if (match) {
			emitSectionChunks(currentSection, currentSectionTextLines);
			currentSectionTextLines = [];

			const level = match[1].length;
			const title = match[2].trim();

			currentSectionHierarchy = currentSectionHierarchy.slice(0, level - 1);
			currentSectionHierarchy[level - 1] = title;
			currentSection = currentSectionHierarchy.filter(Boolean).join(" > ");
		} else {
			currentSectionTextLines.push(line);
		}
	}

	emitSectionChunks(currentSection, currentSectionTextLines);
	return chunks;
}
