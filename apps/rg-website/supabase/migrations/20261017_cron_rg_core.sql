-- Les tâches planifiées quittent pg_cron → Vercel pour `rg-core` sur le VPS.
--
-- `rg-core` (apps/rg-bot/src/core.ts, systemd/rg/rg-core.service) planifie en processus, avec
-- `Bun.cron`, toutes les tâches périodiques du registre `packages/rg-cron/src/registry.ts` : même
-- délai maximal, même historique `public.cron_executions`, même bail `public.cron_task_leases`.
-- Les appels `net.http_post` vers `https://api.rosegriffon.fr/v1/cron/<tâche>` consommaient le
-- quota d'exécution du plan Vercel gratuit pour un travail que le VPS fait sans coût : les 16
-- jobs `rg:*` créés par 20261017_cron_pg_net.sql sont donc retirés, ainsi que la fonction qui
-- les appelait. Les jobs pg_cron purement SQL éventuels ne sont pas touchés.
--
-- `warm` n'est replanifié nulle part : il ne faisait que réveiller des pages Vercel, et l'ISR se
-- revalide à la demande.

begin;

select cron.unschedule(jobid)
  from cron.job
 where jobname like 'rg:%'
   and command like '%rg_cron.appeler(%';

drop function if exists rg_cron.appeler(text);

commit;
