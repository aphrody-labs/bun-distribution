import { PatreonOauthScope } from "@rosegriffon/patreon-bun";

export const PATREON_API_BASE = "https://www.patreon.com/api/oauth2/v2";
export const PATREON_AUTHORIZE = "https://www.patreon.com/oauth2/authorize";
export const PATREON_TOKEN = "https://www.patreon.com/api/oauth2/token";

export const SCOPES_PATRON = [
  PatreonOauthScope.Identity,
  PatreonOauthScope.IdentityEmail,
  PatreonOauthScope.IdentityMemberships,
] as const;

export const SCOPES_CREATOR = [
  PatreonOauthScope.Identity,
  PatreonOauthScope.IdentityEmail,
  PatreonOauthScope.Campaigns,
  PatreonOauthScope.CampaignMembers,
  PatreonOauthScope.CampaignMembersEmail,
  PatreonOauthScope.CampaignMembersAdress,
  PatreonOauthScope.CampaignPosts,
  PatreonOauthScope.ManageCampaignWebhooks,
] as const;

export type OAuthIntent = "patron-link" | "creator-link" | "reactivate";

export type RgSubscriptionStatus = "pending" | "reactivated" | "churned" | "grandfathered";

export type ResolutionMethod = "email" | "discord_id" | "manual";

export interface OAuthStatePayload {
  uid: string | null;
  intent: OAuthIntent;
  ts: number;
  redirect?: string;
  nonce: string;
}

export interface PatreonTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: "Bearer";
}

export interface JsonApiResource<T = Record<string, unknown>> {
  id: string;
  type: string;
  attributes: T;
  relationships?: Record<
    string,
    {
      data: { id: string; type: string } | { id: string; type: string }[] | null;
    }
  >;
}

export interface JsonApiResponse<T = Record<string, unknown>> {
  data: JsonApiResource<T> | JsonApiResource<T>[];
  included?: JsonApiResource[];
  meta?: {
    pagination?: {
      cursors?: { next?: string | null };
      total?: number;
    };
  };
}

export interface PatreonUserAttrs {
  email?: string;
  full_name?: string;
  thumb_url?: string;
  url?: string;
  social_connections?: Record<string, { user_id?: string } | null>;
}

/**
 * Statuts complets renvoyés par Patreon v2 sur `last_charge_status`.
 * cf. https://docs.patreon.com/#member-attributes — 12 valeurs + null.
 */
export type PatreonChargeStatus =
  | "Paid"
  | "Declined"
  | "Deleted"
  | "Pending"
  | "Refunded"
  | "Fraud"
  | "Refunded by Patreon"
  | "Other"
  | "Partially Refunded"
  | "Free Trial"
  | "Refund Pending"
  | "Refund Declined";

export interface PatreonMemberAttrs {
  full_name?: string;
  email?: string;
  patron_status?: "active_patron" | "declined_patron" | "former_patron" | null;
  last_charge_date?: string | null;
  last_charge_status?: PatreonChargeStatus | null;
  currently_entitled_amount_cents?: number;
  campaign_lifetime_support_cents?: number;
  /** [DEPRECATED par Patreon] — utiliser `campaign_lifetime_support_cents`. */
  lifetime_support_cents?: number;
  pledge_relationship_start?: string | null;
  pledge_cadence?: 1 | 12 | null;
  will_pay_amount_cents?: number;
  next_charge_date?: string | null;
  is_free_trial?: boolean;
  is_gifted?: boolean;
  /** [DEPRECATED par Patreon] — toujours `false` désormais. */
  is_follower?: boolean;
  note?: string;
}

export interface ParsedIdentity {
  patreonUserId: string;
  user: PatreonUserAttrs;
  discordUserId: string | null;
  memberships: ParsedMembership[];
}

export interface ParsedMembership {
  memberId: string;
  campaignId: string | null;
  attrs: PatreonMemberAttrs;
  tierIds: string[];
  tierTitles: string[];
  tierAmountsCents: number[];
  tierRequiresShipping: boolean[];
  discordRoleIds: string[];
  address: PatreonAddressAttrs | null;
}

export interface PatreonTierAttrs {
  title?: string;
  amount_cents?: number;
  description?: string;
  discord_role_ids?: string[];
  patron_count?: number;
  published?: boolean;
  published_at?: string | null;
  image_url?: string;
  requires_shipping?: boolean;
  created_at?: string | null;
  edited_at?: string | null;
  url?: string;
}

export interface PatreonAddressAttrs {
  line_1?: string | null;
  line_2?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postal_code?: string | null;
  addressee?: string | null;
  phone_number?: string | null;
  created_at?: string | null;
}

export interface PatreonCampaignAttrs {
  creation_name?: string;
  vanity?: string;
  one_liner?: string;
  summary?: string;
  image_url?: string;
  image_small_url?: string;
  patron_count?: number;
  is_monthly?: boolean;
  is_charged_immediately?: boolean;
  pledge_url?: string;
  published_at?: string;
}

export const TIER_MAPPING: Record<
  string,
  {
    rgPlanName: string;
    discordRoleId: string;
    stripePriceEnv: string;
    grandfatheredCents: number;
  }
> = {
  "𝙽𝚒𝚟𝚎𝚊𝚞 𝙴𝚟𝚊𝚗𝚜 🌹": {
    discordRoleId: "1371176241213870131",
    grandfatheredCents: 1450,
    rgPlanName: "niveau-evans",
    stripePriceEnv: "STRIPE_PRICE_NIVEAU_EVANS",
  },
  "𝙽𝚒𝚟𝚎𝚊𝚞 𝙶𝚊𝚎𝚕𝚕𝚎 🌹": {
    discordRoleId: "1371176894791159819",
    grandfatheredCents: 750,
    rgPlanName: "niveau-gaelle",
    stripePriceEnv: "STRIPE_PRICE_NIVEAU_GAELLE",
  },
  "𝙽𝚒𝚟𝚎𝚊𝚞 𝚁𝚘𝚢 🌹": {
    discordRoleId: "1371177169216077864",
    grandfatheredCents: 250,
    rgPlanName: "niveau-roy",
    stripePriceEnv: "STRIPE_PRICE_NIVEAU_ROY",
  },
};
