-- Temps réel sur Supabase Realtime (Broadcast) — fin du service SSE self-host.
--
-- `rg_realtime_notify()` gardait déjà toute la politique de diffusion : liste
-- blanche des colonnes de `profiles`, contenu Discord publié seulement s'il
-- satisfait sa policy RLS, DELETE sans contenu, troncature des grosses lignes.
-- Le service `rg-realtime` ajoutait une dernière réduction côté Bun
-- (`settings` → invalidation sèche, `profiles` → identifiant seul) avant de
-- rediffuser `LISTEN rg_realtime` en SSE.
--
-- Cette migration rapatrie cette dernière réduction dans la fonction et
-- remplace `pg_notify` par `realtime.send()` sur le topic PUBLIC
-- `rg:<table>`. Le navigateur s'abonne en Broadcast (`apps/rg-website/src/lib/realtime.ts`)
-- et ne reçoit donc que la charge déjà assainie par Postgres : aucune ligne
-- brute ne transite par `postgres_changes`.

begin;

CREATE OR REPLACE FUNCTION public.rg_realtime_notify() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  payload   jsonb;
  row_new   jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  row_old   jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  sous_condition text[] := ARRAY['discord_channels', 'discord_messages',
                                 'discord_polls', 'discord_poll_options'];
  publiable boolean := true;
  ligne     jsonb;
  topic     text := 'rg:' || TG_TABLE_NAME;
BEGIN
  -- Lignes de compte : un abonné public n'a besoin que d'une clé d'invalidation.
  IF TG_TABLE_NAME = 'settings' THEN
    payload := jsonb_build_object(
      'schema', TG_TABLE_SCHEMA, 'table', TG_TABLE_NAME, 'eventType', TG_OP,
      'new', NULL, 'old', NULL, 'truncated', true);
    PERFORM realtime.send(payload, TG_OP, topic, false);
    RETURN NULL;
  END IF;

  IF TG_TABLE_NAME = 'profiles' THEN
    payload := jsonb_build_object(
      'schema', TG_TABLE_SCHEMA, 'table', TG_TABLE_NAME, 'eventType', TG_OP,
      'new', CASE WHEN row_new IS NULL THEN NULL ELSE jsonb_build_object('id', row_new -> 'id') END,
      'old', CASE WHEN row_old IS NULL THEN NULL ELSE jsonb_build_object('id', row_old -> 'id') END,
      'truncated', true);
    PERFORM realtime.send(payload, TG_OP, topic, false);
    RETURN NULL;
  END IF;

  IF TG_TABLE_NAME = ANY (sous_condition) THEN
    IF TG_OP = 'DELETE' THEN
      publiable := false;
    ELSIF TG_TABLE_NAME = 'discord_channels' THEN
      publiable := (row_new ->> 'suivi') = 'true';
    ELSIF TG_TABLE_NAME = 'discord_messages' THEN
      publiable := (row_new ->> 'deleted_at') IS NULL
        AND EXISTS (SELECT 1 FROM public.discord_channels c
                     WHERE c.channel_id = row_new ->> 'channel_id' AND c.suivi);
    ELSIF TG_TABLE_NAME = 'discord_polls' THEN
      publiable := EXISTS (SELECT 1 FROM public.discord_channels c
                            WHERE c.channel_id = row_new ->> 'channel_id' AND c.suivi);
    ELSE -- discord_poll_options
      publiable := EXISTS (SELECT 1 FROM public.discord_polls p
                             JOIN public.discord_channels c ON c.channel_id = p.channel_id
                            WHERE p.poll_id = row_new ->> 'poll_id' AND c.suivi);
    END IF;

    IF NOT publiable THEN
      ligne := COALESCE(row_new, row_old);
      PERFORM realtime.send(jsonb_build_object(
        'schema',       TG_TABLE_SCHEMA,
        'table',        TG_TABLE_NAME,
        'eventType',    TG_OP,
        'new',          NULL,
        'old',          NULL,
        'invalidation', true,
        'cles',         jsonb_strip_nulls(jsonb_build_object(
                          'channel_id', ligne -> 'channel_id',
                          'message_id', ligne -> 'message_id',
                          'poll_id',    ligne -> 'poll_id',
                          'position',   ligne -> 'position'
                        ))
      ), TG_OP, topic, false);
      RETURN NULL;
    END IF;
  END IF;

  payload := jsonb_build_object(
    'schema',    TG_TABLE_SCHEMA,
    'table',     TG_TABLE_NAME,
    'eventType', TG_OP,
    'new',       row_new,
    'old',       row_old
  );

  -- Les messages Broadcast restent courts : au-delà, identifiants seuls.
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

  PERFORM realtime.send(payload, TG_OP, topic, false);
  RETURN NULL;
END $$;

commit;
