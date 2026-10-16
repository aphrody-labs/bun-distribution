-- Pré-profils RG pour l'historique Achilléa.
--
-- Un identifiant Discord connu n'est PAS une preuve OAuth : ne jamais écrire
-- `public.account(provider_id = 'discord')` sans le callback Discord. En
-- revanche, on peut préparer un profil privé, déterministe et non réclamé.
-- `ensureUserProfile()` le libère puis le rattache au vrai compte Better Auth
-- lors de la première connexion Discord de son titulaire.

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
	-- Les membres RG actifs et les joueurs Achilléa sont deux sources de la même
	-- identité Discord. Les tables Achilléa sont désormais locales à `rg`.
	with source_brute as (
		select d.discord_id,
		       d.username,
		       d.avatar_url
		  from public.discord_members d
		 where coalesce(d.is_bot, false) = false
		   and d.left_at is null
		union all
		select a.id as discord_id,
		       coalesce(nullif(a.username, ''), nullif(a.display_name, '')) as username,
		       a.avatar as avatar_url
		  from achillea."user" a
		 where a.id ~ '^[0-9]{15,22}$'
	), source_dedoublonnee as (
		select distinct on (s.discord_id)
		       s.discord_id,
		       nullif(lower(regexp_replace(coalesce(s.username, ''), '[^a-zA-Z0-9_]', '_', 'g')), '') as base_pseudo,
		       s.avatar_url
		  from source_brute s
		 order by s.discord_id, (s.username is not null) desc, (s.avatar_url is not null) desc
	), entrants as (
		select s.discord_id,
		       public.rg_uuid_membre_discord(s.discord_id) as id,
		       s.avatar_url,
		       case
		         when s.base_pseudo is null or char_length(s.base_pseudo) < 3
		           then 'membre-' || right(s.discord_id, 8)
		         when exists (
		           select 1 from public.profiles p
		            where lower(p.username) = s.base_pseudo
		              and p.discord_id is distinct from s.discord_id
		         )
		         or count(*) over (partition by s.base_pseudo) > 1
		           then left(s.base_pseudo, 24) || '-' || right(s.discord_id, 6)
		         else s.base_pseudo
		       end as username
		  from source_dedoublonnee s
	)
	insert into auth.users (id)
	select e.id
	  from entrants e
	 where not exists (select 1 from public.profiles p where p.discord_id = e.discord_id)
	on conflict (id) do nothing;

	with source_brute as (
		select d.discord_id, d.username, d.avatar_url
		  from public.discord_members d
		 where coalesce(d.is_bot, false) = false and d.left_at is null
		union all
		select a.id, coalesce(nullif(a.username, ''), nullif(a.display_name, '')), a.avatar
		  from achillea."user" a
		 where a.id ~ '^[0-9]{15,22}$'
	), source_dedoublonnee as (
		select distinct on (s.discord_id)
		       s.discord_id,
		       nullif(lower(regexp_replace(coalesce(s.username, ''), '[^a-zA-Z0-9_]', '_', 'g')), '') as base_pseudo,
		       s.avatar_url
		  from source_brute s
		 order by s.discord_id, (s.username is not null) desc, (s.avatar_url is not null) desc
	), entrants as (
		select s.discord_id, public.rg_uuid_membre_discord(s.discord_id) as id, s.avatar_url,
		       case
		         when s.base_pseudo is null or char_length(s.base_pseudo) < 3 then 'membre-' || right(s.discord_id, 8)
		         when exists (select 1 from public.profiles p where lower(p.username) = s.base_pseudo and p.discord_id is distinct from s.discord_id)
		              or count(*) over (partition by s.base_pseudo) > 1 then left(s.base_pseudo, 24) || '-' || right(s.discord_id, 6)
		         else s.base_pseudo
		       end as username
		  from source_dedoublonnee s
	), insere as (
		insert into public.profiles (id, discord_id, username, avatar_url, role, updated_at, claimed_at)
		select e.id, e.discord_id, e.username, e.avatar_url, 'member', now(), null
		  from entrants e
		 where not exists (select 1 from public.profiles p where p.discord_id = e.discord_id)
		on conflict (discord_id) do nothing
		returning 1
	), rafraichi as (
		update public.profiles p
		   set avatar_url = e.avatar_url, updated_at = now()
		  from entrants e
		 where p.discord_id = e.discord_id
		   and p.claimed_at is null
		   and e.avatar_url is not null
		   and p.avatar_url is distinct from e.avatar_url
		returning 1
	)
	select (select count(*) from insere), (select count(*) from rafraichi)
	  into v_crees, v_maj;

	return query select v_crees, v_maj;
end;
$$;

comment on function public.rg_precreer_profils_discord() is
	'Pré-crée des profils privés à partir des membres RG et des joueurs Achilléa ; seule une connexion OAuth Discord crée public.account.';

select * from public.rg_precreer_profils_discord();

commit;
