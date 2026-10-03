#!/usr/bin/env bun
/**
 * CLI unifié @shenron/pipeline
 * Commande d'exécution unique pour tout l'offload : OCR, RAG, IA, Traduction, Crawl.
 * Le serveur MCP Shenron est porté par aphrody-ai (apps/shenron-mcp), plus par ce dépôt.
 * Usage :
 *   bun run pipeline <ocr|rag|ia|translation|crawl> [args...]
 */

import {
	buildRagIndex,
	evaluateRag,
	runCorpusIngest,
	runCrawl,
	runDatabooksOcr,
	runIaTask,
	runMangaOcr,
	runTranslation,
} from "./workflows";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import sharp from "sharp";
import {
	parseDatabookCandidateManifest,
	parseMangaCandidateManifest,
	toDatabookReviewCandidateInput,
	toMangaReviewCandidateInput,
	toNativeDatabookReviewCandidateInput,
	toNativeMangaReviewCandidateInput,
} from "./koharu";
import {
	toAphrodyDatabookReviewCandidateInput,
	toAphrodyMangaReviewCandidateInput,
	type OcrReviewImage,
} from "./aphrody-ocr-candidate";
import { KoharuSdkClient } from "./koharu-sdk-client";
import { submitCandidateFile } from "./candidate-submit";

const [command, ...args] = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith("--"));

