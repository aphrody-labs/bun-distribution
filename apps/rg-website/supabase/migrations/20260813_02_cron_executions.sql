-- Historique d'exécution des tâches du démon cron.
--
-- POURQUOI CETTE MIGRATION ARRIVE TREIZE JOURS APRÈS SON NOM
-- `packages/cron/src/lib/executions-postgres.ts` écrit dans `public.cron_executions` depuis le
-- 13/8/2026 et renvoie, à chaque échec, « appliquer
-- apps/website/supabase/migrations/20260813_02_cron_executions.sql » — un fichier qui N'EXISTAIT
-- PAS dans le dépôt. Le démon mettait donc sa persistance en veille par quart d'heure, indéfiniment,
-- en désignant un remède introuvable : depuis le 13/8, AUCUNE exécution n'a laissé de trace, et
-- l'écran /admin/cron n'a jamais eu d'historique à montrer. Le voici, écrit d'après les seules
-- requêtes que le code exécute réellement (INSERT, SELECT, DELETE de purge).
--
-- CE QUE LA TABLE N'EST PAS
-- Ce n'est pas un journal applicatif : une ligne par exécution, pas une par message. Le contenu
-- des erreurs y est TRONQUÉ par l'appelant (`tronquerErreur`), et la purge quotidienne retire ce
-- qui dépasse la rétention (`CRON_HISTORIQUE_RETENTION_JOURS`, 30 jours par défaut). Une table
-- d'observabilité qui grossit sans fin finit par coûter plus cher que ce qu'elle observe.

create table if not exists public.cron_executions (
	id          bigint generated always as identity primary key,
	-- Nom canonique de la tâche (`campagnes:discord`, `seo:llms-txt`…). Pas de clé étrangère vers
	-- un catalogue : une tâche retirée du code ne doit pas effacer l'historique de ses passages.
	tache       text        not null,
	demarre_le  timestamptz not null,
	termine_le  timestamptz not null,
	duree_ms    integer     not null check (duree_ms >= 0),
	succes      boolean     not null,
	-- `true` quand la tâche a dépassé son délai et a été abandonnée : un échec dont la cause est
	-- la durée, pas le code, et qui ne se lit pas de la même façon.
	expiree     boolean     not null default false,
	erreur      text,
	-- D'où venait le déclenchement : `planifie` (Bun.cron), `manuel` (écran d'admin),
	-- `cli` (--run), `pont` (IPC du bot). Une même tâche en échec ne se diagnostique pas pareil
	-- selon qui l'a lancée.
	origine     text        not null check (origine in ('planifie', 'manuel', 'cli', 'pont')),
	-- Nom d'hôte du démon : le jour où un second démon tournera ailleurs, l'historique dira lequel.
	hote        text        not null
);

-- La seule lecture du code trie par `demarre_le desc` (toutes tâches confondues) ; la purge
-- balaie le même champ. Un index descendant sert les deux.
create index if not exists cron_executions_demarre_le_idx
	on public.cron_executions (demarre_le desc);

-- L'écran d'admin filtre par tâche avant de trier.
create index if not exists cron_executions_tache_demarre_le_idx
	on public.cron_executions (tache, demarre_le desc);

comment on table public.cron_executions is
	'Une ligne par exécution de tâche du démon cron. Écrite par packages/cron/src/lib/executions-postgres.ts, purgée au-delà de CRON_HISTORIQUE_RETENTION_JOURS (30 j).';

-- ── VISIBILITÉ ──────────────────────────────────────────────────────────────
-- RLS activée SANS aucune policy : personne ne lit cette table par PostgREST, ni en `anon` ni en
-- `authenticated`. Elle dit quelles tâches tournent, quand, et avec quels messages d'erreur —
-- c'est une carte de l'infrastructure, pas une donnée publique. Le démon et l'écran d'admin y
-- accèdent par le rôle propriétaire `rg`, exempté de RLS.
alter table public.cron_executions enable row level security;
revoke all on public.cron_executions from anon, authenticated;

-- ⚠ LE PROPRIÉTAIRE DOIT ÊTRE `rg`, PAS `postgres`.
-- Le démon se connecte en `rg` et compte sur l'exemption de RLS du PROPRIÉTAIRE : appliquée en
-- `postgres` (le réflexe pour un `psql -f`), la table naît avec le mauvais propriétaire, la RLS
-- sans policy s'applique pleinement au démon, et chaque écriture d'historique échoue — donc la
-- persistance retombe en veille exactement comme si la table n'existait pas. Vérifié le
-- 26/8/2026 : première application en `postgres`, zéro ligne écrite au redémarrage.
alter table public.cron_executions owner to rg;
alter sequence public.cron_executions_id_seq owner to rg;
