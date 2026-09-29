// SPDX-License-Identifier: Apache-2.0
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ShenronA2AHub,
	a2aTaskStore,
	defaultA2AProbes,
	type A2AProbes,
	type DatabooksPipelineSnapshot,
} from "../../src/aphrody/a2a";

// Boîte .coord isolée : les tests n'écrivent JAMAIS dans la vraie boîte partagée.
const previousCoordDir = process.env.A2A_COORD_DIR;
const coordDir = mkdtempSync(join(tmpdir(), "a2a-test-coord-"));

beforeAll(() => {
	process.env.A2A_COORD_DIR = coordDir;
});

afterAll(() => {
	if (previousCoordDir === undefined) delete process.env.A2A_COORD_DIR;
	else process.env.A2A_COORD_DIR = previousCoordDir;
	rmSync(coordDir, { recursive: true, force: true });
});

const realFetch = globalThis.fetch;
afterEach(() => {
	ShenronA2AHub.resetProbes();
	globalThis.fetch = realFetch;
});

const measuredDatabooks: DatabooksPipelineSnapshot = {
	measured: true,
	measuredAt: "2026-09-14T11:00:00.000Z",
	pagesTotal: 17267,
	withText: 15759,
	withTextFr: 4091,
	pendingOcr: 1508,
	pendingTranslation: 11668,
	latestTextFrAt: "2026-09-14T11:18:23.996Z",
	writers: [{ writer: "machine:sonnet", pages: 1110, latestAt: "2026-09-11T11:32:54.309Z" }],
};

/** Hôte réel du 2026-09-14 : traduction arrêtée, aucun heartbeat OCR, results.db sain. */
function noWorkerProbes(overrides: Partial<A2AProbes> = {}): Partial<A2AProbes> {
	return {
		databooksPipeline: async () => measuredDatabooks,
		systemdUnits: async (units) =>
			units.map((unit) =>
				unit === "shenron-traduction.service"
					? { unit, state: "inactive" as const, subState: "dead", since: "Fri 2026-09-11 06:53:40 UTC" }
					: { unit, state: "active" as const, subState: "running" }
			),
		ocrResultsDb: async () => ({ path: "/tmp/results.db", state: "ok", bytes: 44224512, messages: ["ok"] }),
		ocrHeartbeat: async () => ({ state: "none", maxAgeMinutes: 15 }),
		ragContext: async () => ({ ok: false, endpoint: "fake", error: "non utilisé" }),
		...overrides,
	};
}

describe("AgentCard A2A", () => {
	it("reste conforme (nom, version, cibles, compétences) sans promettre de GPU", () => {
		const card = ShenronA2AHub.getAgentCard("https://dragonballfr.com");
		expect(card.name).toBe("shenron-dragonball");
		expect(card.version).toBe("1.0.0");
		expect(card.url).toBe("https://dragonballfr.com/api/a2a");
		expect(card.capabilities.yoloMode).toBe(true);
		for (const t of ["codex", "claude", "agycli", "local_model", "rag", "subagents", "ocr", "broadcast"] as const) {
			expect(card.supportedTargets).toContain(t);
		}
		expect(card.skills.length).toBeGreaterThanOrEqual(4);
		expect(JSON.stringify(card)).not.toContain("RTX 4070");
	});
});

