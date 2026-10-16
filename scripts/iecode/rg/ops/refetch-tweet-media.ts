// Re-télécharge les médias de tweets depuis Twitter vers le Storage self-host.
//
// Les images de tweets étaient miroitées sur Supabase Storage ; la table
// `public.tweets` conserve pour chaque média son `original_url` pbs.twimg.com,
// ce qui rend le bucket entièrement reconstructible sans Supabase.
//
// Usage :
//   bun scripts/ops/refetch-tweet-media.ts [--dry] [--limit N] [--concurrency N]
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createBunSql } from "@rosegriffon/db/bun-sql";

const ROOT = process.env.RG_STORAGE_ROOT ?? "/var/www/rg-storage";
const BUCKET = "tweets";
const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const LIMIT = Number(args[args.indexOf("--limit") + 1]) || Number.POSITIVE_INFINITY;
const CONCURRENCY = Number(args[args.indexOf("--concurrency") + 1]) || 8;

const sql = createBunSql();

interface Media {
  url?: string;
  previewUrl?: string;
  preview_url?: string;
  original_url?: string;
  type?: string;
}

/** pbs.twimg.com sert la meilleure définition raisonnable via `name=large`. */
function bestSource(media: Media): string | null {
  const src = media.original_url ?? media.preview_url ?? null;
  if (!src?.startsWith("https://pbs.twimg.com/")) return src;
  const u = new URL(src);
  u.searchParams.set("name", "large");
  if (!u.searchParams.has("format") && /\.(jpg|png|webp)$/.test(u.pathname)) {
    const ext = u.pathname.split(".").pop() as string;
    u.pathname = u.pathname.replace(/\.(jpg|png|webp)$/, "");
    u.searchParams.set("format", ext);
  }
  return u.toString();
}

// L'index `storage.objects` restauré depuis Supabase fait foi : il donne le nom
// exact de chaque fichier (`<id>/<id>_<n>.<ext>`), où `n` est la position du
// média dans `tweets.media`. On y adosse l'URL source d'origine.
const objects: Array<{ name: string }> =
  await sql`select name from storage.objects where bucket_id = ${BUCKET} order by name`;
const tweets: Array<{ id: string; media: Media[] | null }> =
  await sql`select id, media from public.tweets where media is not null`;
const mediaById = new Map(tweets.map(t => [t.id, t.media ?? []]));

const jobs: Array<{ name: string; source: string }> = [];
let orphans = 0;
for (const { name } of objects) {
  const match = name.match(/^(\d+)\/\1_(\d+)\.[a-z0-9]+$/i);
  if (!match) {
    orphans++;
    continue;
  }
  const media = mediaById.get(match[1])?.[Number(match[2])];
  const source = media ? bestSource(media) : null;
  if (source) jobs.push({ name, source });
  else orphans++;
}
console.log(`objets_index=${objects.length} sans_source=${orphans}`);

const todo = jobs.slice(0, LIMIT === Number.POSITIVE_INFINITY ? undefined : LIMIT);
console.log(`medias=${jobs.length} a_traiter=${todo.length} dry=${DRY}`);

let ok = 0;
let skipped = 0;
let failed = 0;
let bytes = 0;

async function run(job: { name: string; source: string }) {
  const target = join(ROOT, BUCKET, job.name);
  if (await Bun.file(target).exists()) {
    skipped++;
    return;
  }
  if (DRY) return;
  try {
    const res = await fetch(job.source, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; rose-griffon-storage/1.0)" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      failed++;
      return;
    }
    const buffer = await res.arrayBuffer();
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, buffer);
    bytes += buffer.byteLength;
    await sql`
			insert into storage.objects (bucket_id, name, metadata, created_at, updated_at, last_accessed_at, version)
			values (${BUCKET}, ${job.name},
			        ${JSON.stringify({ size: buffer.byteLength, mimetype: res.headers.get("content-type") ?? "image/jpeg", cacheControl: "max-age=3600" })}::jsonb,
			        now(), now(), now(), gen_random_uuid()::text)
			on conflict (bucket_id, name) do update set metadata = excluded.metadata, updated_at = now()`;
    ok++;
  } catch {
    failed++;
  }
}

for (let i = 0; i < todo.length; i += CONCURRENCY) {
  await Promise.all(todo.slice(i, i + CONCURRENCY).map(run));
  if ((i / CONCURRENCY) % 25 === 0) {
    console.log(
      `avance=${i + CONCURRENCY}/${todo.length} ok=${ok} deja=${skipped} echec=${failed} mo=${(bytes / 1048576).toFixed(0)}`,
    );
  }
}

console.log(`termine ok=${ok} deja=${skipped} echec=${failed} mo=${(bytes / 1048576).toFixed(0)}`);
await sql.end();
