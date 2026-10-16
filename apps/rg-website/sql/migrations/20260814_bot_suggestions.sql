-- Boîte à suggestions de la communauté.
--
-- ── LES VOTES NE SONT PAS ICI, ET C'EST LE POINT ───────────────────────────
-- Une suggestion se vote. Le réflexe est d'ajouter une table
-- `bot_suggestion_votes (suggestion_id, discord_id, valeur)` — et ce réflexe
-- est exactement celui que la ligne rouge de ce dépôt interdit pour les
-- sondages : une table nominative de votes, chez nous, consultable pour
-- toujours, sur un serveur où tout le monde se connaît.
--
-- Le vote passe donc par les RÉACTIONS Discord (👍 / 👎). Discord tient le
-- registre nominatif, nous ne lisons que les COMPTEURS au moment où le staff
-- tranche. Personne ne peut interroger notre base pour savoir qui a voté quoi,
-- parce que l'information n'y est pas.
--
-- Cette table ne porte donc que : le texte proposé, son auteur, et la décision.
--
-- ── POURQUOI LE TEXTE EST STOCKÉ ───────────────────────────────────────────
-- Contrairement à un ticket, une suggestion est PUBLIQUE par nature : elle est
-- écrite pour être lue par tout le serveur. La stocker permet de la retrouver
-- quand le message est supprimé, et de dire « celle-ci a déjà été proposée ».
--
-- Appliquer :
--   psql "$DATABASE_URL" -f apps/website/sql/migrations/20260814_bot_suggestions.sql

begin;

create table if not exists public.bot_suggestions (
	id bigserial primary key,
	guild_id text not null,
	-- Numéro lisible, propre à la guilde : « suggestion #12 ».
	numero integer not null,
	salon_id text not null,
	message_id text,
	auteur_id text not null,
	texte text not null,
	statut text not null default 'ouverte'
		check (statut in ('ouverte', 'acceptee', 'refusee', 'faite')),
	-- Qui a tranché, et pourquoi. Le motif est obligatoire côté commande : une
	-- suggestion refusée sans raison est pire qu'une suggestion ignorée.
	decide_par text,
	motif text,
	decide_le timestamptz,
	cree_le timestamptz not null default now(),
	maj_le timestamptz not null default now(),
	unique (guild_id, numero)
);

comment on table public.bot_suggestions is
	'Suggestions de la communauté. Les VOTES ne sont pas ici : ce sont des réactions Discord, dont seul le compteur est lu.';

create index if not exists bot_suggestions_ouvertes_idx
	on public.bot_suggestions (guild_id, statut, cree_le desc);
create index if not exists bot_suggestions_message_idx
	on public.bot_suggestions (message_id)
	where message_id is not null;

alter table public.bot_suggestions owner to rg;
alter sequence public.bot_suggestions_id_seq owner to rg;

-- Le texte d'une suggestion est public par nature (il est écrit pour être lu
-- par tout le serveur), mais son AUTEUR et la décision restent hors des clés
-- publiques : ce sont des données de personne. RLS sans policy = tout refusé.
alter table public.bot_suggestions enable row level security;
revoke all on public.bot_suggestions from anon, authenticated;

commit;
