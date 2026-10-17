-- Fonctions SECURITY DEFINER retirées de l'API publique.
--
-- Postgres accorde EXECUTE à PUBLIC sur toute fonction : via PostgREST, la clé
-- publique pouvait appeler ces RPC qui contournent la RLS — réinitialiser le
-- quota d'un autre compte (`check_rate_limit`), forger l'état du webhook
-- Patreon (`patreon_heartbeat`), écrire l'historique de lecture de n'importe
-- quel utilisateur (`upsert_reading_progress`), gonfler les compteurs
-- d'articles ou lire le statut de mécène d'un tiers (`is_active_patron`).
--
-- Tous les appelants sont des actions serveur (connexion `postgres` /
-- service_role) : seul service_role garde EXECUTE. `is_admin()` et
-- `get_my_patreon_status()` restent publiques : elles ne lisent que la ligne
-- de `auth.uid()` et servent aux policies RLS.

begin;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.check_rate_limit(uuid, text, integer, integer)',
    'public.increment_article_views(uuid)',
    'public.increment_share_count(uuid, text)',
    'public.is_active_patron(uuid)',
    'public.patreon_heartbeat(text, text, boolean)',
    'public.upsert_reading_progress(uuid, uuid, smallint)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

commit;
