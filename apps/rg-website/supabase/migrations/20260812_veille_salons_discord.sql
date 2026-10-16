-- Veille des salons Discord suivis (annonces, sondages) et diffusion temps réel.
--
-- OBJECTIF
-- Archiver en base le contenu de salons Discord choisis, puis le rediffuser sur le
-- site public en temps réel via `rg-realtime` (LISTEN/NOTIFY -> SSE).
--
-- CE QUI EST PUBLIC, ET POURQUOI C'EST ASSUMÉ
-- Le flux SSE de `rg-realtime` n'est PAS authentifié : tout ce qui porte le trigger
-- `public.rg_realtime_notify()` devient lisible par n'importe qui. Ces deux tables
-- sont donc conçues pour être publiques de bout en bout — d'où :
--   * aucune donnée personnelle stockée : ni e-mail, ni identifiant Discord privé
--     autre que l'ID public, ni adresse IP. `author_*` reproduit ce que le CDN
--     Discord expose déjà publiquement, exactement comme `discord_members`.
--   * `suivi = false` par défaut sur `discord_channels` : un salon n'est archivé
--     que sur décision explicite (le démon cron ne lit que les salons `suivi`).
-- Retirer un salon de la veille = `suivi = false` + purge des lignes concernées ;
-- la contrainte ON DELETE CASCADE fait le ménage en une instruction.
--
-- Application : psql -d rg -f apps/website/supabase/migrations/20260812_veille_salons_discord.sql

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Salons sous surveillance
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.discord_channels (
	channel_id        text primary key,
	guild_id          text not null,
	name              text not null,
	-- Type Discord brut (0 = textuel, 5 = annonces, 11/12 = fil…). Conservé en
	-- entier plutôt qu'en libellé : Discord en ajoute régulièrement.
	type              integer not null default 0,
	topic             text,
	parent_id         text,
	position          integer,
	icon_emoji        text,
	-- Drapeau de veille : le démon cron n'ouvre que les salons à `true`.
	suivi             boolean not null default false,
	-- Curseur de rattrapage : dernier message déjà archivé (snowflake croissant).
	last_message_id   text,
	-- `true` une fois l'historique complet remonté ; évite de repaginer 10 000
	-- messages à chaque redémarrage du démon.
	backfill_complete boolean not null default false,
	message_count     integer not null default 0,
	synced_at         timestamptz,
	updated_at        timestamptz not null default now()
);

comment on table public.discord_channels is
	'Salons Discord connus. `suivi = true` = archivé par rg-cron et publié sur le site.';
comment on column public.discord_channels.last_message_id is
	'Snowflake du dernier message archivé — curseur `after=` du rattrapage REST.';
