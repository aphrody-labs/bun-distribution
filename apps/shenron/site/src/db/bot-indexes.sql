-- ============================================================================
-- Index du schéma `bot` (wiki) — PostgreSQL du site.
--
-- Pourquoi ce fichier existe : le schéma `bot` a été matérialisé par
-- `drizzle-kit generate` à partir de `src/db/bot-schema.ts`, qui ne déclarait
-- AUCUN index. Toutes les tables du wiki n'avaient donc que leur clé primaire,
-- et deux tables de jointure n'avaient même pas ça. Mesuré le 2026-08-21 sur la
-- prod : 272 000 balayages séquentiels sur `db_episodes`, 76 000 sur
-- `db_manga_chapters`, 20 830 sur `db_game_characters`.
--
-- Volontairement du SQL à part et non un `drizzle-kit push` : `push` sur le
-- schéma `bot` voudrait droper les colonnes qui n'existent que côté PostgreSQL
-- (`players`, `frames`, `pages`, `subtitles`, `stream_*`) et qui sont absentes
-- du SQLite du bot. Les déclarations Drizzle correspondantes vivent dans
-- `bot-schema.ts` pour que le fichier reste la source de vérité.
--
-- Sans `CONCURRENTLY` : la plus grosse table fait 12 577 lignes, la construction
-- se compte en millisecondes. `CONCURRENTLY` interdirait par ailleurs de
-- regrouper ces ordres dans une transaction.
--
--   bun apps/site/scripts/apply-bot-indexes.ts
-- ============================================================================

-- ── Clés primaires manquantes sur les tables de jointure ────────────────────
-- `db_character_arcs` a bien (character_id, arc_id) ; le motif n'avait pas été
-- appliqué aux deux autres. Sans PK, rien n'empêche les doublons et chaque
-- jointure balaye la table entière.
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conrelid = 'bot.db_character_techniques'::regclass AND contype = 'p'
	) THEN
		ALTER TABLE bot.db_character_techniques
			ADD CONSTRAINT db_character_techniques_pkey PRIMARY KEY (character_id, technique_id);
	END IF;
END $$;

DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conrelid = 'bot.db_game_characters'::regclass AND contype = 'p'
	) THEN
		ALTER TABLE bot.db_game_characters
			ADD CONSTRAINT db_game_characters_pkey PRIMARY KEY (game_id, character_id);
	END IF;
END $$;

-- Sens inverse des jointures (la PK ne couvre que le premier terme).
CREATE INDEX IF NOT EXISTS db_character_techniques_technique_idx
	ON bot.db_character_techniques (technique_id);
CREATE INDEX IF NOT EXISTS db_game_characters_character_idx
	ON bot.db_game_characters (character_id);

-- ── Listes publiques : filtre `visible` + tri, en un seul index partiel ─────
-- Index PARTIEL (`WHERE visible`) plutôt qu'un btree sur le booléen : la lecture
-- publique ne demande jamais les lignes masquées, et l'index porte directement
-- la colonne de tri, donc il sert le filtre ET l'ORDER BY.
CREATE INDEX IF NOT EXISTS db_characters_visible_name_idx
	ON bot.db_characters (name) WHERE visible;
CREATE INDEX IF NOT EXISTS db_planets_visible_name_idx
	ON bot.db_planets (name) WHERE visible;
CREATE INDEX IF NOT EXISTS db_races_visible_name_idx
	ON bot.db_races (name) WHERE visible;
CREATE INDEX IF NOT EXISTS db_techniques_visible_name_idx
	ON bot.db_techniques (name) WHERE visible;
CREATE INDEX IF NOT EXISTS db_transformations_visible_name_idx
	ON bot.db_transformations (name) WHERE visible;
CREATE INDEX IF NOT EXISTS db_sagas_visible_series_idx
	ON bot.db_sagas (series, name) WHERE visible;
CREATE INDEX IF NOT EXISTS db_arcs_visible_saga_idx
	ON bot.db_arcs (saga_id, name) WHERE visible;
CREATE INDEX IF NOT EXISTS db_movies_visible_release_idx
	ON bot.db_movies (series, release_date) WHERE visible;
CREATE INDEX IF NOT EXISTS db_games_visible_release_idx
	ON bot.db_games (release_date) WHERE visible;
CREATE INDEX IF NOT EXISTS db_databooks_visible_idx
	ON bot.db_databooks (title) WHERE visible;
