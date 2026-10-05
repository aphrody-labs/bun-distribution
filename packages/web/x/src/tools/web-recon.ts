// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { webJobWait, webObscuraFetchSubmit } from "@aphrody/bun/web";
import { X_RECON_URLS } from "../config/x-surface";

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

interface NativeFetchResult {
  ok?: boolean;
  error?: string;
  url?: string;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  transport?: string;
}

async function fetchNative(url: string): Promise<NativeFetchResult> {
  const id = webObscuraFetchSubmit(url, false, 30_000);
  if (!id) throw new Error("native Obscura fetch did not create a job");
  return JSON.parse(await webJobWait(id, 35_000)) as NativeFetchResult;
}

function webBinary(): string {
  if (Bun.env.APHRODY_WEB_BIN) return Bun.env.APHRODY_WEB_BIN;
  const installed = Bun.which("aphrody-web");
  if (installed) return installed;
  const workspaceBinary = resolve(import.meta.dir, "../../../../../target/debug/aphrody-web");
  return existsSync(workspaceBinary) ? workspaceBinary : "aphrody-web";
}

async function fetchRendered(
  url: string,
  profile: WebReconProfile,
): Promise<Record<string, unknown>> {
  const args = [webBinary(), "fetch", url, "--dump", "artifact", "--quiet", "--timeout", "90"];
  if (profile === "stealth" || profile === "max") args.push("--stealth");
  const proc = Bun.spawn({ cmd: args, stdout: "pipe", stderr: "pipe" });
  const [code, output, error] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (code !== 0) throw new Error(error.trim() || `aphrody-web exit ${code}`);
  return JSON.parse(output) as Record<string, unknown>;
}

/** Recon via the shared Rust HTTP transport or the Rust V8 browser renderer. */
export async function runXWebRecon(
  profile: WebReconProfile = "max",
  urls: readonly string[] = X_RECON_URLS,
): Promise<XSurfaceReconReport> {
  const entries = await Promise.all(
    urls.map(async (url): Promise<[string, ReconSummary]> => {
      try {
        if (profile !== "http" && profile !== "static") {
          const raw = await fetchRendered(url, profile);
          return [
            url,
            {
              url,
              finalUrl: raw.url as string | undefined,
              profile,
              raw,
            },
          ];
        }
        const raw = await fetchNative(url);
        if (raw.error || !raw.ok) {
          return [url, { url, profile, error: raw.error ?? "native fetch failed", raw }];
        }
        return [
          url,
          {
            url,
            finalUrl: raw.url,
            httpStatus: raw.status,
            profile,
            raw,
          },
        ];
      } catch (error) {
        return [
          url,
          {
            url,
            profile,
            error: error instanceof Error ? error.message : String(error),
          },
        ];
      }
    }),
  );

  return {
    generated_at: new Date().toISOString(),
    profile,
    results: Object.fromEntries(entries),
  };
}
