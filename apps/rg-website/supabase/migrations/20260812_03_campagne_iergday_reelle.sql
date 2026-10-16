-- Campagne IERG Day : la ligne semée à l'aveugle par 20260812_01_campagnes_x.sql est
-- remplacée par la campagne RÉELLE, telle que l'association l'a publiée sur ses
-- trois visuels (affiche, carte « Règles », décor sans texte).
--
-- Application :
--   psql "$DATABASE_URL" -f apps/website/supabase/migrations/20260812_03_campagne_iergday_reelle.sql
-- (« psql -d rg » échoue sur cette instance : il n'existe pas de rôle `ubuntu`.)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CE QUE DISENT LES VISUELS (lus le 12/8/2026, fichiers d'origine ré-hébergés
-- dans le bucket `assets`, cf. plus bas)
-- ─────────────────────────────────────────────────────────────────────────────
--   Affiche  : « UN MOIS DE CÉLÉBRATION » / « Célébrons ensemble les 18 ans de la
--              licence et les 3 ans de Rose Griffon avec une grande fresque ! » /
--              « Postez une image avec le hashtag #InazumaRGday » /
--              « Date de fin : 22 aout 2026 23h59 (FR) » / signature @rose_griffon.
--   Règles   : « Postez une image mettant en scène un OC accompagné du #IERGDay sur
--              Twitter ou Instagram. » + trois autres règles, reprises mot pour mot
--              dans la colonne `reglement` créée ici.
--
-- LE HASHTAG OFFICIEL EST #IERGDay — tranché par l'association.
-- Les deux visuels se contredisent : l'affiche écrit #InazumaRGday, la carte des
-- règles écrit #IERGDay. C'est une COQUILLE DE L'AFFICHE. #InazumaRGday n'est donc
-- pas un second hashtag officiel mais un FILET DE RATTRAPAGE, pour les participants
-- qui recopieront l'affiche : leurs posts doivent remonter dans la galerie comme
-- les autres, sans que la page n'affiche jamais la coquille — l'écrire à l'écran
-- (« #IERGDay ou #InazumaRGday ») la propagerait au lieu de la contenir.
-- D'où la colonne `hashtags_rattrapage` ci-dessous : la récolte lit l'union des
-- deux listes, l'affichage ne lit QUE `hashtags`.
--
-- MESURES DU 12/8/2026 (avant écriture) : `#IERGDay` -> 0 post sur X, `#InazumaRGday`
-- -> 0 post, aucune annonce dans `discord_messages` (le salon d'origine des visuels
-- n'est pas suivi). La campagne est ANNONCÉE mais encore VIDE : l'état vide de la
-- page n'est pas un cas limite, c'est l'état normal du jour.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Schéma : ce qu'une campagne doit pouvoir porter et ne pouvait pas
-- ─────────────────────────────────────────────────────────────────────────────
-- Principe posé par le chantier : « lancer, arrêter ou changer la campagne = un
-- UPDATE, jamais un déploiement ». Coder le règlement ou le hashtag de rattrapage
-- en dur dans le TSX le trahirait — la campagne suivante aura d'autres règles.

alter table public.x_campagnes
	-- Hashtags récoltés MAIS JAMAIS AFFICHÉS. Même normalisation que `hashtags`
	-- (minuscules, sans croisillon) : c'est la même comparaison, côté récolte.
	add column if not exists hashtags_rattrapage text[] not null default '{}',

	-- Règlement de la campagne, une règle par élément, dans l'ordre d'affichage.
	-- text[] plutôt que jsonb : c'est une liste de phrases, rien de plus, et le
	-- reste de la table (`hashtags`, `requetes`) est déjà en text[].
	add column if not exists reglement text[] not null default '{}',

	-- Les deux autres visuels. `image_couverture` reste la BANNIÈRE (décor sans
	-- texte, seul visuel recadrable sans mutiler une phrase) ; ces deux-là sont des
	-- documents à montrer entiers, pas des fonds.
	add column if not exists image_affiche text,
	add column if not exists image_reglement text;

comment on column public.x_campagnes.hashtags_rattrapage is
	'Hashtags récoltés mais JAMAIS affichés (coquille d''un visuel, variante orthographique). L''affichage ne lit que `hashtags`.';
comment on column public.x_campagnes.reglement is
	'Règles de participation, une par élément, dans l''ordre. Piloté en base : changer les règles ne demande aucun déploiement.';
comment on column public.x_campagnes.image_affiche is
	'Affiche officielle de la campagne (document à montrer entier, pas une bannière).';
comment on column public.x_campagnes.image_reglement is
	'Carte « Règles » officielle. Le texte lisible par une machine vit dans `reglement` ; cette image en est le fac-similé.';

-- Mêmes garde-fous que `hashtags` (cf. 20260812_01_campagnes_x.sql pour le détail de
-- cette forme : un `unnest` en sous-requête est refusé dans un CHECK, et
-- `array_to_string` n'est que STABLE). Un tableau vide passe : `'{}'` est déjà en
-- minuscules et ne contient pas de croisillon.
alter table public.x_campagnes drop constraint if exists x_campagnes_rattrapage_normalise;
alter table public.x_campagnes add constraint x_campagnes_rattrapage_normalise
	check (hashtags_rattrapage::text = lower(hashtags_rattrapage::text)
	       and position('#' in hashtags_rattrapage::text) = 0);

-- Un hashtag ne peut pas être à la fois affiché et tu. Sans cette contrainte, une
-- correction hâtive (« ajoutons-le aussi dans hashtags ») rendrait la coquille
-- affichable sans que rien ne proteste. `&&` (arrayoverlap) est IMMUTABLE, donc
-- utilisable dans un CHECK.
alter table public.x_campagnes drop constraint if exists x_campagnes_rattrapage_disjoint;
alter table public.x_campagnes add constraint x_campagnes_rattrapage_disjoint
	check (not (hashtags && hashtags_rattrapage));

-- Une règle vide ou NULL s'afficherait comme une puce fantôme.
-- `array_position` et `@>` (arraycontains) sont IMMUTABLE, donc admis dans un CHECK
-- — contrairement à `array_to_string`, qui n'est que STABLE (cf. le commentaire de
-- `x_campagnes_hashtags_normalises` dans la migration d'origine).
alter table public.x_campagnes drop constraint if exists x_campagnes_reglement_non_vide;
alter table public.x_campagnes add constraint x_campagnes_reglement_non_vide
	check (array_position(reglement, null) is null
	       and not (reglement @> array['']::text[]));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La campagne « à la une » : IERG Day prend la place d'Inazuma Day 2026
-- ─────────────────────────────────────────────────────────────────────────────
-- DÉCISION, ET SON PRIX. Inazuma Day 2026 compte 247 publications récoltées ; IERG
-- Day en compte ZÉRO. Mettre à la une la campagne vide coûte donc une galerie vide
-- en page d'accueil de /iergday.
-- On la met quand même à la une, pour trois raisons qui pèsent plus lourd :
--   1. La route s'appelle /iergday. Un visiteur qui suit l'annonce de l'association
--      et tombe sur la campagne de LEVEL-5 ne comprend pas où il est arrivé :
--      afficher la campagne d'un autre sous l'URL de la nôtre est une erreur pire
--      qu'une galerie vide.
--   2. C'est la campagne VIVANTE de l'association, et elle ferme le 22 août. La
--      page n'a d'utilité que maintenant : elle porte l'appel à participer, les
--      règles et l'affiche. Une fois close, elle redeviendra une archive parmi
--      d'autres et cette ligne repassera `principale = false` — un UPDATE.
--   3. L'état vide n'est pas une panne : avec le règlement et l'affiche désormais
--      EN BASE, la page a de quoi être pleine sans une seule publication.
-- Inazuma Day 2026 reste publiée, active et accessible en un clic par le sélecteur
-- (`/iergday?campagne=inazuma-day-2026`) : on ne lui retire que la vedette.
--
-- ORDRE IMPÉRATIF : `x_campagnes_principale_unique` est un index unique partiel sur
-- les lignes vraies. Poser la nouvelle vedette avant de retirer l'ancienne violerait
-- l'unicité au milieu de la transaction. On libère la place d'abord.
update public.x_campagnes
   set principale = false, updated_at = now()
 where principale and slug <> 'iergday';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. La campagne elle-même
-- ─────────────────────────────────────────────────────────────────────────────
-- `insert … on conflict do update` : rejouable à l'identique (idempotent), et la
-- ligne se recrée si elle a disparu. Contrairement à l'amorçage de
-- 20260812_01_campagnes_x.sql (`do nothing`), on ÉCRASE ici : c'est le but même de
-- cette migration, corriger un squelette écrit avant d'avoir vu les visuels.
insert into public.x_campagnes
	(slug, titre, sur_titre, description,
	 image_couverture, image_affiche, image_reglement,
	 hashtags, hashtags_rattrapage, requetes, reglement,
	 debut_le, fin_le, actif, publiee, principale)
values (
	'iergday',

	-- Le titre de l'affiche, mot pour mot. « IERG Day » n'y figure nulle part comme
	-- titre : c'est le nom du hashtag et de la route, il sert donc de sur-titre.
	'Un mois de célébration',
	'IERG Day',

	-- Reprise de l'affiche. Tronquée à 160 caractères pour la balise `description`
	-- de la page (`app/iergday/page.tsx`) : la première phrase doit se suffire.
	'Célébrons ensemble les 18 ans de la licence et les 3 ans de Rose Griffon avec une grande fresque : postez une image mettant en scène un OC, elle rejoint la galerie.',

	-- VISUELS RÉ-HÉBERGÉS. Les originaux viennent de media.discordapp.net, dont les
	-- URL sont signées et expirent (paramètres `ex=`/`is=`/`hm=`) : les publier,
	-- c'est publier une page qui casse demain. Ils sont donc recopiés dans le bucket
	-- public `assets` (même convention que les visuels de sondages Discord :
	-- `discord/sondages/<id>/…` -> ici `campagnes/<slug>/…`), servis en WebP q82 par
	-- l'origine du site — nginx expose `/storage/v1/` via `supabase-compat.inc`, donc
	-- zéro cross-origin, et `rosegriffon.fr` est déjà dans `images.remotePatterns`.
	-- Les octets d'origine (WebP sans perte, ~1 Mo) sont conservés à côté, suffixés
	-- `-original.webp`. Vérifié le 12/8/2026 : les 6 objets répondent 200 image/webp.
	'https://rosegriffon.fr/storage/v1/object/public/assets/campagnes/iergday/couverture.webp',
	'https://rosegriffon.fr/storage/v1/object/public/assets/campagnes/iergday/affiche.webp',
	'https://rosegriffon.fr/storage/v1/object/public/assets/campagnes/iergday/reglement.webp',

	-- Hashtag OFFICIEL, seul affiché.
	array['iergday'],
	-- Filet de rattrapage, jamais affiché : la coquille de l'affiche.
	array['inazumargday'],

	-- Requêtes X. `since:` volontairement LARGE (1er juillet) : la date de début
	-- n'est écrite sur aucun visuel, une borne trop serrée écarterait un post
	-- légitime — et un post en trop se modère, un post perdu ne se rattrape pas.
	-- Pas de `filter:images` : la récolte vérifie déjà la présence d'une image
	-- (`porteUneImage`) et ce filtre écarte les posts dont l'image est en pièce
	-- jointe de citation.
	array[
		'#IERGDay -filter:replies since:2026-07-01',
		'#InazumaRGday -filter:replies since:2026-07-01'
	],

	-- Les quatre règles de la carte « Règles », mot pour mot.
	array[
		'Postez une image mettant en scène un OC accompagné du #IERGDay sur Twitter ou Instagram.',
		'Que ce soit grâce à un dessin ou bien l''avatar de Victory Road accompagné de la ville Kizuna, vous avez carte blanche.',
		'Vous pouvez participer autant de fois que vous le souhaitez.',
		'L''utilisation d''IA est absolument interdite.'
	],

	-- DÉBUT : DÉDUCTION, PAS UNE DONNÉE. Aucun visuel ne l'écrit. « Un mois de
	-- célébration » + une fin au 22 août donnent un début au 22 juillet 2026 ; c'est
	-- cohérent, ce n'est pas sourcé. Conséquence assumée : cette borne ne sert QU'À
	-- l'affichage (« en cours » vs « à venir ») et au tri des campagnes ; elle ne
	-- filtre RIEN à la récolte, dont la borne `since:` est un mois plus large.
	-- Si l'association donne la vraie date, un UPDATE d'une ligne suffit.
	'2026-07-22 00:00:00+02',

	-- FIN : donnée CERTAINE, écrite sur l'affiche — « 22 aout 2026 23h59 (FR) ».
	-- La France est en CEST (UTC+2) le 22 août : 23h59:59 locales = 21h59:59 UTC.
	'2026-08-22 23:59:59+02',

	true,  -- actif   : la récolte tourne (à vide aujourd'hui, sans coût)
	true,  -- publiee : la page est en ligne
	true   -- principale : cf. la justification en section 2
)
on conflict (slug) do update set
	titre               = excluded.titre,
	sur_titre           = excluded.sur_titre,
	description         = excluded.description,
	image_couverture    = excluded.image_couverture,
	image_affiche       = excluded.image_affiche,
	image_reglement     = excluded.image_reglement,
	hashtags            = excluded.hashtags,
	hashtags_rattrapage = excluded.hashtags_rattrapage,
	requetes            = excluded.requetes,
	reglement           = excluded.reglement,
	debut_le            = excluded.debut_le,
	fin_le              = excluded.fin_le,
	actif               = excluded.actif,
	publiee             = excluded.publiee,
	principale          = excluded.principale,
	updated_at          = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Rien d'autre ne bouge
-- ─────────────────────────────────────────────────────────────────────────────
-- Les six autres campagnes ne sont touchées QUE par le retrait de la vedette
-- (section 2), qui est mécaniquement inévitable : l'index unique partiel n'en
-- autorise qu'une. Aucun contenu, aucune date, aucun drapeau de publication
-- d'une autre campagne n'est réécrit ici.
--
-- TEMPS RÉEL : toujours aucun déclencheur sur ces tables, et surtout pas sur les
-- colonnes de modération. `rg_realtime_notify()` diffuse `to_jsonb(NEW)` ENTIER
-- sur un flux SSE NON AUTHENTIFIÉ (`apps/realtime/server.ts`, CORS `*`, paramètre
-- `table` libre) : un masquage y publierait `motif_masquage` en clair, et une
-- campagne non publiée y partirait entière. On réaffirme le retrait, au cas où un
-- rejeu de trigger global les aurait reposés.
drop trigger if exists rg_realtime_x_campagnes on public.x_campagnes;
drop trigger if exists rg_realtime_x_campagne_posts on public.x_campagne_posts;

-- Les GRANT/policies de 20260812_01_campagnes_x.sql restent valables tels quels : les
-- nouvelles colonnes sont couvertes par le `grant select on public.x_campagnes`
-- (droit au niveau TABLE, pas par colonne) et par la policy « Lecture publique des
-- campagnes publiees ». `hashtags_rattrapage` est donc lisible par `anon` — c'est
-- assumé : ce n'est pas un secret, c'est une consigne d'affichage. Ce qui garantit
-- qu'il ne s'affiche pas, c'est que `apps/website/src/lib/x-campagnes/queries.ts`
-- ne le sélectionne jamais.

commit;
