#!/usr/bin/env bun
/**
 * Backfill / sync des posts Patreon dans `public.patreon_post_events`.
 *
 * - Source de vérité : webhook posts:publish/update/delete (trigger=publish/update/delete)
 * - Ce script : trigger='backfill' pour remplir l'historique pré-webhook
 * - Idempotent : ON CONFLICT (patreon_post_id) DO UPDATE
 *
 * Usage : bun scripts/patreon-posts-sync.ts [--limit N] [--dry-run]
 */

import { createPostgresClient } from "@rosegriffon/db/service";

const PATREON_API = "https://www.patreon.com/api/oauth2/v2";

interface PatreonPost {
	id: string;
	type: "post";
	attributes: {
		title: string | null;
		content: string | null;
		url: string | null;
		embed_url: string | null;
		embed_data: Record<string, unknown> | null;
		published_at: string | null;
		is_paid: boolean | null;
		is_public: boolean | null;
	};
}

interface PostsResponse {
	data: PatreonPost[];
	meta: {
		pagination: {
			total: number;
			cursors?: { next?: string | null };
		};
	};
}

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number.parseInt(limitArg.split("=")[1] || "0", 10) : null;

const TOKEN = process.env.PATREON_CREATOR_ACCESS_TOKEN ?? process.env.PATREON_ACCESS_TOKEN;
const CAMPAIGN_ID = process.env.PATREON_CAMPAIGN_ID;

if (!TOKEN) throw new Error("PATREON_CREATOR_ACCESS_TOKEN manquant");
if (!CAMPAIGN_ID) throw new Error("PATREON_CAMPAIGN_ID manquant");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL manquante");
const db = createPostgresClient();

function stripHtml(html: string | null, max = 500): string | null {
	if (!html) return null;
	const text = html
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, " ")
		.trim();
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function absoluteUrl(path: string | null): string | null {
	if (!path) return null;
	if (path.startsWith("http://") || path.startsWith("https://")) return path;
	return `https://www.patreon.com${path.startsWith("/") ? "" : "/"}${path}`;
}

async function fetchPage(cursor: string | null): Promise<PostsResponse> {
	const params = new URLSearchParams({
		"fields[post]": "title,content,url,embed_url,embed_data,published_at,is_paid,is_public",
		"page[size]": "20",
	});
	if (cursor) params.set("page[cursor]", cursor);
	const url = `${PATREON_API}/campaigns/${CAMPAIGN_ID}/posts?${params}`;
	const res = await fetch(url, {
		headers: { Authorization: `Bearer ${TOKEN}` },
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Patreon API ${res.status}: ${body}`);
	}
	return res.json() as Promise<PostsResponse>;
}

async function upsertBatch(posts: PatreonPost[]): Promise<void> {
	const rows = posts.map((p) => ({
		patreon_post_id: p.id,
		campaign_id: CAMPAIGN_ID,
		trigger: "backfill",
		title: p.attributes.title,
		content_excerpt: stripHtml(p.attributes.content),
		url: absoluteUrl(p.attributes.url),
		published_at: p.attributes.published_at,
		is_paid: p.attributes.is_paid,
		is_public: p.attributes.is_public,
		embed_url: p.attributes.embed_url,
		embed_data: p.attributes.embed_data,
		raw_payload: p,
	}));

	if (dryRun) {
		console.log(`[dry-run] ${rows.length} rows → ${rows.map((r) => r.patreon_post_id).join(", ")}`);
		return;
	}

	const { error } = await db
		.from("patreon_post_events")
		.upsert(rows, { onConflict: "patreon_post_id", ignoreDuplicates: false });
	if (error) throw error;
}

async function main() {
	const start = Date.now();
	console.log(`[patreon-posts-sync] campaign=${CAMPAIGN_ID} dry=${dryRun} limit=${limit ?? "∞"}`);

	let cursor: string | null = null;
	let total = 0;
	let pages = 0;
	let reportedTotal: number | null = null;

	while (true) {
		const page: PostsResponse = await fetchPage(cursor);
		pages += 1;
		reportedTotal = page.meta.pagination.total;

		const batch = limit ? page.data.slice(0, Math.max(0, limit - total)) : page.data;
		if (batch.length === 0) break;

		await upsertBatch(batch);
		total += batch.length;
		console.log(`[page ${pages}] +${batch.length} → ${total}/${reportedTotal ?? "?"}`);

		if (limit && total >= limit) break;
		cursor = page.meta.pagination.cursors?.next ?? null;
		if (!cursor) break;
	}

	const ms = Date.now() - start;
	console.log(
		`[done] ${total} posts ${dryRun ? "scanned" : "upserted"} in ${pages} pages · ${ms}ms`
	);
}

await main();
