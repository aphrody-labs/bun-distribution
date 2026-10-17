import type { VercelConfig } from "@vercel/config/v1";

// Unified Rose Griffon API (Elysia) as one Vercel Function on the Bun runtime.
// The workspace is installed locally; `src/scripts/build-vercel.ts` writes a
// self-contained Build Output (one bundled function serving every path), then
// it is deployed with `vercel deploy --prebuilt`.
//
// Free-tier guardrails (docs/aphrody/reference/infra/rg-free-tier-allocation.md):
// one region next to Supabase and Neon (eu-central-1), a 60 s ceiling, and
// CDN caching of the public GET reads (`src/api/plugins/public-cache.ts`).
// Scheduled tasks and the Discord gateway run on the VPS, not here.
export const config: VercelConfig = {
  framework: null,
  bunVersion: "1.x",
  installCommand: "",
  buildCommand: "bun src/scripts/build-vercel.ts",
  regions: ["fra1"],
};
