// SPDX-License-Identifier: Apache-2.0
/** Crawl a URL list through the shared Rust Web transport and renderer. */

import { runXWebRecon, type WebReconProfile } from "../src/tools/web-recon.ts";

interface CrawlResult {
  url: string;
  ok: boolean;
  title: string;
  profile: WebReconProfile;
  elapsedMs: number;
}

const urls = (await Bun.file("urls.txt").exists())
  ? (await Bun.file("urls.txt").text()).trim().split("\n").filter(Boolean)
  : ["https://google.com", "https://www.google.com/get"];

const results: CrawlResult[] = [];
const profileStats: Record<string, number> = {};

for (const url of urls) {
  const start = Bun.nanoseconds();
  let profile: WebReconProfile = "fast";
  let title = "";
  let error = "";

  for (const candidate of ["fast", "max"] as const) {
    profile = candidate;
    const report = await runXWebRecon(candidate, [url]);
    const page = report.results[url];
    error = page ? page.error ?? "" : "no page result";
    const raw = page?.raw as { extracted?: { title?: string } } | undefined;
    title = raw?.extracted?.title ?? "";
    if (!error && !title) error = "empty page title";
    if (!error && title) break;
  }

  const elapsedMs = (Bun.nanoseconds() - start) / 1e6;
  const ok = !error && Boolean(title);
  results.push({ url, ok, title, profile, elapsedMs });
  if (ok) profileStats[profile] = (profileStats[profile] ?? 0) + 1;
  console.log(
    `[${results.length}/${urls.length}] ${ok ? profile : "FAILED"} | ${title || error} (${elapsedMs.toFixed(0)}ms)`,
  );
}

const successful = results.filter((result) => result.ok);
console.log(`${successful.length}/${urls.length} successful`);
console.log(`profiles: ${JSON.stringify(profileStats)}`);
await Bun.write("results.json", JSON.stringify(successful, null, 2));
