import { defineConfig } from "@neon/config/v1";

// Neon project "aphrody": generic training database for every Aphrody
// training (any model, any domain). Empty until the code and its migrations
// land. Experiment branches expire after 7 days; production is never overridden.
export default defineConfig({
  branch: (branch) => (branch.isDefault || branch.exists ? {} : { ttl: "7d" }),
});