CREATE INDEX IF NOT EXISTS db_manga_volumes_visible_idx
	ON bot.db_manga_volumes (series, volume_number) WHERE visible;
CREATE INDEX IF NOT EXISTS db_manga_chapters_visible_idx
	ON bot.db_manga_chapters (series, chapter_number) WHERE visible;

-- `db_episodes` : la requête la plus chaude du site (rails par série, page
-- série, navigation précédent/suivant, frise chronologique).
CREATE INDEX IF NOT EXISTS db_episodes_visible_series_num_idx
	ON bot.db_episodes (series, number_in_series) WHERE visible;
CREATE INDEX IF NOT EXISTS db_episodes_arc_idx
	ON bot.db_episodes (arc_id) WHERE arc_id IS NOT NULL;

-- ── Recherche par slug : clé de lookup de chaque page détail ────────────────
CREATE INDEX IF NOT EXISTS db_movies_slug_idx      ON bot.db_movies (slug);
CREATE INDEX IF NOT EXISTS db_games_slug_idx       ON bot.db_games (slug);
CREATE INDEX IF NOT EXISTS db_sagas_slug_idx       ON bot.db_sagas (slug);
CREATE INDEX IF NOT EXISTS db_arcs_slug_idx        ON bot.db_arcs (slug);
CREATE INDEX IF NOT EXISTS db_races_slug_idx       ON bot.db_races (slug);
CREATE INDEX IF NOT EXISTS db_techniques_slug_idx  ON bot.db_techniques (slug);
CREATE INDEX IF NOT EXISTS db_tools_slug_idx       ON bot.db_tools (slug);

-- ── Relations d'entité ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS db_wiki_sections_entity_idx
	ON bot.db_wiki_sections (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS db_assets_entity_idx
	ON bot.db_assets (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS db_transformations_character_idx
	ON bot.db_transformations (character_id);

-- Lecteur + dépôt OCR : une planche est adressée sans ambiguïté par
-- (série, tome, planche). L'unicité rend les reprises idempotentes et bloque
-- toute duplication silencieuse lors de deux dépôts concurrents.
CREATE UNIQUE INDEX IF NOT EXISTS db_manga_pages_locator_uidx
	ON bot.db_manga_pages (series, tome, planche);

-- ── Recherche floue (pg_trgm) ───────────────────────────────────────────────
-- `/api/search` et `/wiki/search` cherchent en `ILIKE '%terme%'`, prédicat qu'un
-- btree ne peut pas servir : sans index trigramme, chaque recherche balayait les
-- 12 tables. L'index porte la colonne BRUTE et non `unaccent(lower(col))` :
-- `unaccent()` est STABLE et non IMMUTABLE, donc inutilisable dans un index
-- d'expression sans fonction enveloppe (ce qui obligerait à réécrire les
-- requêtes). L'index sert la branche `ILIKE`, la plus sélective des deux.
CREATE INDEX IF NOT EXISTS db_characters_name_trgm      ON bot.db_characters      USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS db_planets_name_trgm         ON bot.db_planets         USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS db_races_name_trgm           ON bot.db_races           USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS db_techniques_name_trgm      ON bot.db_techniques      USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS db_transformations_name_trgm ON bot.db_transformations USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS db_sagas_name_trgm           ON bot.db_sagas           USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS db_arcs_name_trgm            ON bot.db_arcs            USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS db_movies_title_trgm         ON bot.db_movies          USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS db_games_title_trgm          ON bot.db_games           USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS db_episodes_title_trgm       ON bot.db_episodes        USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS db_manga_volumes_title_trgm  ON bot.db_manga_volumes   USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS db_manga_chapters_title_trgm ON bot.db_manga_chapters  USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS db_databooks_title_trgm      ON bot.db_databooks       USING gin (title gin_trgm_ops);

-- ============================================================================
-- Schéma `public` (site) — index manquants sur les chemins chauds.
-- ============================================================================

-- Requête la plus fréquente de tout le site : résolution d'identité, exécutée à
-- chaque navigation gatée (`lib/session.ts`, `lib/proxy-admin.ts`).
CREATE INDEX IF NOT EXISTS ba_account_user_provider_idx
	ON public."ba_account" ("userId", "providerId");

-- Listes de tier lists : filtre `published` + tri par mise en avant puis date.
CREATE INDEX IF NOT EXISTS tierlist_published_idx
	ON public."Tierlist" (published, featured, official, "createdAt" DESC);
CREATE INDEX IF NOT EXISTS tierlist_author_idx
	ON public."Tierlist" ("authorId", "createdAt" DESC);

-- Commentaires d'article : toujours lus par article.
CREATE INDEX IF NOT EXISTS comment_post_idx
	ON public."Comment" ("postId", "createdAt" DESC);

-- ============================================================================
-- Transcriptions de databooks — recherche dans le TEXTE DES PLANCHES.
--
-- `db_databooks_fts` n'indexe que les métadonnées (titre, titre japonais,
-- auteur, description). Le texte transcrit vit dans le jsonb `pages`, et
-- n'était donc atteignable par AUCUNE recherche : mesuré le 2026-08-22,
-- « ギュー特戦隊 » — une phrase présente dans une planche — remontait 0 résultat.
-- Autrement dit, on produit 11 775 planches de japonais que rien ne sait
-- interroger, et il faut ouvrir la bonne fiche pour la lire.
--
-- Trigramme et non `to_tsvector` : le corpus est majoritairement japonais, une
-- langue sans espaces. `to_tsvector` (quelle que soit la config, `french` comme
-- `simple`) ne sait pas segmenter le japonais et produit un unique lexème par
-- séquence contiguë — une recherche sur un mot interne ne peut alors rien
-- trouver. Les trigrammes, eux, découpent par caractères et gèrent l'UTF-8
-- multi-octets, donc le japonais comme le français.
-- ============================================================================

