-- Les verdicts du staff sur les rapprochements de comptes.
--
-- ── POURQUOI UNE TABLE ALORS QUE LE CALCUL EST REFAIT À CHAQUE FOIS ────────
-- Le rapprochement (`apps/bot/src/lib/multicomptes.ts`) ne stocke rien : il
-- recalcule tout à partir de `discord_members`, `discord_messages`, `account` et
-- `profiles`. C'est voulu — un score figé se périmerait à la première
-- réinscription, et personne ne saurait plus sur quelles données il a été posé.
--
-- Ce qui DOIT persister, c'est la décision humaine. Sans elle, chaque balayage
-- remonte les mêmes faux positifs — deux membres qui portent la même image de
-- série animée, deux frères qui se sont inscrits le même soir — et le staff
-- réexamine indéfiniment des paires qu'il a déjà écartées. Un outil qui
-- redemande sans cesse la même chose finit par n'être plus lu du tout.
--
-- ── CE QUE LA TABLE NE FAIT PAS ───────────────────────────────────────────
-- Elle ne sanctionne rien et ne déclenche rien. `confirme` ne bannit personne,
-- `ecarte` n'innocente personne : ce sont deux notes de lecture, et la seule
-- conséquence technique d'`ecarte` est que la paire cesse de remonter dans le
-- balayage.
--
-- Appliquer :
--   psql "$DATABASE_URL" -f apps/website/sql/migrations/20260829_bot_multicomptes.sql

begin;

create table if not exists public.bot_multicomptes_verdicts (
	id        bigserial primary key,
	guild_id  text not null,
	-- L'ordre du couple est NORMALISÉ : `compte_a` est toujours le plus petit
	-- identifiant des deux. Sans cette contrainte, la même paire s'écrirait deux
	-- fois selon l'ordre de mention, et l'unicité ne protégerait rien — une paire
	-- écartée continuerait de remonter dans l'autre sens.
	compte_a  text not null,
	compte_b  text not null,
	verdict   text not null check (verdict in ('confirme', 'ecarte')),
	motif     text,
	-- Identifiant Discord du membre du staff qui a tranché. Pas de clé étrangère :
	-- la décision doit survivre au départ de celui qui l'a prise.
	par_qui   text,
	cree_le   timestamptz not null default now(),
	maj_le    timestamptz not null default now(),
	constraint bot_multicomptes_paire_ordonnee check (compte_a < compte_b),
	constraint bot_multicomptes_paire_unique unique (guild_id, compte_a, compte_b)
);

comment on table public.bot_multicomptes_verdicts is
	'Décisions du staff sur les rapprochements de comptes. Ne sanctionne rien : « ecarte » retire seulement la paire des balayages suivants.';
comment on column public.bot_multicomptes_verdicts.compte_a is
	'Le plus petit des deux identifiants Discord — ordre normalisé, garanti par bot_multicomptes_paire_ordonnee.';

-- Le balayage relit TOUS les verdicts d'une guilde à chaque exécution : c'est
-- l'unique accès, et il porte sur la guilde entière.
create index if not exists bot_multicomptes_guilde_idx
	on public.bot_multicomptes_verdicts (guild_id);

-- Retrouver les verdicts qui concernent un compte donné, dans un sens comme
-- dans l'autre (la fiche d'un membre les affiche tous).
create index if not exists bot_multicomptes_compte_a_idx
	on public.bot_multicomptes_verdicts (guild_id, compte_a);
create index if not exists bot_multicomptes_compte_b_idx
	on public.bot_multicomptes_verdicts (guild_id, compte_b);

-- ── Droits ─────────────────────────────────────────────────────────────────
--
-- RLS active et AUCUNE policy : la table est donc invisible à `anon` comme à
-- `authenticated`, et seule la connexion de service (le bot) la lit. C'est
-- délibéré et ce n'est pas un oubli — « le compte X est le double du compte Y »
-- est une note de modération sur des personnes nommées, exactement le genre de
-- ligne qui n'a rien à faire derrière une clé publiée dans un bundle navigateur.
alter table public.bot_multicomptes_verdicts enable row level security;

revoke all on public.bot_multicomptes_verdicts from anon, authenticated;
revoke all on sequence public.bot_multicomptes_verdicts_id_seq from anon, authenticated;

commit;
