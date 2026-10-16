-- Le flux SSE cesse de PUBLIER ce qu'on lui demande de RETIRER.
--
-- LE DÉFAUT CORRIGÉ
-- `rg_realtime_notify()` diffusait `to_jsonb(NEW)` ET `to_jsonb(OLD)` sans autre
-- filtre que la liste blanche de `profiles`. Or, sur les tables Discord, la
-- suppression est LOGIQUE : le cron ne fait pas un DELETE, il fait
--   `update discord_messages set deleted_at = now() … where deleted_at is null`
-- (packages/cron/src/tasks/discord-messages.ts, `marquerSupprimes`).
-- Cet UPDATE réveille le trigger, qui expédiait alors `content`, `author_id`,
-- `author_username` et `author_avatar_url` du message QUI VIENT D'ÊTRE SUPPRIMÉ —
-- sur un flux (`apps/realtime/server.ts`, `realtime.rosegriffon.fr/stream?table=…`)
-- qui n'est PAS authentifié et accepte n'importe quel nom de table.
-- Mesuré le 12/8/2026 : un simple UPDATE sans effet sur `discord_messages` fait
-- arriver `{"new":{…"content":"…","author_id":"…"},"old":{…idem…}}` chez un
-- abonné anonyme. Retirer un message le publiait donc au lieu de le masquer.
--
-- Même mécanique pour la dépublication d'un salon : `suivi = false` puis purge
-- (`… on delete cascade`, cf. 20260812_veille_salons_discord.sql). Sur DELETE,
-- `row_old` porte la ligne ENTIÈRE : dépublier aurait diffusé l'intégralité de ce
-- qu'on retirait, messages, sondages et choix compris.
--
-- LA RÈGLE POSÉE ICI
-- Le flux ne peut plus dire plus que la surface HTTP. Pour les quatre tables
-- Discord, le contenu n'est diffusé QUE si la ligne satisfait exactement sa
-- propre policy RLS (salon `suivi`, message `deleted_at is null`) ; sinon il ne
-- part qu'un ÉVÉNEMENT D'INVALIDATION — les identifiants, rien d'autre — pour que
-- le client sache qu'il doit recharger. Un DELETE n'émet jamais de contenu : il
-- n'existe aucun cas où republier une ligne qu'on efface soit le comportement
-- voulu.
--
-- Aucun composant du site ne s'abonne à ces tables aujourd'hui
-- (`grep -rn "discord_messages" apps/website/src` : trois modules serveur, zéro
-- écoute cliente), la forme réduite ne casse donc aucun écran.
--
-- Application :
--   psql "$DATABASE_URL" -f apps/website/supabase/migrations/20260812_realtime_suppression_muette.sql

begin;

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
  -- Tables dont la visibilité est CONDITIONNELLE (RLS) : leur contenu ne part
  -- que si la ligne est réellement publique à cet instant.
  sous_condition text[] := ARRAY['discord_channels', 'discord_messages',
                                 'discord_polls', 'discord_poll_options'];
  publiable boolean := true;
  ligne     jsonb;
BEGIN
  IF TG_TABLE_NAME = 'profiles' THEN
    row_new := row_new - prives;
    row_old := row_old - prives;
  END IF;

  IF TG_TABLE_NAME = ANY (sous_condition) THEN
    -- Les tests portent sur `row_new` en jsonb plutôt que sur `NEW.<colonne>` :
    -- cette fonction sert AUSSI des tables qui n'ont ni `channel_id` ni
    -- `deleted_at`, et un accès de champ inexistant sur un record lèverait une
    -- erreur à l'exécution. En jsonb, une colonne absente vaut simplement NULL.
    IF TG_OP = 'DELETE' THEN
      -- Une ligne effacée ne se republie pas. C'est le cas de la purge d'un
      -- salon retiré de la veille : `row_old` porterait tout le contenu purgé.
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
      -- Invalidation SÈCHE : les identifiants suffisent à faire recharger un
      -- client, et ils sont déjà dans l'URL publique de la page concernée.
      ligne := COALESCE(row_new, row_old);
      PERFORM pg_notify('rg_realtime', jsonb_build_object(
        'schema',       TG_TABLE_SCHEMA,
        'table',        TG_TABLE_NAME,
        'eventType',    TG_OP,
        'invalidation', true,
        'cles',         jsonb_strip_nulls(jsonb_build_object(
                          'channel_id', ligne -> 'channel_id',
                          'message_id', ligne -> 'message_id',
                          'poll_id',    ligne -> 'poll_id',
                          'position',   ligne -> 'position'
                        ))
      )::text);
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

commit;
