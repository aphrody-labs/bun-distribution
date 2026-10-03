import { verify as patreonVerify } from "@rosegriffon/patreon-bun";
import { createPostgresClient } from "@rosegriffon/db/service";

import type {
  JsonApiResource,
  PatreonAddressAttrs,
  PatreonMemberAttrs,
  PatreonTierAttrs,
} from "./types";

/**
 * Tous les triggers Patreon v2 — référence officielle :
 * https://docs.patreon.com/#triggers-v2
 */
export type PatreonTrigger =
  | "members:create"
  | "members:update"
  | "members:delete"
  | "members:pledge:create"
  | "members:pledge:update"
  | "members:pledge:delete"
  | "posts:publish"
  | "posts:update"
  | "posts:delete"
  | (string & {});

export const ALL_TRIGGERS: PatreonTrigger[] = [
  "members:create",
  "members:update",
  "members:delete",
  "members:pledge:create",
  "members:pledge:update",
  "members:pledge:delete",
  "posts:publish",
  "posts:update",
  "posts:delete",
];

export interface PatreonWebhookPayload {
  data: JsonApiResource<PatreonMemberAttrs | PatreonPostAttrs>;
  included?: JsonApiResource[];
  links?: Record<string, string>;
}

export interface PatreonPostAttrs {
  title?: string;
  content?: string;
  teaser_text?: string;
  url?: string;
  published_at?: string | null;
  edited_at?: string | null;
  is_public?: boolean;
  is_paid?: boolean;
  embed_url?: string | null;
  embed_data?: Record<string, unknown> | null;
}

/**
 * HMAC-MD5 verification via @rosegriffon/patreon-bun.
 * Constant-time + safe edge cases (null/empty/length mismatch).
 */
export function verifySignature(rawBody: string, signature: string): boolean {
  const secret = process.env.PATREON_WEBHOOK_SECRET;
  if (!secret) {
    return false;
  }
  try {
    return patreonVerify(secret, signature, rawBody);
  } catch {
    return false;
  }
}

/**
 * Extrait les tiers depuis `included[type=tier]` filtrés par les
 * `currently_entitled_tiers` du member.
 */
function parseTiers(
  member: JsonApiResource<PatreonMemberAttrs>,
  included: JsonApiResource[],
): {
  tierIds: string[];
  tierTitles: string[];
  tierAmountsCents: number[];
  tierRequiresShipping: boolean[];
  discordRoleIds: string[];
} {
  const tierRel = member.relationships?.currently_entitled_tiers?.data;
  const refs = Array.isArray(tierRel) ? tierRel : tierRel ? [tierRel] : [];
  const tiers = refs
    .map((r) =>
      (included as unknown as JsonApiResource<PatreonTierAttrs>[]).find(
        (i) => i.type === "tier" && i.id === r.id,
      ),
    )
    .filter((t): t is JsonApiResource<PatreonTierAttrs> => Boolean(t));

  return {
    discordRoleIds: tiers
      .flatMap((t) => t.attributes.discord_role_ids ?? [])
      .filter((s): s is string => Boolean(s)),
    tierAmountsCents: tiers.map((t) => t.attributes.amount_cents ?? 0),
    tierIds: tiers.map((t) => t.id),
    tierRequiresShipping: tiers.map((t) => t.attributes.requires_shipping ?? false),
    tierTitles: tiers.map((t) => t.attributes.title).filter((s): s is string => Boolean(s)),
  };
}

/**
 * Extrait l'adresse depuis `included[type=address]` si la relation existe.
 */
function parseAddress(
  member: JsonApiResource<PatreonMemberAttrs>,
  included: JsonApiResource[],
): PatreonAddressAttrs | null {
  const rel = member.relationships?.address?.data;
  const id = rel && !Array.isArray(rel) ? rel.id : null;
  if (!id) {
    return null;
  }
  const addr = (included as unknown as JsonApiResource<PatreonAddressAttrs>[]).find(
    (r) => r.type === "address" && r.id === id,
  );
  return addr?.attributes ?? null;
}

