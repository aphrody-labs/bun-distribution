-- Trigger functions and staff-only SECURITY DEFINER routines are not RPC endpoints:
-- remove the default PUBLIC/anon/authenticated EXECUTE grant (triggers fire regardless),
-- and pin the search_path of the remaining helpers (lint 0011).

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.notify_article_comment() from public, anon, authenticated;
revoke execute on function public.promote_rg_creator_to_admin() from public, anon, authenticated;
revoke execute on function public.rg_mirror_user_to_auth() from public, anon, authenticated;
revoke execute on function public.rg_realtime_notify() from public, anon, authenticated;
revoke execute on function public.rg_team_members_nom_equipe() from public, anon, authenticated;
revoke execute on function public.set_orders_updated_at() from public, anon, authenticated;

revoke execute on function public.rg_liberer_profil_discord(text) from public, anon, authenticated;
revoke execute on function public.rg_precreer_profils_discord() from public, anon, authenticated;
grant execute on function public.rg_liberer_profil_discord(text) to service_role;
grant execute on function public.rg_precreer_profils_discord() to service_role;

alter function public.rg_libelle_equipe(text) set search_path = pg_catalog, public;
alter function public.rg_team_members_nom_equipe() set search_path = pg_catalog, public;
alter function public.set_orders_updated_at() set search_path = pg_catalog, public;
alter function public.x_masquer_hashtags(text, text[]) set search_path = pg_catalog, public;
alter function public.x_regles_non_vides(text[]) set search_path = pg_catalog, public;