comment on column public.discord_channels.backfill_complete is
	'Historique intégral déjà remonté : le rattrapage ne repagine plus vers le passé.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Messages archivés
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.discord_messages (
	message_id           text primary key,
	channel_id           text not null
	                       references public.discord_channels (channel_id) on delete cascade,
	guild_id             text not null,

	-- Auteur : uniquement ce que Discord expose publiquement sur le message.
	author_id            text not null,
	author_username      text not null,
	author_display_name  text,
	author_avatar_url    text,
	author_is_bot        boolean not null default false,

	-- Type de message Discord (0 = classique, 6 = épinglage, 20 = commande…).
	type                 integer not null default 0,
	content              text not null default '',
	-- Pièces jointes, encarts, réactions, sondage natif : recopiés tels quels.
	-- Les sondages du serveur passent par le bot EasyPoll, qui les rend sous
	-- forme d'encart — `embeds` est donc la source des sondages, pas `poll`.
	attachments          jsonb not null default '[]'::jsonb,
	embeds               jsonb not null default '[]'::jsonb,
	stickers             jsonb not null default '[]'::jsonb,
	reactions            jsonb not null default '[]'::jsonb,
	poll                 jsonb,
	-- { users: [...], roles: [...], everyone: bool } — identifiants seuls.
	mentions             jsonb not null default '{}'::jsonb,
	reference_message_id text,
	pinned               boolean not null default false,

	-- Horodatages Discord (et non ceux de l'archivage).
	created_at           timestamptz not null,
	edited_at            timestamptz,
	-- Suppression logique : un message effacé sur Discord disparaît du site sans
	-- être perdu en base, et l'événement DELETE reste diffusable en temps réel.
	deleted_at           timestamptz,
	synced_at            timestamptz not null default now()
);

comment on table public.discord_messages is
	'Messages archivés des salons Discord suivis. Publiés en temps réel sur rosegriffon.fr.';
comment on column public.discord_messages.deleted_at is
	'Suppression logique : masqué par la RLS, conservé en base.';

create index if not exists discord_messages_salon_date_idx
	on public.discord_messages (channel_id, created_at desc);
create index if not exists discord_messages_date_idx
	on public.discord_messages (created_at desc);
create index if not exists discord_messages_auteur_idx
	on public.discord_messages (author_id);
-- Fil visible du site : le filtre exact des pages publiques.
create index if not exists discord_messages_visibles_idx
	on public.discord_messages (channel_id, created_at desc)
	where deleted_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS — lecture publique, écriture réservée au démon (service_role)
-- ─────────────────────────────────────────────────────────────────────────────
-- Les rôles `anon`/`authenticated` héritent de GRANT larges au niveau table (posés
-- à la création de la base) : sans RLS ils pourraient écrire. Les policies de
-- lecture seule ci-dessous sont donc la seule barrière — ne pas les retirer.
-- `service_role` contourne la RLS par construction (BYPASSRLS), le démon écrit.

alter table public.discord_channels enable row level security;
alter table public.discord_messages enable row level security;

drop policy if exists "Lecture publique des salons suivis" on public.discord_channels;
create policy "Lecture publique des salons suivis"
	on public.discord_channels for select
	using (suivi);

drop policy if exists "Lecture publique des messages archives" on public.discord_messages;
create policy "Lecture publique des messages archives"
	on public.discord_messages for select
	using (
		deleted_at is null
		and exists (
			select 1 from public.discord_channels c
			 where c.channel_id = discord_messages.channel_id
			   and c.suivi
		)
	);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Temps réel — trigger de diffusion
-- ─────────────────────────────────────────────────────────────────────────────
-- `rg_realtime_notify()` tronque au-delà de 7 000 octets (limite de pg_notify) et
-- pose `truncated: true` : un message long ou riche en encarts arrive au client
-- sous forme d'identifiant seul, à charge pour lui de recharger. Le composant du
-- site traite ce cas — ne pas supposer que `new` est toujours complet.

drop trigger if exists rg_realtime_discord_messages on public.discord_messages;
create trigger rg_realtime_discord_messages
	after insert or update or delete on public.discord_messages
	for each row execute function public.rg_realtime_notify();

drop trigger if exists rg_realtime_discord_channels on public.discord_channels;
create trigger rg_realtime_discord_channels
	after insert or update or delete on public.discord_channels
	for each row execute function public.rg_realtime_notify();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Les deux salons mis sous veille
-- ─────────────────────────────────────────────────────────────────────────────
-- 🚨〡annonces (salon d'annonces) et 🧐〡sondages (salon textuel).
-- Les métadonnées réelles sont réécrites par le démon à chaque synchro ; ces
-- lignes ne servent qu'à armer la veille sans attendre le premier passage.

insert into public.discord_channels (channel_id, guild_id, name, type, parent_id, position, icon_emoji, suivi)
values
	('1073227462500163626', '1072991720268111892', '🚨〡annonces', 5, '1073593926994382878', 6, '🚨', true),
	('1135716082972381234', '1072991720268111892', '🧐〡sondages', 0, '1073593926994382878', 7, '📊', true)
on conflict (channel_id) do update
	set suivi      = true,
	    guild_id   = excluded.guild_id,
	    updated_at = now();

commit;
