-- Socle social partagé (commentaires + réactions sur toutes les surfaces) et
-- clés d'agent pour l'API d'écriture.
--
-- `IF NOT EXISTS` partout → ré-exécutable sur la base de prod (drizzle-kit
-- migrate plante sous Bun ; on applique ce SQL directement, cf. 0014).

CREATE TABLE IF NOT EXISTS "ContentComment" (
	"id" text PRIMARY KEY NOT NULL,
	"targetKind" text NOT NULL,
	"targetId" text NOT NULL,
	"parentId" text,
	"authorId" text,
	"authorName" text,
	"agentName" text,
	"body" text NOT NULL,
	"status" text NOT NULL DEFAULT 'visible',
	"pinned" boolean NOT NULL DEFAULT false,
	"edited" boolean NOT NULL DEFAULT false,
	"moderatedBy" text,
	"moderatedAt" timestamp (3),
	"createdAt" timestamp (3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp (3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- L'auteur peut disparaître (suppression de compte Better Auth) sans emporter le
-- fil : `SET NULL` + `authorName` figé laissent la conversation lisible.
DO $$ BEGIN
	ALTER TABLE "ContentComment"
		ADD CONSTRAINT "ContentComment_authorId_User_id_fk"
		FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- La réponse suit son parent : supprimer un commentaire racine emporte ses
-- réponses (un fil orphelin n'a aucun sens côté lecture).
DO $$ BEGIN
	ALTER TABLE "ContentComment"
		ADD CONSTRAINT "ContentComment_parentId_fk"
		FOREIGN KEY ("parentId") REFERENCES "ContentComment"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "ContentComment_target_idx"
	ON "ContentComment" ("targetKind", "targetId", "createdAt");
CREATE INDEX IF NOT EXISTS "ContentComment_parent_idx"
	ON "ContentComment" ("parentId", "createdAt");
CREATE INDEX IF NOT EXISTS "ContentComment_author_idx"
	ON "ContentComment" ("authorId", "createdAt");
CREATE INDEX IF NOT EXISTS "ContentComment_status_idx"
	ON "ContentComment" ("status", "createdAt");

CREATE TABLE IF NOT EXISTS "ContentReaction" (
	"id" text PRIMARY KEY NOT NULL,
	"targetKind" text NOT NULL,
	"targetId" text NOT NULL,
	"userId" text NOT NULL,
	"kind" text NOT NULL DEFAULT 'like',
	"createdAt" timestamp (3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
	ALTER TABLE "ContentReaction"
		ADD CONSTRAINT "ContentReaction_userId_User_id_fk"
		FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "ContentReaction"
		ADD CONSTRAINT "ContentReaction_target_user_kind_key"
		UNIQUE ("targetKind", "targetId", "userId", "kind");
-- PostgreSQL signale une contrainte UNIQUE existante avec SQLSTATE 42P07
-- (`duplicate_table`) car son index de support porte le même nom.
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "ContentReaction_target_idx"
	ON "ContentReaction" ("targetKind", "targetId");
CREATE INDEX IF NOT EXISTS "ContentReaction_user_idx"
	ON "ContentReaction" ("userId", "createdAt");

-- Reprise des commentaires d'articles déjà écrits. La table `Comment` est
-- CONSERVÉE telle quelle (repli de lecture, aucune perte si la reprise est
-- rejouée) ; la clé de dédoublonnage est l'id d'origine, réutilisé à
-- l'identique — rejouer la migration ne duplique donc rien.
INSERT INTO "ContentComment" ("id", "targetKind", "targetId", "authorId", "authorName", "body", "createdAt", "updatedAt")
SELECT c."id", 'post', c."postId", c."authorId", u."username", c."body", c."createdAt", c."createdAt"
FROM "Comment" c
LEFT JOIN "User" u ON u."id" = c."authorId"
ON CONFLICT ("id") DO NOTHING;

-- Reprise des « likes » de tier lists : même socle, même compteur, une seule
-- logique de toggle à maintenir ensuite.
INSERT INTO "ContentReaction" ("id", "targetKind", "targetId", "userId", "kind", "createdAt")
SELECT v."id", 'tierlist', v."tierlistId", v."userId", 'like', v."createdAt"
FROM "TierlistVote" v
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "AgentKey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"tokenHash" text NOT NULL UNIQUE,
	"scopes" jsonb NOT NULL DEFAULT '[]'::jsonb,
	"note" text,
	"createdBy" text,
	"createdAt" timestamp (3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"lastUsedAt" timestamp (3),
	"revokedAt" timestamp (3),
	"rateLimitPerHour" integer
);

CREATE INDEX IF NOT EXISTS "AgentKey_active_idx" ON "AgentKey" ("revokedAt", "createdAt");

CREATE TABLE IF NOT EXISTS "AgentAudit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"keyId" text,
	"keyName" text,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status" integer NOT NULL,
	"summary" text,
	"createdAt" timestamp (3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "AgentAudit_key_idx" ON "AgentAudit" ("keyId", "createdAt");

-- Attribution d'un article déposé par l'API agents. `authorId` continue de
-- porter le membre du staff responsable de la clé (contrainte de clé étrangère,
-- et quelqu'un doit répondre du texte) ; cette colonne dit que le brouillon a
-- été écrit par une machine.
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "agentName" text;
