// Source: packages/shenron/auth/src/policy.ts at 8172f535ce (preserved Git history).
/**
 * Pure access decision shared by the wiki launch rules
 * (`apps/shenron/site/src/lib/wiki-launch-config.ts`, `proxy.ts`) and the contribution
 * rights (`apps/shenron/site/src/lib/contribution-rights-shared.ts`). Runtime class `pure`.
 *
 * - `public` lets everyone in, anonymous included;
 * - staff (`isAdmin`) passes every other rule;
 * - anonymous visitors get `deny-anonymous` (the caller can offer a login);
 * - `admin` closes to non-staff; `members` opens to any signed-in visitor;
 * - `roles` / `restricted` is an OR: one held role or one named account suffices.
 *   With no role and no account at all, `emptyRoles` decides: `"members"`
 *   (wiki launch: falls back to signed-in visitors) or `"deny"` (contribution).
 */

export type AccessRuleMode = "public" | "members" | "roles" | "restricted" | "admin";

export interface AccessRule {
  mode: AccessRuleMode;
  roleIds?: readonly string[];
  discordIds?: readonly string[];
}

export interface Visitor {
  isAdmin: boolean;
  authenticated: boolean;
  discordId?: string | null;
  /** Discord roles held by the visitor on the guild. */
  roleIds?: readonly string[];
}

export type AccessVerdict = "allow" | "deny-anonymous" | "deny";

export interface DecideAccessOptions {
  emptyRoles: "members" | "deny";
}

export function decideAccess(rule: AccessRule, visitor: Visitor, options: DecideAccessOptions): AccessVerdict {
  if (rule.mode === "public") return "allow";
  if (visitor.isAdmin) return "allow";
  if (!visitor.authenticated) return "deny-anonymous";
  if (rule.mode === "admin") return "deny";
  if (rule.mode === "members") return "allow";

  const roleIds = rule.roleIds ?? [];
  const discordIds = rule.discordIds ?? [];
  if (roleIds.length === 0 && discordIds.length === 0) {
    return options.emptyRoles === "members" ? "allow" : "deny";
  }
  const held = visitor.roleIds ?? [];
  const byRole = roleIds.some(role => held.includes(role));
  const byAccount = !!visitor.discordId && discordIds.includes(visitor.discordId);
  return byRole || byAccount ? "allow" : "deny";
}
