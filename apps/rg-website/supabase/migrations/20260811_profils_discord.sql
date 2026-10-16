-- Pré-crée un profil pour chaque membre du serveur Discord.
--
-- OBJECTIF
-- « Tous les membres Discord existent en base avec un profil pré-créé », de sorte qu'à sa
-- première connexion un membre retrouve son identité au lieu d'un compte vierge.
--
-- LE PIÈGE À NE PAS IGNORER
-- La policy de lecture de `profiles` est `USING (true)` pour le rôle `public` : la
-- fermeture PII du 11/8/2026 a restreint les COLONNES, jamais les LIGNES. Insérer
-- 2043 profils les rendrait donc tous lisibles en une requête par la clé `anon`
-- — qui est publique par conception — depuis quatre domaines, et rendrait
-- `/profil/<pseudo>` accessible pour 2043 personnes qui ne se sont jamais inscrites,
-- avec balisage JSON-LD `Person` et sans blocage dans `robots.txt`.
--
-- D'où la colonne `claimed_at` : un profil pré-créé n'est PAS un profil public. Il
-- n'existe que pour être réclamé. Tant qu'il ne l'est pas, la RLS le masque et les pages
-- publiques l'ignorent.
--
-- CE QUI N'EST DÉLIBÉRÉMENT PAS COPIÉ
-- Ni `full_name`, ni `email` : ce sont des données personnelles, et `discord_members`
-- ne les contient pas. `avatar_url` pointe vers le CDN Discord, déjà public.
--
-- IDEMPOTENCE
-- Rejouable sans effet de bord. `ON CONFLICT (discord_id)` n'écrase JAMAIS `username` :
-- un membre peut avoir choisi un pseudo de site différent de son pseudo Discord
-- (constaté : profil `zever2emedunom_75078` ↔ Discord `fox.xx17`).

begin;

-- 1. Marqueur de réclamation.
alter table public.profiles
	add column if not exists claimed_at timestamptz;

comment on column public.profiles.claimed_at is
	'Date de première connexion. NULL = profil pré-créé depuis Discord, jamais réclamé : masqué au public.';

-- Les profils déjà en base correspondent tous à un compte réel.
update public.profiles p
   set claimed_at = coalesce(p.updated_at, now())
 where p.claimed_at is null
   and exists (select 1 from public."user" u where u.id::text = p.id::text);

-- 2. Identifiant déterministe : même membre Discord → même uuid, à chaque rejeu.
create or replace function public.rg_uuid_membre_discord(p_discord_id text)
returns uuid
language sql
immutable
set search_path = ''
as $$
	-- uuid v5 dans un espace de noms propre au projet, pour ne jamais entrer en
	-- collision avec les uuid v4 générés par Better Auth.
	select extensions.uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'discord:' || p_discord_id);
$$;

-- 3. Ancrage de clé étrangère et pré-création pour les profils à venir.
--    `profiles.id` référence `auth.users`, qui n'est plus qu'une table d'ancrage depuis
--    la sortie de Supabase Auth (aucun GoTrue ne tourne). Une ligne ne portant que
--    l'identifiant suffit : tout le reste est nullable ou généré.
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
	-- Ancrage : un uuid déterministe dérivé du discord_id, pour que le rejeu retombe
	-- toujours sur la même ligne au lieu d'en créer une nouvelle à chaque passage.
	insert into auth.users (id)
	select public.rg_uuid_membre_discord(d.discord_id)
	  from public.discord_members d
	 where coalesce(d.is_bot, false) = false
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
		   and d.username is not null
		   and char_length(d.username) >= 3
	), insere as (
		insert into public.profiles (id, discord_id, username, avatar_url, role, updated_at, claimed_at)
		select e.id,
		       e.discord_id,
		       -- Le pseudo Discord tel quel : les 2058 handles sont déjà en minuscules
		       -- ASCII sans espace, et les « slugifier » créerait des collisions
		       -- (`_.bennett._.` et `_.bennett_.` donneraient le même résultat).
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
		-- Sur un profil NON réclamé, l'avatar suit Discord. Sur un profil réclamé, on ne
		-- touche à rien : la personne a pu téléverser le sien.
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

comment on function public.rg_precreer_profils_discord() is
	'Crée un profil non réclamé pour chaque membre Discord sans profil. Idempotent : ne réécrit jamais un pseudo.';

-- 4. La RLS cesse de tout publier.
--
--    `Public profiles are viewable by everyone.` portait `USING (true)` : toute ligne de
--    `profiles` était lisible par `anon` sur les colonnes de la liste blanche. Avec
--    2043 profils pré-créés, cela aurait publié en une requête l'identité de site de
--    personnes qui ne se sont jamais inscrites. La policy ne montre désormais que les
--    profils réclamés ; le propriétaire voit toujours le sien.
drop policy if exists "Public profiles are viewable by everyone." on public.profiles;

create policy "Profils réclamés visibles par tous"
	on public.profiles
	for select
	using (claimed_at is not null or auth.uid() = id);

-- 5. Exécution.
select * from public.rg_precreer_profils_discord();

commit;
