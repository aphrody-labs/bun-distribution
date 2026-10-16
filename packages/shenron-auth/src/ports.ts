// Source: packages/shenron/auth/src/ports.ts at 8172f535ce (preserved Git history).
/**
 * Ports implemented by the applications (runtime class `pure`, types only).
 * `@shenron/auth` never imports `@shenron/db`: the site and the bot provide
 * these over their own Drizzle instance.
 */

/** Discord snowflake linked to a Better Auth user (`ba_account`, provider `discord`). */
export interface DiscordAccountLookup {
  discordIdForUser(baUserId: string): Promise<string | null>;
}

export interface AgentKeyRecord {
  id: string;
  name: string;
  scopes: readonly string[];
  revokedAt: Date | null;
  /** Writes per hour allowed for this key. */
  rateLimit: number;
}

export interface AgentAuditEntry {
  keyId: string | null;
  keyName: string | null;
  method: string;
  path: string;
  status: number;
  summary?: string | null;
}

export interface AgentKeyStore {
  /** Key whose `tokenHash` equals `hash`, revoked or not (the guard checks `revokedAt`). */
  findActiveByHash(hash: string): Promise<AgentKeyRecord | null>;
  /** Records `lastUsedAt`; failures must not break the call. */
  touch(id: string, at: Date): Promise<void>;
  countWritesSince(id: string, since: Date): Promise<number>;
  recordCall(entry: AgentAuditEntry): Promise<void>;
}
