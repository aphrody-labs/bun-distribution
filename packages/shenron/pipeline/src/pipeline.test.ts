import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeCommand, type CommandRunner } from "./execution";
import { runMangaOcr, runDatabooksOcr } from "./workflows";
import { buildRagIndex, evaluateRag } from "./workflows";
import { runIaTask, getToriyamaPersona } from "./workflows";
import { runCrawl } from "./workflows";

const okRunner: CommandRunner = async (command) => ({ code: 0, stdout: JSON.stringify({ command }), stderr: "" });
const originalProfileHome = process.env.APHRODY_PROFILE_HOME;

afterEach(() => {
	if (originalProfileHome === undefined) delete process.env.APHRODY_PROFILE_HOME;
	else process.env.APHRODY_PROFILE_HOME = originalProfileHome;
});

describe("@shenron/pipeline — exécution vérifiable", () => {
	it("planifie un dry-run sans exécuter le runner", async () => {
		let called = false;
		const result = await buildRagIndex({ dryRun: true, runner: async () => { called = true; return { code: 0, stdout: "", stderr: "" }; } });
		expect(result.status).toBe("planned");
		expect(called).toBe(false);
	});

	it("synchronise toutes les sources vers Aphrody par défaut", async () => {
		const result = await buildRagIndex({ runner: okRunner });
		expect(result.command.at(1)?.endsWith("rag-sync-aphrody.ts")).toBe(true);
		expect(result.command).toContain("--toutes");
		expect(result.command).toContain("--appliquer");
	});

	it("propage les échecs de commande avec leur diagnostic", async () => {
		await expect(executeCommand(["outil", "arg"], {
			cwd: process.cwd(),
			runner: async () => ({ code: 7, stdout: "", stderr: "échec fixture" }),
		})).rejects.toThrow("échec fixture");
	});

	it("route OCR, évaluation RAG Aphrody et crawl vers leurs scripts réels", async () => {
		const manga = await runMangaOcr({ runner: okRunner });
		const databooks = await runDatabooksOcr({ runner: okRunner });
		const rag = await evaluateRag({ runner: okRunner });
		const crawl = await runCrawl({ source: "kanzenshuu", runner: okRunner });
		const officialCrawl = await runCrawl({ source: "official", runner: okRunner });
		const remoteCrawl = await runCrawl({ source: "custom", url: "https://example.org/news", runner: okRunner });
		expect(manga.command.at(1)?.endsWith("run-manga-ocr.ts")).toBe(true);
		expect(databooks.command.at(1)?.endsWith("gpu-continuous-ocr.ts")).toBe(true);
		expect(rag.command.at(1)?.endsWith("eval-aphrody-rag.ts")).toBe(true);
		expect(rag.command).toContain("--ci");
		expect(crawl.command.at(1)?.endsWith("crawl-kanzenshuu-rag.ts")).toBe(true);
		expect(officialCrawl.command.at(1)?.endsWith("crawl-dragon-ball-official-aphrody.ts")).toBe(true);
		expect(remoteCrawl.command.at(1)?.endsWith("aphrody-web-crawl.ts")).toBe(true);
	});

	it("retourne uniquement la sortie réelle de l'agent", async () => {
		const response = await runIaTask({
			task: "vérifier le canon",
			withRag: false,
			chat: async () => ({ answer: "réponse fixture", model: "fixture" }),
		});
		expect(response.content).toBe("réponse fixture");
		await expect(runIaTask({
			task: "échec",
			withRag: false,
			chat: async () => { throw new Error("backend indisponible"); },
		})).rejects.toThrow("backend indisponible");
	});

	it("exige les fichiers réels du profil éditorial", () => {
		const root = join(tmpdir(), `shenron-profile-${process.pid}-${Date.now()}`);
		mkdirSync(root, { recursive: true });
		process.env.APHRODY_PROFILE_HOME = root;
		expect(() => getToriyamaPersona()).toThrow("Profil Shenron incomplet");
		writeFileSync(join(root, "SOUL.md"), "soul fixture");
		writeFileSync(join(root, "IDENTITY.md"), "identity fixture");
		expect(getToriyamaPersona()).toEqual({ soul: "soul fixture", identity: "identity fixture" });
		rmSync(root, { recursive: true, force: true });
	});
});
