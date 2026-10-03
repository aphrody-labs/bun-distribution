import "./setup";
import { describe, expect, it } from "bun:test";
import { signAchilleaSessionToken } from "@rosegriffon/auth/achillea-session";
import { clanController } from "../src/api/modules/achillea/clans";
import { ClanService } from "../src/api/modules/achillea/clans/service";
import { db } from "../src/api/plugins/db";

process.env.JWT_SECRET_KEY ||= "rg-clan-management-contract-test-secret-2026";

describe("unified clan management reads", () => {
  it("rejects invite and application reads without the unified session", async () => {
    for (const path of ["/clans/invites", "/clans/applications"]) {
      const response = await clanController.handle(new Request(`http://localhost${path}`));
      expect(response.status).toBe(401);
    }
  });

  it.skipIf(!process.env.RG_TEST_DATABASE_URL)(
    "rejects clan members below the management role",
    async () => {
      const member = await db
        .selectFrom("clan_member")
        .select("user_id")
        .where("role", "<", 2)
        .limit(1)
        .executeTakeFirst();
      expect(member).toBeDefined();
      if (!member) return;
      const token = signAchilleaSessionToken(
        { id: member.user_id, username: "contract-test", avatar: null },
        process.env.JWT_SECRET_KEY!,
      );
      for (const path of ["/clans/invites", "/clans/applications"]) {
        const response = await clanController.handle(
          new Request(`http://localhost${path}`, {
            headers: { authorization: `Bearer ${token}` },
          }),
        );
        expect(response.status).toBe(403);
      }
    },
  );

  it.skipIf(!process.env.RG_TEST_DATABASE_URL)(
    "serves Kysely-backed invite and application arrays to a clan manager",
    async () => {
      const [inviteManager, applicationManager] = await Promise.all([
        db
          .selectFrom("clan_member as cm")
          .innerJoin("clan_invite as i", "i.clan_id", "cm.clan_id")
          .select("cm.user_id")
          .where("cm.role", ">=", 2)
          .limit(1)
          .executeTakeFirst(),
        db
          .selectFrom("clan_member as cm")
          .innerJoin("clan_application as a", "a.clan_id", "cm.clan_id")
          .select("cm.user_id")
          .where("cm.role", ">=", 2)
          .limit(1)
          .executeTakeFirst(),
      ]);
      expect(inviteManager).toBeDefined();
      expect(applicationManager).toBeDefined();
      if (!inviteManager || !applicationManager) return;

      const cases = [
        {
          path: "/clans/invites",
          userId: inviteManager.user_id,
          read: (userId: string) => ClanService.listInvitesForManager(db, userId),
        },
        {
          path: "/clans/applications",
          userId: applicationManager.user_id,
          read: (userId: string) => ClanService.listApplicationsForManager(db, userId),
        },
      ] as const;
      for (const contract of cases) {
        const projection = await contract.read(contract.userId);
        expect(projection.ok).toBe(true);
        if (projection.ok) expect(projection.data.length).toBeGreaterThan(0);

        const token = signAchilleaSessionToken(
          { id: contract.userId, username: "contract-test", avatar: null },
          process.env.JWT_SECRET_KEY!,
        );
        const response = await clanController.handle(
          new Request(`http://localhost${contract.path}`, {
            headers: { authorization: `Bearer ${token}` },
          }),
        );
        expect(response.status).toBe(200);
        const payload = (await response.json()) as Array<{ user?: unknown; clan?: unknown }>;
        expect(payload.length).toBeGreaterThan(0);
        expect(payload[0]?.user).toBeDefined();
        expect(payload[0]?.clan).toBeDefined();
      }
    },
  );
});
