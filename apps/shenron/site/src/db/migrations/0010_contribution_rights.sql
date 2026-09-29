-- Droit de contribution par périmètre (wiki / databooks).
--
-- Singleton `default` : qui a le droit de proposer une correction, et sur quoi.
-- La réponse était jusqu'ici écrite dans le code (« tout membre connecté »), ce
-- qui interdisait d'ouvrir les databooks à une équipe de relecture sans ouvrir
-- le wiki entier, ou l'inverse.
CREATE TABLE IF NOT EXISTS "ContributionRights" (
  "id"        text PRIMARY KEY,
  "data"      jsonb NOT NULL,
  "updatedBy" text,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Défaut explicite = le comportement historique, pour que le déploiement ne
-- change rien tant qu'un admin n'a pas décidé.
INSERT INTO "ContributionRights" ("id", "data")
VALUES (
  'default',
  '{"wiki":{"mode":"members","roleIds":[],"discordIds":[]},"databooks":{"mode":"members","roleIds":[],"discordIds":[]}}'::jsonb
)
ON CONFLICT ("id") DO NOTHING;