/**
 * Lookup le user RG via `patreon_oauth_tokens` (le compte Patreon a forcément
 * été lié à RG pour qu'on ait stocké un token, sauf flux webhook-first où on
 * ne connaît pas encore le user RG → on stocke quand même côté legacy).
 */
async function resolveRgUserId(
  _supabase: ReturnType<typeof createPostgresClient>,
  patreonUserId: string,
): Promise<string | null> {
  const { data } = await _supabase
    .from("patreon_oauth_tokens")
    .select("user_id")
    .eq("patreon_user_id", patreonUserId)
    .eq("is_creator", false)
    .not("user_id", "is", null)
    .maybeSingle();
  return (data as { user_id: string | null } | null)?.user_id ?? null;
}

/**
 * Dispatch sur le trigger Patreon. Tolère les types d'entités différents
 * (`member` vs `post`) : la lib Patreon n'envoie qu'une entité par event.
 */
export async function processPatreonEvent(
  payload: PatreonWebhookPayload,
  trigger: PatreonTrigger,
): Promise<void> {
  const _supabase = createPostgresClient();

  if (trigger.startsWith("posts:")) {
    await processPostEvent(payload, trigger);
    return;
  }
  await processMemberEvent(payload, trigger);
}

/**
 * Trigger `posts:publish/update/delete` — stocke un audit dans
 * `patreon_post_events`. Utilisable par le digest hebdo + monitoring.
 */
async function processPostEvent(
  payload: PatreonWebhookPayload,
  trigger: PatreonTrigger,
): Promise<void> {
  const _supabase = createPostgresClient();

  const post = payload.data as JsonApiResource<PatreonPostAttrs>;
  const attrs = post.attributes;
  const postId = post.id;

  if (trigger === "posts:delete") {
    await _supabase.from("patreon_post_events").upsert(
      {
        patreon_post_id: postId,
        raw_payload: { trigger, payload } as never,
        trigger,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "patreon_post_id" },
    );
    return;
  }

  const campaignRel = post.relationships?.campaign?.data;
  const campaignId = campaignRel && !Array.isArray(campaignRel) ? campaignRel.id : null;

  const teaser =
    attrs.teaser_text ??
    (typeof attrs.content === "string"
      ? attrs.content.replaceAll(/<[^>]+>/g, "").slice(0, 300)
      : null);

  await _supabase.from("patreon_post_events").upsert(
    {
      campaign_id: campaignId,
      content_excerpt: teaser,
      embed_data: (attrs.embed_data ?? null) as never,
      embed_url: attrs.embed_url ?? null,
      is_paid: attrs.is_paid ?? null,
      is_public: attrs.is_public ?? null,
      patreon_post_id: postId,
      published_at: attrs.published_at ?? null,
      raw_payload: { trigger, payload } as never,
      title: attrs.title ?? null,
      trigger,
      url: attrs.url ?? null,
    },
    { onConflict: "patreon_post_id" },
  );
}

/**
 * Trigger `members:*` ou `members:pledge:*` — upsert legacy + live memberships.
 */
