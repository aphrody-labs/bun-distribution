#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { ensureCrawlMarkdown } from "../src/crawler/markdown-fallback.ts";

type CrawlRow = {
	id: number;
	url: string;
	status: number | null;
	content: string | null;
	markdown: string | null;
	metadata: string | null;
	json_data: string | null;
};

function jsonObject(raw: string | null): Record<string, unknown> {
	if (!raw) return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nestedString(object: Record<string, unknown>, key: string, field: string): string | null {
	const nested = object[key];
	return nested && typeof nested === "object" && !Array.isArray(nested)
		? stringValue((nested as Record<string, unknown>)[field])
		: null;
}

function sourceTitle(row: CrawlRow, metadata: Record<string, unknown>, structured: Record<string, unknown>): string {
	const explicit =
		stringValue(metadata.title) ??
		nestedString(structured, "openGraph", "title") ??
		nestedString(structured, "openGraph", "site_name") ??
		nestedString(structured, "twitter", "title");
	if (explicit) return explicit;
	try {
		return new URL(row.url).hostname || "Crawled source";
	} catch {
		return "Crawled source";
	}
}

const apply = process.argv.includes("--apply");
const paths = process.argv.slice(2).filter((arg) => arg !== "--apply");
if (paths.length === 0) {
	throw new Error("Usage: bun scripts/backfill-empty-markdown.ts [--apply] <bxc.sqlite...>");
}

for (const path of paths) {
	const database = apply ? new Database(path) : new Database(path, { readonly: true });
	const rows = database
		.query<CrawlRow, []>(
			"SELECT id, url, status, content, markdown, metadata, json_data FROM scrapes WHERE status BETWEEN 200 AND 299 AND length(trim(coalesce(markdown, ''))) < 50",
		)
		.all();
	let candidates = 0;
	let changed = 0;
	const update = apply ? database.query("UPDATE scrapes SET markdown = ? WHERE id = ?") : null;
	for (const row of rows) {
		const metadata = jsonObject(row.metadata);
		const structured = jsonObject(row.json_data);
		const title = sourceTitle(row, metadata, structured);
		const description = stringValue(structured.description);
		const markdown = ensureCrawlMarkdown({
			html: row.content ?? "",
			markdown: row.markdown ?? "",
			title,
			description,
			url: row.url,
		});
		if (!markdown.trim()) continue;
		candidates++;
		if (markdown === row.markdown) continue;
		changed++;
		if (update) update.run(markdown, row.id);
	}
	database.close();
	console.log(JSON.stringify({ path, apply, scanned: rows.length, candidates, changed }));
}
