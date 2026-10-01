#!/usr/bin/env bun
/**
 * rag-harvest.ts — Orchestre la récolte RAG Dragon Ball through Aphrody Web.
 * BXC mirror support remains for raw site mirrors until Aphrody Web owns that contract.
 * Extrait du markdown brut, normalise, et versionne dans data/rag/raw/.
 *
 * Usage : bun apps/shenron/bot/scripts/rag-harvest.ts <subcommand> [options]
 */
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { aphrodyWebCrawl, aphrodyWebRecon, aphrodyWebScrape, aphrodyWebSearch } from "@shenron/pipeline/aphrody";
import { bxcCommand } from "@shenron/pipeline/bxc/cli";

// Paths
const DB_PATH = fileURLToPath(new URL("../data/bot.db", import.meta.url));
const OUT_RAW = fileURLToPath(new URL("../data/rag/raw/", import.meta.url));

// CLI Arguments Parser
const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
	printHelpAndExit();
}

const subcommand = args[0];
const subArgs = args.slice(1);

const options: Record<string, string | boolean> = {};
const positional: string[] = [];

for (let i = 0; i < subArgs.length; i++) {
	const arg = subArgs[i];
	if (arg.startsWith("--")) {
		const key = arg.replace(/^--/, "");
		const next = subArgs[i + 1];
		if (next && !next.startsWith("--")) {
			options[key] = next;
			i++;
		} else {
			options[key] = true;
		}
	} else {
		positional.push(arg);
	}
}

// Map configuration options
const profile = (options.profile as string) || process.env.BXC_PROFILE || "max";
const proxy = (options.proxy as string) || process.env.BXC_PROXY || process.env.PROXY || undefined;
const delayMs = parseInt((options.delay as string) || "1000", 10);
const sourceIdOpt = (options["source-id"] as string) || undefined;
const outputDir = (options["output-dir"] as string) || OUT_RAW;
const selector = (options.selector as string) || undefined;
const isJson = !!options.json;
const isRecursive = !!options.recursive;
const maxPages = parseInt((options["max-pages"] as string) || "10", 10);
const maxDepth = parseInt((options["max-depth"] as string) || "3", 10);
const allowedDomains = (options["allowed-domains"] as string) || undefined;
const queueName = (options.queue as string) || "rag-harvest-queue";

// Create output directory
mkdirSync(outputDir, { recursive: true });

// Load sources from SQLite database or fallback
let dbSources: Array<{
	id: string;
	name: string;
	url: string;
	license_key?: string;
	attribution_template?: string;
}> = [];

if (existsSync(DB_PATH)) {
	try {
		const db = new Database(DB_PATH, { readonly: true });
		dbSources = db
			.query(`SELECT id, name, url, license_key, attribution_template FROM db_sources`)
			.all() as any;
		db.close();
	} catch {
		console.warn("⚠ Impossible de lire db_sources depuis SQLite, utilisation du fallback.");
	}
}

if (dbSources.length === 0) {
	dbSources = [
		{
			id: "dragonball-api",
			name: "dragonball-api.com",
			url: "https://dragonball-api.com/",
			license_key: "MIT",
		},
		{
			id: "bandai-eu",
			name: "Bandai Namco Entertainment EU",
			url: "https://en.bandainamcoent.eu/dragon-ball",
			license_key: "FAIR-USE-EDITORIAL",
		},
		{
			id: "dbofficial-fr",
			name: "Site officiel Dragon Ball FR",
			url: "https://fr.dragon-ball-official.com/",
			license_key: "FAIR-USE-EDITORIAL",
		},
		{
			id: "dbofficial-en",
			name: "Dragon Ball Official Site EN",
			url: "https://en.dragon-ball-official.com/",
			license_key: "FAIR-USE-EDITORIAL",
		},
		{
			id: "toei-animation",
			name: "Toei Animation",
			url: "https://www.toei-animation.com/catalog/dragon-ball/",
			license_key: "FAIR-USE-EDITORIAL",
		},
		{
			id: "shueisha",
			name: "Shueisha (corporate)",
			url: "https://www.shueisha.co.jp/",
			license_key: "FAIR-USE-EDITORIAL",
		},
		{
			id: "shonenjump-plus",
			name: "Shōnen Jump+ (Shueisha)",
			url: "https://shonenjumpplus.com/",
			license_key: "FAIR-USE-EDITORIAL",
		},
		{
			id: "viz-media",
			name: "Viz Media",
			url: "https://www.viz.com/shonenjump/chapters/dragon-ball-super",
			license_key: "FAIR-USE-EDITORIAL",
		},
		{
			id: "kanzenshuu",
			name: "Kanzenshuu (fan-site historique)",
			url: "https://kanzenshuu.com/",
			license_key: "FAIR-USE-EDITORIAL",
		},
		{
			id: "jikan",
			name: "Jikan (MyAnimeList scraper)",
			url: "https://jikan.moe/",
			license_key: "API-PUBLIC",
		},
		{ id: "anilist", name: "AniList", url: "https://anilist.co/", license_key: "API-PUBLIC" },
		{ id: "kitsu", name: "Kitsu.io", url: "https://kitsu.io/", license_key: "API-PUBLIC" },
	];
}

