#!/usr/bin/env bun
/**
 * rag-harvest.ts — Orchestre la récolte (harvesting) de données Dragon Ball
 * canon via bxc (recon, scrape, mirror, search, crawl-worker).
 * Extrait du markdown brut, normalise, et versionne dans data/rag/raw/.
 *
 * Usage : bun apps/shenron/bot/scripts/rag-harvest.ts <subcommand> [options]
 */
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
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

// Execute bxc command helper
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
	console.log(`[*] Harvesting markdown content via bxc scrape: ${url}`);

	const scrapeRes = await execBxc("scrape", [url, "--markdown", "--profile", profile], { proxy });

	if (scrapeRes.code !== 0 || scrapeRes.stdout.length < 50) {
		console.error(
			`[-] Error scraping markdown for ${url}: bxc scrape exited with code ${scrapeRes.code}. Stderr: ${scrapeRes.stderr}`
		);
		return null;
	}

	const savedPath = saveHarvestedDoc(url, scrapeRes.stdout, customSourceId, "md");
	console.log(`[+] Successfully saved markdown: ${url} -> ${savedPath}`);

	// Now run bxc recon to get the structural/recon report
	console.log(`[*] Running bxc recon (structural report): ${url}`);
	const reconRes = await execBxc("recon", [url, "--profile", profile], { proxy });
	if (reconRes.code === 0 && reconRes.stdout.length >= 50) {
		const savedReconPath = saveHarvestedDoc(url, reconRes.stdout, customSourceId, "recon.md");
		console.log(`[+] Successfully saved recon report: ${url} -> ${savedReconPath}`);
	} else {
		console.warn(
			`[!] bxc recon failed or returned empty: code ${reconRes.code}. Skipping recon report.`
		);
	}

	return savedPath;
}

async function handleScrape(url: string, selector?: string, customSourceId?: string) {
	if (refuseSiFandom(url)) return null;
	console.log(`[*] Harvesting URL via bxc scrape: ${url} (selector: ${selector || "markdown"})`);

	const cmdArgs = [url];
	if (selector) {
		cmdArgs.push(selector);
		if (isJson) cmdArgs.push("--json");
	} else {
		cmdArgs.push("--markdown");
	}

	const { code, stdout, stderr } = await execBxc("scrape", cmdArgs, { proxy, profile });

	if (code !== 0) {
		console.error(`[-] Error scraping ${url}: bxc exited with code ${code}. Stderr: ${stderr}`);
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

	console.log(`[*] Mirroring site via bxc mirror: ${url} -> ${outDir}`);

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
	console.log(`[*] Searching Web via bxc search: "${query}"`);

	const cmdArgs = [query];
	if (isJson) {
		cmdArgs.push("--json");
	} else {
		cmdArgs.push("--markdown");
	}

	const { code, stdout, stderr } = await execBxc("search", cmdArgs, { proxy });

	if (code !== 0) {
		console.error(
			`[-] Error searching for "${query}": bxc exited with code ${code}. Stderr: ${stderr}`
		);
		return null;
	}

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
	console.log(`[*] Running bxc crawl-worker...`);

	const cmdArgs = ["--no-daemon"];
	if (allowedDomains) {
		cmdArgs.push("--allowed-domains", allowedDomains);
	}
	if (maxDepth) {
		cmdArgs.push("--max-depth", String(maxDepth));
	}
	if (queueName) {
		cmdArgs.push("--queue", queueName);
	}
	if (proxy) {
		cmdArgs.push("--proxy-pool", proxy);
	}
	cmdArgs.push(...initialUrls);

	console.log(`[*] Executing: bxc crawl-worker ${cmdArgs.join(" ")}`);

	const cmd = await bxcCommand();
	cmd.push("crawl-worker", ...cmdArgs);

	const proc = Bun.spawn(cmd, {
		stdout: "inherit",
		stderr: "inherit",
	});

	const code = await proc.exited;
	console.log(`[*] Crawl-worker exited with code ${code}`);
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
rag-harvest.ts — Dragon Ball RAG Data Harvester (bxc engine)

Usage:
  bun apps/shenron/bot/scripts/rag-harvest.ts <subcommand> [options]

Subcommands:
  recon <url>            Harvest a single URL using 'bxc recon' (or fallback 'bxc scrape --markdown')
  scrape <url>           Extract content using 'bxc scrape' (uses CSS selector or --markdown)
  mirror <url>           Download a complete site locally using 'bxc mirror'
  search <query>         Query Google Search and save results using 'bxc search'
  crawl-worker [urls]    Start a crawl worker using 'bxc crawl-worker'
  run-seeds              Harvest all seeds from db_sources and pre-configured links

Options:
  --profile <name>       Stealth profile (static | fast | http | stealth | max) [default: max]
  --proxy <url>          Use HTTP/Socks5 proxy for requests
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