describe("OCR / traduction : état mesuré, jamais présumé", () => {
	it("statut OCR sans worker vivant → pas FAIT, manques nommés, aucun état GPU affirmé", async () => {
		ShenronA2AHub.setProbes(noWorkerProbes());
		const res = await ShenronA2AHub.sendMessage({
			target: "ocr",
			sourceAgent: "test-runner",
			instruction: "Statut des workers GPU et VPS",
		});
		expect(res.verdict).not.toBe("FAIT");
		expect(res.verdict).toBe("INCOMPLET");
		expect(res.task.status).toBe("completed");
		expect(res.responseMarkdown).not.toContain("RTX 4070");
		expect(res.responseMarkdown).not.toContain("actif en boucle");
		expect(res.responseMarkdown).toMatch(/avec texte japonais : 15\s759/u);
		expect(res.responseData.gpuActive).toBeUndefined();
		const gaps = res.responseData.gaps as string[];
		expect(gaps.some((g) => g.includes("aucun worker OCR prouvé vivant"))).toBe(true);
		expect(gaps.some((g) => g.includes("shenron-traduction.service inactive"))).toBe(true);
	});

	it("ordre OCR (« traiter 4 scans ») sans worker → submitted/INCOMPLET, aucun traitement présumé", async () => {
		ShenronA2AHub.setProbes(noWorkerProbes());
		const res = await ShenronA2AHub.sendMessage({
			target: "ocr",
			sourceAgent: "test-runner",
			instruction: "traiter au maximum 4 scans du lot 002",
		});
		expect(res.verdict).toBe("INCOMPLET");
		expect(res.task.status).toBe("submitted");
		expect(res.responseData.kind).toBe("work_order");
		expect(res.responseData.awaiting).toBe("ocr");
		expect(res.task.artifacts).toHaveLength(0);
	});

	it("PostgreSQL injoignable → NON_FAIT avec bloqueur nommé", async () => {
		ShenronA2AHub.setProbes(
			noWorkerProbes({
				databooksPipeline: async () => ({
					measured: false,
					measuredAt: new Date().toISOString(),
					error: "PostgreSQL : connection refused",
				}),
			})
		);
		const res = await ShenronA2AHub.sendMessage({
			target: "translation",
			sourceAgent: "test-runner",
			instruction: "état de la traduction",
		});
		expect(res.verdict).toBe("NON_FAIT");
		expect(res.task.status).toBe("failed");
		expect((res.responseData.blockers as string[])[0]).toContain("connection refused");
	});

	it("FAIT seulement quand tout est mesuré et qu'un worker vivant est prouvé", async () => {
		ShenronA2AHub.setProbes(
			noWorkerProbes({
				systemdUnits: async (units) => units.map((unit) => ({ unit, state: "active" as const })),
				ocrHeartbeat: async () => ({
					state: "alive",
					maxAgeMinutes: 15,
					peer: "ocr-gpu",
					ageMinutes: 2,
					lastSeen: new Date().toISOString(),
				}),
			})
		);
		const res = await ShenronA2AHub.sendMessage({
			target: "ocr",
			sourceAgent: "test-runner",
			instruction: "statut",
		});
		expect(res.verdict).toBe("FAIT");
		expect(res.responseMarkdown).toContain("vivant (heartbeat ocr-gpu");
	});

	it("la sonde heartbeat lit .coord : frais → alive, ancien → stale, absent → none", async () => {
		const dir = mkdtempSync(join(tmpdir(), "a2a-hb-"));
		try {
			expect((await defaultA2AProbes.ocrHeartbeat(dir)).state).toBe("none");
			writeFileSync(join(dir, "heartbeat-ocr-gpu.txt"), new Date(Date.now() - 60 * 60_000).toISOString());
			writeFileSync(join(dir, "heartbeat-codex.txt"), new Date().toISOString()); // pas un worker OCR
			expect((await defaultA2AProbes.ocrHeartbeat(dir)).state).toBe("stale");
			writeFileSync(join(dir, "heartbeat-ocr-gpu.txt"), new Date().toISOString());
			const hb = await defaultA2AProbes.ocrHeartbeat(dir);
			expect(hb.state).toBe("alive");
			expect(hb.peer).toBe("ocr-gpu");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("RAG : recherche réelle", () => {
	it("passages trouvés → FAIT avec titres et URL absolues", async () => {
		globalThis.fetch = (async () =>
			Response.json({
				q: "origine du Super Saiyan",
				mode: "hybrid",
				context: "[1] Saiyan (race · db_races) — https://dragonballfr.com/wiki/races/saiyan\nRace Saiyan (サイヤ人).",
				sources: [
					{ n: 1, title: "Saiyan", url: "https://dragonballfr.com/wiki/races/saiyan", kind: "race" },
					{ n: 2, title: "Super Saiyan — article", url: "/wiki/transformations/super-saiyan", kind: "transformation" },
				],
			})) as unknown as typeof fetch;
		const res = await ShenronA2AHub.sendMessage({
			target: "rag",
			sourceAgent: "test-runner",
			instruction: "origine du Super Saiyan",
		});
		expect(res.verdict).toBe("FAIT");
		expect(res.task.status).toBe("completed");
		const sources = res.responseData.sources as Array<{ title: string; url: string }>;
		expect(sources).toHaveLength(2);
		for (const s of sources) expect(s.url).toMatch(/^https:\/\/dragonballfr\.com\//);
		expect(sources[1]!.url).toBe("https://dragonballfr.com/wiki/transformations/super-saiyan");
		expect(res.responseMarkdown).toContain("[Saiyan](https://dragonballfr.com/wiki/races/saiyan)");
		expect(res.responseData.canonChecked).toBeUndefined();
		expect(res.task.artifacts).toHaveLength(2);
	});

	it("aucun passage → INCOMPLET (manque nommé)", async () => {
		ShenronA2AHub.setProbes({
			ragContext: async () => ({ ok: true, endpoint: "fake", mode: "lexical", context: "", sources: [] }),
		});
		const res = await ShenronA2AHub.sendMessage({ target: "rag", instruction: "zzzz inexistant" });
		expect(res.verdict).toBe("INCOMPLET");
		expect(res.responseData.hits).toBe(0);
	});

	it("API RAG injoignable → NON_FAIT / failed", async () => {
		globalThis.fetch = (async () => {
			throw new Error("ECONNREFUSED 127.0.0.1:5006");
		}) as unknown as typeof fetch;
		const res = await ShenronA2AHub.sendMessage({ target: "rag", instruction: "Goku" });
		expect(res.verdict).toBe("NON_FAIT");
		expect(res.task.status).toBe("failed");
		expect(JSON.stringify(res.responseData.blockers)).toContain("ECONNREFUSED");
	});
});

describe("Ordres de travail et clôture par un pair", () => {
	it("un ordre à codex reste submitted/INCOMPLET (JSON-RPC message/send puis tasks/get)", async () => {
		const rpcRes: any = await ShenronA2AHub.handleJsonRpc({
			jsonrpc: "2.0",
			id: "req-001",
			method: "message/send",
			params: { target: "codex", sourceAgent: "claude-code", instruction: "Implémente la validation AST" },
		});
		expect(rpcRes.id).toBe("req-001");
		expect(rpcRes.result.taskId).toMatch(/^task-/);
		expect(rpcRes.result.status).toBe("submitted");
		expect(rpcRes.result.verdict).toBe("INCOMPLET");

		const got: any = await ShenronA2AHub.handleJsonRpc({
			jsonrpc: "2.0",
			id: "req-002",
			method: "tasks/get",
			params: { taskId: rpcRes.result.taskId },
		});
		expect(got.result.status).toBe("submitted");
		expect(got.result.verdict).toBe("INCOMPLET");
	});

	it("tasks/update : FAIT sans artefact refusé, FAIT avec artefact → completed, puis tâche terminale", async () => {
		const { task } = await ShenronA2AHub.sendMessage({
			target: "local_model",
			sourceAgent: "test-runner",
			instruction: "Résume le lot 003",
		});
		expect(task.status).toBe("submitted");

		const refused: any = await ShenronA2AHub.handleJsonRpc({
			jsonrpc: "2.0",
			id: 1,
			method: "tasks/update",
			params: { taskId: task.id, verdict: "FAIT", text: "fini", sourceAgent: "local_model" },
		});
		expect(refused.error.code).toBe(-32602);
		expect((await ShenronA2AHub.getTask(task.id))!.status).toBe("submitted");

		const done: any = await ShenronA2AHub.handleJsonRpc({
			jsonrpc: "2.0",
			id: 2,
			method: "tasks/update",
			params: {
				taskId: task.id,
				verdict: "FAIT",
				text: "Résumé produit",
				sourceAgent: "local_model",
				artifacts: [{ name: "resume.md", type: "markdown", content: "# Lot 003\n..." }],
			},
		});
		expect(done.result.status).toBe("completed");
		expect(done.result.verdict).toBe("FAIT");
		expect(done.result.task.artifacts.some((a: any) => a.name === "resume.md")).toBe(true);

		const again: any = await ShenronA2AHub.handleJsonRpc({
			jsonrpc: "2.0",
			id: 3,
			method: "tasks/update",
			params: { taskId: task.id, verdict: "NON_FAIT", text: "trop tard" },
		});
		expect(again.error.code).toBe(-32002);
	});

	it("message/send avec taskId (continuation A2A) clôt la tâche en NON_FAIT avec bloqueur", async () => {
		const { task } = await ShenronA2AHub.sendMessage({ target: "agycli", instruction: "Ingère le lot 7" });
		const res: any = await ShenronA2AHub.handleJsonRpc({
			jsonrpc: "2.0",
			id: "c1",
			method: "message/send",
			params: {
				message: {
					role: "agent",
					taskId: task.id,
					parts: [{ type: "text", text: "Scans introuvables sur le disque" }],
					metadata: { sourceAgent: "agycli", verdict: "NON_FAIT" },
				},
			},
		});
		expect(res.result.status).toBe("failed");
		expect(res.result.verdict).toBe("NON_FAIT");
	});

	it("une enveloppe .coord écrite directement par le pair (re=…) fait basculer la tâche", async () => {
		const { task, responseData } = await ShenronA2AHub.sendMessage({
			target: "subagents",
			sourceAgent: "test-runner",
			instruction: "Relis les planches 12 à 20",
		});
		const envelopeId = responseData.envelopeId as string;
		expect(envelopeId).toMatch(/^env-/);

		// Le pair écrit dans SA boîte, sans passer par le hub.
		appendFileSync(
			join(coordDir, "inbox-from-subagents.jsonl"),
			JSON.stringify({
				v: 1,
				ts: new Date(Date.now() + 5).toISOString(),
				id: "env-peer-done-1",
				from: "subagents",
				to: "shenron-dragonball",
				kind: "fact",
				topic: "Relecture terminée",
				body: "FAIT : 9 planches relues",
				re: envelopeId,
				artifacts: [{ name: "relecture.jsonl", type: "file", uri: "file:///tmp/relecture.jsonl" }],
			}) + "\n"
		);

		const got: any = await ShenronA2AHub.handleJsonRpc({
			jsonrpc: "2.0",
			id: "g1",
			method: "tasks/get",
			params: { id: task.id },
		});
		expect(got.result.status).toBe("completed");
		expect(got.result.verdict).toBe("FAIT");
		expect(got.result.metadata.appliedEnvelopes).toContain("env-peer-done-1");
	});

	it("enveloppe /msg « FAIT » sans artefact → rétrogradée INCOMPLET, la tâche reste ouverte", async () => {
		const { task, responseData } = await ShenronA2AHub.sendMessage({
			target: "claude",
			sourceAgent: "test-runner",
			instruction: "Corrige la fiche Broly",
		});
		const ack = await ShenronA2AHub.handleMsgEnvelope({
			from: "claude",
			to: "shenron-dragonball",
			kind: "fact",
			topic: "Broly",
			body: "FAIT",
			re: responseData.envelopeId,
		});
		expect(ack.kind).toBe("ack");
		const t = (await ShenronA2AHub.getTask(task.id))!;
		expect(t.verdict).toBe("INCOMPLET");
		expect(t.status).toBe("working");
		// Aucun nouvel ordre n'a été créé pour la réponse.
		expect(a2aTaskStore.list().filter((x) => x.description === "FAIT")).toHaveLength(0);
	});

	it("broadcast → completed au sens « déposé », jamais FAIT", async () => {
		const res = await ShenronA2AHub.sendMessage({
			target: "broadcast",
			sourceAgent: "test-runner",
			instruction: "Gel des déploiements 30 min",
		});
		expect(res.task.status).toBe("completed");
		expect(res.verdict).not.toBe("FAIT");
		expect(res.responseData.deliveredMailboxes).toBe(1);
		expect(res.responseData.acknowledgements).toBe(0);
	});

	it("ping → ack + heartbeat, et toutes les écritures restent dans la boîte temporaire", async () => {
		const pong = await ShenronA2AHub.handleMsgEnvelope({
			v: 1,
			from: "codex",
			to: "shenron-dragonball",
			kind: "ping",
			topic: "Heartbeat check",
			body: "Ping from Codex agent",
		});
		expect(pong.kind).toBe("ack");
		expect(pong.to).toBe("codex");
		expect(pong.re).toBeDefined();

		const files = readdirSync(coordDir);
		expect(files).toContain("heartbeat-codex.txt");
		expect(files).toContain("inbox-from-test-runner.jsonl");
		expect(files).toContain("a2a-tasks.jsonl");
		expect(readFileSync(join(coordDir, "inbox-from-test-runner.jsonl"), "utf8")).toContain("Relis les planches");
	});

	it("enveloppe /msg au kind invalide → enveloppe error, aucune tâche créée", async () => {
		const before = a2aTaskStore.list().length;
		const env = await ShenronA2AHub.handleMsgEnvelope({ id: "bad-1", from: "codex", to: "rag", kind: "shout", topic: "x", body: "y" });
		expect(env.kind).toBe("error");
		expect(env.re).toBe("bad-1");
		expect(a2aTaskStore.list().length).toBe(before);
	});

	it("enveloppe error hors tâche → ack, escalade #bot-admin, aucune tâche créée", async () => {
		const before = a2aTaskStore.list().length;
		const env = await ShenronA2AHub.handleMsgEnvelope({ from: "ocr", to: "shenron-dragonball", kind: "error", topic: "GPU OOM", body: "worker down" });
		expect(env.kind).toBe("ack");
		expect(env.to).toBe("ocr");
		expect(a2aTaskStore.list().length).toBe(before);
	});

	it("tasks/list renvoie les tâches persistées", async () => {
		const rpcRes: any = await ShenronA2AHub.handleJsonRpc({ jsonrpc: "2.0", id: "l", method: "tasks/list", params: {} });
		expect(Array.isArray(rpcRes.result.tasks)).toBe(true);
		expect(rpcRes.result.total).toBeGreaterThan(0);
	});
});
