#!/usr/bin/env bun
/**
 * Remote half of `traduire-pages-collectees-aphrody.ts`: runs ON the
 * application host (ssh `vps`), next to Aphrody Web (`127.0.0.1:3007`) and the
 * `aphrody` CLI, copied into a scratch directory together with
 * `_collected-page-translation.ts`.
 *
 * For each candidate page (JSONL, one `RemoteInput` per line):
 *   1. re-extracts the main article text of its origin URL through Aphrody Web
 *      (`POST /api/v1/scrape`, raw HTML → `extractMainContent`), except for
 *      jimaku.cc file lists, which carry no prose;
 *   2. translates the title and, when there is one, the excerpt EN→FR with
 *      `aphrody translate -b bxc`, the excerpt in pieces of ≤ 450 characters
 *      (`translationChunks`: longer inputs are echoed back untranslated, and
 *      Japanese paragraphs are kept verbatim);
 *   3. validates every translation (`checkTranslation`): an output identical
 *      to its input is a silent backend failure, retried, never kept.
 *
 * Results are appended to the output JSONL as they complete, so an interrupted
 * run resumes where it stopped. A `<output>.done` marker is written at the end.
 *
 * Environment: `BXC_API_TOKEN` (read by the launcher from the host's env file,
 * never printed), optional `APHRODY_BIN`, `APHRODY_WEB_URL`.
 *
 * Usage (on the host): bun _aphrody-translate-remote.ts --entree in.jsonl --sortie out.jsonl [--concurrence 4]
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { checkTranslation, decodeEntities, extractMainContent, joinChunks, translationChunks, type TranslationCheck } from "./_collected-page-translation.ts";

export type RemoteInput = { id: string; url: string; title: string };

export type RemoteOutput = {
	id: string;
	url: string;
	originalTitle: string;
	frenchTitle: string;
	titleCheck: TranslationCheck;
	/** Clean English excerpt of the origin document ("" when none). */
	excerpt: string;
	translation: string;
	excerptCheck: TranslationCheck | null;
	/** `ok`, `skipped` (jimaku lists), `empty` (no prose found) or `error: …`. */
	scrape: string;
};

const argv = process.argv.slice(2);
const option = (name: string, fallback: string) => {
	const index = argv.indexOf(name);
	return index === -1 ? fallback : (argv[index + 1] ?? fallback);
};
const inputPath = option("--entree", "candidats.jsonl");
const outputPath = option("--sortie", "resultats.jsonl");
const concurrency = Math.max(1, Math.min(12, Number(option("--concurrence", "4")) || 4));
const aphrodyBin = process.env.APHRODY_BIN ?? "/srv/aphrody/current/bin/aphrody";
const webUrl = process.env.APHRODY_WEB_URL ?? "http://127.0.0.1:3007";
const token = process.env.BXC_API_TOKEN ?? "";
if (!token.trim()) throw new Error("BXC_API_TOKEN absent de l'environnement.");

const TITLE_ONLY_HOSTS = new Set(["jimaku.cc"]);
/** Hosts whose pages are server-rendered: a static fetch that yields no prose will not yield more with a browser. */
const STATIC_ONLY_HOSTS = new Set(["kanzenshuu.com", "jimaku.cc"]);

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return "";
	}
}

// ── Aphrody Web scrape ──────────────────────────────────────────────────────────

const scrapeCache = new Map<string, Promise<{ status: number; html: string }>>();

async function scrapeOnce(url: string, profile: "static" | "render"): Promise<{ status: number; html: string }> {
	const response = await fetch(`${webUrl}/api/v1/scrape`, {
		method: "POST",
		headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
		body: JSON.stringify({ url, profile }),
		signal: AbortSignal.timeout(profile === "render" ? 120_000 : 60_000),
	});
	if (!response.ok) throw new Error(`Aphrody Web HTTP ${response.status}`);
	const data = (await response.json()) as { status?: number; content?: string; error?: string };
	if (typeof data.content !== "string") throw new Error(data.error ?? "réponse sans contenu");
	return { status: Number(data.status ?? 0), html: data.content };
}

