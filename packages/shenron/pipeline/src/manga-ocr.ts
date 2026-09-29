import { rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export const MANGA_MANIFEST_SCHEMA_VERSION = 1 as const;
export const MANGA_REVIEW_PROMPT_VERSION = 4 as const;
export const MANGA_SERIES = ["DB", "DBS"] as const;

export type MangaSeries = (typeof MANGA_SERIES)[number];

export interface MangaManifestEntry {
	id: string;
	series: MangaSeries;
	collection: string;
	tome: string;
	planche: number;
	source: string;
	sourceSha256: string;
	sourceBytes: number;
	image: string;
	imageSha256: string;
	imageBytes: number;
	alreadyTranscribed: boolean;
}

export interface MangaOcrManifest {
	schemaVersion: typeof MANGA_MANIFEST_SCHEMA_VERSION;
	lot: number;
	lots: number;
	generatedAt: string;
	generator: "apps/shenron/bot/scripts/export-manga-ocr.ts";
	selection: "missing" | "all" | "ids";
	series: MangaSeries[];
	imagePipeline: {
		width: number;
		quality: number;
		format: "jpeg";
	};
	entries: MangaManifestEntry[];
	responseExpected: {
		format: "aphrody-ocr-jsonl";
		result: {
			image: string;
			text: { kind: "text"; markdown: string } | { kind: "none" };
		};
	};
}

/**
 * **Les arbitres autorisés à atteindre le dépôt éditorial.**
 *
 * Ce qui protège le corpus n'est pas l'identité d'un modèle : c'est le
 * contrat que `ocr-manga.md` impose et que `scelleMangaResultat` applique —
 * DEUX lectures visuelles indépendantes de l'image réelle, une décision
 * `confirm`, et aucune anomalie. Un JSONL PP-OCR seul reste indéposable.
 *
 * Coder `gpt-5.6-luna` en dur dans les contrôles faisait donc dépendre tout le
 * corpus de la disponibilité d'UN fournisseur : le 2026-09-11, `codex` a épuisé
 * son quota jusqu'au 15 et la chaîne entière s'est arrêtée, alors que d'autres
 * modèles de vision étaient disponibles et que le contrat, lui, restait
 * tenable. On nomme donc les arbitres au lieu de les supposer.
 *
 * Ajouter une entrée est un acte éditorial : le modèle doit savoir lire une
 * image jointe et rendre le schéma de revue complet. Un modèle qui ne voit pas
 * l'image ne peut pas arbitrer une transcription, il ne peut que la paraphraser.
 */
export const MANGA_ARBITRES = {
	"hybrid-luna-ppocr": "gpt-5.6-luna",
	"hybrid-sonnet-ppocr": "claude-sonnet-5",
	"hybrid-agy-ppocr": "agy",
	"hybrid-local-ppocr": "dots-ocr",
} as const;
export type MangaArbitre = keyof typeof MANGA_ARBITRES;

/** Le couple moteur/modèle d'un résultat est-il un arbitre approuvé ? */
export function estArbitreApprouve(engine: unknown, model: unknown): engine is MangaArbitre {
	if (typeof engine !== "string" || !(engine in MANGA_ARBITRES)) return false;
	return model === MANGA_ARBITRES[engine as MangaArbitre];
}

export interface MangaOcrResultLine {
	image: string;
	text: { kind: "text"; markdown: string } | { kind: "none" };
	elapsed_ms?: number;
	engine?: "ppocr-v5" | MangaArbitre;
	model?: string;
	promptVersion?: number;
	quality?: { meanConfidence: number; blocks: number; retainedBlocks: number };
	review?: MangaOcrVisualReview;
	coverageAudit?: MangaOcrCoverageAudit;
	coverageModel?: string;
	coverageReasoning?: "low";
	coverageElapsedMs?: number;
}

export const MANGA_REGION_KINDS = [
	"dialogue",
	"caption",
	"sfx",
	"watermark",
	"page_number",
] as const;
export type MangaRegionKind = (typeof MANGA_REGION_KINDS)[number];
export type MangaReviewConfidence = "high" | "medium" | "low";

export interface MangaOcrReviewRegion {
	order: number;
	kind: MangaRegionKind;
	text: string;
	confidence: MangaReviewConfidence;
}

export interface MangaOcrVisualReview {
	schemaVersion: 1;
	pageId: string;
	decision: "accept" | "none" | "needs_human";
	regions: MangaOcrReviewRegion[];
	notes: string;
}

export const MANGA_COVERAGE_ISSUE_KINDS = [
	"omitted_region",
	"misread_text",
	"wrong_kind",
	"wrong_order",
] as const;
export type MangaCoverageIssueKind = (typeof MANGA_COVERAGE_ISSUE_KINDS)[number];

export interface MangaOcrCoverageIssue {
	kind: MangaCoverageIssueKind;
	detail: string;
	confidence: MangaReviewConfidence;
}

export interface MangaOcrCoverageAudit {
	schemaVersion: 1;
	pageId: string;
	verdict: "confirm" | "needs_human";
	issues: MangaOcrCoverageIssue[];
	notes: string;
}

export interface MangaOcrDetectionLine {
	image: string;
	elapsed_ms: number;
	engine: "ppocr-v5";
	model: string;
	quality: { meanConfidence: number; blocks: number; retainedBlocks: number };
	blocks: Array<{
		text: string;
		confidence: number;
		polygon: number[][];
	}>;
}

export interface ParsedMangaPage {
	entry: MangaManifestEntry;
	markdown: string;
	lines: string[];
	text: string;
	lang: "fr" | "ja";
	hasJa: boolean;
}

const IMAGE_EXT = /\.(?:webp|jpe?g|png)$/i;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const CONTROL_TOKEN = /<\|[^>]{1,120}\|>|<\/?(?:html|body|script|style)(?:\s|>)/i;

export function portableBasename(path: string): string {
	return path.split(/[\\/]/).at(-1) ?? path;
}

export function mangaPageId(series: MangaSeries, tome: string, planche: number): string {
	return `${series}:${tome}:${planche}`;
}

/** Convertit un chemin relatif sous assets/manga en identité éditoriale stable. */
export function identifyMangaAsset(
	relativePath: string
): Omit<
	MangaManifestEntry,
	"sourceSha256" | "sourceBytes" | "image" | "imageSha256" | "imageBytes" | "alreadyTranscribed"
> | null {
	const source = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
	const parts = source.split("/").filter(Boolean);
	if (parts.length < 3 || !IMAGE_EXT.test(parts.at(-1) ?? "")) return null;
	const series = parts[0];
	if (series !== "DB" && series !== "DBS") return null;
	const tome = parts.at(-2);
	const filename = parts.at(-1);
	if (!tome || !filename) return null;
	const planche = Number.parseInt(filename, 10);
	if (!Number.isInteger(planche) || planche < 1 || !/^(?:vol|t|ch)\d+$/i.test(tome)) return null;
	const collection = parts.slice(1, -2).join("/") || "principal";
	return {
		id: mangaPageId(series, tome, planche),
		series,
		collection,
		tome,
		planche,
		source: `assets/manga/${source}`,
	};
}

export async function sha256File(path: string): Promise<string> {
	const bytes = await Bun.file(path).arrayBuffer();
	return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
	await atomicWriteText(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function atomicWriteText(path: string, value: string): Promise<void> {
	const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
	await Bun.write(temporary, value);
	await rename(temporary, path);
}

export function assertMangaManifest(value: unknown): asserts value is MangaOcrManifest {
	if (!value || typeof value !== "object") throw new Error("manifeste JSON invalide");
	const manifest = value as Partial<MangaOcrManifest>;
	if (manifest.schemaVersion !== MANGA_MANIFEST_SCHEMA_VERSION) {
		throw new Error(`schemaVersion manga non supportée: ${String(manifest.schemaVersion)}`);
	}
	if (
		!Number.isInteger(manifest.lot) ||
		!Number.isInteger(manifest.lots) ||
		typeof manifest.lot !== "number" ||
		manifest.lot < 1
	) {
		throw new Error("numérotation de lot invalide");
	}
	if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
		throw new Error("un manifeste manga ne peut pas être vide");
	}
	const ids = new Set<string>();
	const images = new Set<string>();
	for (const entry of manifest.entries) {
		if (!entry || typeof entry !== "object") throw new Error("entrée de manifeste invalide");
		if (entry.series !== "DB" && entry.series !== "DBS")
			throw new Error(`série refusée: ${entry.series}`);
		if (entry.id !== mangaPageId(entry.series, entry.tome, entry.planche)) {
			throw new Error(`identité incohérente: ${entry.id}`);
		}
		if (ids.has(entry.id)) throw new Error(`planche dupliquée: ${entry.id}`);
		ids.add(entry.id);
		const image = portableBasename(entry.image);
		if (!image || images.has(image)) throw new Error(`image de lot dupliquée: ${image}`);
		images.add(image);
		if (!/^[a-f0-9]{64}$/.test(entry.sourceSha256) || !/^[a-f0-9]{64}$/.test(entry.imageSha256)) {
			throw new Error(`SHA-256 invalide: ${entry.id}`);
		}
		if (entry.sourceBytes < 1 || entry.imageBytes < 1)
			throw new Error(`taille invalide: ${entry.id}`);
	}
}

export async function readMangaManifest(path: string): Promise<MangaOcrManifest> {
	const value = await Bun.file(path).json();
	assertMangaManifest(value);
	return value;
}

export function normalizeMangaMarkdown(markdown: string): {
	markdown: string;
	lines: string[];
	text: string;
	lang: "fr" | "ja";
	hasJa: boolean;
} {
	const clean = markdown.replaceAll("\r\n", "\n").trim();
	if (!clean) throw new Error("transcription vide");
	if (clean.length > 40_000) throw new Error(`transcription trop longue (${clean.length})`);
	const hasControlCharacter = [...clean].some((character) => {
		const code = character.charCodeAt(0);
		return code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d;
	});
	if (CONTROL_TOKEN.test(clean) || hasControlCharacter) {
		throw new Error("sortie modèle contenant du balisage ou un caractère de contrôle");
	}
	const lines = clean
		.split("\n")
		.map((line) => line.replace(/^\s{0,3}(?:#{1,6}|[-*+]|\d+[.)])\s+/, "").trim())
		.filter((line) => line.length > 0);
	if (lines.length === 0) throw new Error("aucune ligne exploitable");
	if (lines.length > 500) throw new Error(`trop de lignes (${lines.length})`);
	const text = lines.join(" ").replace(/\s+/g, " ").trim();
	const cjkCount = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? [])
		.length;
	const latinCount = (text.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
	return {
		markdown: clean,
		lines,
		text,
		lang: cjkCount > 8 && cjkCount >= latinCount ? "ja" : "fr",
		hasJa: CJK.test(text),
	};
}

const EDITORIAL_REGION_KINDS = new Set<MangaRegionKind>(["dialogue", "caption", "sfx"]);

/**
 * Transforme une revue visuelle structurée en résultat déposable. Les filigranes,
 * numéros de page et régions incertaines ne sont jamais déposés comme du texte.
 */
export function reviewedMangaResult(
	image: string,
	pageId: string,
	review: MangaOcrVisualReview,
	elapsedMs?: number,
	/** L'arbitre qui a rendu cette revue. Doit figurer au registre `MANGA_ARBITRES`. */
	arbitre: MangaArbitre = "hybrid-luna-ppocr"
): MangaOcrResultLine {
	if (review.schemaVersion !== 1 || review.pageId !== pageId) {
		throw new Error(`revue visuelle incohérente pour ${pageId}`);
	}
	if (!["accept", "none", "needs_human"].includes(review.decision)) {
		throw new Error(`décision visuelle invalide pour ${pageId}`);
	}
	if (typeof review.notes !== "string" || review.notes.length > 1_000) {
		throw new Error(`notes de revue invalides pour ${pageId}`);
	}
	if (!Array.isArray(review.regions) || review.regions.length > 200) {
		throw new Error(`régions visuelles invalides pour ${pageId}`);
	}
	const seenOrders = new Set<number>();
	for (const region of review.regions) {
		if (!Number.isInteger(region.order) || region.order < 1 || seenOrders.has(region.order)) {
			throw new Error(`ordre de lecture invalide pour ${pageId}`);
		}
		seenOrders.add(region.order);
		if (!MANGA_REGION_KINDS.includes(region.kind))
			throw new Error(`type de région invalide pour ${pageId}`);
		if (!["high", "medium", "low"].includes(region.confidence)) {
			throw new Error(`confiance visuelle invalide pour ${pageId}`);
		}
		if (typeof region.text !== "string" || region.text.length > 4_000) {
			throw new Error(`texte de région invalide pour ${pageId}`);
		}
	}
	const editorial = review.regions
		.filter((region) => EDITORIAL_REGION_KINDS.has(region.kind))
		.toSorted((a, b) => a.order - b.order);
	const unresolved = editorial.some(
		(region) => region.confidence === "low" || region.text.trim().length === 0
	);
	if (review.decision === "accept" && (editorial.length === 0 || unresolved)) {
		throw new Error(`revue acceptée sans transcription éditoriale complète pour ${pageId}`);
	}
	if (review.decision === "none" && editorial.length > 0) {
		throw new Error(`revue sans texte contenant une région éditoriale pour ${pageId}`);
	}
	if (review.decision === "needs_human" && editorial.length === 0) {
		throw new Error(`revue humaine demandée sans région éditoriale pour ${pageId}`);
	}
	const markdown = editorial
		.map((region) =>
			region.text.replaceAll("\r", " ").replaceAll("\n", " ").replace(/\s+/g, " ").trim()
		)
		.filter(Boolean)
		.map((text) => `- ${text}`)
		.join("\n");
	return {
		image,
		text: review.decision === "accept" && markdown ? { kind: "text", markdown } : { kind: "none" },
		elapsed_ms: elapsedMs,
		engine: arbitre,
		model: MANGA_ARBITRES[arbitre],
		promptVersion: MANGA_REVIEW_PROMPT_VERSION,
		review,
	};
}

/**
 * Scelle une première revue par une seconde lecture visuelle indépendante.
 * Une seule anomalie suffit à neutraliser le texte : le résultat reste tracé,
 * mais ne peut plus atteindre le dépôt éditorial.
 */
export function coverageAuditedMangaResult(
	result: MangaOcrResultLine,
	pageId: string,
	audit: MangaOcrCoverageAudit,
	elapsedMs?: number
): MangaOcrResultLine {
	if (
		audit.schemaVersion !== 1 ||
		audit.pageId !== pageId ||
		!Array.isArray(audit.issues) ||
		audit.issues.length > 100
	) {
		throw new Error(`audit de couverture incohérent pour ${pageId}`);
	}
	if (result.review?.decision === "needs_human" || !result.review) {
		throw new Error(`première revue non arbitrable pour ${pageId}`);
	}
	for (const issue of audit.issues) {
		if (!MANGA_COVERAGE_ISSUE_KINDS.includes(issue.kind)) {
			throw new Error(`type d'anomalie de couverture invalide pour ${pageId}`);
		}
		if (
			typeof issue.detail !== "string" ||
			issue.detail.trim().length === 0 ||
			issue.detail.length > 1_000 ||
			!["high", "medium", "low"].includes(issue.confidence)
		) {
			throw new Error(`anomalie de couverture invalide pour ${pageId}`);
		}
	}
	if (audit.verdict === "confirm" && audit.issues.length > 0) {
		throw new Error(`audit confirmé avec anomalies pour ${pageId}`);
	}
	if (audit.verdict === "needs_human" && audit.issues.length === 0) {
		throw new Error(`audit bloquant sans anomalie pour ${pageId}`);
	}
	return {
		...result,
		text: audit.verdict === "confirm" ? result.text : { kind: "none" as const },
		coverageAudit: audit,
		coverageModel: "gpt-5.6-luna",
		coverageReasoning: "low",
		coverageElapsedMs: elapsedMs,
	};
}

export function mangaResultDecision(
	result: MangaOcrResultLine
): "accept" | "none" | "needs_human" | "invalid" {
	const primary = result.review?.decision;
	if (primary === "needs_human") return "needs_human";
	if (primary !== "accept" && primary !== "none") return "invalid";
	const audit = result.coverageAudit;
	if (
		!audit ||
		audit.schemaVersion !== 1 ||
		audit.pageId !== result.review?.pageId ||
		result.coverageModel !== "gpt-5.6-luna" ||
		result.coverageReasoning !== "low" ||
		!Array.isArray(audit.issues) ||
		audit.issues.length > 100 ||
		audit.issues.some(
			(issue) =>
				!MANGA_COVERAGE_ISSUE_KINDS.includes(issue.kind) ||
				typeof issue.detail !== "string" ||
				issue.detail.trim().length === 0 ||
				issue.detail.length > 1_000 ||
				!["high", "medium", "low"].includes(issue.confidence)
		) ||
		typeof audit.notes !== "string" ||
		audit.notes.length > 1_000 ||
		(audit.verdict === "confirm" && audit.issues.length !== 0) ||
		(audit.verdict === "needs_human" && audit.issues.length === 0)
	) {
		return "invalid";
	}
	return audit.verdict === "confirm" ? primary : "needs_human";
}

export function parseMangaResults(
	content: string,
	manifest: MangaOcrManifest
): {
	pages: ParsedMangaPage[];
	none: string[];
	invalid: string[];
	unknown: string[];
} {
	const index = new Map(manifest.entries.map((entry) => [portableBasename(entry.image), entry]));
	const latest = new Map<string, MangaOcrResultLine>();
	const invalid: string[] = [];
	const unknown: string[] = [];
	for (const [offset, line] of content.split("\n").entries()) {
		const raw = line.trim();
		if (!raw) continue;
		let result: MangaOcrResultLine;
		try {
			result = JSON.parse(raw) as MangaOcrResultLine;
		} catch {
			invalid.push(`ligne ${offset + 1}: JSON invalide`);
			continue;
		}
		const image = portableBasename(result.image ?? "");
		if (!index.has(image)) {
			unknown.push(image || `ligne ${offset + 1}`);
			continue;
		}
		const entry = index.get(image);
		if (!entry) {
			unknown.push(image || `ligne ${offset + 1}`);
			continue;
		}
		if (
			!estArbitreApprouve(result.engine, result.model) ||
			result.promptVersion !== MANGA_REVIEW_PROMPT_VERSION ||
			!result.review ||
			result.review.decision === "needs_human" ||
			mangaResultDecision(result) !== result.review.decision
		) {
			invalid.push(`${entry.id}: résultat non arbitré ou non confirmé par deux lectures Luna low`);
			continue;
		}
		try {
			reviewedMangaResult(result.image, entry.id, result.review, result.elapsed_ms);
		} catch (error) {
			invalid.push(`${entry.id}: ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}
		latest.set(image, result);
	}

	const pages: ParsedMangaPage[] = [];
	const none: string[] = [];
	for (const [image, result] of latest) {
		const entry = index.get(image);
		if (!entry) continue;
		if (result.text?.kind === "none") {
			none.push(entry.id);
			continue;
		}
		if (result.text?.kind !== "text" || typeof result.text.markdown !== "string") {
			invalid.push(`${entry.id}: format text inconnu`);
			continue;
		}
		try {
			pages.push({ entry, ...normalizeMangaMarkdown(result.text.markdown) });
		} catch (error) {
			invalid.push(`${entry.id}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	pages.sort(
		(a, b) =>
			a.entry.series.localeCompare(b.entry.series) ||
			a.entry.tome.localeCompare(b.entry.tome, undefined, { numeric: true }) ||
			a.entry.planche - b.entry.planche
	);
	return { pages, none, invalid, unknown };
}

export function mangaTomeMarkdown(
	series: MangaSeries,
	tome: string,
	pages: Array<{ planche: number; lines: string[]; text: string }>
): string {
	const output = [`# ${series} — ${tome}`];
	for (const page of pages.toSorted((a, b) => a.planche - b.planche)) {
		const lines = page.lines.length > 0 ? page.lines : [page.text];
		output.push(
			`\n## Planche ${String(page.planche).padStart(3, "0")}\n`,
			...lines.map((line) => `- ${line.replaceAll("\r", " ").replaceAll("\n", " ").trim()}`)
		);
	}
	return `${output.join("\n").trim()}\n`;
}
