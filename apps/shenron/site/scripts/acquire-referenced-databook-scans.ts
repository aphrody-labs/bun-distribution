#!/usr/bin/env bun
/**
 * Downloads referenced databook scans through BXC's browser-fingerprinted
 * HTTP client. BXC's FFI client blocks its JS thread while curl runs, so the
 * coordinator uses a bounded number of Bun child processes for real parallelism.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import sharp from "sharp";
import { SITE_URL } from "../src/lib/config";
import { parseReferencedDatabookScan, referencedScanBasename } from "../src/lib/referenced-databook-scan";

const args = process.argv.slice(2);
const value = (name: string) => {
	const index = args.indexOf(`--${name}`);
	return index < 0 ? undefined : args[index + 1];
};
const integer = (name: string, fallback: number) => {
	const raw = value(name);
	if (raw === undefined) return fallback;
	const parsed = Number(raw);
	if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`--${name} doit être un entier positif.`);
	return parsed;
};
const bookId = integer("databook", 0);
const limit = integer("limit", 0);
const concurrency = integer("concurrency", 4);
const retries = integer("retries", 3);
const directUrl = value("fetch"); // Internal child-process mode.
const directPage = integer("page", 0);
if (!bookId) throw new Error("--databook <id> est requis.");
if (!concurrency || concurrency > 8) throw new Error("--concurrency doit être entre 1 et 8.");
if (!retries || retries > 8) throw new Error("--retries doit être entre 1 et 8.");

const MAX_BYTES = 25_000_000;
const MIN_EDGE = 160;
/** The BXC FFI timeout is not guaranteed to interrupt a stalled TLS read. */
const CHILD_TIMEOUT_MS = 75_000;
const destination = join(import.meta.dir, "..", "public", "wiki", "databooks");
const bxcRoot = process.env.BXC_ROOT?.trim() || resolve(import.meta.dir, "..", "..", "..", "..", "aphrody-web", "apps", "bxc");
const { ImpersonatedClient } = await import(join(bxcRoot, "src", "ffi", "curl-impersonate.ts"));

type Page = { number?: number; image?: string | null; text?: string | null };
type Databook = { id: number; pages?: Page[] };
type Result = { page: number; name: string; status: "acquired" | "skipped"; width?: number; height?: number; bytes?: number };

const sleep = (milliseconds: number) => new Promise((done) => setTimeout(done, milliseconds));
const isRetryable = (error: unknown) => /HTTP (?:408|425|429|5\d\d)\b|timed? out|curl_easy_perform/i.test(String(error));

async function validate(bytes: Uint8Array, page: number) {
	if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) throw new Error(`Planche ${page}: taille invalide (${bytes.byteLength}).`);
	const metadata = await sharp(bytes, { failOn: "error", limitInputPixels: false }).metadata();
	if (!metadata.width || !metadata.height || metadata.width < MIN_EDGE || metadata.height < MIN_EDGE || !["jpeg", "png", "webp"].includes(metadata.format ?? "")) {
		throw new Error(`Planche ${page}: image invalide (${metadata.format ?? "inconnu"}, ${metadata.width ?? 0}x${metadata.height ?? 0}).`);
	}
	return metadata;
}

async function existingImage(target: string) {
	if (!existsSync(target)) return false;
	try {
		const info = await sharp(target, { failOn: "error", limitInputPixels: false }).metadata();
		return !!info.width && !!info.height && info.width >= MIN_EDGE && info.height >= MIN_EDGE;
	} catch {
		return false;
	}
}

