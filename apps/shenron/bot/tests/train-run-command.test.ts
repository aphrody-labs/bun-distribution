import "./setup";
import { describe, expect, it } from "bun:test";
import {
	TrainJobRunner,
	buildTrainRunArgv,
	defaultDbfrTriples,
	describeJob,
	embeddingsLabel,
	startedMessage,
	type TrainJob,
	type TrainRunKind,
} from "../src/commands/admin/Train";

const env = { APHRODY_HOME: "/state", APHRODY_BIN: "/bin/aphrody" } as NodeJS.ProcessEnv;

function stream(text: string): ReadableStream<Uint8Array> {
	return new Response(text).body as ReadableStream<Uint8Array>;
}

async function until(done: () => boolean): Promise<void> {
	for (let i = 0; i < 200 && !done(); i++) await Bun.sleep(5);
	expect(done()).toBe(true);
}

function pending(stdout: string | null = null, stderr: string | null = null) {
	let release!: (code: number) => void;
	const exited = new Promise<number>((r) => (release = r));
	return {
		release,
		spawn: () => ({
			exited,
			stdout: stdout === null ? null : stream(stdout),
			stderr: stderr === null ? null : stream(stderr),
		}),
	};
}

describe("train run", () => {
	it("defaults input to the dbfr workspace triples", () => {
		expect(defaultDbfrTriples(env)).toBe("/state/workspaces/dbfr/training/triples.jsonl");
	});

	it("builds the aphrody train run argv", () => {
		expect(
			buildTrainRunArgv({ id: "j1", kind: "rerank", input: "/t.jsonl", outDir: "/o" }, env)
		).toEqual([
			"/bin/aphrody", "train", "run", "--kind", "rerank", "--id", "j1",
			"--input", "/t.jsonl", "--out-dir", "/o",
		]);
	});

	it("starts without blocking and records completion", async () => {
		let release!: (code: number) => void;
		const exited = new Promise<number>((r) => (release = r));
		const calls: { argv: string[]; domain?: string }[] = [];
		const runner = new TrainJobRunner((argv, spawnEnv) => {
			calls.push({ argv, domain: spawnEnv.APHRODY_AGENT_DOMAIN });
			return { exited, stdout: stream("Job done\n"), stderr: null };
		}, env);
		const job = runner.start("embed", undefined, "42");
		expect(job.status).toBe("running");
		expect(job.input).toBe("/state/workspaces/dbfr/training/triples.jsonl");
		expect(job.outDir).toBe(`/state/train/${job.id}`);
		expect(calls[0]?.domain).toBe("dbfr");
		expect(runner.latest()?.id).toBe(job.id);
		release(0);
		await until(() => runner.get(job.id)?.status === "succeeded");
		expect(runner.get(job.id)?.exitCode).toBe(0);
		expect(runner.get(job.id)?.tail).toContain("Job done");
	});

	it("never reports a final status before the last output is in the tail", async () => {
		const run = pending("last words\n", "warning\n");
		const runner = new TrainJobRunner(run.spawn, env);
		const job = runner.start("rerank", "/t.jsonl", "42");
		run.release(1);
		await until(() => job.status !== "running");
		expect(job.status).toBe("failed");
		expect(job.exitCode).toBe(1);
		expect(job.tail).toContain("last words");
		expect(job.tail).toContain("warning");
	});

	it("runs one job at a time: the GPU lease preempts production inference", async () => {
		const run = pending();
		const runner = new TrainJobRunner(run.spawn, env);
		const first = runner.start("embed", undefined, "42");
		expect(runner.running()?.id).toBe(first.id);
		expect(() => runner.start("rerank", undefined, "43")).toThrow(
			`Un entraînement est déjà en cours : ${first.id}`
		);
		run.release(0);
		await until(() => runner.running() === undefined);
		expect(runner.start("rerank", undefined, "43").kind).toBe("rerank");
	});

	it("marks a job failed when the spawn throws, and does not block the next start", () => {
		let attempts = 0;
		const runner = new TrainJobRunner(() => {
			if (++attempts === 1) throw new Error("ENOENT: aphrody not found");
			return { exited: new Promise<number>(() => {}), stdout: null, stderr: null };
		}, env);
		expect(() => runner.start("embed", undefined, "42")).toThrow("ENOENT");
		const failed = runner.latest() as TrainJob;
		expect(failed.status).toBe("failed");
		expect(failed.tail).toContain("ENOENT");
		expect(runner.running()).toBeUndefined();
		const next = runner.start("embed", undefined, "42");
		expect(next.status).toBe("running");
		expect(next.id).not.toBe(failed.id);
		expect(runner.get(failed.id)?.status).toBe("failed");
	});

	it("rejects an unknown kind before spawning", () => {
		let spawned = 0;
		const runner = new TrainJobRunner(() => {
			spawned++;
			return { exited: new Promise<number>(() => {}), stdout: null, stderr: null };
		}, env);
		expect(() => runner.start("lora" as TrainRunKind, undefined, "42")).toThrow(
			"Type d'entraînement inconnu : lora"
		);
		expect(spawned).toBe(0);
		expect(runner.latest()).toBeUndefined();
	});
});

describe("train job messages", () => {
	const job: TrainJob = {
		id: "shenron-embed-x",
		kind: "embed",
		input: `/${"a".repeat(5000)}`,
		outDir: "/state/train/shenron-embed-x",
		startedBy: "42",
		startedAt: 1_700_000_000_000,
		status: "failed",
		exitCode: 1,
		tail: `${"x".repeat(2000)}\n\`\`\`\nboom`,
	};

	it("stays within the Discord message limit whatever the input and tail", () => {
		expect(startedMessage(job).length).toBeLessThanOrEqual(2000);
		expect(describeJob(job).length).toBeLessThan(1900);
	});

	it("neutralizes code fences inside the tail so the block stays closed", () => {
		const text = describeJob(job);
		expect(text.match(/```/g)).toHaveLength(2);
		expect(text).toContain("boom");
	});

	it("keeps the end of a clipped input path", () => {
		expect(describeJob({ ...job, input: `/${"a".repeat(5000)}/triples.jsonl` })).toContain(
			"a/triples.jsonl`"
		);
	});
});

describe("eval embeddings label", () => {
	it("does not report a BM25 fallback when the Aphrody backend is in use", () => {
		expect(embeddingsLabel(true, true)).toContain("Aphrody E5");
		expect(embeddingsLabel(false, true)).not.toContain("BM25");
		expect(embeddingsLabel(false, false)).toContain("BM25");
		expect(embeddingsLabel(true, false)).toContain("ONNX");
	});
});
