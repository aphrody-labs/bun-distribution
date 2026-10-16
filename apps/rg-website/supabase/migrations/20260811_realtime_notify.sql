-- Remplacement du Realtime Supabase par LISTEN/NOTIFY Postgres.
--
-- Le service rg-realtime (apps/realtime/server.ts) tient une connexion
-- `LISTEN rg_realtime` et rediffuse chaque événement en SSE aux navigateurs.
-- Seules les tables réellement écoutées par le site portent le trigger.
--
-- Application : psql -d rg -f apps/website/sql/migrations/20260811_realtime_notify.sql

-- `search_path` figé : la fonction est SECURITY DEFINER, donc elle s'exécute avec
-- les droits de son propriétaire. Sans cette clause, un rôle appelant peut placer
-- un schéma sous son contrôle devant `public` et détourner un appel non qualifié.
CREATE OR REPLACE FUNCTION public.rg_realtime_notify() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  payload   jsonb;
  row_new   jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  row_old   jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  -- Colonnes personnelles à ne JAMAIS diffuser : le flux SSE de rg-realtime
  -- n'est pas authentifié (n'importe qui peut s'abonner à une table), donc
  -- tout ce qui part d'ici est public. Miroir de la liste blanche appliquée
  -- aux droits `anon` (20260811_profiles_pii.sql).
  prives   text[] := ARRAY['email', 'full_name', 'address_line1', 'address_line2',
                           'city', 'postal_code', 'country', 'patreon_id'];
BEGIN
  IF TG_TABLE_NAME = 'profiles' THEN
    row_new := row_new - prives;
    row_old := row_old - prives;
  END IF;

  payload := jsonb_build_object(
    'schema',    TG_TABLE_SCHEMA,
    'table',     TG_TABLE_NAME,
    'eventType', TG_OP,
    'new',       row_new,
    'old',       row_old
  );

  -- pg_notify plafonne à 8000 octets : au-delà on n'envoie que les identifiants
  -- et on marque l'événement tronqué, à charge du client de recharger.
  IF octet_length(payload::text) > 7000 THEN
    payload := jsonb_build_object(
      'schema',    TG_TABLE_SCHEMA,
      'table',     TG_TABLE_NAME,
      'eventType', TG_OP,
      'truncated', true,
      'new',       CASE WHEN row_new IS NULL THEN NULL ELSE jsonb_build_object('id', row_new -> 'id') END,
      'old',       CASE WHEN row_old IS NULL THEN NULL ELSE jsonb_build_object('id', row_old -> 'id') END
    );
  END IF;

  PERFORM pg_notify('rg_realtime', payload::text);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS rg_realtime_comments ON public.comments;
CREATE TRIGGER rg_realtime_comments
  AFTER INSERT OR UPDATE OR DELETE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.rg_realtime_notify();

DROP TRIGGER IF EXISTS rg_realtime_settings ON public.settings;
CREATE TRIGGER rg_realtime_settings
  AFTER INSERT OR UPDATE OR DELETE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.rg_realtime_notify();

DROP TRIGGER IF EXISTS rg_realtime_profiles ON public.profiles;
CREATE TRIGGER rg_realtime_profiles
  AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.rg_realtime_notify();
