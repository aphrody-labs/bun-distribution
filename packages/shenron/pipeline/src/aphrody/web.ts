// SPDX-License-Identifier: Apache-2.0
/** Authenticated crawl jobs and index access owned by Aphrody Web. */
import { runAphrodyCli, type AphrodyCliOptions, type CliResult } from "./cli";

export interface AphrodyWebScrapeOptions extends Omit<AphrodyCliOptions, "json"> {
	profile?: "static" | "http" | "fast" | "stealth" | "max";
	selector?: string;
	max?: number;
}

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

/** Captures source HTML through Aphrody Web's authenticated, server hosted API. */
export async function scrapeWithAphrody(url: string, options: AphrodyScrapeOptions = {}): Promise<AphrodyScrapeResult> {
	const target = new URL(url);
	if (!["https:", "http:"].includes(target.protocol) || target.username || target.password) {
		throw new Error("Aphrody Web requires an HTTP(S) page URL without credentials");
	}
	const origin = new URL(options.baseUrl ?? process.env.APHRODY_WEB_API_URL ?? "https://aphrody.com");
	if ((origin.protocol !== "https:" && !(origin.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(origin.hostname))) || origin.username || origin.password || origin.search || origin.hash) {
		throw new Error("Aphrody Web API URL must use HTTPS or loopback HTTP");
	}
	const token = options.token ?? process.env.APHRODY_WEB_API_TOKEN ?? process.env.APHRODY_BXC_API_TOKEN;
	if (!token?.trim()) throw new Error("APHRODY_WEB_API_TOKEN is not configured (legacy APHRODY_BXC_API_TOKEN)");
	const localListener = origin.protocol === "http:" && origin.port === "3007" && ["127.0.0.1", "[::1]", "localhost"].includes(origin.hostname);
	const endpoint = new URL(localListener ? "/api/v1/scrape" : "/api/v1/web/scrape", origin);
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

export interface AphrodyWebCrawlRequest {
	urls: string[];
	allowedDomains?: string[];
	maxDepth?: number;
	maxRequests?: number;
	maxConcurrency?: number;
	perHostDelayMs?: number;
	sqlite?: string;
}

export interface AphrodyWebCrawlReport {
	attempts: number;
	pages: Array<{ url: string; title?: string; markdown?: string; [key: string]: unknown }>;
	errors: Array<{ url: string; error: string }>;
	frontier?: Record<string, number>;
}

/** Scrapes one page through the shared Aphrody Web Rust CLI and returns Markdown. */
export async function aphrodyWebScrape(url: string, options: AphrodyWebScrapeOptions = {}): Promise<string> {
	const parsed = new URL(url);
	if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
		throw new Error("Aphrody Web scrape requires an HTTP(S) URL without credentials");
	}
	const args = ["web", "scrape", url];
	if (options.selector) args.push(options.selector);
	else args.push("--markdown");
	args.push("--profile", options.profile ?? "static");
	if (options.max !== undefined) args.push("--max", String(options.max));
	const result = await runAphrodyCli(args, { timeoutMs: 120_000, ...options });
	if (result.kind === "exit" && result.ok) return result.stdout.trimEnd();
	throw new Error(formatCliError(result));
}

/** Fetches a JSON reconnaissance report through Aphrody Web. */
export async function aphrodyWebRecon<T = Record<string, unknown>>(
	url: string,
	options: AphrodyWebScrapeOptions = {},
): Promise<T> {
	const parsed = new URL(url);
	if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
		throw new Error("Aphrody Web recon requires an HTTP(S) URL without credentials");
	}
	const result: CliResult<T> = await runAphrodyCli<T>(["web", "recon", url, "--json", "--profile", options.profile ?? "static"], {
		timeoutMs: 120_000,
		...options,
		json: true,
	});
	if (result.kind === "exit" && result.ok) return result.data as T;
	throw new Error(formatCliError(result));
}

/** Runs a bounded, persistent crawl through the Aphrody Web Rust frontier. */
export async function aphrodyWebCrawl(
	request: AphrodyWebCrawlRequest,
	options: Omit<AphrodyCliOptions, "json"> = {},
): Promise<AphrodyWebCrawlReport> {
	if (!request.urls.length) throw new Error("Aphrody Web crawl requires at least one seed URL");
	for (const raw of request.urls) {
		const url = new URL(raw);
		if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
			throw new Error(`Aphrody Web crawl requires HTTP(S) URLs without credentials: ${raw}`);
		}
	}
	const args = ["web", "crawl", ...request.urls,
		"--max-depth", String(request.maxDepth ?? 3),
		"--max-requests", String(request.maxRequests ?? 100),
		"--concurrency", String(request.maxConcurrency ?? 2),
		"--per-host-delay", String(request.perHostDelayMs ?? 1000),
		"--json"];
	if (request.allowedDomains?.length) args.push("--allowed-domains", request.allowedDomains.join(","));
	if (request.sqlite) args.push("--sqlite", request.sqlite);
	const result = await runAphrodyCli<AphrodyWebCrawlReport>(args, { timeoutMs: 600_000, ...options, json: true });
	if (result.kind !== "exit" || !result.ok || !result.data || !Array.isArray(result.data.pages)) {
		throw new Error(formatCliError(result));
	}
	return result.data;
}