const SEEDS = [
	{
		id: "wiki-dbz",
		name: "Dragon Ball Z (Wikipedia)",
		url: "https://en.wikipedia.org/wiki/Dragon_Ball_Z",
	},
	{
		id: "wiki-db",
		name: "Dragon Ball (Wikipedia)",
		url: "https://en.wikipedia.org/wiki/Dragon_Ball",
	},
	{
		id: "wiki-dbsuper",
		name: "Dragon Ball Z (Wikipedia)",
		url: "https://en.wikipedia.org/wiki/Dragon_Ball_Super",
	},
	{
		id: "wiki-toriyama",
		name: "Akira Toriyama (Wikipedia)",
		url: "https://en.wikipedia.org/wiki/Akira_Toriyama",
	},
];

// Temporary raw-site mirror adapter; other web operations use Aphrody Web.
async function execBxc(
	subcmd: string,
	subcmdArgs: string[],
	opts: { proxy?: string; profile?: string } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
	const cmd = await bxcCommand();

	if (opts.proxy) {
		cmd.push("--proxy", opts.proxy);
	}

	cmd.push(subcmd);

	if (opts.profile && ["recon", "scrape", "mirror", "crawl-worker"].includes(subcmd)) {
		cmd.push("--profile", opts.profile);
	}

	cmd.push(...subcmdArgs);

	const spawnOpts: { stdout: "pipe"; stderr: "pipe" } = {
		stdout: "pipe",
		stderr: "pipe",
	};

	const proc = Bun.spawn(cmd, spawnOpts);
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const code = await proc.exited;

	return { code, stdout, stderr };
}

// Slugifier
function getSlug(urlStr: string): string {
	try {
		const url = new URL(urlStr);
		let path = url.pathname.replace(/^\/|\/$/g, "");
		if (!path) return "index";
		return path
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
	} catch {
		return "page";
	}
}

// Language Detector
function detectLang(url: string, content: string): string {
	if (url.includes("/fr/") || url.includes("fr.dragon-ball-official.com") || url.includes(".fr/")) {
		return "fr";
	}
	if (url.includes("/ja/") || url.includes(".jp/") || url.includes("dragonball.jp")) {
		return "ja";
	}

	const frWords = [
		" et ",
		" le ",
		" la ",
		" dans ",
		" les ",
		" une ",
		" des ",
		" pour ",
		" qui ",
		" que ",
		" est ",
		" avec ",
	];
	let frCount = 0;
	const lowercaseContent = content.toLowerCase();
	for (const word of frWords) {
		if (lowercaseContent.includes(word)) frCount++;
	}

	if (frCount >= 4) return "fr";
	return "en";
}

/**
 * Fandom est une source interdite (cf. CLAUDE.md) : la récolte la refuse à la
 * porte, quel que soit le sous-commande, plutôt que de la filtrer plus tard.
 */
function refuseSiFandom(urlStr: string): boolean {
	if (!/(^|\.)fandom\.com/i.test((() => {
		try {
			return new URL(urlStr).hostname;
		} catch {
			return "";
		}
	})())) {
		return false;
	}
	console.error(`[-] Refusé : ${urlStr} — Fandom est une source interdite (cf. CLAUDE.md).`);
	return true;
}

