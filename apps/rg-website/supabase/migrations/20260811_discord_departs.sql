-- Distingue les membres actuels du serveur Discord de ceux qui l'ont quitté.
--
-- CONSTAT
-- `discord_members` traitait les départs par DELETE. Toute sortie survenue
-- pendant une coupure du démon n'était donc jamais rattrapée : 173 des 2058
-- « membres » ne sont plus sur le serveur, et leur ligne n'a plus bougé depuis
-- des semaines. La pré-création des profils leur en a donc fabriqué un, à eux
-- comme aux autres.
--
-- CORRECTIF
-- Une colonne `left_at` remplace la suppression : on garde `joined_at` et
-- l'historique de rôles, et « membre actuel » devient un prédicat explicite au
-- lieu d'une déduction par absence.
--
-- La borne de réconciliation est prise sur le dernier balayage RÉUSSI, pas sur
-- `now()` : sans cela, un cron arrêté depuis deux heures ferait passer tout le
-- serveur pour parti.

\set ON_ERROR_STOP on

begin;

alter table public.discord_members
	add column if not exists left_at timestamptz;

comment on column public.discord_members.left_at is
	'Date de sortie du serveur. NULL = membre actuel. Remplace le DELETE, qui perdait joined_at et l''historique de rôles.';

create index if not exists discord_members_actifs_idx
	on public.discord_members (discord_id)
	where left_at is null;

-- Réconciliation : ce que le dernier balayage complet n'a pas touché est parti.
with dernier_run as (
	select max(created_at) as t from public.discord_sync_logs where status = 'success'
)
update public.discord_members dm
   set left_at = coalesce(dm.updated_at, now())
  from dernier_run r
 where dm.left_at is null
   and r.t is not null
   and dm.updated_at < r.t - interval '5 minutes';

-- Les profils pré-créés pour des personnes parties n'ont plus de raison d'être.
-- On ne touche QUE les profils jamais réclamés : si quelqu'un s'est connecté un
-- jour, son compte lui appartient, qu'il soit encore sur le serveur ou non.
delete from public.profiles p
 using public.discord_members d
 where p.discord_id = d.discord_id
   and p.claimed_at is null
   and d.left_at is not null;

-- Les ancres synthétiques partent avec eux.
--
-- Le prédicat est borné à NOS ancres — celles dont l'identifiant est l'uuid v5
-- dérivé d'un discord_id. Un « supprime toute ligne auth.users sans profil »
-- serait une mine : `auth.users` porte 22 clés étrangères, dont une quinzaine en
-- ON DELETE CASCADE (patreon_memberships, reading_history, article_comments,
-- chronicles, user_preferences…). Le jour où un profil disparaît sans que le
-- compte disparaisse, un tel DELETE emporterait silencieusement les données
-- métier de la personne.
delete from auth.users a
 using public.discord_members d
 where a.id = public.rg_uuid_membre_discord(d.discord_id)
   and d.left_at is not null
   and not exists (select 1 from public.profiles p where p.id = a.id)
   and not exists (select 1 from public."user" u where u.id::text = a.id::text);

commit;
