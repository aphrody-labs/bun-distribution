-- Tables serveur exposées par défaut sur Supabase Cloud.
--
-- Sur la pile self-host, ces tables (Better Auth, OAuth provider, clés d'API,
-- boîte de réception, relais de campagnes) n'étaient lisibles que par les rôles
-- applicatifs. Supabase Cloud accorde par défaut tous les droits de `public` à
-- `anon` et `authenticated` sur les tables créées par `postgres` : sans RLS,
-- PostgREST les servait à n'importe quel porteur de la clé publique.
--
-- Le site et l'API y accèdent uniquement côté serveur (connexion `postgres`,
-- qui contourne la RLS) : RLS activée sans policy, droits publics retirés.

begin;

do $$
declare
  t text;
begin
  foreach t in array array[
    'apikey', 'discord_appartenances', 'inbound_emails', 'jwks', 'niers_schema_migrations',
    'oauthRefreshToken', 'passkey', 'oauthApplication', 'oauthConsent', 'oauthClient',
    'x_campagne_relais', 'oauthAccessToken'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

commit;
