-- Répare la création de profil, cassée depuis la sortie de Supabase Auth.
--
-- CONSTAT
-- La base porte deux graphes d'identité parallèles :
--   * `auth.users`   — hérité de Supabase, référencé par 22 clés étrangères
--                      (profiles, chronicles, article_comments, patreon_memberships,
--                       reading_history, user_preferences…) ;
--   * `public."user"`— la table de Better Auth, référencée par 8 clés étrangères
--                      (account, session, orders, agent…).
--
-- `profiles.id` est arrimée au PREMIER (`profiles_id_fkey → auth.users`) mais n'est
-- alimentée que par le SECOND, via `ensureUserProfile`. Les 31 profils existants ne
-- survivent que parce que leurs identifiants figuraient déjà dans les deux tables au
-- moment de la migration.
--
-- Conséquence : tout compte créé depuis lors n'obtient AUCUN profil — l'insertion est
-- rejetée par la clé étrangère, et `ensureUserProfile` avale l'échec dans son try/catch.
-- Deux comptes réels en ont fait les frais (25/4/2026 et 6/5/2026).
--
-- CORRECTIF
-- Plutôt que de déplacer la clé étrangère vers `public."user"` — ce qui aurait fait
-- diverger `profiles` des 22 tables encore arrimées à `auth.users`, et forcé à créer un
-- utilisateur Better Auth pour tout profil pré-créé — on maintient l'invariant à la
-- source : chaque ligne de `public."user"` est reflétée dans `auth.users`.
--
-- Le reflet se fait par TRIGGER et non dans le code applicatif : un appelant peut
-- oublier d'appeler une fonction, pas de déclencher un trigger. C'est exactement l'oubli
-- qui a produit le bug.
--
-- Seul l'identifiant est reflété. `auth.users` porte un index unique partiel sur
-- l'adresse (`users_email_partial_key … WHERE is_sso_user = false`) : y recopier l'e-mail
-- ferait échouer l'insertion au premier doublon, et l'adresse fait déjà autorité dans
-- `public."user"` et `public.profiles`.

begin;

-- 1. Reflet automatique des futurs comptes.
create or replace function public.rg_mirror_user_to_auth()
returns trigger
language plpgsql
security definer
-- `search_path` figé : sans lui la fonction est un vecteur d'escalade de privilèges,
-- et l'audit de sécurité la signale à juste titre.
set search_path = ''
as $$
begin
	insert into auth.users (id)
	values (new.id::uuid)
	on conflict (id) do nothing;
	return new;
end;
$$;

comment on function public.rg_mirror_user_to_auth() is
	'Reflète tout compte Better Auth dans auth.users, que profiles référence par clé étrangère.';

drop trigger if exists rg_mirror_user_to_auth on public."user";

create trigger rg_mirror_user_to_auth
	after insert on public."user"
	for each row
	execute function public.rg_mirror_user_to_auth();

-- 2. Rattrapage des comptes déjà créés sans reflet.
insert into auth.users (id)
select u.id::uuid
  from public."user" u
 where not exists (select 1 from auth.users a where a.id = u.id::uuid)
on conflict (id) do nothing;

-- 3. Rattrapage des profils manquants.
--
--    Le pseudo est dérivé de l'adresse puis assaini pour respecter
--    `username_length` (au moins trois caractères) et l'unicité ; en cas de collision on
--    suffixe par le début de l'identifiant, ce qui reste stable si la migration est
--    rejouée.
insert into public.profiles (id, username, email, full_name, avatar_url, role, updated_at)
select u.id::uuid,
       case
         when exists (select 1 from public.profiles p where p.username = base.candidat)
           then base.candidat || '-' || left(replace(u.id::text, '-', ''), 6)
         else base.candidat
       end,
       u.email,
       nullif(u.name, ''),
       u.image,
       'member',
       now()
  from public."user" u
  cross join lateral (
    select coalesce(
             nullif(regexp_replace(lower(split_part(u.email, '@', 1)), '[^a-z0-9_]', '_', 'g'), ''),
             'membre'
           ) as candidat_brut
  ) brut
  cross join lateral (
    select case
             when char_length(brut.candidat_brut) >= 3 then left(brut.candidat_brut, 30)
             else brut.candidat_brut || '_' || left(replace(u.id::text, '-', ''), 4)
           end as candidat
  ) base
 where not exists (select 1 from public.profiles p where p.id = u.id::uuid)
on conflict (id) do nothing;

commit;
