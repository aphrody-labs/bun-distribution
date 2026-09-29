// SPDX-License-Identifier: Apache-2.0
/** Remote HTML capture. Shenron owns the source-specific editorial parsing. */
export type AphrodyScrapeProfile = "static" | "http" | "render";

export interface AphrodyScrapeResult {
	url: string;
	status: number;
	title: string;
	content: string;
}

export interface AphrodyScrapeOptions {
	baseUrl?: string;
	token?: string;
	profile?: AphrodyScrapeProfile;
	fetcher?: typeof fetch;
}

export async function scrapeWithAphrody(url: string, options: AphrodyScrapeOptions = {}): Promise<AphrodyScrapeResult> {
	const target = new URL(url);
	if (!["https:", "http:"].includes(target.protocol) || target.username || target.password) {
		throw new Error("Aphrody Web requires an HTTP(S) page URL without credentials");
	}
	const origin = new URL(options.baseUrl ?? process.env.APHRODY_WEB_API_URL ?? "https://aphrody.com");
	if ((origin.protocol !== "https:" && !(origin.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(origin.hostname))) || origin.username || origin.password || origin.search || origin.hash) {
		throw new Error("Aphrody Web API URL must use HTTPS or loopback HTTP");
	}
	const token = options.token ?? process.env.APHRODY_BXC_API_TOKEN;
	if (!token?.trim()) throw new Error("APHRODY_BXC_API_TOKEN is not configured");
	const directBxc = origin.protocol === "http:" && origin.port === "3007" && ["127.0.0.1", "[::1]", "localhost"].includes(origin.hostname);
	const endpoint = new URL(directBxc ? "/api/v1/scrape" : "/api/v1/web/scrape", origin);
	const response = await (options.fetcher ?? fetch)(endpoint, {
		method: "POST",
		headers: { authorization: `Bearer ${token}`, accept: "application/json", "content-type": "application/json" },
		body: JSON.stringify({ url: target.href, profile: options.profile ?? "static" }),
		signal: AbortSignal.timeout(60_000),
	});
	if (!response.ok) throw new Error(`Aphrody Web scrape HTTP ${response.status}`);
	const result = await response.json() as Partial<AphrodyScrapeResult>;
	if (result.url !== target.href || typeof result.status !== "number" || typeof result.title !== "string" || typeof result.content !== "string") {
		throw new Error("Aphrody Web scrape returned an invalid page");
	}
	if (result.status < 200 || result.status >= 300) throw new Error(`Aphrody Web page HTTP ${result.status}`);
	return result as AphrodyScrapeResult;
}
