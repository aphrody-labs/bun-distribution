const token = process.env.BXC_API_TOKEN;
if (!token) throw new Error("BXC token is unavailable");
const base = "https://aphrody.com/api/v1/web";
const headers = { authorization: `Bearer ${token}` };
const start = await fetch(`${base}/crawl`, {
	method: "POST",
	headers: { ...headers, "content-type": "application/json" },
	body: JSON.stringify({
		urls: ["https://dragon-ball-official.com/"],
		allowedDomains: ["dragon-ball-official.com"],
		maxDepth: 0,
		maxRequests: 1,
		maxConcurrency: 1,
		profile: "static",
	}),
	signal: AbortSignal.timeout(10_000),
});
const started = await start.json() as { success?: boolean; job?: { id?: string } };
if (start.status !== 202 || !started.success || !started.job?.id) throw new Error(`crawl submit HTTP ${start.status}`);
let final: Record<string, unknown> | undefined;
for (let attempt = 0; attempt < 30; attempt++) {
	const response = await fetch(`${base}/crawl/stats?jobId=${encodeURIComponent(started.job.id)}`, {
		headers,
		signal: AbortSignal.timeout(5_000),
	});
	const value = await response.json() as { job?: Record<string, unknown> };
	if (response.status !== 200 || !value.job) throw new Error(`crawl status HTTP ${response.status}`);
	if (value.job.status !== "running") { final = value.job; break; }
	await Bun.sleep(1000);
}
console.log(JSON.stringify({ id: started.job.id, status: final?.status ?? "timeout", stats: final?.stats ?? null }));
if (!final || final.status !== "completed") process.exitCode = 1;
