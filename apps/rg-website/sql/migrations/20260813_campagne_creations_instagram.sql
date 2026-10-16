-- Les créations INSTAGRAM d'une campagne rejoignent la galerie de /iergday.
--
-- Application :
--   psql "$DATABASE_URL" -f apps/website/sql/migrations/20260813_campagne_creations_instagram.sql
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POURQUOI ELLE SE REMPLIT À LA MAIN, ET PAS PAR UN COLLECTEUR
-- ─────────────────────────────────────────────────────────────────────────────
-- Le règlement de la campagne autorise Instagram, mais il n'existe AUCUN moyen
-- automatique d'y récolter un hashtag aujourd'hui. Mesuré le 13/8/2026, sans
-- compte connecté :
--   * `/explore/tags/<tag>/?__a=1`         -> 200 avec une enveloppe d'erreur Meta, zéro donnée
--   * `/graphql/query/?query_hash=…`       -> 401 `require_login`
--   * `/api/v1/tags/web_info/`             -> 302 vers /accounts/login/
--   * HTML d'une page de tag ou de post    -> 605 Ko sans `window._sharedData`,
--                                             sans balise `og:`, sans JSON-LD
-- Les bibliothèques (`instaloader`, `instagrapi`) exigent toutes une session
-- Instagram : les utiliser avec le compte de l'association l'exposerait à un
-- blocage en pleine campagne. L'API Graph officielle, elle, fonctionne mais
-- demande compte pro + Page Facebook + App Review Meta (2 à 4 semaines), et ne
-- rend même pas le champ `username` — donc pas d'attribution d'auteur.
--
-- D'où cette table : le participant DÉPOSE le permalien de sa publication et son
-- image. Le lien est vérifié par l'oEmbed public de Meta (200 = la publication
-- existe et est publique ; 400 / code 24 = privée ou supprimée), l'image est
-- ré-hébergée dans le bucket `assets`, et l'auteur est exact puisque c'est lui
-- qui se nomme.
--
-- ⚠ `origine` distingue les deux chemins et rend la table prête pour le jour où
-- l'API Graph sera accordée : `graph_api` s'insérera à côté de `formulaire`, la
-- clé primaire `(campagne_slug, shortcode)` dédoublonnant une publication à la
-- fois déposée et récoltée.
--
-- REJOUABLE : `create table if not exists`, `create index if not exists`,
-- `drop policy if exists` avant chaque `create policy`.

begin;

create table if not exists public.campagne_creations_instagram (
	campagne_slug   text not null references public.x_campagnes (slug) on delete cascade,

	-- L'identifiant chez la source : `Db_AxXAlywQ` dans
	-- `https://www.instagram.com/p/Db_AxXAlywQ/`. C'est la seule clé stable — le
	-- permalien peut s'écrire avec ou sans le pseudo du compte, avec ou sans
	-- query, et deux écritures du même post doivent produire UNE ligne.
	shortcode       text not null,
	permalink       text not null,

	-- Saisi par le déposant. L'API Graph ne rend PAS `username` : le jour où elle
	-- alimentera cette table, cette colonne sera NULL pour ses lignes, et c'est
	-- une lacune honnête plutôt qu'un pseudo deviné depuis le permalien.
	auteur_pseudo   text,
	legende         text,

	-- Hashtag de la campagne trouvé dans la légende (minuscules, sans croisillon),
	-- ou NULL quand le dépôt ne le porte pas. NULL est une information exacte.
	hashtag_trouve  text,

	-- ⚠ MÊME SÉMANTIQUE STRICTE QUE POUR DISCORD : `a_media` veut dire « au moins
	-- une image RÉ-HÉBERGÉE, donc servable », pas « la publication a une photo ».
	-- Les URL `scontent.cdninstagram.com` sont signées et expirent exactement
	-- comme celles de Discord : une galerie qui les compterait annoncerait des
	-- créations qu'elle ne peut pas montrer.
	a_media         boolean not null default false,
	nb_images       smallint not null default 0,
	-- [{ "chemin": "campagnes/<slug>/instagram/<shortcode>-0.webp", "nom": …,
	--    "type_mime": …, "largeur": …, "hauteur": …, "taille": …,
	--    "url_origine": … }] — `chemin` dans le bucket `assets`, jamais d'URL signée.
	images          jsonb not null default '[]'::jsonb,

	mis_en_avant    boolean not null default false,

	-- MODÉRATION. Une ligne masquée est CONSERVÉE : c'est ce qui empêche un
	-- re-dépôt de la faire réapparaître (la clé primaire existe déjà, l'upsert
	-- tombe sur `do update` et ne touche pas à ces deux colonnes).
	masque          boolean not null default false,
	motif_masquage  text,

	publie_le       timestamptz,
	collecte_le     timestamptz not null default now(),

	-- D'où vient la ligne. `formulaire` = déposée par un membre connecté ;
	-- `graph_api` = récoltée par l'API officielle le jour où elle sera accordée ;
	-- `staff` = ajoutée à la main par l'équipe.
	origine         text not null default 'formulaire',
	-- Qui a déposé. NULL pour `graph_api`. Sert au diagnostic d'abus (plusieurs
	-- dépôts douteux d'un même compte) et à retrouver le déposant.
	soumis_par      uuid,

	primary key (campagne_slug, shortcode),

	constraint campagne_creations_instagram_images_tableau
		check (jsonb_typeof(images) = 'array'),
	constraint campagne_creations_instagram_origine
		check (origine in ('formulaire', 'graph_api', 'staff')),
	-- Un shortcode Instagram : lettres, chiffres, tiret et souligné, 5 à 30
	-- caractères. Le contraindre ici évite qu'une URL entière atterrisse dans la
	-- colonne et casse la déduplication.
	constraint campagne_creations_instagram_shortcode
		check (shortcode ~ '^[A-Za-z0-9_-]{5,30}$')
);

