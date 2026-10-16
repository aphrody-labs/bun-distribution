-- Persistance privée des recettes de l'atelier 3D Azalée.
-- Rejouable : aucune lecture publique n'est accordée, y compris pour les codes partagés.

create table if not exists public.avatar_saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nom varchar(40) not null default 'Avatar',
  donnees jsonb not null,
  code varchar(69),
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(),
  constraint avatar_saves_nom_borne check (char_length(nom) between 1 and 40),
  constraint avatar_saves_code_69 check (code is null or char_length(code) = 69)
);

-- Les politiques dépendent des colonnes dont le type peut devoir être réparé. Elles doivent
-- donc disparaître avant les ALTER TYPE, puis sont recréées avec la définition canonique.
drop policy if exists "avatar_saves_select_owner" on public.avatar_saves;
drop policy if exists "avatar_saves_insert_owner" on public.avatar_saves;
drop policy if exists "avatar_saves_update_owner" on public.avatar_saves;
drop policy if exists "avatar_saves_delete_owner" on public.avatar_saves;
drop policy if exists "Lecture par propriétaire ou code" on public.avatar_saves;
drop policy if exists "Lecture par code" on public.avatar_saves;
drop policy if exists avatar_saves_lecture_par_code on public.avatar_saves;
drop policy if exists avatar_saves_lecture_proprietaire on public.avatar_saves;
drop policy if exists avatar_saves_ecriture_proprietaire on public.avatar_saves;

-- Converge aussi les index legacy : une seule unicité nullable par code et un seul index
-- propriétaire/date doivent subsister, quel que soit l'historique de création de la table.
alter table public.avatar_saves drop constraint if exists avatar_saves_code_key;
drop index if exists public.avatar_saves_code_idx;
drop index if exists public.avatar_saves_user_idx;

-- Répare aussi l'éventuelle table créée manuellement par l'ancienne livraison.
alter table public.avatar_saves alter column id set default gen_random_uuid();
alter table public.avatar_saves alter column user_id set not null;
alter table public.avatar_saves alter column nom type varchar(40) using left(coalesce(nullif(nom, ''), 'Avatar'), 40);
alter table public.avatar_saves alter column nom set default 'Avatar';
alter table public.avatar_saves alter column nom set not null;
alter table public.avatar_saves alter column donnees type jsonb using donnees::jsonb;
alter table public.avatar_saves alter column donnees set not null;
alter table public.avatar_saves alter column code type varchar(69) using code::varchar(69);
alter table public.avatar_saves alter column cree_le set default now();
alter table public.avatar_saves alter column cree_le set not null;
alter table public.avatar_saves alter column modifie_le set default now();
alter table public.avatar_saves alter column modifie_le set not null;

alter table public.avatar_saves drop constraint if exists avatar_saves_user_id_fkey;
alter table public.avatar_saves add constraint avatar_saves_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.avatar_saves drop constraint if exists avatar_saves_nom_borne;
alter table public.avatar_saves add constraint avatar_saves_nom_borne check (char_length(nom) between 1 and 40);
alter table public.avatar_saves drop constraint if exists avatar_saves_code_69;
alter table public.avatar_saves add constraint avatar_saves_code_69 check (code is null or char_length(code) = 69);

create unique index if not exists avatar_saves_code_unique on public.avatar_saves (code) where code is not null;
create index if not exists avatar_saves_user_modifie_idx on public.avatar_saves (user_id, modifie_le desc);

alter table public.avatar_saves enable row level security;
revoke all on table public.avatar_saves from public;
revoke all on table public.avatar_saves from anon;
grant select, insert, update, delete on table public.avatar_saves to authenticated;
-- Les Server Actions passent par le client de service après validation/authentification.
-- Le rôle contourne la RLS, mais a tout de même besoin des privilèges SQL de la table.
grant select, insert, update, delete on table public.avatar_saves to service_role;

create policy "avatar_saves_select_owner" on public.avatar_saves
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "avatar_saves_insert_owner" on public.avatar_saves
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "avatar_saves_update_owner" on public.avatar_saves
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "avatar_saves_delete_owner" on public.avatar_saves
  for delete to authenticated using ((select auth.uid()) = user_id);