// Metadata Lookup
function lookupSourceMeta(urlStr: string): { sourceId: string; licenseKey: string; name: string } {
	try {
		const urlObj = new URL(urlStr);
		const host = urlObj.hostname.toLowerCase();

		if (host.includes("wikipedia.org")) {
			return {
				sourceId: "wikipedia",
				licenseKey: "CC-BY-SA-3",
				name: "Wikipedia",
			};
		}

		for (const source of dbSources) {
			try {
				const srcUrl = new URL(source.url);
				const srcHost = srcUrl.hostname.toLowerCase();
				if (host === srcHost || host.endsWith("." + srcHost) || srcHost.endsWith("." + host)) {
					return {
						sourceId: source.id,
						licenseKey: source.license_key || "FAIR-USE-EDITORIAL",
						name: source.name,
					};
				}
			} catch {}
		}
	} catch {}

	return {
		sourceId: "generic",
		licenseKey: "FAIR-USE-EDITORIAL",
		name: "Unknown Source",
	};
}

// Save document and update manifest
function saveHarvestedDoc(
	url: string,
	content: string,
	customSourceId?: string,
	extension = "md"
): string {
	const meta = lookupSourceMeta(url);
	const sourceId = customSourceId || meta.sourceId;
	const license = meta.licenseKey;
	const slug = getSlug(url);

	const hash = createHash("sha256").update(content).digest("hex");
	const lang = detectLang(url, content);

	const relativePath = `${sourceId}/${slug}.${extension}`;
	const absolutePath = `${outputDir}/${relativePath}`;

	const fileDir = `${outputDir}/${sourceId}`;
	mkdirSync(fileDir, { recursive: true });
	writeFileSync(absolutePath, content);

	// Update manifest.json
	const manifestPath = `${outputDir}/harvest.json`;
	let manifest: Record<string, any> = {};
	if (existsSync(manifestPath)) {
		try {
			manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
		} catch {}
	}

	const existing = manifest[url] || {};
	manifest[url] = {
		...existing,
		url,
		source_id: sourceId,
		license,
		lang,
		fetched_at: new Date().toISOString(),
	};

	if (extension === "recon.md") {
		manifest[url].recon_path = relativePath;
		manifest[url].recon_hash = hash;
	} else {
		manifest[url].path = relativePath;
		manifest[url].hash = hash;
	}

	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
	return absolutePath;
}

// Subcommands Handlers
async function handleRecon(url: string, customSourceId?: string) {
	if (refuseSiFandom(url)) return null;
	console.log(`[*] Harvesting Markdown through Aphrody Web: ${url}`);
	let markdown: string;
	try {
		markdown = await aphrodyWebScrape(url, { profile: profile as "static" | "http" | "fast" | "stealth" | "max" });
	} catch (error) {
		console.error(`[-] Aphrody Web scrape failed for ${url}: ${error instanceof Error ? error.message : String(error)}`);
		return null;
	}
	if (markdown.length < 50) {
		console.error(`[-] Aphrody Web returned too little Markdown for ${url}`);
		return null;
	}

	const savedPath = saveHarvestedDoc(url, markdown, customSourceId, "md");
	console.log(`[+] Successfully saved markdown: ${url} -> ${savedPath}`);

	console.log(`[*] Running Aphrody Web reconnaissance: ${url}`);
	try {
		const report = await aphrodyWebRecon(url, { profile: profile as "static" | "http" | "fast" | "stealth" | "max" });
		const savedReconPath = saveHarvestedDoc(url, JSON.stringify(report, null, 2), customSourceId, "recon.md");
		console.log(`[+] Successfully saved recon report: ${url} -> ${savedReconPath}`);
	} catch (error) {
		console.warn(`Aphrody Web recon failed; skipping report: ${error instanceof Error ? error.message : String(error)}`);
	}

	return savedPath;
}

async function handleScrape(url: string, selector?: string, customSourceId?: string) {
	if (refuseSiFandom(url)) return null;
	console.log(`[*] Harvesting URL via Aphrody Web scrape: ${url} (selector: ${selector || "markdown"})`);
	let stdout: string;
	try {
		stdout = await aphrodyWebScrape(url, {
			profile: profile as "static" | "http" | "fast" | "stealth" | "max",
			...(selector ? { selector } : {}),
		});
	} catch (error) {
		console.error(`[-] Aphrody Web scrape failed: ${error instanceof Error ? error.message : String(error)}`);
		return null;
	}

	const ext = selector && isJson ? "json" : selector ? "txt" : "md";
	const savedPath = saveHarvestedDoc(url, stdout, customSourceId, ext);
	console.log(`[+] Successfully scraped: ${url} -> ${savedPath}`);
	return savedPath;
}

