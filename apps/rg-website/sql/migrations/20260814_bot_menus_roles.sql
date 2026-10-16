-- Menus de rôles en libre-service — ce qui remplace les « rôles à réaction ».
--
-- ── POURQUOI UNE TABLE ─────────────────────────────────────────────────────
-- Un menu de rôles est un message qui vit des mois dans un salon, et dont le
-- bot doit savoir, à chaque clic, quels rôles il propose. Trois façons de le
-- retenir, et une seule tient :
--
--   1. relire le message à chaque clic — impossible, le contenu d'un menu
--      déroulant Discord ne porte pas les identifiants de rôle en clair ;
--   2. tout encoder dans l'identifiant du composant — plafonné à 100
--      caractères par Discord, soit quatre rôles au mieux ;
--   3. une ligne en base, désignée par l'identifiant du MESSAGE. C'est celle-ci.
--
-- Conséquence : un menu dont le message est supprimé laisse une ligne
-- orpheline. Elle est inoffensive (plus personne ne peut cliquer dessus) et
-- `/gestion roles liste` la montre pour qu'on puisse la retirer.
--
-- ── CE QU'ON N'ÉCRIT PAS ───────────────────────────────────────────────────
-- Aucune trace de QUI a pris QUEL rôle. Discord tient déjà cette information
-- (elle est visible sur la fiche du membre), et la dupliquer chez nous en
-- ferait un historique de préférences — pronoms, centres d'intérêt, âge —
-- consultable des années plus tard.
--
-- Appliquer :
--   psql "$DATABASE_URL" -f apps/website/sql/migrations/20260814_bot_menus_roles.sql

begin;

create table if not exists public.bot_menus_roles (
	id bigserial primary key,
	guild_id text not null,
	salon_id text not null,
	-- Identifiant du message qui porte le menu : c'est LUI qu'on retrouve au clic.
	message_id text not null,
	titre text not null,
	description text,
	-- `menu` = un déroulant (jusqu'à 25 rôles) ; `boutons` = une rangée (5 max).
	forme text not null default 'menu' check (forme in ('menu', 'boutons')),
	-- Nombre de rôles qu'un membre peut cumuler dans CE menu. 0 = sans limite.
	choix_max integer not null default 0 check (choix_max >= 0),
	-- Les rôles proposés : [{ roleId, libelle, emoji, description }]. Un jsonb
	-- plutôt qu'une table fille — l'ordre compte (c'est celui de l'affichage) et
	-- on ne fait jamais de requête sur un rôle isolé.
	roles jsonb not null default '[]'::jsonb,
	cree_par text not null,
	cree_le timestamptz not null default now(),
	maj_le timestamptz not null default now(),
	unique (message_id)
);

comment on table public.bot_menus_roles is
	'Menus de rôles en libre-service. Ne contient AUCUNE trace de qui a pris quel rôle.';

create index if not exists bot_menus_roles_guilde_idx
	on public.bot_menus_roles (guild_id, cree_le desc);

alter table public.bot_menus_roles owner to rg;

-- Rien de public : la liste des rôles proposés est déjà visible dans le salon,
-- mais l'identifiant du message et l'auteur du menu n'ont pas à sortir de la
-- base. RLS activée sans policy = tout refusé aux clés publiques.
alter table public.bot_menus_roles enable row level security;
revoke all on public.bot_menus_roles from anon, authenticated;

commit;
