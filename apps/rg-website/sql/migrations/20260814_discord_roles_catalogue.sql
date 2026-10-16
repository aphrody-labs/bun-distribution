-- Catalogue enrichi des rôles Discord : permissions décodées, dangerosité,
-- porteurs et utilité — de quoi exploiter les 94 rôles du serveur Rose
-- Griffon depuis le bot sans redécoder un bitfield à chaque commande.
--
-- ── POURQUOI UNE TABLE À PART, ET PAS DES COLONNES SUR `discord_roles` ─────
-- `discord_roles` est un miroir FACTUEL, réécrit en entier à chaque
-- synchronisation (`syncAllRoles`, cron + `/administration synchroniser`) : le
-- nom, la couleur, la position, le bitfield brut d'un rôle changent au rythme
-- de Discord, et l'UPSERT qui les réécrit n'a pas à se soucier d'une colonne
-- de plus. Ce que cette table ajoute — permissions décodées, catégorie,
-- utilité — est un travail d'ANALYSE, pas un miroir : il vit au rythme d'une
-- relecture humaine (nouveaux rôles créés côté Discord), pas de la
-- synchronisation. Séparer les deux évite qu'un futur script de miroir
-- écrase, par un simple `UPDATE *`, une catégorie ou une utilité choisies à
-- la main.
--
-- ── LA CATÉGORIE N'EST PAS TOUJOURS DÉDUCTIBLE D'UN CHAMP DE L'API ─────────
-- Trois catégories le sont (`base` = @everyone, `bot`/`abonnement` = rôle
-- `managed` par une intégration Discord). Les cinq autres (staff, modération,
-- cosmétique, niveau, notification, accès) viennent d'une lecture humaine du
-- nom, de la position, des permissions et du nombre de porteurs — vérifiée
-- rôle par rôle sur l'export réel de la guilde le 14/8/2026
-- (`apps/bot/src/lib/discord-roles-catalogue.ts`). Un rôle non encore
-- analysé (nouveau rôle Discord, ou guilde jamais couverte) garde
-- `categorie`/`utilite` à NULL plutôt qu'une valeur devinée — d'où leur
-- absence de `not null`.
--
-- Appliquer :
--   sudo -u postgres psql -d rg -f apps/website/sql/migrations/20260814_discord_roles_catalogue.sql

begin;