async function handleMirror(url: string) {
	if (refuseSiFandom(url)) return null;
	const meta = lookupSourceMeta(url);
	const sourceId = sourceIdOpt || meta.sourceId;
	const outDir = `${outputDir}/${sourceId}/mirror`;
	mkdirSync(outDir, { recursive: true });

	console.log(`[*] Mirroring site via the BXC compatibility adapter: ${url} -> ${outDir}`);

	const cmdArgs = [url, outDir];
	if (isRecursive) {
		cmdArgs.push("--recursive");
		cmdArgs.push("--max-pages", String(maxPages));
		cmdArgs.push("--max-depth", String(maxDepth));
		cmdArgs.push("--delay-ms", String(delayMs));
	}

	const { code, stderr } = await execBxc("mirror", cmdArgs, { proxy, profile });

	if (code !== 0) {
		console.error(`[-] Error mirroring ${url}: bxc exited with code ${code}. Stderr: ${stderr}`);
		return null;
	}

	console.log(`[+] Successfully mirrored: ${url} to ${outDir}`);
	return outDir;
}

async function handleSearch(query: string) {
	console.log(`[*] Searching Web through Aphrody: "${query}"`);
	let result: unknown;
	try {
		result = await aphrodyWebSearch(query, { language: "fr", region: "FR" });
	} catch (error) {
		console.error(`[-] Aphrody Web search failed for "${query}": ${error instanceof Error ? error.message : String(error)}`);
		return null;
	}
	const stdout = isJson ? JSON.stringify(result, null, 2) : searchMarkdown(result);

	const querySlug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-");
	const ext = isJson ? "json" : "md";
	const relativePath = `search/${querySlug}.${ext}`;
	const absolutePath = `${outputDir}/${relativePath}`;

	mkdirSync(`${outputDir}/search`, { recursive: true });
	writeFileSync(absolutePath, stdout);

	console.log(`[+] Search results saved to: ${absolutePath}`);

	console.log("\n--- Search Results Preview ---");
	console.log(stdout.substring(0, 1000));
	if (stdout.length > 1000) console.log("... [truncated]");
	console.log("------------------------------\n");

	return absolutePath;
}

async function handleCrawlWorker(initialUrls: string[]) {
	console.log(`[*] Running bounded Aphrody Web crawl (${queueName})...`);
	if (!initialUrls.length) throw new Error("crawl-worker requires at least one URL");
	const report = await aphrodyWebCrawl({
		urls: initialUrls,
		...(allowedDomains ? { allowedDomains: allowedDomains.split(",").map((domain) => domain.trim()).filter(Boolean) } : {}),
		maxDepth,
		maxRequests: maxPages,
		maxConcurrency: 2,
		perHostDelayMs: delayMs,
		sqlite: `${process.env.APHRODY_HOME || `${homedir()}/.aphrody`}/workspaces/dbfr/crawl/frontier/${queueName}.sqlite`,
	});
	console.log(`[*] Aphrody Web crawl finished: ${report.pages.length} pages, ${report.attempts} requests, ${report.errors.length} errors`);
}

function searchMarkdown(value: unknown): string {
	const result = value as { content?: { organic?: Array<{ position?: number; title?: string; url?: string; snippet?: string }>; corrected_query?: string } };
	const organic = result.content?.organic ?? [];
	return [
		`# Search results${result.content?.corrected_query ? `: ${result.content.corrected_query}` : ""}`,
		"",
		...organic.flatMap((hit) => [`${hit.position ?? "-"}. [${hit.title ?? hit.url ?? "Result"}](${hit.url ?? ""})`, ...(hit.snippet ? [`   ${hit.snippet}`] : []), ""]),
	].join("\n");
}

