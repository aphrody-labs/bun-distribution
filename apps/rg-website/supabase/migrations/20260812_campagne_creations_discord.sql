-- Les créations DISCORD d'une campagne rejoignent la galerie de /iergday.
--
-- Application :
--   psql "$DATABASE_URL" -f apps/website/supabase/migrations/20260812_campagne_creations_discord.sql
-- (« psql -d rg » échoue sur cette instance : il n'existe pas de rôle `ubuntu`.)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POURQUOI CETTE TABLE EXISTE
-- ─────────────────────────────────────────────────────────────────────────────
-- La galerie de /iergday ne sait lire qu'une source : `x_campagne_posts`, c'est-
-- à-dire des tweets. Or, mesuré le 12/8/2026, AUCUNE des 12 998 lignes de
-- `public.tweets` ne porte `#inazumarg`, `#inatoberrg*` ni `#iergday`. Les cinq
-- campagnes archivées ont donc une galerie structurellement vide : leurs
-- créations n'ont jamais transité par X — elles ont été déposées dans des salons
-- Discord dédiés, et pour partie publiées sur Instagram (aucun collecteur ici).
--
-- Cette table est le pendant Discord de `x_campagne_posts` : une table
-- d'ASSOCIATION (campagne ↔ message archivé), pas une copie du message. Le
-- contenu, l'auteur et les pièces jointes vivent dans `public.discord_messages`,
-- exactement comme le texte d'un tweet vit dans `public.tweets`.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LA SEULE EXCEPTION : LES IMAGES SONT RÉ-HÉBERGÉES, ET LEUR CHEMIN EST STOCKÉ ICI
-- ─────────────────────────────────────────────────────────────────────────────
-- `discord_messages.attachments` recopie les URL de l'API Discord telles quelles,
-- or elles sont SIGNÉES (`?ex=…&is=…&hm=…`) et expirent en moins de 24 h — la
-- même URL privée de sa query répond 404. C'est déjà la raison pour laquelle
-- `apps/website/src/lib/discord/url.ts` (`estUrlDiscordExpirante`,
-- `urlPubliableOuNull`) les écarte du rendu : mieux vaut ne rien servir qu'un
-- lien mort le lendemain.
-- La colonne `images` porte donc le CHEMIN de la copie faite dans le bucket
-- public `assets` par le cron (même remède que `discord_polls.visual_path`), et
-- jamais l'URL signée. C'est la seule dénormalisation de la table, et elle est
-- indispensable : sans elle, une galerie « Discord » afficherait des images
-- mortes 24 h après chaque récolte.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CE QUI EST BLOQUÉ, ET QUI N'EST PAS SIMULÉ
-- ─────────────────────────────────────────────────────────────────────────────
-- Les salons de dépôt vivent dans la catégorie « Archives » (`1180594177063526441`)
-- et le bot n'y a PAS accès : `GET /channels/<id>` renvoie
-- `{"message":"Missing Access","code":50001}` (revérifié le 13/8/2026 sur les
-- quatre identifiants). Ses surcharges refusent `VIEW_CHANNEL` à `@everyone` et
-- ne l'accordent qu'au rôle `Staffs` (`1072992327766904865`) ; le bot n'a ni
-- `MANAGE_ROLES` ni `MANAGE_CHANNELS`, il ne peut donc pas se l'accorder.
-- SEUL UN HUMAIN PEUT DÉBLOQUER ÇA. Aucune ligne de création n'est semée ici en
-- attendant : une galerie remplie de données inventées est exactement le défaut
-- que ce chantier répare. La table reste vide, la page le dit honnêtement, et la
-- récolte s'exécutera d'elle-même le jour où l'accès sera donné.
--
-- REJOUABLE : `create table if not exists`, `add column if not exists`,
-- `create index if not exists`, `drop policy if exists` avant chaque `create
-- policy`, `on conflict` sur chaque insertion et `where … is distinct from …`
-- sur chaque mise à jour. Un second passage ne touche aucune ligne.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Salons de dépôt : la campagne sait où ses créations ont été déposées
-- ─────────────────────────────────────────────────────────────────────────────
-- Une création Discord se rattache à une campagne par DEUX chemins, et il faut
-- les deux :
--   * le HASHTAG écrit dans le message (comme sur X) ;
--   * l'APPARTENANCE au salon de dépôt de la campagne — c'est le cas majoritaire,
--     personne n'écrit le hashtag dans le salon qui lui est déjà consacré.
-- Le second chemin exige de connaître le salon : d'où cette colonne.

alter table public.x_campagnes
	add column if not exists salons_depot text[] not null default '{}';

comment on column public.x_campagnes.salons_depot is
	'Salons Discord où les créations de la campagne ont été déposées (snowflakes). Second chemin de rattachement, borné par la fenêtre debut_le/fin_le.';

-- Un identifiant Discord est un snowflake : uniquement des chiffres. La forme
-- `salons_depot::text` (et non un `unnest`) reprend celle de
-- `x_campagnes_hashtags_normalises` : PostgreSQL refuse une sous-requête dans une
-- contrainte CHECK, et la conversion d'E/S d'un tableau est immutable.
--   {123…,456…} -> passe          {abc}     -> rejeté
--   {}          -> passe          {ok,NULL} -> rejeté (le littéral NULL n'est pas numérique)
-- `drop … if exists` puis `add` plutôt qu'un `do $$ … $$` : c'est la forme la
-- plus courte qui reste rejouable, et elle réécrit la contrainte si sa définition
-- change un jour.
alter table public.x_campagnes
	drop constraint if exists x_campagnes_salons_depot_snowflakes;
alter table public.x_campagnes
	add constraint x_campagnes_salons_depot_snowflakes
	check (salons_depot::text ~ '^[{](\d{15,25}([,]\d{15,25})*)?[}]$');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La table d'association
-- ─────────────────────────────────────────────────────────────────────────────
-- Colonnes CALQUÉES sur `x_campagne_posts` : même vocabulaire, mêmes garanties de
-- modération, donc mêmes réflexes pour qui connaît déjà l'autre table. Les deux
-- sources remontent d'ailleurs dans un seul et même type côté site
-- (`PostCampagne`, discriminé par `source`).

create table if not exists public.campagne_creations_discord (
	campagne_slug   text not null references public.x_campagnes (slug) on delete cascade,
	-- `on delete cascade` sur le message : un message effacé de l'archive ne doit
	-- pas laisser derrière lui une carte vide dans la galerie. La suppression
	-- ORDINAIRE d'un message Discord, elle, ne supprime rien — elle pose
	-- `discord_messages.deleted_at`, et c'est la policy plus bas qui la masque.
	message_id      text not null references public.discord_messages (message_id) on delete cascade,

	-- Le hashtag de la campagne trouvé dans le message (minuscules, sans
	-- croisillon), ou NULL quand le rattachement vient du SALON DE DÉPÔT. NULL est
	-- ici une information exacte, pas une lacune : le message n'en portait aucun.
	hashtag_trouve  text,

	-- ⚠ SÉMANTIQUE VOLONTAIREMENT PLUS STRICTE QUE DANS `x_campagne_posts`.
	-- Là-bas, `a_media` veut dire « le post porte une photo ». Ici il veut dire
	-- « au moins une image a été RÉ-HÉBERGÉE et est donc servable ». La nuance est
	-- nécessaire : une image Discord non recopiée n'est pas affichable (URL signée
	-- expirée), et une galerie qui la compterait annoncerait des créations qu'elle
	-- ne peut pas montrer. Une recopie qui échoue laisse donc `a_media = false` ;
	-- la passe suivante retente et bascule la ligne à `true` toute seule.
	a_media         boolean not null default false,
	-- Nombre d'images ré-hébergées (« +3 » de la mosaïque), même sémantique.
	nb_images       smallint not null default 0,

	-- Images ré-hébergées, dans l'ordre du message :
	--   [{ "attachment_id": "…", "chemin": "campagnes/<slug>/discord/<msg>-<pj>.png",
	--      "nom": "dessin.png", "type_mime": "image/png",
	--      "largeur": 1200, "hauteur": 1600, "taille": 482113,
	--      "url_origine": "https://cdn.discordapp.com/…" }]
	-- `chemin` est un chemin DANS le bucket public `assets`, jamais une URL signée.
	-- `chemin = null` = recopie encore en échec : l'entrée reste pour que la passe
	-- suivante retente sans redemander Discord depuis zéro.
	-- `url_origine` est conservée SANS sa signature (query retirée) : elle sert de
	-- trace de provenance, elle n'est jamais servie au navigateur.
	images          jsonb not null default '[]'::jsonb,

	-- Mise en avant éditoriale (bandeau « À la une »), comme pour les tweets.
	mis_en_avant    boolean not null default false,

	-- MODÉRATION. Une ligne masquée est CONSERVÉE : c'est ce qui empêche la
	-- récolte suivante de la faire réapparaître (la clé primaire existe déjà,
	-- l'upsert tombe sur `do update` et ne touche pas à ces deux colonnes).
	masque          boolean not null default false,
	motif_masquage  text,

	-- Copie de `discord_messages.created_at` figée à l'insertion : trier et
	-- paginer la galerie sans trier la jointure entière.
	publie_le       timestamptz,

	collecte_le     timestamptz not null default now(),

	primary key (campagne_slug, message_id),

	-- Un tableau JSON, jamais un objet ni une chaîne : le site itère dessus.
	constraint campagne_creations_discord_images_tableau
		check (jsonb_typeof(images) = 'array')
);

comment on table public.campagne_creations_discord is
	'Rattachement d''un message Discord archivé à une campagne. Pendant Discord de x_campagne_posts ; le contenu vit dans public.discord_messages.';
comment on column public.campagne_creations_discord.hashtag_trouve is
	'Hashtag de la campagne présent dans le message (minuscules, sans croisillon). NULL = rattachement par le salon de dépôt.';
comment on column public.campagne_creations_discord.a_media is
	'Au moins une image RÉ-HÉBERGÉE, donc servable. Plus strict que x_campagne_posts.a_media : une URL Discord signée n''est pas affichable.';
comment on column public.campagne_creations_discord.images is
	'Images recopiées dans le bucket public `assets` : [{attachment_id, chemin, nom, type_mime, largeur, hauteur, taille, url_origine}]. Jamais d''URL signée.';
comment on column public.campagne_creations_discord.masque is
	'Retiré du site. La ligne est CONSERVÉE : c''est ce qui empêche une récolte ultérieure de la réafficher.';
comment on column public.campagne_creations_discord.publie_le is
	'Copie de discord_messages.created_at, pour trier et paginer sans trier la jointure.';

-- Index CALQUÉS sur ceux de `x_campagne_posts` : la galerie fusionne les deux
-- sources dans un même `union all`, les deux moitiés doivent donc être servies
-- par le même genre de parcours.
--
-- ⚠ Pas de `nulls last` dans l'ORDER BY côté site : un `desc` est NULLS FIRST par
-- défaut, et c'est cet ordre-là que l'index matérialise (mesure faite sur
-- `x_campagne_posts_galerie_idx`, cf. le commentaire de queries.ts).
create index if not exists campagne_creations_discord_galerie_idx
	on public.campagne_creations_discord (campagne_slug, publie_le desc)
	where not masque and a_media;

create index if not exists campagne_creations_discord_vedette_idx
	on public.campagne_creations_discord (campagne_slug, publie_le desc)
	where mis_en_avant and not masque;

-- Chemin inverse (« à quelles campagnes ce message appartient-il ») et parcours
-- de la cascade lors d'une purge de `discord_messages`.
create index if not exists campagne_creations_discord_message_idx
	on public.campagne_creations_discord (message_id);

-- File de modération : les créations masquées, tous slugs confondus.
create index if not exists campagne_creations_discord_masquees_idx
	on public.campagne_creations_discord (campagne_slug, collecte_le desc) where masque;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Droits et RLS
-- ─────────────────────────────────────────────────────────────────────────────
-- Même dispositif que `20260812_campagnes_x.sql`, et pour les mêmes raisons :
--   (a) une table créée par le rôle `rg` n'accorde RIEN à `anon` par défaut
--       (le seul ALTER DEFAULT PRIVILEGES en vigueur appartient à `postgres`),
--       donc sans GRANT explicite PostgREST et le MCP répondraient 42501 ;
--   (b) la RLS reste la barrière qui tient si la table venait à être recréée par
--       `postgres` (rejeu via Studio), auquel cas le default ACL lui donnerait
--       `arwdDxtm`.
-- Rappel du piège de `20260811_profiles_pii.sql` : un GRANT au niveau TABLE
-- masque silencieusement tout REVOKE par colonne — on révoque la table d'abord.
-- L'ordre revoke -> grant est impératif : inversé, le REVOKE effacerait le GRANT.

revoke all on public.campagne_creations_discord from anon, authenticated;
grant select on public.campagne_creations_discord to anon, authenticated;
grant select, insert, update, delete on public.campagne_creations_discord to service_role;

alter table public.campagne_creations_discord enable row level security;

-- LA POLICY N'EST PAS PLUS PERMISSIVE QUE CELLES DONT ELLE DÉPEND.
-- Elle est l'INTERSECTION de trois règles déjà en vigueur :
--   * « Lecture publique des posts de campagne » (x_campagne_posts) :
--         not masque ET campagne publiée ;
--   * « Lecture publique des messages archives » (discord_messages) :
--         deleted_at is null ET salon suivi.
-- Retirer un salon de la veille, dépublier une campagne, effacer un message ou
-- masquer une création : chacun de ces quatre gestes suffit, seul, à retirer la
-- création du site. Ne jamais relâcher l'une de ces conditions sans relâcher
-- d'abord celle dont elle est copiée — ce serait publier par cette table ce que
-- l'autre interdit.
drop policy if exists "Lecture publique des creations Discord" on public.campagne_creations_discord;
create policy "Lecture publique des creations Discord"
	on public.campagne_creations_discord for select
	using (
		not masque
		and exists (
			select 1 from public.x_campagnes c
			 where c.slug = campagne_creations_discord.campagne_slug
			   and c.publiee
		)
		and exists (
			select 1
			  from public.discord_messages m
			  join public.discord_channels s on s.channel_id = m.channel_id
			 where m.message_id = campagne_creations_discord.message_id
			   and m.deleted_at is null
			   and s.suivi
		)
	);

-- Aucune policy d'écriture : la récolte passe par la connexion Postgres directe
-- du cron (rôle `rg`, propriétaire, donc exempté de RLS), jamais par PostgREST.
-- COROLLAIRE POUR LE SITE : `getPgPool()` se connecte lui aussi en `rg`, donc
-- SANS RLS. Les quatre conditions ci-dessus sont RECOPIÉES EXPLICITEMENT dans
-- `apps/website/src/lib/x-campagnes/queries.ts`. Ce n'est pas une redondance de
-- confort : sans elles, le site publierait les créations d'une campagne
-- dépubliée, d'un salon retiré de la veille, ou masquées par un modérateur.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Temps réel : AUCUN trigger, décision de sécurité (pas un oubli)
-- ─────────────────────────────────────────────────────────────────────────────
-- Même raisonnement que pour `x_campagne_posts` : `rg_realtime_notify()` diffuse
-- `to_jsonb(NEW)` ENTIER sur un flux SSE NON authentifié, dont la liste de
-- colonnes privées est codée en dur pour la seule table `profiles`. Poser le
-- trigger ici annoncerait publiquement, en direct, chaque masquage AVEC son
-- `motif_masquage` — c'est-à-dire le texte libre où l'on écrit « signalement
-- RGPD », un nom, une mise en demeure. La modération se retournerait contre la
-- personne qu'elle protège.
drop trigger if exists rg_realtime_campagne_creations_discord on public.campagne_creations_discord;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Les salons de dépôt, tels que les annonces les nomment
-- ─────────────────────────────────────────────────────────────────────────────
-- Chaque rattachement ci-dessous cite le message d'annonce qui le porte. Rien
-- n'est déduit sans le dire.
--
--   `inazuma-rg`       -> 1136706802579411025 (⚡〡inazuma-rg)
--   `inatober-rg-2023` -> 1153955426191278132 (⚡〡inatober-rg)
--   `inazuma-rg-2`     -> 1268959169268944958 (⚡〡inazuma-rg2)
--   `inatober-rg-2024` -> 1153955426191278132, écrit noir sur blanc par l'annonce
--        `1290343058793173042` : « en utilisant le hashtag #InatoberRG2024 sur les
--        réseaux (insta, twitter) ou ici dans <#1153955426191278132> ».
--   `inatober-rg-2025` -> 1153955426191278132, de même par `1422662293027815515` :
--        « dans votre publication et/ou bien dans le salon dédié
--        <#1153955426191278132> ».
--
-- ⚠ UN SALON POUR TROIS ÉDITIONS. `1153955426191278132` sert aux Inatober 2023,
-- 2024 ET 2025 : l'appartenance au salon ne suffit donc PAS à désigner une
-- édition. Le rattachement par salon est pour cette raison BORNÉ par la fenêtre
-- `debut_le`/`fin_le` de la campagne (côté cron), là où le rattachement par
-- hashtag, lui, est sans ambiguïté et reste non borné.
--
-- ⚠ `1242631641038458930` est le quatrième salon inaccessible de la catégorie
-- « Archives ». Aucune annonce archivée ne le nomme et aucune ne le rattache à
-- une campagne : il n'est donc rattaché à RIEN ici. Lui inventer une campagne
-- serait exactement la faute que cette migration répare.

update public.x_campagnes c set salons_depot = v.salons, updated_at = now()
  from (values
	('inazuma-rg',       array['1136706802579411025']),
	('inatober-rg-2023', array['1153955426191278132']),
	('inazuma-rg-2',     array['1268959169268944958']),
	('inatober-rg-2024', array['1153955426191278132']),
	('inatober-rg-2025', array['1153955426191278132'])
  ) as v(slug, salons)
 where c.slug = v.slug
   and c.salons_depot is distinct from v.salons;

-- Les trois salons de dépôt NOMMÉS par les annonces entrent dans le registre des
-- salons, avec les métadonnées mesurées (catégorie « Archives », serveur Rose
-- Griffon). Le démon réécrira nom, type et position dès qu'il pourra les lire.
--
-- `suivi = true` EST DÉLIBÉRÉ, malgré le 403 : c'est ce qui rend la chaîne
-- « armée ». Le jour où un humain accorde `VIEW_CHANNEL` au bot, la veille
-- (`discord:messages`, toutes les 5 minutes) archive le salon, puis la récolte
-- (`campagnes:discord`, à la minute 25) remplit la table — sans qu'aucune ligne
-- de SQL ni aucun déploiement soit nécessaire.
-- LE COÛT, CONNU ET ASSUMÉ : jusque-là, `runDiscordMessagesSync()` journalise à
-- chaque passage « Échec sur le salon … : Discord a répondu 403 … Missing
-- Access ». C'est un signal juste, pas du bruit : il nomme précisément ce qui
-- manque. La synchro continue pour les autres salons (le try/catch est par
-- salon) et ces trois lignes n'exposent rien — elles n'ont aucun message
-- archivé, et la policy de `discord_messages` ne montre que ce qui existe.
--
-- `type` est volontairement ABSENT de la liste de colonnes : il n'a pas pu être
-- mesuré (403), et la valeur par défaut de la colonne (0, salon textuel) est une
-- valeur d'attente, pas une observation. Le démon écrira le type réel.
insert into public.discord_channels
	(channel_id, guild_id, name, parent_id, suivi)
values
	('1136706802579411025', '1072991720268111892', '⚡〡inazuma-rg',  '1180594177063526441', true),
	('1153955426191278132', '1072991720268111892', '⚡〡inatober-rg', '1180594177063526441', true),
	('1268959169268944958', '1072991720268111892', '⚡〡inazuma-rg2', '1180594177063526441', true)
on conflict (channel_id) do update
	set suivi      = true,
	    guild_id   = excluded.guild_id,
	    updated_at = now()
 where discord_channels.suivi is distinct from true;

commit;
