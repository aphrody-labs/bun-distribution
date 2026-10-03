import "./setup";
import { describe, expect, it } from "bun:test";
import {
	TrainJobRunner,
	buildTrainRunArgv,
	defaultDbfrTriples,
} from "../src/commands/admin/Train";

const env = { APHRODY_HOME: "/state", APHRODY_BIN: "/bin/aphrody" } as NodeJS.ProcessEnv;

function stream(text: string): ReadableStream<Uint8Array> {
	return new Response(text).body as ReadableStream<Uint8Array>;
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
		await exited;
		await Bun.sleep(5);
		expect(runner.get(job.id)?.status).toBe("succeeded");
		expect(runner.get(job.id)?.tail).toContain("Job done");
	});
});
