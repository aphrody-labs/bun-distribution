-- Groupe d'âge / année scolaire / surnom officiels, tels que publiés par
-- zukan.inazuma.jp (`ul.basic` de `chara_param`, une seule requête déjà
-- effectuée par le crawl `crawlZukanOrder` — aucun crawl supplémentaire).
--
-- Le zukan officiel affiche ces trois champs par personnage (`Age Group`,
-- `School Year`, et le surnom sous le nom complet) mais azalee ne les
-- stockait pas : `crawlZukanOrder` ne lisait jusqu'ici que Position/Élément
-- (redondants avec nos propres données de jeu) pour l'ordre officiel. On les
-- capture désormais en même temps, sans coût réseau supplémentaire.
--
-- Appliquer :
--   psql "$DATABASE_URL" -f apps/website/sql/migrations/20260901_inagle_characters_zukan_agegroup.sql

begin;

alter table public.inagle_characters
	add column if not exists age_group text,
	add column if not exists school_year text,
	add column if not exists nickname text;

comment on column public.inagle_characters.age_group is
	'Groupe d''âge publié par zukan.inazuma.jp (ex. "Middle School", "Adult") — brut, non traduit.';
comment on column public.inagle_characters.school_year is
	'Année scolaire publiée par zukan.inazuma.jp (ex. "Grade 8") — brut, non traduit.';
comment on column public.inagle_characters.nickname is
	'Surnom affiché sous le nom complet sur zukan.inazuma.jp (ex. "Evans" pour Mark Evans).';

commit;