create table if not exists public.discord_roles_catalogue (
	-- Même identifiant que `discord_roles.role_id` (une ligne par rôle Discord,
	-- snowflake globalement unique — jamais deux guildes ne partagent un rôle).
	role_id text primary key references public.discord_roles (role_id) on delete cascade,
	-- Copié depuis `discord_roles.guild_id` au moment de l'écriture : évite une
	-- jointure pour tout filtre « rôles de telle guilde », au prix d'un léger
	-- risque de désynchronisation si un rôle changeait de guilde — chose que
	-- Discord ne permet tout simplement pas.
	guild_id text not null,
	-- Permissions décodées vers les noms OFFICIELS de `PermissionFlagsBits`
	-- (discord.js) — "Administrator", "BanMembers", … — pas une traduction
	-- française : ce sont ces chaînes qu'on recomparerait à
	-- `PermissionFlagsBits[nom]` si besoin, une traduction perdrait cette
	-- propriété. Le libellé français, lui, reste dans `nomPermissionFr`
	-- (`lib/discord-admin.ts`), pour l'AFFICHAGE dans un salon.
	permissions_decodees text[] not null default '{}'::text[],
	-- Vrai si le rôle porte AU MOINS une des huit permissions jugées
	-- dangereuses par la mission : Administrator, ManageGuild, ManageRoles,
	-- ManageChannels, BanMembers, KickMembers, ManageWebhooks, MentionEveryone.
	permissions_dangereuses boolean not null default false,
	-- Membres ACTIFS (`discord_members.left_at IS NULL`) qui portent ce rôle,
	-- au moment de l'écriture. Snapshot, pas une vue : un rôle qui perd tous
	-- ses porteurs entre deux synchronisations garde son dernier chiffre connu
	-- jusqu'au prochain passage du script.
	porteurs_count integer not null default 0,
	-- Catégorie fonctionnelle. NULL = pas encore analysé, jamais une valeur
	-- devinée (cf. commentaire d'en-tête). La liste est fermée : un besoin de
	-- catégorie supplémentaire doit passer par une migration, pas par une
	-- chaîne libre qui dérive avec le temps.
	categorie text
		constraint discord_roles_catalogue_categorie_valide
		check (
			categorie is null or categorie = any (array[
				'base', 'staff', 'moderation', 'bot', 'abonnement',
				'cosmetique', 'niveau', 'notification', 'acces'
			])
		),
	-- Une phrase en français : à quoi ce rôle sert CONCRÈTEMENT sur CE
	-- serveur. NULL tant que `categorie` l'est aussi.
	utilite text,
	-- `role.managed` de l'API Discord : le rôle est posé/retiré par une
	-- intégration (bot, boost Nitro, abonnement payant), jamais à la main —
	-- utile au bot pour refuser d'emblée une tentative de distribution
	-- (`empechementRole` de `discord-admin.ts` le redécouvre déjà depuis
	-- Discord au moment d'agir ; ce booléen permet de le savoir SANS appel API,
	-- par exemple pour filtrer une liste avant de l'afficher).
	gere_par_integration boolean not null default false,
	-- Précise QUEL genre d'intégration, quand `gere_par_integration` est vrai.
	-- NULL pour tous les rôles non gérés par une intégration.
	type_integration text
		constraint discord_roles_catalogue_type_integration_valide
		check (type_integration is null or type_integration = any (array['bot', 'abonnement'])),
	maj_le timestamptz not null default now()
);

comment on table public.discord_roles_catalogue is
	'Analyse enrichie des rôles Discord (permissions décodées, dangerosité, porteurs, catégorie, utilité) — dérivée de discord_roles + discord_members, jamais réécrite en miroir automatique.';
comment on column public.discord_roles_catalogue.permissions_decodees is
	'Noms officiels PermissionFlagsBits (discord.js), pas une traduction — decoderPermissions() dans apps/bot/src/lib/discord-roles-catalogue.ts.';
comment on column public.discord_roles_catalogue.categorie is
	'staff | moderation | bot | abonnement | cosmetique | niveau | notification | acces | base. NULL = rôle non encore analysé.';

-- Filtrer « tous les rôles dangereux » ou « tous les rôles de telle
-- catégorie » sont les deux lectures attendues depuis le bot (diagnostic
-- `/staff discord`, futur audit de permissions).
create index if not exists discord_roles_catalogue_dangereuses_idx
	on public.discord_roles_catalogue (guild_id)
	where permissions_dangereuses;
create index if not exists discord_roles_catalogue_categorie_idx
	on public.discord_roles_catalogue (guild_id, categorie);

-- ── Propriétaire ───────────────────────────────────────────────────────────
-- Appliquée en `postgres` (seul rôle en authentification peer sur ce VPS) :
-- sans ce transfert, `rg` — le rôle sous lequel le bot se connecte — n'a
-- aucun droit sur une table qu'il vient pourtant de créer via cette migration.
alter table public.discord_roles_catalogue owner to rg;

-- ── Droits ─────────────────────────────────────────────────────────────────
-- Rien ici n'est plus sensible que ce que `discord_roles` expose déjà : les
-- permissions d'un rôle et son nombre de porteurs sont visibles par n'importe
-- quel membre du serveur depuis l'interface Discord. Lecture publique via
-- PostgREST, donc — mais écriture réservée au bot (connexion Postgres directe
-- sous le rôle `rg`, hors RLS).
alter table public.discord_roles_catalogue enable row level security;

revoke all on public.discord_roles_catalogue from anon, authenticated;
grant select on public.discord_roles_catalogue to anon, authenticated;

drop policy if exists "Catalogue de rôles public" on public.discord_roles_catalogue;
create policy "Catalogue de rôles public" on public.discord_roles_catalogue
	for select to anon, authenticated using (true);

commit;
