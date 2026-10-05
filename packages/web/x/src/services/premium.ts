// SPDX-License-Identifier: Apache-2.0
//
// Premium surfaces. Parsing, fetching and the per-operation variable templates are aphrody-x
// (crates/web/x/src/premium.rs); this file keeps the public names and types over the native
// operations.

import type { XClient } from "../core/client";
import { local } from "../core/local";

/** Known upsell surface keys on x.com (from Upsells GraphQL). */
export type UpsellSurfaceKey =
  | "UserProfileName"
  | "UserProfileHeader"
  | "HomeSidebar"
  | "PremiumNav"
  | "HomeNav"
  | string;

/** Checkout SKUs in responsive-web main bundle (2026-06); not separate GraphQL ops. */
export type ProductCategory =
  | "BlueVerified"
  | "BlueVerified3Months"
  | "BlueVerified6Months"
  | "BlueVerifiedPlus"
  | "BlueVerifiedPlus3Months"
  | "BlueVerifiedPlus6Months"
  | "PremiumBasic"
  | string;
export type ChargeInterval = "Month" | "Year" | string;

export interface UpsellDestination {
  charge_interval?: ChargeInterval;
  product_category?: ProductCategory;
}

export interface UpsellConfigEntry {
  key: UpsellSurfaceKey;
  attribution_referrer?: string;
  destination?: UpsellDestination;
  is_hidden?: boolean;
  variant_key?: string;
  action_label?: string;
  primary_label?: string;
}

export interface PremiumUpsells {
  configs: UpsellConfigEntry[];
  raw: unknown;
}

export interface PremiumAccountFlags {
  is_blue_verified?: boolean;
  premium_gifting_eligible?: boolean;
  creator_subscriptions_count?: number;
  super_follow_eligible?: boolean;
  super_followers_count?: number;
  is_super_follow_subscriber?: boolean;
  can_access_payments?: boolean;
}

/** Parse `Upsells` → viewer_v2.upsell_config_for_surfaces. */
export function parseUpsellsResponse(json: unknown): PremiumUpsells {
  const parsed = local<{ configs: UpsellConfigEntry[] }>("parse_upsells", { json });
  return { configs: parsed.configs, raw: json };
}

/** Extract premium-related flags from Viewer + UserByScreenName payloads. */
export function parsePremiumFlags(viewerJson: unknown, userJson?: unknown): PremiumAccountFlags {
  return local<PremiumAccountFlags>("parse_premium_flags", { viewer: viewerJson, user: userJson });
}

export async function fetchPremiumUpsells(client: XClient): Promise<PremiumUpsells> {
  return client.call("premium_upsells");
}

export async function fetchPremiumBundle(
  client: XClient,
  handle: string,
  // Kept for the public signature; the bundle is resolved from the handle.
  _userId: string,
): Promise<{ upsells: PremiumUpsells; flags: PremiumAccountFlags; raw: Record<string, unknown> }> {
  return client.call("premium_bundle", { handle });
}

/** Variable templates for full Premium GraphQL coverage (see scripts/tools/web/x-premium-dump.ts). */
export function premiumGraphqlVariables(
  handle: string,
  userId: string,
): Record<string, Record<string, unknown>> {
  return local("premium_variables", { handle, user_id: userId });
}

/** Fetch every operation of the Premium set; failures are recorded, not thrown. */
export async function fetchAllPremiumGraphql(
  client: XClient,
  handle: string,
  userId: string,
): Promise<Record<string, { ok: true; data: unknown } | { ok: false; error: string }>> {
  return client.call("premium_fetch_all", { handle, user_id: userId });
}
