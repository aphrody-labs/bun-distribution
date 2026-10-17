-- Planification des tâches Rose Griffon par Supabase — fin du démon `rg-cron`.
--
-- Le démon tenait les planifications en mémoire (`Bun.cron`). Vercel Hobby ne
-- planifie qu'une fois par jour : c'est donc `pg_cron` qui cadence, et `pg_net`
-- qui appelle `POST https://api.rosegriffon.fr/v1/cron/<tâche>` (route servie par
-- `packages/rg-cron/src/http.ts`). L'API répond 202 et poursuit la tâche
-- (`waitUntil`) : `pg_net` n'attend que l'accusé de réception.
--
-- SECRET : le jeton `CRON_SECRET` est lu à chaque appel dans Supabase Vault
-- (`rg_cron_secret`). Il n'est JAMAIS écrit dans ce fichier : il est créé hors
-- migration avec `select vault.create_secret('<CRON_SECRET>', 'rg_cron_secret')`
-- (ou `vault.update_secret` pour une rotation), la même valeur que la variable
-- `CRON_SECRET` de l'API.
--
-- Les expressions sont celles de `PLANIFICATIONS` (`@rosegriffon/types/cron`),
-- en UTC. Exclues, parce qu'elles exigent un disque local, un navigateur ou un
-- sous-processus (`horsServerless` dans `packages/rg-cron/src/registry.ts`) :
-- `db` (0 2 * * *), `cdn` (0 4 * * *), `seo:llms-txt` (45 5 * * *),
-- `stats:achillea` (8,23,38,53 * * * *). `sync:achillea` n'a pas de tâche
-- propre : elle est enchaînée par `discord` quand la collecte réussit, comme
-- dans le démon (l'ordre compte).

begin;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Bail d'exécution : sans processus unique, c'est la base qui empêche une
-- tâche de tourner deux fois en même temps (`prendreBail` / `rendreBail`).
create table if not exists public.cron_task_leases (
  tache text primary key,
  jeton uuid not null,
  tenu_jusqua timestamptz not null,
  hote text not null,
  pris_le timestamptz not null default now()
);

comment on table public.cron_task_leases is
  'Bail d''unicité des tâches cron, tenu le temps du délai maximal. Écrit par packages/rg-cron/src/lib/executions-postgres.ts.';

alter table public.cron_task_leases enable row level security;
revoke all on public.cron_task_leases from anon, authenticated;

create schema if not exists rg_cron;
revoke all on schema rg_cron from public, anon, authenticated;

-- Appel HTTP d'une tâche. SECURITY DEFINER : seul le propriétaire lit Vault.
create or replace function rg_cron.appeler(tache text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'rg_cron_secret';
  if secret is null then
    raise exception 'Secret Vault rg_cron_secret absent : tâche % non appelée', tache;
  end if;
  return net.http_post(
    url := 'https://api.rosegriffon.fr/v1/cron/' || tache,
    body := jsonb_build_object('origine', 'planifie'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    timeout_milliseconds := 15000
  );
end;
$$;

revoke all on function rg_cron.appeler(text) from public, anon, authenticated;

-- Une tâche pg_cron par tâche planifiée ; `cron.schedule` remplace un job du même nom.
select cron.schedule('rg:' || tache, planification, format('select rg_cron.appeler(%L)', tache))
  from (values
    ('publish', '2,17,32,47 * * * *'),
    ('warm', '7,37 * * * *'),
    ('discord', '12,42 * * * *'),
    ('discord:messages', '5,20,35,50 * * * *'),
    ('discord:polls', '10 * * * *'),
    ('x:campagnes', '20 * * * *'),
    ('campagnes:discord', '25 * * * *'),
    ('campagnes:instagram', '35 * * * *'),
    ('campagnes:relais', '10,25,40,55 * * * *'),
    ('zukan:videos', '0 2 * * *'),
    ('patreon', '0 3 * * *'),
    ('github-publish', '30 4 * * *'),
    ('seo:indexnow', '0 6 * * *'),
    ('reminders', '0 8 * * *'),
    ('achillea:seasons', '0 0 * * *'),
    ('achillea:weekly-payout', '0 0 * * 1')
  ) as t(tache, planification);

commit;