/** Queries the shared Aphrody Google Search client and returns its structured result. */
export async function aphrodyWebSearch<T = Record<string, unknown>>(
	query: string,
	options: AphrodyCliOptions & { language?: string; region?: string; count?: number } = {},
): Promise<T> {
	if (!query.trim()) throw new Error("Aphrody Web search requires a query");
	const args = ["web", "search", ...query.trim().split(/\s+/), "--json",
		"--hl", options.language ?? "en", "--gl", options.region ?? "US",
		"--num", String(options.count ?? 10)];
	const result: CliResult<T> = await runAphrodyCli<T>(args, { ...options, json: true });
	if (result.kind === "exit" && result.ok && result.data !== undefined) return result.data;
	throw new Error(formatCliError(result));
}

function formatCliError(result: CliResult): string {
	if (result.kind === "not_found") return `Aphrody CLI unavailable (${result.bin}): ${result.message}`;
	if (result.kind === "timeout") return `Aphrody CLI timed out after ${result.timeoutMs} ms: ${result.stderr.trim()}`;
	if (result.kind === "invalid_json") return `Aphrody CLI returned invalid JSON: ${result.error}`;
	return `Aphrody CLI exited ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`;
}

export interface AphrodyCrawlOptions {
	baseUrl?: string;
	token?: string;
	fetcher?: typeof fetch;
}

export interface AphrodyCrawlRequest {
	urls: string[];
	allowedDomains?: string[];
	maxDepth?: number;
	maxRequests?: number;
	maxConcurrency?: number;
	profile?: "static" | "http" | "render";
}

export interface AphrodyCrawlJob {
	id: string;
	status: "running" | "completed" | "partial" | "limit_reached" | "failed";
	stats: Record<string, unknown>;
	startedAt?: string;
	finishedAt?: string;
}

export class AphrodyWebClient {
	private readonly baseUrl: URL;
	private readonly token: string;
	private readonly fetcher: typeof fetch;
	private readonly apiPrefix: string;

	constructor(options: AphrodyCrawlOptions = {}) {
		this.baseUrl = new URL(options.baseUrl ?? process.env.APHRODY_WEB_API_URL ?? "https://aphrody.com");
		if ((this.baseUrl.protocol !== "https:" && !(this.baseUrl.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(this.baseUrl.hostname))) || this.baseUrl.username || this.baseUrl.password) {
			throw new Error("Aphrody Web URL must use HTTPS or loopback HTTP");
		}
		this.token = options.token ?? process.env.APHRODY_WEB_API_TOKEN ?? process.env.APHRODY_BXC_API_TOKEN ?? "";
		if (!this.token.trim()) throw new Error("Aphrody Web token is not configured");
		this.fetcher = options.fetcher ?? fetch;
		this.apiPrefix = this.baseUrl.protocol === "http:" && this.baseUrl.port === "3007" && ["127.0.0.1", "[::1]", "localhost"].includes(this.baseUrl.hostname)
			? "/api/v1" : "/api/v1/web";
	}

	private async request(path: string, body?: unknown): Promise<{ success?: unknown; job?: unknown }> {
		const url = new URL(path, this.baseUrl);
		const response = await this.fetcher(url, {
			method: body === undefined ? "GET" : "POST",
			headers: { authorization: `Bearer ${this.token}`, accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok) throw new Error(`Aphrody Web HTTP ${response.status} on ${url.pathname}`);
		return await response.json() as { success?: unknown; job?: unknown };
	}

	private job(value: unknown): AphrodyCrawlJob {
		const row = value as Record<string, unknown> | null;
		if (!row || typeof row.id !== "string" || !["running", "completed", "partial", "limit_reached", "failed"].includes(String(row.status)) || !row.stats || typeof row.stats !== "object") {
			throw new Error("Aphrody Web returned an invalid crawl job");
		}
		return row as unknown as AphrodyCrawlJob;
	}

	async crawl(request: AphrodyCrawlRequest): Promise<AphrodyCrawlJob> {
		if (request.urls.length < 1 || request.urls.length > 10 || request.urls.some((url) => {
			const parsed = new URL(url);
			return !["http:", "https:"].includes(parsed.protocol) || Boolean(parsed.username || parsed.password);
		})) {
			throw new Error("Aphrody Web requires 1 to 10 HTTP(S) seed URLs");
		}
		const result = await this.request(`${this.apiPrefix}/crawl`, request);
		if (result.success !== true) throw new Error("Aphrody Web did not accept the crawl");
		return this.job(result.job);
	}

	async status(jobId: string): Promise<AphrodyCrawlJob> {
		if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw new Error("Invalid Aphrody Web crawl job ID");
		const result = await this.request(`${this.apiPrefix}/crawl/stats?jobId=${encodeURIComponent(jobId)}`);
		if (result.success !== true) throw new Error("Aphrody Web crawl job is unavailable");
		return this.job(result.job);
	}
}
