-- Appartenances Discord, sur PLUSIEURS serveurs.
--
-- POURQUOI UNE TABLE DE PLUS
-- `discord_members` porte l'identité Rose Griffon : sa clé primaire est le seul
-- `discord_id`, et une trentaine de lecteurs (bot, site, statistiques,
-- multicomptes, pré-création des profils) s'appuient dessus pour désigner UNE
-- personne. Y ajouter un second serveur imposerait une clé composite, et chaque
-- `where discord_id = …` existant rendrait soudain deux lignes — une régression
-- silencieuse, jamais une erreur.
--
-- Cette table-ci répond à une autre question : « qui est membre de QUEL serveur,
-- avec quels rôles ». Elle couvre les deux serveurs suivis (Rose Griffon et
-- Achilléa) et c'est elle qui alimente la hiérarchie affichée sur `/community`.
--
-- PAS DE DIVERGENCE POSSIBLE
-- Les deux tables sont écrites par le MÊME balayage, dans la même boucle, à
-- partir du même objet `GuildMember` (`packages/cron/src/lib/discord.ts`).
-- `discord_members` reste la projection « serveur Rose Griffon » de cette
-- table ; elle n'a pas sa propre source.

create table if not exists public.discord_appartenances (
	guild_id text not null,
	discord_id text not null,
	username text not null,
	display_name text,
	nickname text,
	avatar_url text,
	-- Identifiants de rôles, tels que Discord les rend. La hiérarchie se lit en
	-- joignant `discord_roles`, qui porte déjà `guild_id`, `position`,
	-- `is_hoisted` et `permissions`.
	roles text[] not null default '{}',
	joined_at timestamptz,
	premium_since timestamptz,
	is_bot boolean not null default false,
	updated_at timestamptz not null default now(),
	-- Départ constaté par réconciliation : un membre que le balayage complet n'a
	-- pas revu a quitté le serveur. On ne supprime pas la ligne — l'historique
	-- d'appartenance sert aux statistiques.
	left_at timestamptz,
	primary key (guild_id, discord_id)
);

-- Listing par serveur, membres présents d'abord : c'est la requête de la page
-- communauté, la seule qui balaie toute la table.
create index if not exists discord_appartenances_guilde_idx
	on public.discord_appartenances (guild_id)
	where left_at is null;

-- Recherche par pseudo, insensible à la casse et aux fragments.
create index if not exists discord_appartenances_username_idx
	on public.discord_appartenances using gin (username gin_trgm_ops);

-- Retrouver tous les serveurs d'une personne (fiche de profil).
create index if not exists discord_appartenances_membre_idx
	on public.discord_appartenances (discord_id);

comment on table public.discord_appartenances is
	'Appartenance à un serveur Discord suivi (Rose Griffon, Achilléa). Écrite par la tâche cron discord:sync. `discord_members` en est la projection Rose Griffon.';

-- Reprise de l'existant : les membres déjà connus sont ceux du serveur Rose
-- Griffon. La tâche cron réécrira tout au premier passage, mais la page ne doit
-- pas être vide entre le déploiement et ce passage.
insert into public.discord_appartenances (
	guild_id, discord_id, username, display_name, nickname, avatar_url,
	roles, joined_at, premium_since, is_bot, updated_at, left_at
)
select '1072991720268111892', m.discord_id, m.username, m.display_name, m.nickname,
       m.avatar_url, coalesce(m.roles, '{}'), m.joined_at, m.premium_since,
       coalesce(m.is_bot, false), coalesce(m.updated_at, now()), m.left_at
  from public.discord_members m
on conflict (guild_id, discord_id) do nothing;

-- Le schéma n'est pas exposé à `anon` : ces lignes portent des données
-- personnelles (pseudo, avatar, date d'arrivée). La page communauté lit côté
-- serveur, derrière `getPgPool()`.
revoke all on public.discord_appartenances from anon, authenticated;
grant select, insert, update, delete on public.discord_appartenances to service_role;
