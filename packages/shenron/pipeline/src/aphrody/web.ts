// SPDX-License-Identifier: Apache-2.0
/** Authenticated crawl jobs and index access owned by Aphrody Web. */
import { runAphrodyCli, type AphrodyCliOptions, type CliResult } from "./cli";

export interface AphrodyWebScrapeOptions extends Omit<AphrodyCliOptions, "json"> {
	profile?: "static" | "http" | "fast" | "stealth" | "max";
	selector?: string;
	max?: number;
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
