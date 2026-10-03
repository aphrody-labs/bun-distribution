const token = process.env.BXC_API_TOKEN;
if (!token) throw new Error("BXC token is unavailable");
for (const suffix of ["search", "index/search"]) {
	const url = new URL(`https://aphrody.com/api/v1/web/${suffix}`);
	url.searchParams.set("q", "dragon ball");
	url.searchParams.set("mode", "keyword");
	url.searchParams.set("limit", "10");
	const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
	const contentType = response.headers.get("content-type") ?? "";
	const value = contentType.includes("application/json") ? await response.json() as { ok?: boolean; results?: unknown[] } : {};
	console.log(JSON.stringify({ route: suffix, http: response.status, contentType, ok: value.ok, resultCount: value.results?.length ?? 0 }));
}