async function handleRunSeeds() {
	console.log(`[*] Running RAG harvesting on seeds...`);
	const allSeeds = [...dbSources.filter((s) => s.url.startsWith("http")), ...SEEDS];

	const seenUrls = new Set<string>();
	const uniqueSeeds = [];
	for (const s of allSeeds) {
		if (!seenUrls.has(s.url)) {
			seenUrls.add(s.url);
			uniqueSeeds.push(s);
		}
	}

	console.log(`[*] Found ${uniqueSeeds.length} unique seeds to harvest.`);

	let successCount = 0;
	for (let i = 0; i < uniqueSeeds.length; i++) {
		const s = uniqueSeeds[i];
		console.log(`\n[*] [${i + 1}/${uniqueSeeds.length}] Processing ${s.name} (${s.url})`);

		if (i > 0 && delayMs > 0) {
			console.log(`[*] Sleeping for ${delayMs}ms (rate-limiting)...`);
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}

		const path = await handleRecon(s.url, s.id);
		if (path) {
			successCount++;
		}
	}

	console.log(
		`\n[+] Harvesting completed: ${successCount}/${uniqueSeeds.length} seeds harvested successfully.`
	);
}

function printHelpAndExit() {
	console.log(`
rag-harvest.ts — Dragon Ball RAG Data Harvester (Aphrody Web)

Usage:
  bun apps/shenron/bot/scripts/rag-harvest.ts <subcommand> [options]

Subcommands:
  recon <url>            Harvest Markdown and structural report through Aphrody Web
  scrape <url>           Extract content using Aphrody Web (CSS selector or Markdown)
  mirror <url>           Download a complete site locally using the BXC compatibility path
  search <query>         Query Google Search through Aphrody Web
  crawl-worker [urls]    Run a bounded persistent Aphrody Web crawl
  run-seeds              Harvest all seeds from db_sources and pre-configured links

Options:
  --profile <name>       Stealth profile (static | fast | http | stealth | max) [default: max]
  --proxy <url>          Use HTTP/Socks5 proxy for the BXC mirror compatibility path
  --delay <ms>           Rate-limiting delay between requests in milliseconds [default: 1000]
  --source-id <id>       Override source ID (for folders and manifest) [default: derived from hostname]
  --output-dir <dir>     Output base directory [default: apps/shenron/bot/data/rag/raw/]
  --selector <css>       CSS selector for scrape command
  --json                 Request JSON output where applicable (search/scrape)
  --markdown             Request Markdown output where applicable (scrape)
  --recursive            Enable recursive crawling (mirror)
  --max-pages <N>        Maximum pages to crawl (mirror) [default: 10]
  --max-depth <N>        Maximum crawl depth (mirror/crawl-worker) [default: 3]
  --allowed-domains <d>  Comma-separated domains to restrict crawling (crawl-worker)
  --queue <name>         Crawl worker queue name [default: rag-harvest-queue]

Examples:
  bun apps/shenron/bot/scripts/rag-harvest.ts recon https://www.kanzenshuu.com/guides/
  bun apps/shenron/bot/scripts/rag-harvest.ts scrape https://www.kanzenshuu.com/manga/db/ --selector "main"
  bun apps/shenron/bot/scripts/rag-harvest.ts search "Dragon Ball canon timeline" --json
  bun apps/shenron/bot/scripts/rag-harvest.ts run-seeds --delay 2000
`);
	process.exit(1);
}

// Main Runner
async function main() {
	switch (subcommand) {
		case "recon":
			if (positional.length === 0) {
				console.error("[-] Error: 'recon' requires a target URL.");
				printHelpAndExit();
			}
			await handleRecon(positional[0], sourceIdOpt);
			break;

		case "scrape":
			if (positional.length === 0) {
				console.error("[-] Error: 'scrape' requires a target URL.");
				printHelpAndExit();
			}
			await handleScrape(positional[0], selector, sourceIdOpt);
			break;

		case "mirror":
			if (positional.length === 0) {
				console.error("[-] Error: 'mirror' requires a target URL.");
				printHelpAndExit();
			}
			await handleMirror(positional[0]);
			break;

		case "search":
			if (positional.length === 0) {
				console.error("[-] Error: 'search' requires a query string.");
				printHelpAndExit();
			}
			await handleSearch(positional.join(" "));
			break;

		case "crawl-worker":
			await handleCrawlWorker(positional);
			break;

		case "run-seeds":
			await handleRunSeeds();
			break;

		default:
			console.error(`[-] Error: Unknown subcommand '${subcommand}'`);
			printHelpAndExit();
	}
}

main().catch((e) => {
	console.error("[-] Execution failed:", e);
	process.exit(1);
});