function scrape(url: string, profile: "static" | "render"): Promise<{ status: number; html: string }> {
	const key = `${profile} ${url.replace(/#.*$/, "")}`;
	let pending = scrapeCache.get(key);
	if (!pending) {
		pending = (async () => {
			let lastError: unknown;
			for (let attempt = 1; attempt <= 2; attempt++) {
				try {
					return await scrapeOnce(url.replace(/#.*$/, ""), profile);
				} catch (error) {
					lastError = error;
					await Bun.sleep(1_500 * attempt);
				}
			}
			throw lastError;
		})();
		scrapeCache.set(key, pending);
	}
	return pending;
}

async function excerptOf(url: string): Promise<{ excerpt: string; scrape: string }> {
	const host = hostOf(url);
	if (TITLE_ONLY_HOSTS.has(host)) return { excerpt: "", scrape: "skipped" };
	try {
		const page = await scrape(url, "static");
		let content = page.status >= 200 && page.status < 400 ? extractMainContent(page.html) : null;
		if ((!content || !content.meaningful) && !STATIC_ONLY_HOSTS.has(host)) {
			const rendered = await scrape(url, "render").catch(() => null);
			if (rendered && rendered.status >= 200 && rendered.status < 400) content = extractMainContent(rendered.html);
		}
		if (!content) return { excerpt: "", scrape: `error: HTTP ${page.status}` };
		return content.meaningful ? { excerpt: content.excerpt, scrape: "ok" } : { excerpt: "", scrape: "empty" };
	} catch (error) {
		return { excerpt: "", scrape: `error: ${error instanceof Error ? error.message : String(error)}` };
	}
}

// ── Aphrody translate (bxc) ─────────────────────────────────────────────────────

/** Text printed after the `Traduction :` line; "" when the CLI printed none. */
function parseTranslateOutput(stdout: string): string {
	const match = /^Traduction :[^\S\n]*\n([\s\S]*)$/m.exec(stdout.replace(/\r\n/g, "\n"));
	return (match?.[1] ?? "").trim();
}

async function translateOnce(text: string): Promise<string> {
	const child = Bun.spawn([aphrodyBin, "translate", "-s", "en", "-t", "fr", "-b", "bxc", text], { stdout: "pipe", stderr: "pipe" });
	const timer = setTimeout(() => child.kill(), 90_000);
	try {
		const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
		if (code !== 0) throw new Error(`aphrody translate code ${code}`);
		return parseTranslateOutput(stdout);
	} finally {
		clearTimeout(timer);
	}
}

async function translate(text: string, options: { properName?: boolean } = {}): Promise<{ text: string; check: TranslationCheck }> {
	let output = "";
	let check: TranslationCheck = { ok: false, reason: "non tenté" };
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			output = await translateOnce(text);
			check = checkTranslation(text, output, options);
		} catch (error) {
			check = { ok: false, reason: error instanceof Error ? error.message : String(error) };
		}
		if (check.ok) break;
		await Bun.sleep(2_000 * attempt * attempt);
	}
	return { text: output, check };
}

/** Excerpt translation, chunk by chunk (see `translationChunks`); fails as a whole when one chunk fails. */
async function translateExcerpt(excerpt: string): Promise<{ text: string; check: TranslationCheck }> {
	const out: { text: string; joiner: string }[] = [];
	for (const chunk of translationChunks(excerpt)) {
		if (!chunk.translate) {
			out.push(chunk);
			continue;
		}
		const piece = await translate(chunk.text, { properName: true });
		if (!piece.check.ok) return { text: "", check: { ok: false, reason: `segment : ${piece.check.reason}` } };
		out.push({ text: piece.text, joiner: chunk.joiner });
	}
	const text = joinChunks(out);
	return { text, check: checkTranslation(excerpt, text) };
}

// ── Run ─────────────────────────────────────────────────────────────────────────

const inputs = readFileSync(inputPath, "utf8")
	.split("\n")
	.filter((line) => line.trim())
	.map((line) => JSON.parse(line) as RemoteInput);
const done = new Set<string>();
if (existsSync(outputPath)) {
	const previous = readFileSync(outputPath, "utf8");
	if (previous && !previous.endsWith("\n")) appendFileSync(outputPath, "\n");
	for (const line of previous.split("\n")) {
		if (!line.trim()) continue;
		try {
			done.add((JSON.parse(line) as RemoteOutput).id);
		} catch {
			// A torn last line from an interrupted run is simply redone.
		}
	}
}
const queue = inputs.filter((input) => !done.has(input.id));
console.log(`[distant] ${inputs.length} candidats, ${done.size} déjà traités, ${queue.length} à traiter (concurrence ${concurrency})`);

let processed = 0;
async function worker(): Promise<void> {
	for (let input = queue.shift(); input; input = queue.shift()) {
		const originalTitle = decodeEntities(input.title).replace(/\s+/g, " ").trim();
		const [{ excerpt, scrape: scrapeState }, title] = await Promise.all([excerptOf(input.url), translate(originalTitle, { properName: true })]);
		const body = excerpt ? await translateExcerpt(excerpt) : null;
		const output: RemoteOutput = {
			id: input.id,
			url: input.url,
			originalTitle,
			frenchTitle: title.text.replace(/\s+/g, " ").trim(),
			titleCheck: title.check,
			excerpt,
			translation: body?.text ?? "",
			excerptCheck: body?.check ?? null,
			scrape: scrapeState,
		};
		appendFileSync(outputPath, `${JSON.stringify(output)}\n`);
		processed++;
		if (processed % 25 === 0) console.log(`[distant] ${processed}/${inputs.length - done.size}`);
	}
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
writeFileSync(`${outputPath}.done`, new Date().toISOString());
console.log(`[distant] terminé : ${processed} traités`);
