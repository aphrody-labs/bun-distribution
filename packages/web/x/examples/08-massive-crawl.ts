/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Example 08 — Crawl a URL list with BXC profile escalation.
 *
 * Strategy:
 * BXC owns the supported static → HTTP → render escalation ladder. Each URL
 * is processed serially so this example stays within the runtime's resource limits.
 */

import { autoEscalate, type EscalationStep } from "../../../apps/bxc/src/profiles/auto-escalation.ts";

interface CrawlResult {
	url: string;
	ok: boolean;
	title: string;
	profile: EscalationStep;
	elapsedMs: number;
}

const urls: string[] = (await Bun.file("urls.txt").exists())
	? (await Bun.file("urls.txt").text()).trim().split("\n").filter(Boolean)
	: ["https://google.com", "https://www.google.com/get"];

console.log(`Crawling ${urls.length} URLs with profile escalation…`);

const results: CrawlResult[] = [];
const profileStats: Record<string, number> = {};

for (const url of urls) {
	const start = Bun.nanoseconds();
	let profile: EscalationStep = "static";

	try {
		const result = await autoEscalate(url, { startProfile: "static", maxAttempts: 3 });
		profile = result.profile;
		let title: string;
		try {
			title = await result.page.title();
		} finally {
			await result.page.close();
		}
		profileStats[profile] = (profileStats[profile] ?? 0) + 1;
		const elapsedMs = (Bun.nanoseconds() - start) / 1e6;
		results.push({ url, ok: true, title, profile, elapsedMs });
		console.log(
			`[${results.length}/${urls.length}] ${profile} profile (${result.attempts.join(" → ")}) | "${title}" (${elapsedMs.toFixed(0)}ms)`,
		);
	} catch (err) {
		const elapsedMs = (Bun.nanoseconds() - start) / 1e6;
		results.push({ url, ok: false, title: "", profile, elapsedMs });
		console.error(
			`[${results.length}/${urls.length}] FAILED: ${url} — ${String(err)}`,
		);
	}
}

const successful = results.filter((r) => r.ok);
console.log(`\n${successful.length}/${urls.length} successful`);
console.log(
	`  profiles: ${Object.entries(profileStats).map(([name, count]) => `${name}=${count}`).join(", ") || "none"}`,
);

await Bun.write(
	"results.json",
	JSON.stringify(
		successful.map((r) => ({
			url: r.url,
			title: r.title,
			profile: r.profile,
			elapsedMs: r.elapsedMs,
		})),
		null,
		2,
	),
);
