const token = process.env.BXC_API_TOKEN;
if (!token) throw new Error("BXC token is unavailable");

const target = "https://dragon-ball-official.com/";
const endpoint = "https://aphrody.com/api/v1/web/scrape";
const response = await fetch(endpoint, {
	method: "POST",
	headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
	body: JSON.stringify({ url: target, profile: "static" }),
	signal: AbortSignal.timeout(60_000),
});
const value = await response.json() as Record<string, unknown>;
console.log(JSON.stringify({
	http: response.status,
	pageStatus: value.status,
	urlMatches: value.url === target,
	titleChars: typeof value.title === "string" ? value.title.length : 0,
	contentChars: typeof value.content === "string" ? value.content.length : 0,
	error: typeof value.error === "string" ? value.error : undefined,
}));
if (response.status !== 200 || value.status !== 200 || value.url !== target || typeof value.content !== "string" || value.content.length === 0) {
	process.exitCode = 1;
}
