import type { VercelConfig } from "@vercel/config/v1";

// Unified Rose Griffon API (Elysia) as one Vercel Function on the Bun runtime.
// The workspace is installed locally; `src/scripts/build-vercel.ts` writes a
// self-contained Build Output (one bundled function serving every path), then
// it is deployed with `vercel deploy --prebuilt`.
export const config: VercelConfig = {
  framework: null,
  bunVersion: "1.x",
  installCommand: "",
  buildCommand: "bun src/scripts/build-vercel.ts",
};
