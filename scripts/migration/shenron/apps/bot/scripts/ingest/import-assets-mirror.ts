#!/usr/bin/env bun
/**
 * import-assets-mirror — copie reference/db-recon/assets/ → apps/bot/public/db/
 * et peuple db_assets avec sha256 + bytes + source + license + attribution.
 * Idempotent : skip si path déjà présent (basé sur sha256).
 */
import { db } from "./_db";
import { dbAssets } from "../../src/db/schema";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, mkdirSync, copyFileSync } from "node:fs";
import { join, extname, relative } from "node:path";

const REF = new URL("../../../../reference/db-recon/assets", import.meta.url).pathname;
const DEST = new URL("../../public/db", import.meta.url).pathname;

// Mapping bucket → {source, license, attribution}
const BUCKETS: Record<
	string,
	{
		source: string;
		license: string;
		attribution: string;
		entityType?: string;
		role?: string;
	}
> = {
	characters: {
		source: "dragonball-api",
		license: "MIT",
		attribution: "dragonball-api.com (OSS MIT)",
		entityType: "character",
		role: "thumbnail",
	},
	planets: {
		source: "dragonball-api",
		license: "MIT",
		attribution: "dragonball-api.com (OSS MIT)",
		entityType: "planet",
		role: "thumbnail",
	},
	transformations: {
		source: "dragonball-api",
		license: "MIT",
		attribution: "dragonball-api.com (OSS MIT)",
		entityType: "transformation",
		role: "thumbnail",
	},
	"anime-posters": {
		source: "anilist",
		license: "API-PUBLIC",
		attribution: "AniList + MyAnimeList via Jikan",
		entityType: "anime",
		role: "poster",
	},
	kitsu: {
		source: "kitsu",
		license: "API-PUBLIC",
		attribution: "Kitsu.io",
		entityType: "anime",
		role: "poster",
	},
	bandai: {
		source: "bandai-eu",
		license: "FAIR-USE-EDITORIAL",
		attribution: "© Bandai Namco Entertainment",
		entityType: "game",
		role: "banner",
	},
	toei: {
		source: "toei-animation",
		license: "FAIR-USE-EDITORIAL",
		attribution: "© Toei Animation",
		role: "banner",
	},
	dbofficial: {
		source: "dbofficial-fr",
		license: "FAIR-USE-EDITORIAL",
		attribution: "© Bird Studio / Shueisha / Toei Animation",
		role: "banner",
	},
	shueisha: {
		source: "shueisha",
		license: "FAIR-USE-EDITORIAL",
		attribution: "© Shueisha",
		role: "banner",
	},
	shonenjump: {
		source: "shonenjump-plus",
		license: "FAIR-USE-EDITORIAL",
		attribution: "© Shueisha — Shōnen Jump+",
		role: "still",
	},
	viz: {
		source: "viz-media",
		license: "FAIR-USE-EDITORIAL",
		attribution: "© Viz Media / Shueisha",
		role: "still",
	},
	kanzenshuu: {
		source: "kanzenshuu",
		license: "FAIR-USE-EDITORIAL",
		attribution: "© Kanzenshuu",
		role: "still",
	},
};

const MIME: Record<string, string> = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp",
	".gif": "image/gif",
	".avif": "image/avif",
	".svg": "image/svg+xml",
};

let imported = 0;
let skipped = 0;
let errored = 0;

for (const bucket of Object.keys(BUCKETS)) {
	const srcDir = join(REF, bucket);
	const dstDir = join(DEST, bucket);
	try {
		mkdirSync(dstDir, { recursive: true });
	} catch {}

	const meta = BUCKETS[bucket]!;
	let files: string[] = [];
	try {
		files = readdirSync(srcDir);
	} catch {
		console.warn(`  skip ${bucket} : no source dir`);
		continue;
	}

	for (const f of files) {
		const srcPath = join(srcDir, f);
		const dstPath = join(dstDir, f);
		const relPath = relative(DEST, dstPath); // ex: "characters/Goku.webp"
		const ext = extname(f).toLowerCase();
		if (!(ext in MIME)) {
			continue;
		}
		try {
			const stat = statSync(srcPath);
			if (stat.size === 0) {
				skipped++;
				continue;
			}
			const buf = readFileSync(srcPath);
			const sha = createHash("sha256").update(buf).digest("hex");

			const existing = await db.select().from(dbAssets).where(eq(dbAssets.path, relPath)).limit(1);
			if (existing.length > 0) {
				skipped++;
				continue;
			}

			copyFileSync(srcPath, dstPath);

			await db.insert(dbAssets).values({
				path: relPath,
				sourceId: meta.source,
				sourceUrl: null,
				licenseKey: meta.license,
				attribution: meta.attribution,
				sha256: sha,
				mimeType: MIME[ext] ?? null,
				bytes: stat.size,
				width: null,
				height: null,
				entityType: meta.entityType ?? null,
				entityId: null,
				role: meta.role ?? null,
			});
			imported++;
		} catch (e) {
			errored++;
			console.error(`  err ${bucket}/${f}:`, e instanceof Error ? e.message : e);
		}
	}
	console.log(`  ${bucket} : importés=${imported - errored} (skipped=${skipped}, err=${errored})`);
}

console.log(`\nDONE : imported=${imported}, skipped=${skipped}, errored=${errored}`);
console.log(`Total db_assets rows : ${(await db.select().from(dbAssets)).length}`);
