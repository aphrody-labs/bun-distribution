// Source: packages/shenron/auth/test/policy.test.ts at 8172f535ce (preserved Git history).
import { describe, expect, test } from "bun:test";
import { type AccessRule, decideAccess, type Visitor } from "../src/policy";

const ROLE = "300000000000000001";
const ACCOUNT = "300000000000000002";

const anon: Visitor = { isAdmin: false, authenticated: false };
const member: Visitor = {
  isAdmin: false,
  authenticated: true,
  discordId: "300000000000000009",
  roleIds: [],
};
const withRole: Visitor = { ...member, roleIds: [ROLE] };
const named: Visitor = { ...member, discordId: ACCOUNT };
const admin: Visitor = { isAdmin: true, authenticated: true };

// ── Inline copy of decideContribution (contribution-rights-shared.ts:85-101) ──
function decideContribution(
  rule: { mode: "members" | "restricted" | "admin"; roleIds: string[]; discordIds: string[] },
  visitor: Visitor,
): boolean {
  if (visitor.isAdmin) return true;
  if (!visitor.authenticated) return false;
  if (rule.mode === "admin") return false;
  if (rule.mode === "members") return true;
  const parRole = (rule.roleIds ?? []).some(r => (visitor.roleIds ?? []).includes(r));
  const parCompte = !!visitor.discordId && (rule.discordIds ?? []).includes(visitor.discordId);
  return parRole || parCompte;
}

// ── Wiki launch: sanitize (wiki-launch-config.ts:82-86) then proxy.ts decision ──
function wikiAllowed(rule: { mode: "public" | "members" | "roles" | "admin"; roleIds: string[] }, v: Visitor) {
  const effective = rule.mode === "roles" && rule.roleIds.length === 0 ? { ...rule, mode: "members" as const } : rule;
  if (effective.mode === "public") return true;
  let allowed = v.isAdmin;
  if (!allowed && effective.mode === "members") allowed = v.authenticated;
  else if (!allowed && effective.mode === "roles" && v.discordId)
    allowed = (v.roleIds ?? []).some(r => effective.roleIds.includes(r));
  return allowed;
}

const visitors = [anon, member, withRole, named, admin];

describe("decideAccess", () => {
  test("emptyRoles 'members' matches the wiki launch rules", () => {
    const rules = [
      { mode: "public" as const, roleIds: [] },
      { mode: "members" as const, roleIds: [] },
      { mode: "roles" as const, roleIds: [] },
      { mode: "roles" as const, roleIds: [ROLE] },
      { mode: "admin" as const, roleIds: [] },
    ];
    for (const rule of rules) {
      for (const v of visitors) {
        const verdict = decideAccess(rule, v, { emptyRoles: "members" });
        expect(verdict === "allow").toBe(wikiAllowed(rule, v));
      }
    }
  });

  test("emptyRoles 'deny' matches decideContribution", () => {
    const rules = [
      { mode: "members" as const, roleIds: [], discordIds: [] },
      { mode: "restricted" as const, roleIds: [], discordIds: [] },
      { mode: "restricted" as const, roleIds: [ROLE], discordIds: [] },
      { mode: "restricted" as const, roleIds: [], discordIds: [ACCOUNT] },
      { mode: "restricted" as const, roleIds: [ROLE], discordIds: [ACCOUNT] },
      { mode: "admin" as const, roleIds: [], discordIds: [] },
    ];
    for (const rule of rules) {
      for (const v of visitors) {
        const verdict = decideAccess(rule, v, { emptyRoles: "deny" });
        expect(verdict === "allow").toBe(decideContribution(rule, v));
      }
    }
  });

  test("anonymous visitors are told apart from signed-in refusals", () => {
    const rule: AccessRule = { mode: "admin" };
    expect(decideAccess(rule, anon, { emptyRoles: "deny" })).toBe("deny-anonymous");
    expect(decideAccess(rule, member, { emptyRoles: "deny" })).toBe("deny");
    expect(decideAccess({ mode: "public" }, anon, { emptyRoles: "deny" })).toBe("allow");
    expect(decideAccess({ mode: "roles", roleIds: [] }, member, { emptyRoles: "members" })).toBe("allow");
    expect(decideAccess({ mode: "roles", roleIds: [] }, member, { emptyRoles: "deny" })).toBe("deny");
  });
});
