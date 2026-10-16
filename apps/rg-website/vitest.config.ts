import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [react()],
	test: {
		alias: {
			"@": path.resolve(dirname, "./src"),
		},
		environment: "jsdom",
		exclude: ["node_modules", ".next", "dist"],
		globals: true,
		include: ["src/**/*.{test,spec}.{ts,tsx}"],
		setupFiles: ["./vitest.setup.ts"],
	},
});