async function processMemberEvent(
  payload: PatreonWebhookPayload,
  trigger: PatreonTrigger,
): Promise<void> {
  const _supabase = createPostgresClient();

  const member = payload.data as JsonApiResource<PatreonMemberAttrs>;
  const attrs = member.attributes;
  const memberId = member.id;
  const included = payload.included ?? [];

  const userRel = member.relationships?.user?.data;
  const patreonUserId = userRel && !Array.isArray(userRel) ? userRel.id : "";

  const campaignRel = member.relationships?.campaign?.data;
  const campaignId = campaignRel && !Array.isArray(campaignRel) ? campaignRel.id : null;

  // === DELETE / pledge:delete : patron_status → former_patron côté legacy + memberships
  if (trigger === "members:delete") {
    await Promise.all([
      _supabase
        .from("patreon_legacy_members")
        .update({ rg_subscription_status: "churned" })
        .eq("patreon_member_id", memberId),
      _supabase
        .from("patreon_memberships")
        .update({
          fetched_at: new Date().toISOString(),
          patron_status: "former_patron",
        })
        .eq("patreon_member_id", memberId),
    ]);
    return;
  }
  if (trigger === "members:pledge:delete") {
    await Promise.all([
      _supabase
        .from("patreon_legacy_members")
        .update({
          patron_status: "former_patron",
          rg_subscription_status: "churned",
        })
        .eq("patreon_member_id", memberId),
      _supabase
        .from("patreon_memberships")
        .update({
          currently_entitled_cents: 0,
          fetched_at: new Date().toISOString(),
          next_charge_date: null,
          patron_status: "former_patron",
          will_pay_amount_cents: 0,
        })
        .eq("patreon_member_id", memberId),
    ]);
    return;
  }

  // === CREATE / UPDATE / pledge:create / pledge:update : upsert dans les 2 tables.
  const tiers = parseTiers(member, included);
  const address = parseAddress(member, included);
  const rgUserId = await resolveRgUserId(_supabase, patreonUserId);

  // 1. Legacy (pour rétrocompat avec snapshot J-0)
  await _supabase.from("patreon_legacy_members").upsert(
    {
      currently_entitled_cents: attrs.currently_entitled_amount_cents ?? 0,
      email: attrs.email ?? null,
      full_name: attrs.full_name ?? null,
      last_charge_date: attrs.last_charge_date ?? null,
      last_charge_status: attrs.last_charge_status ?? null,
      lifetime_support_cents: attrs.campaign_lifetime_support_cents ?? 0,
      patreon_member_id: memberId,
      patreon_user_id: patreonUserId,
      patron_status: attrs.patron_status ?? "active_patron",
      pledge_cadence: attrs.pledge_cadence ?? null,
      pledge_start: attrs.pledge_relationship_start ?? null,
      raw_payload: { payload, trigger },
      tier_ids: tiers.tierIds,
      tier_titles: tiers.tierTitles,
    },
    { onConflict: "patreon_member_id" },
  );

  // 2. Live memberships — uniquement si on connaît le user RG
  if (rgUserId) {
    await _supabase.from("patreon_memberships").upsert(
      {
        address,
        campaign_id: campaignId,
        currently_entitled_cents: attrs.currently_entitled_amount_cents ?? null,
        discord_role_ids: tiers.discordRoleIds,
        fetched_at: new Date().toISOString(),
        is_free_trial: attrs.is_free_trial ?? null,
        is_gifted: attrs.is_gifted ?? null,
        last_charge_date: attrs.last_charge_date ?? null,
        last_charge_status: attrs.last_charge_status ?? null,
        lifetime_support_cents:
          attrs.campaign_lifetime_support_cents ?? attrs.lifetime_support_cents ?? null,
        member_email: attrs.email ?? null,
        next_charge_date: attrs.next_charge_date ?? null,
        note: attrs.note ?? null,
        patreon_email: attrs.email ?? null,
        patreon_full_name: attrs.full_name ?? null,
        patreon_member_id: memberId,
        patreon_user_id: patreonUserId,
        patron_status: attrs.patron_status ?? null,
        pledge_cadence: attrs.pledge_cadence ?? null,
        pledge_start: attrs.pledge_relationship_start ?? null,
        raw_identity: { trigger, payload } as unknown as Record<string, unknown>,
        tier_amounts_cents: tiers.tierAmountsCents,
        tier_ids: tiers.tierIds,
        tier_requires_shipping: tiers.tierRequiresShipping,
        tier_titles: tiers.tierTitles,
        user_id: rgUserId,
        will_pay_amount_cents: attrs.will_pay_amount_cents ?? null,
      },
      { onConflict: "user_id,patreon_user_id" },
    );
  }
}
