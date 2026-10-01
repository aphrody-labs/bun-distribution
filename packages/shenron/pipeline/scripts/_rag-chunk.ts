/** Shenron's stable input/output contract over Aphrody's canonical RAG chunker. */
import { shenronRagChunk } from "@aphrody/bun/shenron";

export interface Chunk {
	content: string;
	section: string;
}

export function chunkDocument(markdown: string, maxChunkChars = 1400, overlapPct = 0.15): Chunk[] {
	return shenronRagChunk(markdown, maxChunkChars, overlapPct).map(({ content, section }) => ({ content, section }));
}
