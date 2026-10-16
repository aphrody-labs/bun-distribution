-- Ajoute les colonnes power_offense/power_defense à inagle_formations.
--
-- `packages/inagle/src/push-categories.ts::importFormations` les écrit depuis
-- `SoccerFormationInfo.power_offense/power_defense` (nie-data/formation.rs, niers) depuis un
-- certain temps déjà, mais la table n'avait jamais reçu la migration correspondante : chaque
-- `inagle push` échouait silencieusement sur le batch `inagle_formations` entier
-- (« Could not find the 'power_defense' column of 'inagle_formations' in the schema cache »),
-- 0/115 formations poussées à chaque fois, données réelles perdues avant même d'atteindre la
-- table. Additif pur, aucune donnée existante déplacée.
alter table public.inagle_formations
  add column if not exists power_offense integer,
  add column if not exists power_defense integer;

comment on column public.inagle_formations.power_offense is
  'Puissance offensive de la formation (SoccerFormationInfo.powerOffense, nie-data/formation.rs).';
comment on column public.inagle_formations.power_defense is
  'Puissance défensive de la formation (SoccerFormationInfo.powerDefense, nie-data/formation.rs).';
