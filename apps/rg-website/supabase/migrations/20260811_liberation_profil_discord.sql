-- Durcit la libération d'un profil pré-créé lors de la première connexion.
--
-- CONSTAT (revue adversariale du plan, 11/8/2026)
-- `ensureUserProfile` libérait le profil détenant le `discord_id` avec pour seul
-- garde `claimed_at IS NULL`. Or ce prédicat porte deux sens incompatibles :
-- « invisible au public » et « supprimable sans perte ». Un profil réel dont le
-- `claimed_at` n'aurait pas été posé — compte créé par une version antérieure du
-- code, rattrapage manuel oublié — tombait dans le second sens et pouvait être
-- détruit avec sa bio, ses badges et son rôle.
--
-- CORRECTIF
-- La suppression est réservée à ce que ce système a lui-même fabriqué : un profil
-- dont l'identifiant est exactement l'uuid v5 dérivé du `discord_id`. Un profil
-- réel porte un uuid v4 tiré par Better Auth et ne peut pas satisfaire l'égalité.
-- Le refus est explicite plutôt que silencieux : mieux vaut une connexion en
-- erreur, visible et corrigeable, qu'un profil effacé sans trace.

begin;

create or replace function public.rg_liberer_profil_discord(p_discord_id text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_supprimes integer := 0;
begin
	if p_discord_id is null or p_discord_id = '' then
		return 0;
	end if;

	delete from public.profiles p
	 where p.discord_id = p_discord_id
	   and p.claimed_at is null
	   -- Double garde : l'identifiant PROUVE l'origine. `claimed_at` seul ne
	   -- distingue pas un profil pré-créé d'un profil réel mal initialisé.
	   and p.id = public.rg_uuid_membre_discord(p_discord_id)
	   -- Troisième garde : aucun contenu saisi par un humain. Un profil pré-créé
	   -- ne porte que le pseudo et l'avatar venus de Discord.
	   and coalesce(p.bio, '') = ''
	   and coalesce(p.website, '') = ''
	   and coalesce(p.banner_url, '') = ''
	   and coalesce(p.twitter_handle, '') = ''
	   and coalesce(p.full_name, '') = ''
	   and p.email is null
	   and coalesce(array_length(p.badges, 1), 0) = 0;

	get diagnostics v_supprimes = row_count;

	-- L'ancre de clé étrangère part avec le profil : plus personne ne la référence.
	if v_supprimes > 0 then
		delete from auth.users a
		 where a.id = public.rg_uuid_membre_discord(p_discord_id)
		   and not exists (select 1 from public.profiles p where p.id = a.id)
		   and not exists (select 1 from public."user" u where u.id::text = a.id::text);
	end if;

	return v_supprimes;
end;
$$;

comment on function public.rg_liberer_profil_discord(text) is
	'Libère le discord_id détenu par un profil pré-créé, et UNIQUEMENT par lui : identifiant dérivé du discord_id, non réclamé, sans contenu humain.';

commit;
