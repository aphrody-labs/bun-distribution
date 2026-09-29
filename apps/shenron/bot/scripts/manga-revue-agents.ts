#!/usr/bin/env bun
/** Compatibility command; the pipeline owns Aphrody OCR and visual reviews. */
import { join } from "node:path";

const pipeline = join(import.meta.dir, "..", "..", "..", "packages", "pipeline", "scripts", "manga-revue-agents.ts");
const proc = Bun.spawn([process.execPath, pipeline, ...Bun.argv.slice(2)], {
	stdin: "inherit", stdout: "inherit", stderr: "inherit",
});
process.exit(await proc.exited);
