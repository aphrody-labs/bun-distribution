/** Public metadata about a configured bot. Credential values never belong here. */
export interface DiscordBotSource {
  botId: string;
  profile: "rg" | "achillea-current" | "achillea-legacy";
  applicationId: string;
}

export type SnapshotCompleteness = "complete" | "partial" | "unavailable";

/** A collection is complete only for the scope the Discord API actually returned. */
export interface DiscordCollectionCoverage {
  sourceBotId: string;
  guildId: string;
  collection: "guild" | "members" | "roles" | "channels" | "threads" | "emojis" | "stickers" | "scheduled-events";
  status: SnapshotCompleteness;
  observedCount: number;
  observedAt: string;
  reason?: "missing-intent" | "missing-permission" | "rate-limited" | "api-error" | "not-requested";
}

/** An identity link is metadata, never an OAuth credential or authorization grant. */
export interface OAuthAccountLink {
  userId: string;
  provider: "discord" | "patreon" | "twitch" | "google" | (string & {});
  providerAccountId: string;
  linkedAt: string | null;
  lastVerifiedAt: string | null;
  status: "linked" | "revoked" | "unknown";
}

/** Aggregate counters only; no page URL queries, IP addresses or user identifiers. */
export interface SiteTelemetryBucket {
  site: "association" | "azalee" | "achillea";
  metric: "page-view" | "api-request" | "api-error" | "auth-success" | "auth-failure";
  pathTemplate: string;
  windowStart: string;
  windowSeconds: number;
  count: number;
}
