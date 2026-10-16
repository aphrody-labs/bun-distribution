-- Campagnes à hashtag sur X : récolter une opération communautaire, puis la
-- publier telle quelle sur le site.
--
-- POURQUOI DES TABLES DÉDIÉES PLUTÔT QU'UN FILTRE SUR `tweets`
-- On pourrait croire qu'un `where text ilike '%#inazumarg%'` suffit. Trois raisons
-- l'interdisent :
--   1. `public.tweets` (12 542 lignes, dont 8 300 avec média — mesuré le 12/8/2026)
--      est peuplée par des crawls de timelines et des requêtes thématiques : le
--      hashtag d'une campagne n'y est PAS présent. Mesuré le même jour :
--      `#inazumaRG` -> 0 ligne, `#Inatober` -> 0 ligne, `#IERGDay` -> 0 ligne,
--      `#InazumaDay` -> 15 lignes seulement, alors que X en sert des centaines.
--      Le filtre ne trouverait quasiment rien.
--   2. Un `ilike` ne se modère pas. Une campagne publique a besoin d'un
--      interrupteur par publication (`masque`) et d'une mise en avant éditoriale
--      (`mis_en_avant`) — deux attributs de la RELATION post↔campagne, pas du tweet.
--   3. Une campagne est un objet éditorial (titre, dates, visuel) qui doit se créer
--      et se piloter EN BASE, sans déploiement. Le hashtag exact n'est souvent connu
--      que quelques jours avant le lancement.
--
-- POURQUOI RÉUTILISER `public.tweets` MALGRÉ TOUT
-- On ne duplique ni le texte ni les médias : `x_campagne_posts` n'est qu'une table
-- d'association. La campagne hérite gratuitement du ré-hébergement des images dans
-- le Storage self-host (bucket `tweets`) et de l'ingestion RAG déjà en place, et un
-- tweet capté par deux campagnes (`#InazumaDay` et son pendant japonais
-- `#8月22日はイナイレの日`) n'est stocké qu'une seule fois.
--
-- POURQUOI TROIS TABLES ET PAS DEUX
-- `rg_realtime_notify()` tronque toute charge utile de plus de 7000 octets et ne
-- réémet alors que `new->'id'`. La clé primaire de `x_campagnes` étant `slug`, une
-- ligne tronquée partirait en `{"new":{"id":null}}` : inexploitable. Les curseurs de
-- pagination X grossissent à chaque run et franchiraient ce seuil. Ils vivent donc
-- dans `x_campagne_curseurs`, table de plomberie interne — ni publique, ni temps réel.
--
-- Application : psql "$DATABASE_URL" -f apps/website/supabase/migrations/20260812_01_campagnes_x.sql
-- (« psql -d rg » échoue sur cette instance : il n'existe pas de rôle `ubuntu`.
--  L'en-tête « psql -d rg » des migrations voisines est erroné, ne pas le recopier.)

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Campagnes
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.x_campagnes (
	-- Identifiant d'URL (`/iergday?campagne=inazuma-day-2026`). Stable, en clair,
	-- choisi à la main : il apparaît dans les liens partagés.
	slug              text primary key,

	titre             text not null,
	-- Sur-titre court affiché au-dessus du titre dans la bannière (« Campagne
	-- communautaire », « Édition 2024 »…).
	sur_titre         text,
	description       text,
	-- Chemin ou URL du visuel de bannière. NULL = dégradé de marque par défaut.
	image_couverture  text,

	-- Hashtags de la campagne, EN MINUSCULES ET SANS le croisillon.
	-- Pourquoi sans le « # » : le stockage sert à deux usages incompatibles avec le
	-- croisillon — la comparaison au champ `tags` renvoyé par X (qui ne le porte pas)
	-- et la construction d'un `ilike '%#' || h || '%'`. L'affichage le rajoute.
	-- Pourquoi en minuscules : X est insensible à la casse sur les hashtags
	-- (`#InazumaRG` et `#inazumarg` sont le même flux) ; normaliser à l'écriture
	-- évite un `lower()` sur chaque comparaison. Sans effet sur le japonais.
	hashtags          text[] not null,

	-- Requêtes X brutes, telles qu'envoyées à l'API (opérateurs compris :
	-- `-filter:replies`, `filter:images`, `since:`/`until:`). Volontairement
	-- distinctes de `hashtags` : une campagne peut se récolter par plusieurs angles
	-- (Latest large + fenêtres de dates pour le rattrapage historique) alors qu'elle
	-- n'a qu'un ou deux hashtags d'identité.
	requetes          text[] not null default '{}',

	-- Bornes éditoriales. `fin_le` NULL = campagne sans fin annoncée.
	debut_le          timestamptz,
	fin_le            timestamptz,

	-- DEUX interrupteurs, délibérément séparés :
	--   `actif`   : le cron interroge X pour cette campagne.
	--   `publiee` : la campagne et ses posts sont lisibles publiquement.
	-- Une campagne passée est `actif=false, publiee=true` : archive consultable, plus
	-- aucune requête X inutile. Une campagne annoncée mais pas encore lancée est
	-- `actif=true, publiee=true` : la récolte tourne à vide (1 requête qui renvoie 0)
	-- et la page affiche son état vide, sans qu'aucun déploiement soit nécessaire le
	-- jour du lancement.
	actif             boolean not null default true,
	publiee           boolean not null default true,

	-- La campagne affichée par défaut sur /iergday. Au plus UNE ligne vraie
	-- (index unique partiel plus bas). Changer la campagne à la une = un UPDATE.
	principale        boolean not null default false,

	-- Horodatage du dernier passage de récolte (succès comme échec).
	collecte_le       timestamptz,

	created_at        timestamptz not null default now(),
	updated_at        timestamptz not null default now(),

	-- Une campagne sans hashtag n'est pas récoltable : autant l'interdire à l'écriture.
	constraint x_campagnes_hashtags_non_vide check (cardinality(hashtags) > 0),

	-- Garde-fou contre le croisillon et les majuscules oubliés à l'insertion.
	--
	-- POURQUOI CETTE FORME BIZARRE (`hashtags::text`) ET PAS UN `unnest`
	-- La rédaction naturelle — `not exists (select 1 from unnest(hashtags) h
	-- where h like '#%' or h <> lower(h))` — est REFUSÉE par PostgreSQL :
	-- « cannot use subquery in check constraint » (vérifié sur PostgreSQL 18.4).
	-- `array_to_string()` est exclue elle aussi : elle est marquée STABLE, pas
	-- IMMUTABLE. On compare donc la représentation textuelle du tableau entier,
	-- qui est produite par une conversion d'E/S immutable :
	--   {inazumaday,abc}          -> passe
	--   {#inazumaday}             -> rejeté (croisillon)
	--   {InazumaDay}              -> rejeté (majuscule)
	--   {8月22日はイナイレの日}    -> passe (aucune casse en japonais)
	--   {ok,NULL}                 -> rejeté (le littéral NULL n'est pas en minuscules)
	-- Ce dernier cas est un effet de bord HEUREUX : un élément NULL dans `hashtags`
	-- produirait un `#null` à l'affichage et une requête X absurde.
	-- Le croisillon est refusé où qu'il soit dans la chaîne, pas seulement en tête :
	-- un hashtag n'en contient jamais.
	constraint x_campagnes_hashtags_normalises
		check (hashtags::text = lower(hashtags::text)
		       and position('#' in hashtags::text) = 0),

	constraint x_campagnes_fenetre_coherente
		check (fin_le is null or debut_le is null or fin_le >= debut_le)
);

comment on table public.x_campagnes is
	'Campagnes à hashtag sur X (opérations communautaires), pilotées en base sans déploiement.';
comment on column public.x_campagnes.hashtags is
	'Hashtags en minuscules et SANS croisillon : comparables tels quels au champ `tags` de X.';
comment on column public.x_campagnes.requetes is
	'Requêtes X brutes (opérateurs compris). Plusieurs angles possibles pour un même hashtag.';
comment on column public.x_campagnes.actif is
	'La récolte tourne. Indépendant de `publiee` : une archive reste lisible sans être récoltée.';
comment on column public.x_campagnes.publiee is
	'Visible publiquement. C''est ce drapeau, et lui seul, que lit la RLS.';
comment on column public.x_campagnes.principale is
	'Campagne affichée par défaut sur /iergday. Au plus une ligne vraie.';
comment on column public.x_campagnes.collecte_le is
	'Dernier passage de récolte, succès comme échec. Alimente le « mis à jour il y a… » de la page.';

-- Au plus une campagne à la une. L'index ne porte que sur les lignes vraies :
-- toutes y valent `true`, donc l'unicité en limite le nombre à une.
create unique index if not exists x_campagnes_principale_unique
	on public.x_campagnes ((principale)) where principale;

-- Liste des campagnes que le cron doit visiter à chaque run (table minuscule, mais
-- l'index évite un parcours séquentiel dans une tâche qui tourne toutes les heures).
create index if not exists x_campagnes_a_recolter_idx
	on public.x_campagnes (slug) where actif;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Publications rattachées à une campagne
-- ─────────────────────────────────────────────────────────────────────────────
-- Table d'ASSOCIATION : ni texte, ni média, ni auteur ici — tout cela vit dans
-- `public.tweets`. On n'y stocke que ce qui appartient au couple (campagne, post) :
-- pourquoi il a été retenu, s'il porte une image, et les décisions de modération.

create table if not exists public.x_campagne_posts (
	campagne_slug   text not null references public.x_campagnes (slug) on delete cascade,
	-- `on delete cascade` : si un tweet est purgé de `tweets`, son rattachement
	-- disparaît avec lui. Une ligne d'association orpheline afficherait une carte
	-- vide sur le site.
	tweet_id        text not null references public.tweets (id) on delete cascade,

	-- Lequel des hashtags de la campagne a été trouvé dans ce post (minuscules, sans
	-- croisillon). Une campagne bilingue en a plusieurs ; savoir lequel a mordu
	-- permet de mesurer chaque pendant séparément.
	hashtag_trouve  text,

	-- Le post porte au moins un média de type `photo`. C'est LE critère d'affichage
	-- de la page (« les posts qui portent une image »). Dénormalisé ici parce que
	-- l'alternative — `jsonb_path_exists(t.media, '$[*] ? (@.type == "photo")')` à
	-- chaque requête — interdit tout index utilisable.
	a_media         boolean not null default false,
	-- Nombre d'images, pour l'aperçu en mosaïque (« +3 ») sans relire le jsonb.
	nb_images       smallint not null default 0,

	-- Mise en avant éditoriale : bandeau « À la une » en tête de galerie.
	-- Volontairement HORS du tri de la grille (cf. index plus bas).
	mis_en_avant    boolean not null default false,

	-- MODÉRATION. Un post masqué reste en base — c'est ce qui garantit qu'une
	-- récolte ultérieure ne le fera pas réapparaître : la clé primaire existe déjà,
	-- l'upsert tombe sur `do update` et NE TOUCHE PAS à cette colonne.
	-- Supprimer la ligne aurait l'effet inverse : le post reviendrait au run suivant.
	masque          boolean not null default false,
	motif_masquage  text,

	-- Copie de `tweets.created_at` figée à l'insertion. Sans elle, trier la galerie
	-- impose de trier la jointure entière avant de paginer ; avec elle, l'index
	-- partiel ci-dessous sert à la fois la grille et son COUNT(*).
	publie_le       timestamptz,

	collecte_le     timestamptz not null default now(),

	primary key (campagne_slug, tweet_id)
);

comment on table public.x_campagne_posts is
	'Rattachement d''un tweet à une campagne, avec ses décisions de modération. Le contenu vit dans public.tweets.';
comment on column public.x_campagne_posts.masque is
	'Retiré du site. La ligne est CONSERVÉE : c''est ce qui empêche une récolte ultérieure de la réafficher.';
comment on column public.x_campagne_posts.a_media is
	'Au moins une image. Dénormalisé : un test sur le jsonb de `tweets` serait non indexable.';
comment on column public.x_campagne_posts.publie_le is
	'Copie de tweets.created_at, pour trier et paginer sans trier la jointure.';
comment on column public.x_campagne_posts.hashtag_trouve is
	'Le hashtag de la campagne effectivement présent dans le post (minuscules, sans croisillon).';

-- L'index de la galerie : il sert EXACTEMENT la requête de la page
--   where campagne_slug = $1 and not masque and a_media order by publie_le desc
-- et son COUNT(*). C'est pour lui que `publie_le` et `a_media` sont dénormalisés.
create index if not exists x_campagne_posts_galerie_idx
	on public.x_campagne_posts (campagne_slug, publie_le desc)
	where not masque and a_media;

-- « À la une » : requête séparée (LIMIT 6, page 1 seulement). `mis_en_avant` n'est
-- PAS dans l'ORDER BY de la grille — il y rendrait la pagination instable (un post
-- promu depuis la page 3 décalerait toutes les pages) et neutraliserait l'index.
create index if not exists x_campagne_posts_vedette_idx
	on public.x_campagne_posts (campagne_slug, publie_le desc)
	where mis_en_avant and not masque;

-- Chemin inverse : « à quelles campagnes ce tweet appartient-il ». Sert aussi au
-- parcours de la cascade lors d'une purge de `tweets`.
create index if not exists x_campagne_posts_tweet_idx
	on public.x_campagne_posts (tweet_id);

-- File de modération : les posts masqués, tous slugs confondus.
create index if not exists x_campagne_posts_masques_idx
	on public.x_campagne_posts (campagne_slug, collecte_le desc) where masque;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Curseurs de récolte — PLOMBERIE INTERNE, NON PUBLIQUE
-- ─────────────────────────────────────────────────────────────────────────────
-- X impose un rate-limit agressif (429 dès ~6-8 pages consécutives, fenêtre ~15 min).
-- Rebalayer une campagne depuis zéro à chaque run est donc impossible : la récolte
-- doit reprendre là où elle s'est arrêtée.
--
-- HORS du dispositif public, exactement comme `discord_poll_votes` :
--   * aucune policy de lecture      -> `anon` et `authenticated` ne voient rien ;
--   * aucun GRANT                   -> même un contournement de RLS ne donnerait rien ;
--   * aucun trigger temps réel      -> rien ne part dans le flux SSE non authentifié.
-- Ce ne sont pas des données de l'association : ce sont les traces de notre
-- stratégie d'interrogation de X. Ne pas les publier par accident.

create table if not exists public.x_campagne_curseurs (
	campagne_slug   text not null references public.x_campagnes (slug) on delete cascade,
	-- Requête X exacte à laquelle ce curseur se rapporte. Changer une requête dans
	-- `x_campagnes.requetes` crée donc naturellement un nouveau curseur, sans risque
	-- de reprendre une pagination qui ne correspondait plus.
	requete         text not null,
	-- Curseur `next_cursor` renvoyé par X à la dernière page lue.
	-- ATTENTION : X renvoie un `next_cursor` NON NUL même avec zéro tweet (vérifié :
	-- `#iergday` -> tweets=0, cursor="DAADDAABAAgAAgAAAAIIAAMAAAAA"). Ce curseur ne
	-- vaut donc jamais preuve qu'il reste quelque chose à lire.
	curseur         text,
	-- Id le plus récent déjà vu pour cette requête : borne haute d'un run incrémental.
	dernier_id      text,
	pages_lues      integer not null default 0,
	-- Dernier arrêt : 'epuise' | 'max_pages' | 'rate_limit' | 'erreur'.
	-- Une reprise après 'rate_limit' repart du curseur ; après 'epuise' elle repart
	-- du début (les nouveaux posts sont en tête du flux Latest).
	dernier_arret   text,
	maj_le          timestamptz not null default now(),
	primary key (campagne_slug, requete)
);

comment on table public.x_campagne_curseurs is
	'Reprise de pagination X par requête. NON PUBLIC : ni GRANT, ni RLS de lecture, ni temps réel.';
comment on column public.x_campagne_curseurs.curseur is
	'X renvoie un curseur non nul même sur 0 résultat : ne jamais s''en servir comme condition d''arrêt.';
comment on column public.x_campagne_curseurs.dernier_arret is
	'epuise | max_pages | rate_limit | erreur. Seul rate_limit justifie de repartir du curseur.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Droits et RLS
-- ─────────────────────────────────────────────────────────────────────────────
-- DEUX barrières, et les deux sont nécessaires ici.
--
-- (a) Les GRANT. Contrairement aux tables héritées de Supabase, une table créée par
--     le rôle `rg` n'hérite d'AUCUN privilège pour `anon` : le seul
--     `ALTER DEFAULT PRIVILEGES` en vigueur appartient au rôle `postgres`
--     (vérifié : pg_default_acl ne contient qu'une entrée, propriétaire `postgres` ;
--     et `discord_polls`, créée par `rg`, n'a que des droits `rg`). Sans le GRANT
--     explicite ci-dessous, PostgREST, le MCP et `live_select` renverraient 42501
--     sur ces tables, quelles que soient les policies.
--
-- (b) La RLS. Le REVOKE ne suffit pas comme unique garde-fou : si la table venait à
--     être recréée par `postgres` (rejeu via Studio), le default ACL lui accorderait
--     `arwdDxtm`. Les policies restent alors la seule chose qui tienne — c'est
--     exactement le cas de `public.tweets`, où `anon` détient INSERT/UPDATE/DELETE au
--     niveau table et où seule l'absence de policy d'écriture le bloque.
--
-- Rappel du piège de 20260811_profiles_pii.sql : un GRANT au niveau TABLE masque
-- silencieusement tout REVOKE par colonne. On révoque donc la table d'abord.
-- L'ordre revoke -> grant est impératif : inversé, le REVOKE effacerait le GRANT.

revoke all on public.x_campagnes         from anon, authenticated;
revoke all on public.x_campagne_posts    from anon, authenticated;
revoke all on public.x_campagne_curseurs from anon, authenticated;

grant select on public.x_campagnes      to anon, authenticated;
grant select on public.x_campagne_posts to anon, authenticated;
-- `x_campagne_curseurs` : aucun GRANT. Volontaire.

grant select, insert, update, delete
	on public.x_campagnes, public.x_campagne_posts, public.x_campagne_curseurs
	to service_role;

alter table public.x_campagnes         enable row level security;
alter table public.x_campagne_posts    enable row level security;
alter table public.x_campagne_curseurs enable row level security;

drop policy if exists "Lecture publique des campagnes publiees" on public.x_campagnes;
create policy "Lecture publique des campagnes publiees"
	on public.x_campagnes for select
	using (publiee);

-- Deux conditions, et les deux comptent : le post ne doit pas être masqué ET sa
-- campagne doit être publiée. Dépublier une campagne entière doit suffire à retirer
-- ses publications, sans avoir à masquer chaque post un par un.
drop policy if exists "Lecture publique des posts de campagne" on public.x_campagne_posts;
create policy "Lecture publique des posts de campagne"
	on public.x_campagne_posts for select
	using (
		not masque
		and exists (
			select 1 from public.x_campagnes c
			 where c.slug = x_campagne_posts.campagne_slug
			   and c.publiee
		)
	);

-- `x_campagne_curseurs` : aucune policy, donc aucune lecture hors propriétaire /
-- service_role. Ne pas en ajouter.

-- Aucune policy d'écriture nulle part : la récolte passe par la connexion Postgres
-- directe du cron (rôle `rg`, propriétaire des tables et donc exempté de RLS —
-- il n'est ni superutilisateur ni BYPASSRLS, c'est bien l'exemption du propriétaire
-- qui joue), jamais par PostgREST. Même choix que pour `discord_messages`.
-- COROLLAIRE POUR LES LECTURES DU SITE : `getPgPool()` se connecte lui aussi en `rg`,
-- donc SANS RLS. Les clauses `publiee` / `not masque` doivent figurer EXPLICITEMENT
-- dans chaque requête de `apps/website/src/lib/x-campagnes/queries.ts`.

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Temps réel
-- ─────────────────────────────────────────────────────────────────────────────
-- AUCUN trigger temps réel sur ces tables — décision de sécurité, pas un oubli.
--
-- `rg_realtime_notify()` diffuse `to_jsonb(NEW)` ENTIER sur le canal `rg_realtime`,
-- que rg-realtime relaie en SSE SANS authentification ni liste blanche de tables
-- (`apps/realtime/server.ts` : le paramètre `table` est libre, CORS `*`). Sa liste
-- de colonnes privées est codée en dur pour la seule table `profiles`.
--
-- Poser le trigger ici contournerait donc par le bas les deux règles que cette
-- migration vient d'établir, ce qui a été vérifié en conditions réelles sur
-- https://realtime.rosegriffon.fr/stream?table=x_campagne_posts :
--   * `x_campagne_posts` -> un masquage diffusait `masque`, `tweet_id` ET le
--     `motif_masquage` en clair. Le motif est du texte libre de modération : c'est
--     précisément là qu'on écrit « signalement RGPD », un nom, une mise en demeure.
--     Masquer un post l'annonçait donc publiquement, en direct, avec son motif —
--     la modération se retournait contre la personne qu'elle protège.
--   * `x_campagnes` -> une campagne `publiee = false` (brouillon, partenariat non
--     annoncé) partait intégralement dans le flux, alors que la policy
--     « Lecture publique des campagnes publiees » l'interdit côté REST.
--
-- Aucun client ne s'y abonnait (aucune occurrence de `x_campagne` dans
-- `apps/website/src/lib/realtime.ts` ni ailleurs), le retrait ne coûte rien.
-- POUR RÉTABLIR LE TEMPS RÉEL un jour : il faut d'abord un chemin d'expurgation
-- (retirer `motif_masquage`, ne rien émettre pour une ligne `masque` ou une
-- campagne non publiée) — ne pas se contenter de recréer le trigger.

drop trigger if exists rg_realtime_x_campagnes on public.x_campagnes;
drop trigger if exists rg_realtime_x_campagne_posts on public.x_campagne_posts;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Amorçage
-- ─────────────────────────────────────────────────────────────────────────────
-- Campagnes vérifiées le 12/8/2026 : annonce retrouvée dans `discord_messages` pour
-- les campagnes maison (._sasha_. le 2/8/2023 pour Inazuma RG, jennscarlet le
-- 2/8/2024 pour la seconde édition, inazo__ le 15/9/2023 pour l'Inatober), volume
-- mesuré sur X pour chacune.
-- `on conflict do nothing` : rejouer la migration ne doit jamais écraser une
-- correction faite à la main en production.

insert into public.x_campagnes
	(slug, titre, sur_titre, description, hashtags, requetes,
	 debut_le, fin_le, actif, publiee, principale)
values
	-- Campagne LEVEL-5 en cours, relayée par l'association (@Azalee_IE le 10/8/2026,
	-- retweeté par @rose_griffon) : mosaïque collaborative pour l'anniversaire de
	-- Mark Evans et les 18 ans de la licence. 20/20 des posts mesurés portent une
	-- image. C'est elle qui remplit la page dès le premier run, d'où `principale`.
	('inazuma-day-2026',
	 'Inazuma Day 2026',
	 'Campagne en cours',
	 'Pour l''anniversaire de Mark Evans et les 18 ans de la licence, LEVEL-5 a lancé une mosaïque collaborative : une image, le hashtag, et la mention du compte officiel. Voici les créations de la communauté.',
	 array['inazumaday', '8月22日はイナイレの日'],
	 array[
		'#InazumaDay filter:images -filter:replies since:2026-08-05',
		'#8月22日はイナイレの日 filter:images -filter:replies since:2026-08-05'
	 ],
	 '2026-08-05 00:00:00+00', '2026-08-31 23:59:59+00', true, true, true),

	-- Campagne demandée au lancement du chantier. Aucun post à ce jour : cinq sondes
	-- indépendantes (X Latest, X Top paginé, table `tweets`, `discord_messages`,
	-- recherche web) sont revenues vides le 12/8/2026. Elle est semée `actif` pour
	-- que la récolte la ramasse dès la première publication, sans déploiement — et
	-- `publiee` pour que sa page affiche un état vide soigné en attendant.
	('iergday',
	 'IERG Day',
	 'Campagne à venir',
	 'La journée Rose Griffon : une image publiée sur X avec le hashtag, et elle rejoint cette galerie automatiquement.',
	 array['iergday'],
	 array['#IERGDay -filter:replies'],
	 null, null, true, true, false),

	-- Campagne fondatrice de l'association, annoncée sur Discord par ._sasha_. le
	-- 2/8/2023. 172 posts mesurés sur X, dont 155 avec photo (90 %), 65 auteurs,
	-- du 2/8/2023 au 29/3/2025. C'est la plus riche archive disponible.
	('inazuma-rg',
	 'Inazuma RG',
	 'Édition 2023',
	 'La première grande campagne de créations de l''association : un mois pour partager ses dessins, montages et écrits Inazuma Eleven.',
	 array['inazumarg'],
	 array[
		'#inazumaRG -filter:replies',
		'#inazumaRG -filter:replies since:2023-08-01 until:2023-09-15'
	 ],
	 '2023-08-01 00:00:00+00', '2023-09-15 23:59:59+00', false, true, false),

	-- Seconde édition, annoncée par jennscarlet le 2/8/2024, clôture le 31 août.
	('inazuma-rg-2',
	 'Inazuma RG 2',
	 'Édition 2024',
	 'Deuxième édition de la campagne de créations : mêmes règles, nouvelle fournée.',
	 array['inazumarg2'],
	 array[
		'#InazumaRG2 -filter:replies',
		'#InazumaRG2 -filter:replies since:2024-08-01 until:2024-09-30'
	 ],
	 '2024-08-01 00:00:00+00', '2024-09-30 23:59:59+00', false, true, false),

	-- Les trois Inatober (défi de dessin d'octobre), annoncés respectivement par
	-- inazo__ (2023, 2025) et dleez215e (2024).
	('inatober-rg-2023',
	 'Inatober RG 2023',
	 'Défi d''octobre',
	 'Un mois, une liste de thèmes, un dessin par jour : l''Inatober de la communauté Rose Griffon.',
	 array['inatoberrg2023'],
	 array['#InatoberRG2023 -filter:replies since:2023-09-25 until:2023-11-15'],
	 '2023-10-01 00:00:00+00', '2023-11-15 23:59:59+00', false, true, false),

	('inatober-rg-2024',
	 'Inatober RG 2024',
	 'Défi d''octobre',
	 'Un mois, une liste de thèmes, un dessin par jour : l''Inatober de la communauté Rose Griffon.',
	 array['inatoberrg2024'],
	 array['#InatoberRG2024 -filter:replies since:2024-09-25 until:2024-11-15'],
	 '2024-10-01 00:00:00+00', '2024-11-15 23:59:59+00', false, true, false),

	('inatober-rg-2025',
	 'Inatober RG 2025',
	 'Défi d''octobre',
	 'Un mois, une liste de thèmes, un dessin par jour : l''Inatober de la communauté Rose Griffon.',
	 array['inatoberrg2025'],
	 array['#InatoberRG2025 -filter:replies since:2025-09-25 until:2025-11-15'],
	 '2025-10-01 00:00:00+00', '2025-11-15 23:59:59+00', false, true, false)
on conflict (slug) do nothing;

commit;
