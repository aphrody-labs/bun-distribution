CREATE TABLE "Tierlist" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"templateKey" text,
	"tiers" jsonb NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"authorId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "Tierlist_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "Tierlist" ADD CONSTRAINT "Tierlist_authorId_User_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;