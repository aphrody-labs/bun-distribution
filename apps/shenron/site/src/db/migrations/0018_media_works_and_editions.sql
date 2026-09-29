-- Phase 1 / Sprint 2 : Ontologie des œuvres média, éditions et assets physiques dédupliqués

DO $$ BEGIN
    CREATE TYPE bot.media_kind AS ENUM ('manga', 'novel', 'artbook', 'databook', 'magazine', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE bot.edition_kind AS ENUM ('tankobon', 'kanzenban', 'shinsouban', 'chouzenshuu', 'full_color', 'sjc', 'digital');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE bot.page_color AS ENUM ('nb', 'color', 'mixed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS bot.media_works (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  kind bot.media_kind NOT NULL,
  series text NOT NULL,
  title text NOT NULL,
  title_ja text,
  title_romaji text,
  synopsis_fr text,
  source_id text REFERENCES bot.db_sources(id),
  visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bot.media_editions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  work_id bigint NOT NULL REFERENCES bot.media_works(id),
  edition bot.edition_kind NOT NULL,
  label text NOT NULL,
  language text NOT NULL DEFAULT 'ja',
  isbn text,
  publisher text,
  published_at date,
  page_color bot.page_color NOT NULL DEFAULT 'nb',
  scan_policy text NOT NULL DEFAULT 'self_hosted',
  visible boolean NOT NULL DEFAULT true,
  UNIQUE (work_id, edition, language, isbn)
);

CREATE TABLE IF NOT EXISTS bot.media_volumes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  edition_id bigint NOT NULL REFERENCES bot.media_editions(id),
  legacy_volume_id bigint UNIQUE REFERENCES bot.db_manga_volumes(id),
  number numeric(6,2) NOT NULL,
  slug text NOT NULL UNIQUE,
  title text,
  cover text,
  page_count integer,
  visible boolean NOT NULL DEFAULT true,
  UNIQUE (edition_id, number)
);

CREATE TABLE IF NOT EXISTS bot.media_chapters (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  volume_id bigint NOT NULL REFERENCES bot.media_volumes(id),
  legacy_chapter_id bigint UNIQUE REFERENCES bot.db_manga_chapters(id),
  number numeric(8,2) NOT NULL,
  slug text NOT NULL UNIQUE,
  title text,
  pages jsonb NOT NULL DEFAULT '[]',
  ocr_status text NOT NULL DEFAULT 'unprocessed',
  visible boolean NOT NULL DEFAULT true,
  UNIQUE (volume_id, number)
);

CREATE TABLE IF NOT EXISTS bot.media_page_assets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  uri text NOT NULL,
  width integer,
  height integer,
  sha256 text NOT NULL,
  source_id text REFERENCES bot.db_sources(id),
  UNIQUE (sha256)
);

-- Un asset physique peut être partagé par plusieurs éditions/chapitres sans
-- recopier le fichier ni perdre l'ordre de lecture propre à chaque chapitre.
CREATE TABLE IF NOT EXISTS bot.media_page_refs (
  chapter_id bigint NOT NULL REFERENCES bot.media_chapters(id),
  asset_id bigint NOT NULL REFERENCES bot.media_page_assets(id),
  ordinal integer NOT NULL CHECK (ordinal > 0),
  page_label text,
  PRIMARY KEY (chapter_id, ordinal),
  UNIQUE (chapter_id, asset_id)
);

-- Index de performance et de cohérence
CREATE INDEX IF NOT EXISTS idx_media_works_series ON bot.media_works (series);
CREATE INDEX IF NOT EXISTS idx_media_editions_work ON bot.media_editions (work_id, edition);
CREATE INDEX IF NOT EXISTS idx_media_volumes_edition ON bot.media_volumes (edition_id, number);
CREATE INDEX IF NOT EXISTS idx_media_chapters_volume ON bot.media_chapters (volume_id, number);
CREATE INDEX IF NOT EXISTS idx_media_page_refs_asset ON bot.media_page_refs (asset_id);
