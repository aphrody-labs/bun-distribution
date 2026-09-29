-- Sprint 1 — publications dérivées hors du catalogue databooks.
CREATE TABLE IF NOT EXISTS bot.db_media_publications (
	"id" bigint PRIMARY KEY,
	"legacy_databook_id" bigint NOT NULL UNIQUE,
	"publication_type" text NOT NULL CHECK ("publication_type" IN ('anime_comic_movie', 'anime_comic_tv', 'light_novel')),
	"title" text NOT NULL,
	"title_ja" text,
	"author" text,
	"illustrator" text,
	"published_at" bigint,
	"cover" text,
	"description" text,
	"pages" jsonb,
	"visible" boolean NOT NULL DEFAULT true
);
DO $$ BEGIN
	ALTER TABLE bot.db_media_publications
		ADD CONSTRAINT db_media_publications_type_check
		CHECK (publication_type IN ('anime_comic_movie', 'anime_comic_tv', 'light_novel'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS db_media_publications_type_date_idx
	ON bot.db_media_publications (publication_type, published_at);
INSERT INTO bot.db_media_publications
	(id, legacy_databook_id, publication_type, title, title_ja, author, published_at, cover, description, pages, visible)
SELECT id, id,
	CASE
		WHEN category = 'Light Novel' THEN 'light_novel'
		WHEN id IN (48, 312, 313, 314, 315) THEN 'anime_comic_tv'
		ELSE 'anime_comic_movie'
	END,
	title, title_ja, author, published_at, cover, description, pages, true
FROM bot.db_databooks
WHERE category IN ('Jump Anime Comics', 'Light Novel')
ON CONFLICT (legacy_databook_id) DO UPDATE SET
	publication_type = EXCLUDED.publication_type,
	title = EXCLUDED.title, title_ja = EXCLUDED.title_ja, author = EXCLUDED.author,
	published_at = EXCLUDED.published_at, cover = EXCLUDED.cover,
	description = EXCLUDED.description, pages = EXCLUDED.pages, visible = EXCLUDED.visible;
UPDATE bot.db_databooks SET visible = false
WHERE category IN ('Jump Anime Comics', 'Light Novel') AND visible IS DISTINCT FROM false;
CREATE TABLE IF NOT EXISTS public.url_redirects (
	"source_path" text PRIMARY KEY,
	"target_path" text NOT NULL,
	"status_code" integer NOT NULL DEFAULT 301,
	"visible" boolean NOT NULL DEFAULT true,
	"created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE public.url_redirects
	ADD COLUMN IF NOT EXISTS "visible" boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS url_redirects_visible_idx
	ON public.url_redirects (source_path) WHERE visible;
INSERT INTO public.url_redirects (source_path, target_path, status_code, visible)
SELECT '/wiki/databooks/' || id::text,
	CASE WHEN publication_type = 'light_novel' THEN '/wiki/romans/' || id::text
	ELSE '/wiki/manga/anime-comics/' || id::text END,
	301,
	true
FROM bot.db_media_publications
ON CONFLICT (source_path) DO UPDATE SET
	target_path = EXCLUDED.target_path, status_code = EXCLUDED.status_code, visible = EXCLUDED.visible;
