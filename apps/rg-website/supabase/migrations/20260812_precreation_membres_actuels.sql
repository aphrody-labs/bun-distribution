-- Restreint la pré-création aux membres ACTUELS du serveur Discord.
--
-- CONSTAT
-- `rg_precreer_profils_discord()` filtrait sur `is_bot` et la longueur du pseudo,
-- mais pas sur `left_at`. La colonne a été ajoutée après la fonction : depuis, à
-- chaque passage du cron, les 173 personnes ayant quitté le serveur voyaient leur
-- profil recréé, alors que la migration des départs venait justement de le
-- supprimer. Les deux mécanismes se défaisaient mutuellement toutes les
-- trente minutes — profils 1903 → 2076 en un cycle.
--
-- L'invariant visé est « tout membre ACTUEL a un profil », pas « toute personne
-- ayant un jour rejoint le serveur en a un ».

\set ON_ERROR_STOP on

begin;

create or replace function public.rg_precreer_profils_discord()
returns table (crees integer, mis_a_jour integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_crees integer := 0;
	v_maj integer := 0;
begin
	insert into auth.users (id)
	select public.rg_uuid_membre_discord(d.discord_id)
	  from public.discord_members d
	 where coalesce(d.is_bot, false) = false
	   and d.left_at is null
	   and d.username is not null
	   and char_length(d.username) >= 3
	   and not exists (select 1 from public.profiles p where p.discord_id = d.discord_id)
	on conflict (id) do nothing;

	with entrant as (
		select public.rg_uuid_membre_discord(d.discord_id) as id,
		       d.discord_id,
		       d.username,
		       d.avatar_url
		  from public.discord_members d
		 where coalesce(d.is_bot, false) = false
		   -- Le filtre qui manquait.
		   and d.left_at is null
		   and d.username is not null
		   and char_length(d.username) >= 3
	), insere as (
		insert into public.profiles (id, discord_id, username, avatar_url, role, updated_at, claimed_at)
		select e.id,
		       e.discord_id,
		       case
		         when exists (select 1 from public.profiles p2
		                       where lower(p2.username) = lower(e.username)
		                         and p2.discord_id is distinct from e.discord_id)
		           then e.username || '-' || right(e.discord_id, 4)
		         else e.username
		       end,
		       e.avatar_url,
		       'member',
		       now(),
		       null
		  from entrant e
		 where not exists (select 1 from public.profiles p where p.discord_id = e.discord_id)
		on conflict (discord_id) do nothing
		returning 1
	), rafraichi as (
		update public.profiles p
		   set avatar_url = e.avatar_url,
		       updated_at = now()
		  from entrant e
		 where p.discord_id = e.discord_id
		   and p.claimed_at is null
		   and p.avatar_url is distinct from e.avatar_url
		returning 1
	)
	select (select count(*) from insere), (select count(*) from rafraichi)
	  into v_crees, v_maj;

	return query select v_crees, v_maj;
end;
$$;

-- Nettoyage des profils recréés à tort depuis l'ajout de `left_at`.
delete from public.profiles p
 using public.discord_members d
 where p.discord_id = d.discord_id
   and p.claimed_at is null
   and d.left_at is not null;

delete from auth.users a
 using public.discord_members d
 where a.id = public.rg_uuid_membre_discord(d.discord_id)
   and d.left_at is not null
   and not exists (select 1 from public.profiles p where p.id = a.id)
   and not exists (select 1 from public."user" u where u.id::text = a.id::text);

commit;
