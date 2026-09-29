import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: "./src/db/schema.ts",
	out: "./src/db/migrations",
	dialect: "postgresql",
	dbCredentials: {
		url: process.env.DATABASE_URL!,
	},
	tablesFilter: [
		"Post",
		"User",
		"Comment",
		"Tierlist",
		"TierlistVote",
		"WikiCategory",
		"WikiPage",
		"ba_user",
		"ba_session",
		"ba_account",
		"ba_verification",
		"site_events",
		"user_preferences",
		"HomeConfig",
		"SiteTheme",
		"ChronologyConfig",
		"PageBanners",
	],
	verbose: true,
	strict: true,
});
