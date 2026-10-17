import type { VercelConfig } from "@vercel/config/v1";

// Rose Griffon website on Vercel Fluid Compute with the Bun runtime. The site
// reads Supabase Cloud (Postgres, Storage, Realtime), Neon (inagle mirror) and
// the unified API; the workspace is prepared and built locally, then deployed
// as a prebuilt output.
//
// Free-tier guardrails (docs/aphrody/reference/infra/rg-free-tier-allocation.md):
// - one region, Frankfurt, next to Supabase and Neon (eu-central-1): every
//   database round trip stays in-region, which shortens wall time and thus
//   provisioned memory;
// - default max duration (Hobby: 300 s); no Vercel cron, the VPS schedules jobs;
// - public pages are ISR (`force-static` + `revalidate`), public GET routes send
//   `s-maxage` + `stale-while-revalidate`, and large game assets bypass image
//   optimisation (see `src/lib/image-cdn.tsx`).
export const config: VercelConfig = {
  framework: "nextjs",
  bunVersion: "1.4.x",
  installCommand: "",
  buildCommand: "bun run build",
  regions: ["fra1"],
};
