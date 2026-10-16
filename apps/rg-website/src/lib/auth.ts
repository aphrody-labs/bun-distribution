import { createRoseGriffonAuth } from "@rosegriffon/auth";
import { createPostgresClient } from "@rosegriffon/db/service";
import { resolveAuthBaseURL } from "./auth-base-url";
import { nextCookies } from "better-auth/next-js";
import { createPgDialect, getPgPool } from "@rosegriffon/db/pg";
import { sendEmail } from "@/lib/email";
import { fetchIdentity, parseIdentityWithMemberships } from "@/lib/patreon/client";
import { encryptToken } from "@/lib/patreon/encryption";
import { SCOPES_CREATOR, SCOPES_PATRON } from "@/lib/patreon/types";
import { SITE_URL } from "@/lib/site-url";

let postgresAdmin: ReturnType<typeof createPostgresClient> | undefined;

function getPostgresAdmin() {
  postgresAdmin ??= createPostgresClient();
  return postgresAdmin;
}

function detectCreatorScopes(scope: string | null | undefined): boolean {
  return (scope ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .some(value => value === "campaigns.members" || value === "w:campaigns.webhook");
}

/**
 * The website owns only its integrations. The Better Auth schema, plugins,
 * role boundary, profile hooks and security defaults live in @rosegriffon/auth.
 */
export const auth = createRoseGriffonAuth({
  database: { dialect: createPgDialect(), type: "postgres" },
  baseURL: getBetterAuthURL(),
  secret: process.env.BETTER_AUTH_SECRET,
  sendEmail,
  executerSql: (query, parameters) => getPgPool().query(query, parameters as unknown[]),
  nextCookiesPlugin: nextCookies(),
  passkey: {
    rpID: process.env.BETTER_AUTH_PASSKEY_RP_ID ?? new URL(getBetterAuthURL()).hostname,
    origin: process.env.BETTER_AUTH_PASSKEY_ORIGIN ?? getBetterAuthURL(),
  },
  patreon: {
    authorizationUrl: "https://www.patreon.com/oauth2/authorize",
    tokenUrl: "https://www.patreon.com/api/oauth2/token",
    clientId: process.env.PATREON_CLIENT_ID ?? "",
    clientSecret: process.env.PATREON_CLIENT_SECRET ?? "",
    scopes: SCOPES_PATRON,
    getUserInfo: async tokens => {
      const accessToken = (tokens as { accessToken?: string }).accessToken;
      if (!accessToken) return null;
      try {
        const response = await fetchIdentity(accessToken, { withMemberships: true });
        const identity = parseIdentityWithMemberships(response);
        return {
          id: identity.patreonUserId,
          email: identity.user.email ?? `patreon-${identity.patreonUserId}@noemail.local`,
          emailVerified: Boolean(identity.user.email),
          name: identity.user.full_name ?? "Utilisateur Patreon",
          image: identity.user.thumb_url ?? undefined,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      } catch (error) {
        console.error("[auth/patreon] getUserInfo failed", error);
        return null;
      }
    },
    onAccountChanged: syncPatreonAccount,
  },
});

function getBetterAuthURL(): string {
  const configured = process.env.BETTER_AUTH_URL?.trim();
  if (configured?.startsWith("eyJ2Ijo")) return SITE_URL;
  return resolveAuthBaseURL({ configured, production: process.env.NODE_ENV === "production" });
}

async function syncPatreonAccount(account: {
  id: string;
  userId: string;
  accountId: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  accessTokenExpiresAt?: Date | null;
  scope?: string | null;
}) {
  if (!account.accessToken || !account.refreshToken) return;

  try {
    const response = await fetchIdentity(account.accessToken, { withMemberships: true });
    const identity = parseIdentityWithMemberships(response);
    const top =
      [...identity.memberships].toSorted((a, b) => {
        const score = (value: string | null | undefined) => (value === "active_patron" ? 0 : 1);
        return score(a.attrs.patron_status) - score(b.attrs.patron_status);
      })[0] ?? null;
    const isCreator = detectCreatorScopes(account.scope);
    const fallbackScopes = (isCreator ? SCOPES_CREATOR : SCOPES_PATRON).join(" ");
    const expiresAt = account.accessTokenExpiresAt
      ? account.accessTokenExpiresAt.toISOString()
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString();

    await Promise.all([
      getPostgresAdmin()
        .from("patreon_oauth_tokens")
        .upsert(
          {
            access_token_enc: encryptToken(account.accessToken),
            expires_at: expiresAt,
            is_creator: isCreator,
            patreon_user_id: identity.patreonUserId,
            refresh_token_enc: encryptToken(account.refreshToken),
            scope: account.scope ?? fallbackScopes,
            user_id: account.userId,
          },
          { onConflict: "user_id,patreon_user_id" },
        ),
      getPostgresAdmin()
        .from("patreon_memberships")
        .upsert(
          {
            address: (top?.address ?? null) as never,
            campaign_id: top?.campaignId ?? null,
            currently_entitled_cents: top?.attrs.currently_entitled_amount_cents ?? null,
            discord_role_ids: top?.discordRoleIds ?? [],
            discord_user_id: identity.discordUserId,
            fetched_at: new Date().toISOString(),
            is_free_trial: top?.attrs.is_free_trial ?? null,
            is_gifted: top?.attrs.is_gifted ?? null,
            last_charge_date: top?.attrs.last_charge_date ?? null,
            last_charge_status: top?.attrs.last_charge_status ?? null,
            lifetime_support_cents:
              top?.attrs.campaign_lifetime_support_cents ?? top?.attrs.lifetime_support_cents ?? null,
            member_email: top?.attrs.email ?? null,
            next_charge_date: top?.attrs.next_charge_date ?? null,
            note: top?.attrs.note ?? null,
            patreon_email: identity.user.email ?? null,
            patreon_full_name: identity.user.full_name ?? null,
            patreon_member_id: top?.memberId ?? null,
            patreon_thumb_url: identity.user.thumb_url ?? null,
            patreon_url: identity.user.url ?? null,
            patreon_user_id: identity.patreonUserId,
            patron_status: top?.attrs.patron_status ?? null,
            pledge_cadence: top?.attrs.pledge_cadence ?? null,
            pledge_start: top?.attrs.pledge_relationship_start ?? null,
            raw_identity: response as never,
            scope: account.scope ?? fallbackScopes,
            tier_amounts_cents: top?.tierAmountsCents ?? [],
            tier_ids: top?.tierIds ?? [],
            tier_requires_shipping: top?.tierRequiresShipping ?? [],
            tier_titles: top?.tierTitles ?? [],
            user_id: account.userId,
            will_pay_amount_cents: top?.attrs.will_pay_amount_cents ?? null,
          },
          { onConflict: "user_id,patreon_user_id" },
        ),
      getPostgresAdmin()
        .from("profiles")
        .update({
          patreon_id: identity.patreonUserId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", account.userId),
    ]);
  } catch (error) {
    console.error("[auth/patreon] syncPatreonAccount failed", error);
  }
}

export type AuthSession = typeof auth.$Infer.Session;
export type AuthUser = typeof auth.$Infer.Session.user;
