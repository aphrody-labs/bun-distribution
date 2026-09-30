const token = process.env.BXC_API_TOKEN;
if (!token) throw new Error("BXC token is unavailable");
const base = "http://127.0.0.1:13007/api/v1";
const headers = { authorization: `Bearer ${token}` };
const target = "https://dragon-ball-official.com/";
const submitted = await fetch(`${base}/crawl`, {
	method: "POST",
	headers: { ...headers, "content-type": "application/json" },
	body: JSON.stringify({ urls: [target], allowedDomains: ["dragon-ball-official.com"], maxDepth: 0, maxRequests: 1, maxConcurrency: 1, profile: "static" }),
	signal: AbortSignal.timeout(10_000),
});
const start = await submitted.json() as { success?: boolean; job?: { id?: string } };
if (submitted.status !== 202 || !start.success || !start.job?.id) throw new Error(`submit HTTP ${submitted.status}`);
let status = "timeout";
for (let attempt = 0; attempt < 30; attempt++) {
	const response = await fetch(`${base}/crawl/stats?jobId=${encodeURIComponent(start.job.id)}`, { headers, signal: AbortSignal.timeout(5_000) });
	const value = await response.json() as { job?: { status?: string } };
	if (response.status !== 200 || !value.job?.status) throw new Error(`status HTTP ${response.status}`);
	status = value.job.status;
	if (status !== "running") break;
	await Bun.sleep(1000);
}
const search = new URL(`${base}/index/search`);
search.searchParams.set("q", "Dragon Ball");
search.searchParams.set("mode", "keyword");
const response = await fetch(search, { headers, signal: AbortSignal.timeout(10_000) });
const value = await response.json() as { ok?: boolean; results?: Array<{ url?: string }> };
const found = value.results?.some((hit) => hit.url === target) ?? false;
console.log(JSON.stringify({ crawl: status, searchHttp: response.status, resultCount: value.results?.length ?? 0, officialFound: found }));
if (status !== "completed" || response.status !== 200 || !found) process.exitCode = 1;
