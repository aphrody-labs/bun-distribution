CREATE TABLE "TierlistVote" (
	"id" text PRIMARY KEY NOT NULL,
	"tierlistId" text NOT NULL,
	"userId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "TierlistVote_tierlist_user_unique" UNIQUE("tierlistId","userId")
);
--> statement-breakpoint
ALTER TABLE "TierlistVote" ADD CONSTRAINT "TierlistVote_tierlistId_Tierlist_id_fk" FOREIGN KEY ("tierlistId") REFERENCES "public"."Tierlist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TierlistVote" ADD CONSTRAINT "TierlistVote_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;