comment on table public.campagne_creations_instagram is
	'Créations Instagram d''une campagne, déposées à la main (aucun collecteur automatique n''existe) ou récoltées par l''API Graph.';
comment on column public.campagne_creations_instagram.shortcode is
	'Identifiant de la publication chez Instagram — la seule clé stable, extraite du permalien.';
comment on column public.campagne_creations_instagram.auteur_pseudo is
	'Pseudo Instagram saisi par le déposant. NULL pour les lignes venues de l''API Graph, qui ne rend pas ce champ.';
comment on column public.campagne_creations_instagram.a_media is
	'Au moins une image RÉ-HÉBERGÉE, donc servable. Une URL scontent.cdninstagram.com est signée et expire.';
comment on column public.campagne_creations_instagram.masque is
	'Retiré du site. La ligne est CONSERVÉE : c''est ce qui empêche un re-dépôt de la réafficher.';
comment on column public.campagne_creations_instagram.origine is
	'formulaire = déposée par un membre ; graph_api = récoltée par l''API officielle ; staff = ajoutée par l''équipe.';

-- Index calqués sur les deux autres sources : la galerie fusionne les trois dans
-- un même `union all`, les trois moitiés doivent être servies pareil.
create index if not exists campagne_creations_instagram_galerie_idx
	on public.campagne_creations_instagram (campagne_slug, publie_le desc)
	where not masque and a_media;

create index if not exists campagne_creations_instagram_vedette_idx
	on public.campagne_creations_instagram (campagne_slug, publie_le desc)
	where mis_en_avant and not masque;

create index if not exists campagne_creations_instagram_masquees_idx
	on public.campagne_creations_instagram (campagne_slug, collecte_le desc) where masque;

-- Diagnostic d'abus : tous les dépôts d'un même membre, du plus récent au plus
-- ancien. Partiel, parce que `soumis_par` est NULL pour tout ce qui ne vient pas
-- du formulaire.
create index if not exists campagne_creations_instagram_deposant_idx
	on public.campagne_creations_instagram (soumis_par, collecte_le desc)
	where soumis_par is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Droits et RLS — même dispositif que la table Discord, mêmes raisons.
-- ⚠ L'ordre revoke -> grant est impératif : inversé, le REVOKE effacerait le GRANT.
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on public.campagne_creations_instagram from anon, authenticated;
grant select on public.campagne_creations_instagram to anon, authenticated;
grant select, insert, update, delete on public.campagne_creations_instagram to service_role;

alter table public.campagne_creations_instagram enable row level security;

-- INTERSECTION des mêmes règles que les deux autres sources : non masquée ET
-- campagne publiée. Il n'y a pas de troisième condition ici — contrairement à
-- Discord, il n'existe pas de « salon retiré de la veille » ni de « message
-- effacé » : la publication vit chez Instagram, et son retrait se constate par
-- l'oEmbed puis se traduit en `masque = true`.
drop policy if exists "Lecture publique des creations Instagram" on public.campagne_creations_instagram;
create policy "Lecture publique des creations Instagram"
	on public.campagne_creations_instagram for select
	using (
		not masque
		and exists (
			select 1 from public.x_campagnes c
			 where c.slug = campagne_creations_instagram.campagne_slug
			   and c.publiee
		)
	);

-- Aucune policy d'écriture : le dépôt passe par une server action du site, qui
-- se connecte en `rg` (propriétaire, donc exempté de RLS) APRÈS avoir vérifié la
-- session du membre. Jamais par PostgREST avec la clé `anon`.

-- ⚠ AUCUN trigger `rg_realtime_notify` — décision de sécurité, pas un oubli.
-- Il diffuserait `to_jsonb(NEW)` ENTIER sur un flux SSE NON authentifié, donc
-- `motif_masquage` (texte libre où l'on écrit « signalement RGPD », un nom) et
-- `soumis_par` (l'identifiant du membre déposant).
drop trigger if exists rg_realtime_campagne_creations_instagram on public.campagne_creations_instagram;

commit;
