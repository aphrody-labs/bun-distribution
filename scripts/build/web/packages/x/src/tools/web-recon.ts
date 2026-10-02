// SPDX-License-Identifier: Apache-2.0
/**
 * Aphrody Web integration — renders the X SPA through the canonical V8 CLI.
 */

import { X_RECON_URLS } from "../../../../../../../packages/web/x/src/config/x-surface";

export type WebReconProfile = "static" | "fast" | "http" | "stealth" | "max";

export interface ReconSummary {
  url: string;
  finalUrl?: string;
  httpStatus?: number;
  profile?: string;
  cdn?: string;
  error?: string;
  raw?: unknown;
}

export interface XSurfaceReconReport {
  generated_at: string;
  profile: WebReconProfile;
  results: Record<string, ReconSummary>;
}

/** Render every URL through `aphrody-web`, emitting the shared page artifact. */
export async function runXWebRecon(
  profile: WebReconProfile = "max",
  urls: readonly string[] = X_RECON_URLS,
): Promise<XSurfaceReconReport> {
  const results: XSurfaceReconReport["results"] = {};

  for (const url of urls) {
    try {
      const webBin = Bun.env.APHRODY_WEB_BIN || Bun.which("aphrody-web") || "aphrody-web";
      const args = [webBin, "fetch", url, "--dump", "artifact", "--quiet", "--timeout", "90"];
      if (profile === "stealth" || profile === "max") args.push("--stealth");
      const proc = Bun.spawn({
        cmd: args,
        stdout: "pipe",
        stderr: "pipe",
      });
      const code = await proc.exited;
      const text = await new Response(proc.stdout).text();
      if (code !== 0) {
        const err = await new Response(proc.stderr).text();
        results[url] = { url, error: err.trim() || `aphrody-web exit ${code}` };
        continue;
      }
      const parsed = JSON.parse(text) as Record<string, unknown>;
      results[url] = {
        url,
        finalUrl: parsed.url as string | undefined,
        profile,
        cdn: undefined,
        raw: parsed,
      };
    } catch (err: unknown) {
      results[url] = { url, error: err instanceof Error ? err.message : String(err) };
    }
  }

  return {
    generated_at: new Date().toISOString(),
    profile,
    results,
  };
}
