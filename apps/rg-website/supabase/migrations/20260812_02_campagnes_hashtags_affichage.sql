-- Casse d'affichage des hashtags de campagne.
--
-- Application :
--   psql "$DATABASE_URL" -f apps/website/supabase/migrations/20260812_02_campagnes_hashtags_affichage.sql
-- (« psql -d rg » échoue sur cette instance : il n'existe pas de rôle `ubuntu`.)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POURQUOI
-- ─────────────────────────────────────────────────────────────────────────────
-- `x_campagnes.hashtags` est NORMALISÉ en minuscules par la contrainte
-- `x_campagnes_hashtags_normalises` — c'est indispensable côté récolte (X est
-- insensible à la casse, la comparaison doit l'être aussi). Mais c'est la MÊME
-- colonne qui alimente l'affichage : la page annonçait donc « #iergday » là où
-- les visuels officiels de l'association écrivent « #IERGDay », et « #inazumaday »
-- là où les 38 posts récoltés écrivent « #InazumaDay ».
--
-- Le hashtag est l'information la plus utile de la page pour un participant : il
-- doit s'afficher exactement comme la campagne l'écrit. D'où cette colonne, qui
-- ne porte QUE la casse — jamais un hashtag différent, la contrainte ci-dessous
-- l'interdit mécaniquement.
--
-- ⚠ Ce n'est PAS une porte dérobée pour `hashtags_rattrapage` : la contrainte
-- `x_campagnes_affichage_aligne` exige que `lower(hashtags_affichage)` soit
-- EXACTEMENT `hashtags`, élément par élément et dans le même ordre. Écrire
-- `{InazumaRGday}` dans `hashtags_affichage` de la campagne IERG Day est donc
-- rejeté par Postgres : la coquille de l'affiche ne peut pas remonter à l'écran
-- par ce chemin.

begin;

alter table public.x_campagnes
	add column if not exists hashtags_affichage text[] not null default '{}';

comment on column public.x_campagnes.hashtags_affichage is
	'Casse d''affichage des hashtags, aligné index par index sur `hashtags` (minuscules). Vide = afficher `hashtags` tel quel. Ne peut, par contrainte, contenir autre chose que la même liste avec une autre casse.';

-- Rejouable : la contrainte est reposée à l'identique.
alter table public.x_campagnes
	drop constraint if exists x_campagnes_affichage_aligne;

alter table public.x_campagnes
	add constraint x_campagnes_affichage_aligne check (
		cardinality(hashtags_affichage) = 0
		or lower(hashtags_affichage::text) = hashtags::text
	);
-- `lower(x::text) = y::text` compare les littéraux de tableau : cela impose d'un
-- seul coup le même cardinal, le même ordre et le même contenu à la casse près,
-- et rejette au passage un croisillon en tête (« {#iergday} » ≠ « {iergday} »).
-- `lower` et le cast `text[] -> text` sont IMMUTABLE, donc admis dans un CHECK —
-- même montage que la contrainte `x_campagnes_hashtags_normalises` existante.

-- ─────────────────────────────────────────────────────────────────────────────
-- Casses réelles, mesurées — aucune n'est inventée
-- ─────────────────────────────────────────────────────────────────────────────
-- IERG Day : « #IERGDay » est écrit tel quel sur la carte « Règles » officielle,
-- reprise mot pour mot dans `reglement` par 20260812_03_campagne_iergday_reelle.sql.
update public.x_campagnes
   set hashtags_affichage = array['IERGDay']
 where slug = 'iergday'
   and hashtags = array['iergday']
   and hashtags_affichage is distinct from array['IERGDay'];

-- Inazuma Day 2026 : casse RELEVÉE dans les posts déjà récoltés (12/8/2026) —
--   select m[1], count(*) from x_campagne_posts p join tweets t on t.id = p.tweet_id
--   cross join lateral regexp_matches(t.text, '#([[:alnum:]_À-ɏ぀-ヿ一-鿿]+)', 'g') m …
--   -> « 8月22日はイナイレの日 » 244, « InazumaDay » 38, « inazumaday » 2.
update public.x_campagnes
   set hashtags_affichage = array['InazumaDay', '8月22日はイナイレの日']
 where slug = 'inazuma-day-2026'
   and hashtags = array['inazumaday', '8月22日はイナイレの日']
   and hashtags_affichage is distinct from array['InazumaDay', '8月22日はイナイレの日'];

-- Les cinq campagnes archivées (Inatober RG 2023/2024/2025, Inazuma RG 1 et 2)
-- restent VOLONTAIREMENT à '{}' : elles n'ont aucun post récolté, donc aucune
-- preuve de la casse réellement employée à l'époque. La page affiche alors
-- `hashtags` tel quel — en minuscules, ce qui est exact plutôt que supposé.

commit;
