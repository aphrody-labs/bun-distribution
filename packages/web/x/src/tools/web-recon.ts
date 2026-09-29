// SPDX-License-Identifier: Apache-2.0
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

/** Recon via the shared Rust HTTP transport. Browser profiles await Rust rendering. */
export async function runXWebRecon(
  profile: WebReconProfile = "max",
  urls: readonly string[] = X_RECON_URLS,
): Promise<XSurfaceReconReport> {
  if (profile !== "http" && profile !== "static") {
    throw new Error(`X recon profile '${profile}' requires the unified Rust browser renderer`);
  }

  const entries = await Promise.all(urls.map(async (url): Promise<[string, ReconSummary]> => {
    try {
      const raw = await fetchNative(url);
      if (raw.error || !raw.ok) {
        return [url, { url, profile, error: raw.error ?? "native fetch failed", raw }];
      }
      return [url, {
        url,
        finalUrl: raw.url,
        httpStatus: raw.status,
        profile,
        raw,
      }];
    } catch (error) {
      return [url, {
        url,
        profile,
        error: error instanceof Error ? error.message : String(error),
      }];
    }
  }));

  return {
    generated_at: new Date().toISOString(),
    profile,
    results: Object.fromEntries(entries),
  };
}
