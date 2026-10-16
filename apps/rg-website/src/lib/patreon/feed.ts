"use server";

import { createPostgresClient } from "@rosegriffon/db/service";

import { getViewerPatreonAccess } from "./viewer";
import type { PatreonViewerAccess } from "./viewer";

export interface PatreonFeedImage {
	storagePath: string;
	signedUrl: string | null;
	contentType: string | null;
}

export interface PatreonFeedPost {
	id: string;
	title: string | null;
	excerpt: string | null;
	url: string | null;
	publishedAt: string | null;
	isPaid: boolean;
	isPublic: boolean;
	cover: PatreonFeedImage | null;
	images: PatreonFeedImage[];
}

const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Renvoie le fil Patreon visible par le viewer connecté.
 *
 * Règle d'accès :
 * - Visiteur non lié Patreon → liste vide (la section ne s'affiche pas).
 * - Lié Patreon mais pas membre actif → posts publics (`is_public=true`).
 * - Membre actif → tous les posts Patreon archivés.
 *
 * Les images sont stockées dans le bucket privé `patreon`, on génère
 * des signed URLs valides 1h pour le rendu côté client.
 */
export async function getPatreonFeedForViewer(opts?: {
	limit?: number;
}): Promise<{ access: PatreonViewerAccess; posts: PatreonFeedPost[] }> {
	const access = await getViewerPatreonAccess();
	if (!access.linked) {
		return { access, posts: [] };
	}

	const db = createPostgresClient();
	const storage = db.storage;

	const limit = opts?.limit ?? 12;

	let query = db
		.from("patreon_post_events")
		.select("patreon_post_id, title, content_excerpt, url, published_at, is_paid, is_public")
		.order("published_at", { ascending: false, nullsFirst: false })
		.limit(limit);

	if (!access.isActiveMember) {
		query = query.eq("is_public", true);
	}

	const { data: rows, error } = await query;
	if (error || !rows || rows.length === 0) {
		return { access, posts: [] };
	}

	const postIds = rows.map((r: { patreon_post_id: string }) => r.patreon_post_id);
	const { data: imageRows } = await db
		.from("patreon_post_images")
		.select("patreon_post_id, position, storage_path, content_type")
		.in("patreon_post_id", postIds)
		.order("position", { ascending: true });

	const allPaths = (imageRows ?? []).map((r: { storage_path: string }) => r.storage_path);
	const signedUrlMap = new Map<string, string>();
	if (allPaths.length > 0) {
		const { data: signed } = await storage
			.from("patreon")
			.createSignedUrls(allPaths, SIGNED_URL_TTL_SECONDS);
		for (const entry of signed ?? []) {
			if (entry.path && entry.signedUrl) {
				signedUrlMap.set(entry.path, entry.signedUrl);
			}
		}
	}

	const imagesByPost = new Map<string, PatreonFeedImage[]>();
	for (const r of imageRows ?? []) {
		const list = imagesByPost.get(r.patreon_post_id) ?? [];
		list.push({
			contentType: r.content_type,
			signedUrl: signedUrlMap.get(r.storage_path) ?? null,
			storagePath: r.storage_path,
		});
		imagesByPost.set(r.patreon_post_id, list);
	}

	const posts: PatreonFeedPost[] = rows.map((r: {
		patreon_post_id: string;
		content_excerpt: string | null;
		is_paid: boolean | null;
		is_public: boolean | null;
		published_at: string | null;
		title: string | null;
		url: string | null;
	}) => {
		const imgs = imagesByPost.get(r.patreon_post_id) ?? [];
		return {
			cover: imgs[0] ?? null,
			excerpt: r.content_excerpt,
			id: r.patreon_post_id,
			images: imgs,
			isPaid: r.is_paid ?? false,
			isPublic: r.is_public ?? false,
			publishedAt: r.published_at,
			title: r.title,
			url: r.url,
		};
	});

	return { access, posts };
}
