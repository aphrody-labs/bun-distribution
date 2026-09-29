import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "sqlite",
	schema: "./src/db/schema.ts",
	out: "./src/db/migrations",
	dbCredentials: {
		url: process.env.DATABASE_PATH ?? "./data/bot.db",
	},
	strict: true,
	verbose: true,
});