async function acquireOne(page: number, url: URL): Promise<Result> {
	const name = referencedScanBasename(url.href) ?? basename(url.pathname);
	const target = join(destination, name);
	await mkdir(destination, { recursive: true });
	if (await existingImage(target)) return { page, name, status: "skipped" };
	const client = new ImpersonatedClient({ profile: "chrome131", httpVersion: "1.1", followRedirects: false, timeoutMs: 120_000 });
	try {
		let lastError: unknown;
		for (let attempt = 1; attempt <= retries; attempt++) {
			try {
				const image = await client.fetch(url.href, {
					headers: { Referer: `${url.origin}/`, Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8", "Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7" },
					httpVersion: "1.1", followRedirects: false, timeoutMs: 120_000,
				});
				if (!image.ok) throw new Error(`Planche ${page}: HTTP ${image.status}`);
				const bytes = new Uint8Array(await image.arrayBuffer());
				const metadata = await validate(bytes, page);
				const temporary = `${target}.part-${process.pid}-${randomUUID()}`;
				try {
					await writeFile(temporary, bytes, { flag: "wx" });
					await rename(temporary, target);
				} catch (error) {
					await unlink(temporary).catch(() => undefined);
					throw error;
				}
				return { page, name, status: "acquired", width: metadata.width, height: metadata.height, bytes: bytes.byteLength };
			} catch (error) {
				lastError = error;
				if (attempt === retries || !isRetryable(error)) break;
				await sleep(500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
			}
		}
		throw lastError;
	} finally {
		client.close();
	}
}

async function runChild() {
	const url = directUrl ? parseReferencedDatabookScan(directUrl) : null;
	if (!url || !directPage) throw new Error("Mode interne invalide.");
	console.log(JSON.stringify(await acquireOne(directPage, url)));
}

async function childResult(page: Page, url: URL): Promise<Result> {
	const proc = Bun.spawn([process.execPath, import.meta.path, "--databook", String(bookId), "--fetch", url.href, "--page", String(page.number ?? 0), "--retries", String(retries), "--concurrency", "1"], { stdout: "pipe", stderr: "pipe" });
	let timedOut = false;
	const watchdog = setTimeout(() => {
		timedOut = true;
		proc.kill();
	}, CHILD_TIMEOUT_MS);
	const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
	clearTimeout(watchdog);
	if (timedOut) throw new Error(`Planche ${page.number ?? "?"}: délai BXC dépassé (${CHILD_TIMEOUT_MS / 1000} s).`);
	if (exitCode !== 0) throw new Error(stderr.trim() || stdout.trim() || `Planche ${page.number ?? "?"}: processus BXC arrêté (${exitCode}).`);
	try { return JSON.parse(stdout.trim()) as Result; }
	catch { throw new Error(`Planche ${page.number ?? "?"}: réponse worker invalide: ${stdout.trim().slice(0, 300)}`); }
}

async function runCoordinator() {
	const apiClient = new ImpersonatedClient({ profile: "chrome131", httpVersion: "1.1", followRedirects: false, timeoutMs: 120_000 });
	let book: Databook;
	try {
		const response = await apiClient.fetch(`${SITE_URL}/api/databooks/${bookId}`, { headers: { Accept: "application/json" } });
		if (!response.ok) throw new Error(`API databook ${bookId}: HTTP ${response.status}`);
		book = (await response.json()) as Databook;
	} finally { apiClient.close(); }
	if (!Array.isArray(book.pages)) throw new Error(`Databook ${bookId}: pages invalides.`);
	const seen = new Set<string>();
	const pending = book.pages
		.filter((page) => !page.text?.trim())
		.map((page) => ({ page, url: parseReferencedDatabookScan(page.image ?? "") }))
		.filter((entry): entry is { page: Page; url: URL } => entry.url !== null)
		.filter(({ url }) => {
			const name = referencedScanBasename(url.href) ?? basename(url.pathname);
			if (seen.has(name)) return false;
			seen.add(name);
			return true;
		});
	const work = limit ? pending.slice(0, limit) : pending;
	let cursor = 0, acquired = 0, skipped = 0;
	const failures: string[] = [];
	const worker = async () => {
		while (cursor < work.length) {
			const entry = work[cursor++];
			try {
				const result = await childResult(entry.page, entry.url);
				if (result.status === "acquired") acquired++; else skipped++;
				console.log(`${result.page}\t${result.status}\t${result.name}${result.width ? `\t${result.width}x${result.height}\t${result.bytes}` : ""}`);
			} catch (error) {
				const message = `${entry.page.number ?? "?"}: ${error instanceof Error ? error.message : String(error)}`;
				failures.push(message); console.error(`✗ ${message}`);
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, work.length) }, worker));
	console.log(JSON.stringify({ databook: bookId, candidates: pending.length, selected: work.length, acquired, skipped, failed: failures.length }));
	if (failures.length) process.exitCode = 1;
}

if (directUrl) await runChild();
else await runCoordinator();
