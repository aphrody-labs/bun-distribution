import type { VercelConfig } from "@vercel/config/v1";

// Rose Griffon website on Vercel Fluid Compute with the Bun runtime. The site
// reads Supabase Cloud (Postgres, Storage, Realtime) and the unified API; the
// workspace is prepared and built locally, then deployed as a prebuilt output.
export const config: VercelConfig = {
  framework: "nextjs",
  bunVersion: "1.4.x",
  installCommand: "",
  buildCommand: "bun run build",
};