-- Texte concaténé des planches d'une fiche, dans l'ordre de lecture.
-- `IMMUTABLE` est requis pour servir d'expression d'index ; la fonction ne lit
-- que son argument. Le `CASE` protège du jsonb scalaire (le piège `sql.json` a
-- déjà écrit une chaîne là où on attendait un tableau).
CREATE OR REPLACE FUNCTION bot.databook_pages_text(pages jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURNS NULL ON NULL INPUT
AS $fn$
	SELECT coalesce(string_agg(t.p ->> 'text', E'\n' ORDER BY t.ord), '')
	FROM jsonb_array_elements(
		CASE WHEN jsonb_typeof(pages) = 'array' THEN pages ELSE '[]'::jsonb END
	) WITH ORDINALITY AS t(p, ord)
	WHERE t.p ->> 'text' IS NOT NULL
$fn$;

CREATE INDEX IF NOT EXISTS db_databooks_pages_text_trgm
	ON bot.db_databooks USING gin (bot.databook_pages_text(pages) gin_trgm_ops);

-- Texte français concaténé des planches d'une fiche (recherche plein texte dans les traductions).
CREATE OR REPLACE FUNCTION bot.databook_pages_text_fr(pages jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURNS NULL ON NULL INPUT
AS $fn$
	SELECT coalesce(string_agg(t.p ->> 'text_fr', E'\n' ORDER BY t.ord), '')
	FROM jsonb_array_elements(
		CASE WHEN jsonb_typeof(pages) = 'array' THEN pages ELSE '[]'::jsonb END
	) WITH ORDINALITY AS t(p, ord)
	WHERE t.p ->> 'text_fr' IS NOT NULL AND length(trim(t.p ->> 'text_fr')) > 0
$fn$;

CREATE INDEX IF NOT EXISTS db_databooks_pages_text_fr_trgm
	ON bot.db_databooks USING gin (bot.databook_pages_text_fr(pages) gin_trgm_ops);

-- Recherche trigramme dans le texte des planches manga OCR (12,5k+ lignes).
CREATE INDEX IF NOT EXISTS db_manga_pages_text_trgm
	ON bot.db_manga_pages USING gin (text gin_trgm_ops);

-- Corpus de preuves canoniques (filtrage rapide par source, intégrité hash et visibilité).
DO $$ BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'canon_references'
	) THEN
		CREATE INDEX IF NOT EXISTS canon_references_source_hash_idx
			ON public.canon_references (source, document, hash);
		CREATE INDEX IF NOT EXISTS canon_references_visible_created_idx
			ON public.canon_references (visible, created_at DESC);
	END IF;
END $$;

-- Historique des révisions wiki (recherche instantanée par entité).
DO $$ BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'wiki_revisions'
	) THEN
		CREATE INDEX IF NOT EXISTS wiki_revisions_entity_created_idx
			ON public.wiki_revisions ("tableName", "rowId", "createdAt" DESC);
	END IF;
END $$;