async function main() {
	if (command === "aphrody-ocr-candidate") {
		const [kind, manifestPath, inputPath, outputPath] = args;
		if ((kind !== "manga" && kind !== "databook") || !manifestPath || !inputPath || !outputPath || args.length !== 4) {
			throw new Error("usage: pipeline aphrody-ocr-candidate <manga|databook> <hash-bearing-manifest.json> <aphrody-ocr-v2.jsonl> <unreviewed-candidates.jsonl>");
		}
		if (await Bun.file(outputPath).exists()) throw new Error(`refusing to overwrite candidate artifact: ${outputPath}`);
		const manifest = kind === "manga"
			? parseMangaCandidateManifest(await Bun.file(manifestPath).json())
			: parseDatabookCandidateManifest(await Bun.file(manifestPath).json());
		const byImageHash = new Map<string, (typeof manifest)[number]>();
		for (const entry of manifest) {
			if (byImageHash.has(entry.imageSha256)) throw new Error(`ambiguous manifest image digest: ${entry.imageSha256}`);
			byImageHash.set(entry.imageSha256, entry);
		}
		const input = Bun.file(inputPath);
		if (input.size > 150_000_000) throw new Error("OCR result artifact exceeds 150 MB");
		const lines = (await input.text()).split(/\r?\n/).filter((line) => line.trim());
		if (!lines.length) throw new Error("OCR result artifact is empty");
		const output: string[] = [];
		const seen = new Set<string>();
		const manifestDirectory = dirname(resolve(manifestPath));
		for (const [index, line] of lines.entries()) {
			let result: unknown;
			try { result = JSON.parse(line); } catch { throw new Error(`invalid OCR JSON at line ${index + 1}`); }
			const digest = (result as { image?: { sha256?: unknown } } | null)?.image?.sha256;
			if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) {
				throw new Error(`OCR line ${index + 1} has no trustworthy image SHA-256`);
			}
			const entry = byImageHash.get(digest);
			if (!entry) throw new Error(`OCR line ${index + 1} has no matching Shenron manifest image`);
			if (seen.has(digest)) throw new Error(`duplicate OCR result for Shenron image: ${entry.image}`);
			seen.add(digest);
			const imagePath = resolve(manifestDirectory, entry.image);
			const imageRelative = relative(manifestDirectory, imagePath);
			if (isAbsolute(entry.image) || imageRelative.startsWith("..") || isAbsolute(imageRelative)) {
				throw new Error(`manifest image leaves its export directory: ${entry.image}`);
			}
			const imageBytes = await Bun.file(imagePath).arrayBuffer();
			if (new Bun.CryptoHasher("sha256").update(imageBytes).digest("hex") !== digest) {
				throw new Error(`manifest review image changed: ${entry.image}`);
			}
			const metadata = await sharp(imageBytes).metadata();
			if (!metadata.width || !metadata.height) throw new Error(`manifest image has no dimensions: ${entry.image}`);
			const mime: OcrReviewImage["mime"] | null = metadata.format === "jpeg" ? "image/jpeg" : metadata.format === "png" ? "image/png" : metadata.format === "webp" ? "image/webp" : null;
			if (!mime) throw new Error(`unsupported manifest image format: ${entry.image}`);
			const image = { mime, width: metadata.width, height: metadata.height };
			const candidate = kind === "manga"
				? toAphrodyMangaReviewCandidateInput(result, entry as ReturnType<typeof parseMangaCandidateManifest>[number], image)
				: toAphrodyDatabookReviewCandidateInput(result, entry as ReturnType<typeof parseDatabookCandidateManifest>[number], image);
			output.push(JSON.stringify(candidate));
		}
		await Bun.write(outputPath, `${output.join("\n")}\n`);
		console.log(JSON.stringify({ status: "ocr_candidate_artifact_written", kind, count: output.length, output: outputPath }));
		return;
	}
	if (command === "koharu-submit") {
		const fileFlag = args.indexOf("--file");
		const file = fileFlag === -1 ? undefined : args[fileFlag + 1];
		if (!file || args.length !== 2) throw new Error("usage: pipeline koharu-submit --file <unreviewed-candidates.jsonl> (env SHENRON_API_URL, SHENRON_API_TOKEN)");
		const { count, response } = await submitCandidateFile(file);
		console.log(JSON.stringify({ status: "candidates_submitted", count, response }));
		return;
	}
	if (command === "koharu-native-candidate") {
		const [kind, manifestPath, projectRoot, projectName, outputPath] = args;
		const sdkFlag = args.indexOf("--sdk");
		if ((kind !== "manga" && kind !== "databook") || !manifestPath || !projectRoot || !projectName || !outputPath ||
			(sdkFlag !== -1 && (!args[sdkFlag + 1] || sdkFlag !== 5)) || (sdkFlag === -1 && args.length !== 5) || args.length > 7) {
			throw new Error("usage: pipeline koharu-native-candidate <manga|databook> <manifest.json> <project-root> <project-name> <unreviewed-candidates.jsonl> [--sdk <koharu-sdk-binary>]");
		}
		if (await Bun.file(outputPath).exists()) throw new Error(`refusing to overwrite candidate artifact: ${outputPath}`);
		const manifest = kind === "manga"
			? parseMangaCandidateManifest(await Bun.file(manifestPath).json())
			: parseDatabookCandidateManifest(await Bun.file(manifestPath).json());
		const byImageHash = new Map<string, (typeof manifest)[number]>();
		for (const entry of manifest) {
			if (byImageHash.has(entry.imageSha256)) throw new Error(`ambiguous manifest image digest: ${entry.imageSha256}`);
			byImageHash.set(entry.imageSha256, entry);
		}
		const sdk = new KoharuSdkClient(projectRoot, sdkFlag === -1 ? "koharu-sdk" : args[sdkFlag + 1]!);
		const call = (method: string, params: unknown) => sdk.call(method, params);
		const output: string[] = [];
		const seen = new Set<string>();
		try {
			await call("project.open", { name: projectName });
			const pages = await call("project.pages", {});
			if (!Array.isArray(pages)) throw new Error("Koharu SDK project.pages returned no page list");
			for (const rawPage of pages) {
				const page = rawPage as { id?: unknown };
				if (typeof page?.id !== "string") throw new Error("Koharu SDK project.pages returned a page without ID");
				const nativeDigest = await call("page.sourceSha256", { page: page.id }) as { sha256?: unknown };
				if (typeof nativeDigest?.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(nativeDigest.sha256)) {
					throw new Error(`Koharu SDK returned an invalid source digest for page ${page.id}`);
				}
				const entry = byImageHash.get(nativeDigest.sha256);
				if (!entry) continue;
				if (seen.has(entry.imageSha256)) throw new Error(`multiple Koharu pages match one Shenron manifest image: ${entry.image}`);
				seen.add(entry.imageSha256);
				const manifestDirectory = dirname(resolve(manifestPath));
				const imagePath = resolve(manifestDirectory, entry.image);
				const imageRelative = relative(manifestDirectory, imagePath);
				if (isAbsolute(entry.image) || imageRelative.startsWith("..") || isAbsolute(imageRelative)) {
					throw new Error(`manifest image leaves its export directory: ${entry.image}`);
				}
				const imageBytes = await Bun.file(imagePath).arrayBuffer();
				if (new Bun.CryptoHasher("sha256").update(imageBytes).digest("hex") !== entry.imageSha256) {
					throw new Error(`manifest review image changed: ${entry.image}`);
				}
				const metadata = await sharp(imageBytes).metadata();
				if (!metadata.width || !metadata.height) throw new Error(`manifest image has no dimensions: ${entry.image}`);
				const mime = metadata.format === "jpeg" ? "image/jpeg" : metadata.format === "png" ? "image/png" : metadata.format === "webp" ? "image/webp" : null;
				if (!mime) throw new Error(`unsupported manifest image format: ${entry.image}`);
				const result = await call("page.result", { page: page.id });
				if ((result as { page?: unknown } | null)?.page !== page.id) throw new Error("Koharu SDK page.result returned the wrong page");
				const evidence = { result, sourceSha256: nativeDigest.sha256 };
				const candidate = kind === "manga"
					? toNativeMangaReviewCandidateInput(evidence, entry as ReturnType<typeof parseMangaCandidateManifest>[number], mime, metadata.width, metadata.height)
					: toNativeDatabookReviewCandidateInput(evidence, entry as ReturnType<typeof parseDatabookCandidateManifest>[number], mime, metadata.width, metadata.height);
				output.push(JSON.stringify(candidate));
			}
			if (!output.length) throw new Error("no Koharu project page matches a Shenron manifest image digest");
			await Bun.write(outputPath, `${output.join("\n")}\n`);
			console.log(JSON.stringify({ status: "native_candidate_artifact_written", kind, count: output.length, output: outputPath }));
		} finally {
			await sdk.close();
		}
		return;
	}
	if (command === "koharu-candidate") {
		const [manifestPath, inputPath, outputPath] = positional;
		if (!manifestPath || !inputPath || !outputPath) {
			throw new Error("usage: pipeline koharu-candidate <manga-manifest.json> <koharu-page-results.jsonl> <unreviewed-candidates.jsonl>");
		}
		if (await Bun.file(outputPath).exists()) throw new Error(`refusing to overwrite candidate artifact: ${outputPath}`);
		const manifest = parseMangaCandidateManifest(await Bun.file(manifestPath).json());
		const byId = new Map(manifest.map((entry) => [entry.id, entry]));
		const seen = new Set<string>();
		const lines = (await Bun.file(inputPath).text()).split(/\r?\n/).filter((line) => line.trim());
		if (lines.length === 0) throw new Error("Koharu candidate JSONL is empty");
		const output = lines.map((line, index) => {
			let value: unknown;
			try {
				value = JSON.parse(line);
			} catch {
				throw new Error(`invalid candidate JSON at line ${index + 1}`);
			}
			const pageId = (value as { source?: { pageId?: unknown } } | null)?.source?.pageId;
			if (typeof pageId !== "string") throw new Error(`candidate line ${index + 1} has no pageId`);
			const entry = byId.get(pageId);
			if (!entry) throw new Error(`candidate page is absent from the Shenron manifest: ${pageId}`);
			if (seen.has(pageId)) throw new Error(`duplicate candidate page: ${pageId}`);
			seen.add(pageId);
			return JSON.stringify(toMangaReviewCandidateInput(value, entry));
		});
		await Bun.write(outputPath, `${output.join("\n")}\n`);
		console.log(JSON.stringify({ status: "candidate_artifact_written", count: output.length, output: outputPath }));
		return;
	}
	if (command === "koharu-databook-candidate") {
		const [manifestPath, inputPath, outputPath] = positional;
		if (!manifestPath || !inputPath || !outputPath) {
			throw new Error("usage: pipeline koharu-databook-candidate <hash-bearing-manifest.json> <koharu-page-results.jsonl> <unreviewed-candidates.jsonl>");
		}
		if (await Bun.file(outputPath).exists()) throw new Error(`refusing to overwrite candidate artifact: ${outputPath}`);
		const manifest = parseDatabookCandidateManifest(await Bun.file(manifestPath).json());
		const byKey = new Map(manifest.map((entry) => [`${entry.databookId}:${entry.page}`, entry]));
		const seen = new Set<string>();
		const lines = (await Bun.file(inputPath).text()).split(/\r?\n/).filter((line) => line.trim());
		if (lines.length === 0) throw new Error("Koharu candidate JSONL is empty");
		const output = lines.map((line, index) => {
			let value: unknown;
			try {
				value = JSON.parse(line);
			} catch {
				throw new Error(`invalid candidate JSON at line ${index + 1}`);
			}
			const source = (value as { source?: { kind?: unknown; entityId?: unknown; plateNumber?: unknown } } | null)?.source;
			if (source?.kind !== "databook" || !Number.isSafeInteger(source.entityId) || !Number.isSafeInteger(source.plateNumber)) {
				throw new Error(`candidate line ${index + 1} needs databook kind, entityId, and plateNumber`);
			}
			const key = `${source.entityId}:${source.plateNumber}`;
			const entry = byKey.get(key);
			if (!entry) throw new Error(`candidate page is absent from the Shenron databook manifest: ${key}`);
			if (seen.has(key)) throw new Error(`duplicate databook candidate page: ${key}`);
			seen.add(key);
			return JSON.stringify(toDatabookReviewCandidateInput(value, entry));
		});
		await Bun.write(outputPath, `${output.join("\n")}\n`);
		console.log(JSON.stringify({ status: "databook_candidate_artifact_written", count: output.length, output: outputPath }));
		return;
	}
	const dryRun = args.includes("--dry-run");
	let result: unknown;
	switch (command) {
		case "ocr":
			console.log("=== Pipeline OCR ===");
			if (positional[0] === "databooks") {
				result = await runDatabooksOcr({ dryRun });
			} else {
				result = await runMangaOcr({ dryRun });
			}
			break;
		case "rag":
			console.log("=== Pipeline RAG ===");
			if (positional[0] === "eval") {
				result = await evaluateRag({ dryRun });
			} else {
				result = await buildRagIndex({ dryRun });
			}
			break;
		case "ia":
			console.log("=== Pipeline IA ===");
			result = dryRun
				? { status: "planned", endpoint: "/api/v1/shenron/llm/chat" }
				: await runIaTask({ task: positional.join(" ") || "default" });
			break;
		case "translation":
		case "translate":
			console.log("=== Pipeline Traduction ===");
			result = await runTranslation({ dryRun, args });
			break;
		case "crawl":
			console.log("=== Pipeline Crawl ===");
			result = await runCrawl({ source: (positional[0] as any) ?? "universal", url: positional[1], dryRun });
			break;
		case "unify":
			console.log("=== Pipeline Unify : Aphrody Web corpus -> Aphrody RAG ===");
			result = await runCorpusIngest({ dryRun });
			break;
		default:
			console.log(`
Usage: bun run pipeline <module> [options]

Modules unifiés (exécutables hors du VPS principal) :
	aphrody-ocr-candidate Lie le JSONL OCR v2 Aphrody aux images/manifeste Shenron sans décision éditoriale
  koharu-candidate Lie des résultats Aphrody Koharu au manifeste et écrit des candidats non arbitrés
  koharu-databook-candidate Lie les résultats Koharu databooks au manifeste haché et écrit des candidats non arbitrés
  koharu-native-candidate Lit un projet du SDK Rust et lie les images exactes au manifeste Shenron
  ocr          Exécute les tâches OCR Manga et Databooks
  rag          Construit ou évalue l'index vectoriel RAG
  ia           Orchestration des workflows et agents IA
  translation  Lance la supervision Bun des traductions databooks et du RAG
  crawl        Lance les scrapers et collecteurs de données
  unify        Ingère les exports Aphrody Web dans le store Aphrody RAG
`);
			process.exit(command ? 1 : 0);
	}
	if (result !== undefined) console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
	console.error("[Pipeline] Erreur:", err);
	process.exit(1);
});
