#!/usr/bin/env bun
/**
 * Archive durable des images embarquees dans les posts Patreon.
 *
 * Lit `patreon_post_events.raw_payload.attributes.content` (HTML), parse les <img>,
 * télécharge les fichiers depuis patreonusercontent.com (URLs signées temporaires)
 * et les uploade dans le bucket Storage `patreon` avec un chemin déterministe.
 *
 * Idempotent : UNIQUE (patreon_post_id, sha256) côté DB, upsert côté Storage.
 *
 * Usage : bun scripts/patreon-images-sync.ts [--limit N] [--dry-run] [--force]
 */

import { createPostgresClient } from "@rosegriffon/db/service";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL manquante");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const force = args.has("--force");
const limitArg = process.argv.find(a => a.startsWith("--limit="));
const limit = limitArg ? Number.parseInt(limitArg.split("=")[1] || "0", 10) : null;

const db = createPostgresClient();

const BUCKET = "patreon";
const ALLOWED_HOSTS = new Set(["c10.patreonusercontent.com", "c8.patreonusercontent.com", "c.patreon.com"]);

interface ImgRef {
  postId: string;
  position: number;
  url: string;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractImages(postId: string, html: string | null): ImgRef[] {
  if (!html) return [];
  const out: ImgRef[] = [];
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  let pos = 0;
  while ((m = re.exec(html)) !== null) {
    const url = decodeHtmlEntities(m[1]!);
    try {
      const u = new URL(url);
      if (!ALLOWED_HOSTS.has(u.hostname)) continue;
      out.push({ postId, position: pos++, url });
    } catch {
      // invalid URL, skip
    }
  }
  return out;
}

function extFromContentType(mime: string | null): string {
  if (!mime) return "bin";
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("avif")) return "avif";
  return "bin";
}

async function sha256(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function archiveOne(img: ImgRef): Promise<{
  skipped: boolean;
  reason?: string;
  storage_path?: string;
  sha?: string;
  size?: number;
  mime?: string;
}> {
  if (!force) {
    const { data: existing } = await db
      .from("patreon_post_images")
      .select("id, storage_path, sha256")
      .eq("patreon_post_id", img.postId)
      .eq("original_url", img.url)
      .maybeSingle();
    if (existing) {
      return { skipped: true, reason: "already-archived" };
    }
  }

  const res = await fetch(img.url);
  if (!res.ok) {
    return { skipped: true, reason: `fetch ${res.status}` };
  }
  const mime = res.headers.get("content-type")?.split(";")[0]?.trim() ?? null;
  const buf = await res.arrayBuffer();
  const sha = await sha256(buf);
  const ext = extFromContentType(mime);
  const storage_path = `${img.postId}/${sha}.${ext}`;

  if (dryRun) {
    return {
      skipped: false,
      storage_path,
      sha,
      size: buf.byteLength,
      mime: mime ?? undefined,
    };
  }

  const { error: upErr } = await db.storage.from(BUCKET).upload(storage_path, buf, {
    contentType: mime ?? "application/octet-stream",
    upsert: true,
  });
  if (upErr) {
    return { skipped: true, reason: `storage: ${upErr.message}` };
  }

  const { error: dbErr } = await db.from("patreon_post_images").upsert(
    {
      patreon_post_id: img.postId,
      position: img.position,
      original_url: img.url,
      storage_path,
      content_type: mime,
      size_bytes: buf.byteLength,
      sha256: sha,
    },
    { onConflict: "patreon_post_id,sha256", ignoreDuplicates: false },
  );
  if (dbErr) {
    return { skipped: true, reason: `db: ${dbErr.message}` };
  }

  return {
    skipped: false,
    storage_path,
    sha,
    size: buf.byteLength,
    mime: mime ?? undefined,
  };
}

async function main() {
  const start = Date.now();
  console.log(`[patreon-images-sync] dry=${dryRun} force=${force} limit=${limit ?? "∞"}`);

  const { data: posts, error } = await db
    .from("patreon_post_events")
    .select("patreon_post_id, raw_payload")
    .order("published_at", { ascending: true });
  if (error) throw error;

  const allImages: ImgRef[] = [];
  for (const row of posts ?? []) {
    const html = row.raw_payload?.attributes?.content ?? null;
    allImages.push(...extractImages(row.patreon_post_id, html));
  }

  const slice = limit ? allImages.slice(0, limit) : allImages;
  console.log(`[scan] ${posts?.length} posts → ${allImages.length} images Patreon (${slice.length} dans cette run)`);

  let archived = 0;
  let skipped = 0;
  const failures: Array<{ url: string; reason: string }> = [];
  let totalBytes = 0;

  for (const img of slice) {
    const r = await archiveOne(img);
    if (r.skipped) {
      skipped++;
      if (r.reason && r.reason !== "already-archived") {
        failures.push({ url: img.url, reason: r.reason });
      }
    } else {
      archived++;
      totalBytes += r.size ?? 0;
      console.log(
        `  ✓ ${img.postId}/${r.sha?.slice(0, 8)}…${r.mime ? ` ${r.mime}` : ""} ${r.size ? `(${(r.size / 1024).toFixed(1)} KB)` : ""}`,
      );
    }
  }

  const ms = Date.now() - start;
  console.log(
    `[done] archived=${archived} skipped=${skipped} failures=${failures.length} total=${(totalBytes / 1024).toFixed(1)} KB · ${ms}ms`,
  );
  if (failures.length > 0) {
    console.log("[failures]");
    for (const f of failures) console.log(`  - ${f.reason}: ${f.url}`);
  }
}

await main();
