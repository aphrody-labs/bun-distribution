// Source: packages/shenron/auth/src/staff.ts at 8172f535ce (preserved Git history).
/**
 * Staff policy (runtime class `pure`, decision D6 of docs/STACK.md).
 *
 * - bot scope  = OWNER_ID ∪ OWNER_IDS ∪ BOT_DEV_ID ∪ OAUTH_ALLOWED_USERS
 *   (`isBotOwner` + `isUserAllowed` of `apps/shenron/bot/src/api/oauth.ts`);
 * - site scope = OWNER_ID ∪ OAUTH_ALLOWED_USERS (`apps/shenron/site/src/lib/session.ts`).
 *
 * The environment is injected: nothing is read at module load.
 */

/** Structural environment source (same shape as `@shenron/config/env` `EnvSource`). */
export type StaffEnvSource = Readonly<Record<string, string | undefined>>;

const SNOWFLAKE = /^\d{17,20}$/;

/** Splits a CSV of Discord snowflakes; blanks and non-snowflakes are dropped, order kept, deduped. */
export function parseSnowflakeCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (SNOWFLAKE.test(value) && !out.includes(value)) out.push(value);
  }
  return out;
}

export interface StaffPolicy {
  readonly ids: ReadonlySet<string>;
  isStaff(discordId: string | null | undefined): boolean;
}

export interface StaffPolicyInput {
  ownerIds?: readonly string[];
  devIds?: readonly string[];
  allowedUsers?: readonly string[];
}

export function createStaffPolicy(input: StaffPolicyInput): StaffPolicy {
  const ids: ReadonlySet<string> = new Set(
    [...(input.ownerIds ?? []), ...(input.devIds ?? []), ...(input.allowedUsers ?? [])].filter(id =>
      SNOWFLAKE.test(id),
    ),
  );
  return {
    ids,
    isStaff: discordId => !!discordId && ids.has(discordId),
  };
}

export type StaffScope = "bot" | "site";

export function staffPolicyFromEnv(env: StaffEnvSource, scope: StaffScope): StaffPolicy {
  const owner = parseSnowflakeCsv(env.OWNER_ID);
  const allowedUsers = parseSnowflakeCsv(env.OAUTH_ALLOWED_USERS);
  if (scope === "site") return createStaffPolicy({ ownerIds: owner, allowedUsers });
  return createStaffPolicy({
    ownerIds: [...owner, ...parseSnowflakeCsv(env.OWNER_IDS)],
    devIds: parseSnowflakeCsv(env.BOT_DEV_ID),
    allowedUsers,
  });
}
