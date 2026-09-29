// SPDX-License-Identifier: Apache-2.0
/** Shared rendering of licensed JSON corpora for legacy build and Aphrody sync. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chunkDocument } from "./_rag-chunk";
import { resolveEntity, type SourceChunk } from "./_rag-sources-pg";

export interface CorpusDoc { id: string; name: string; url: string; markdown: string; lang?: string }
export interface CorpusPassage extends SourceChunk { sourceId: string }
export const CORPUS_DIR = resolve(import.meta.dir, "../../../apps/bot/data/rag");

export function detectLang(docId: string, docName: string, docUrl: string, content: string): string {
	const id = docId.toLowerCase();
	const name = docName.toLowerCase();
	const url = docUrl.toLowerCase();
	if (id.includes("fd-fr-") || id.includes("-fr") || url.includes("/fr/") || name.includes("(fr)")) return "fr";
	if (id.includes("fd-en-") || id.includes("-en") || url.includes("/en/") || name.includes("(en)")) return "en";
	const cjk = (content.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
	const latin = (content.match(/[A-Za-zÀ-ÿ]/g) || []).length;
	if (cjk > 8 && cjk >= latin) return "ja";
	const fr = (content.match(/\b(le|la|les|de|des|et|en|un|une|est|dans|pour|qui|que)\b/gi) || []).length;
	const en = (content.match(/\b(the|of|and|in|a|an|is|to|for|who|that|with|on|at)\b/gi) || []).length;
	return fr >= en ? "fr" : "en";
}

export function isFandom(doc: Pick<CorpusDoc, "id" | "url" | "name">): boolean {
	if (/^fd-(en|fr)-/.test(doc.id)) return true;
	return `${doc.id} ${doc.url ?? ""} ${doc.name ?? ""}`.toLowerCase().includes("fandom.com");
}

export function corpusSourceId(docId: string): string {
	const parts = docId.split("-");
	if (parts.length > 1) return parts[0] === "wiki" ? "wikipedia" : parts[0]!;
	return docId;
}

export function renderCorpusDocs(docs: CorpusDoc[], author = false): { passages: CorpusPassage[]; refusedFandom: number } {
	const passages: CorpusPassage[] = [];
	let refusedFandom = 0;
	for (const doc of docs) {
		if (!author && doc.id.startsWith("manga-")) continue;
		if (isFandom(doc)) { refusedFandom++; continue; }
		const markdown = author ? doc.markdown : doc.markdown.replace(/^#.*$/gm, "").replace(/\[[^\]]*\]\([^)]*\)/g, "");
		const lang = author ? doc.lang || "fr" : detectLang(doc.id, doc.name, doc.url, markdown);
		const sourceId = author ? "aphrody" : corpusSourceId(doc.id);
		for (const chunk of chunkDocument(markdown, 1400, 0.15)) {
			const content = chunk.content.replace(/\s+/g, " ").trim();
			if (content.length < 12) continue;
			passages.push({
				sourceId, kind: author ? "author" : "source", title: doc.name, url: doc.url,
				content, lang, entity: resolveEntity(chunk.section) || resolveEntity(doc.name) || resolveEntity(content),
			});
		}
	}
	return { passages, refusedFandom };
}

export function loadCorpusDocs(path: string): CorpusDoc[] | null {
	if (!existsSync(path)) return null;
	const payload = JSON.parse(readFileSync(path, "utf8")) as { docs?: unknown };
	if (!Array.isArray(payload.docs)) throw new Error(`Invalid RAG corpus: ${path}`);
	return payload.docs as CorpusDoc[];
}
