// SPDX-License-Identifier: Apache-2.0
/** Submit a bounded Shenron seed crawl to Aphrody Web. */
import { AphrodyWebClient } from "@shenron/pipeline/aphrody";

function argument(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

const url = process.argv[2];
if (!url || url.startsWith("--")) throw new Error("Usage: bun scripts/ops/aphrody-web-crawl.ts <https-url> [--max-depth N] [--max-requests N] [--wait]");
const maxDepth = Number(argument("--max-depth") ?? 1);
const maxRequests = Number(argument("--max-requests") ?? 25);
if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > 5) throw new Error("--max-depth must be between 0 and 5");
if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 250) throw new Error("--max-requests must be between 1 and 250");
const client = new AphrodyWebClient();
let job = await client.crawl({ urls: [url], maxDepth, maxRequests });
console.log(JSON.stringify({ status: "submitted", job }));
if (process.argv.includes("--wait")) {
	while (job.status === "running") {
		await Bun.sleep(2_000);
		job = await client.status(job.id);
	}
	console.log(JSON.stringify({ status: "finished", job }));
	if (job.status !== "completed") process.exitCode = 1;
}
