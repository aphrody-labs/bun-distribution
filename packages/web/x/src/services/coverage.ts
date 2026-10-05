// SPDX-License-Identifier: Apache-2.0
//
// Coverage of the embedded GraphQL catalog against the live bundles and an optional live Premium
// probe. The report is built by aphrody-x (native operation `coverage`); `resolveOperationQueryId`
// documents the resolution order.

import type { XClient } from "../core/client";
import { xSubmit } from "@aphrody/bun/x";
import { xErrorFromInfo } from "../core/error";
import { getOperation } from "../config/catalog";

export interface CoverageReport {
  generated_at: string;
  catalog: { total: number; queries: number; mutations: number };
  sdk_surface: readonly string[];
  premium_ops: readonly string[];
  query_id_cache?: { live_bundle_ops: number; stale_vs_catalog: string[] };
  premium_fetch?: Record<string, { ok: boolean }>;
}

/** Compare the embedded catalog against the live bundles, and optionally probe Premium live. */
export async function buildCoverageReport(
  client?: XClient,
  opts?: { probePremium?: boolean; checkQueryIds?: boolean },
): Promise<CoverageReport> {
  const args = {
    check_query_ids: opts?.checkQueryIds !== false,
    probe_premium: Boolean(opts?.probePremium && client),
  };
  if (client) return client.call<CoverageReport>("coverage", args);
  // No session: the report needs none (local catalog, live bundles); run it as a native job.
  const envelope = await xSubmit<CoverageReport>(0, "coverage", args);
  if (!envelope.ok) {
    throw xErrorFromInfo(envelope.error);
  }
  return envelope.data;
}

/** Resolve queryId: runtime cache → catalog (documents resolution order). */
export function resolveOperationQueryId(opName: string, runtimeId?: string): string | undefined {
  return runtimeId ?? getOperation(opName)?.queryId;
}
