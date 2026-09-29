import "./setup"; // must be first
import { describe, expect, test, mock } from "bun:test";
import { container } from "tsyringe";
import { DatabaseService } from "~/db/index";
import { warns, jails, actionLogs, bans } from "~/db/schema";
import { eq, and, isNull } from "drizzle-orm";

const { ModerationService } = await import("~/services/ModerationService");
const { JoinLeaveEvent } = await import("~/events/JoinLeave");

describe("Moderation Persistence", () => {
	const dbs = container.resolve(DatabaseService);
	const mod = container.resolve(ModerationService);
	const joinLeave = container.resolve(JoinLeaveEvent);

	test("Jail persistence on rejoin", async () => {
		const userId = "test-user-jail-rejoin";
		// Ensure no active jails
		await dbs.db.delete(jails).where(eq(jails.userId, userId));

		// Create an active jail record
		await dbs.db.insert(jails).values({
			userId,
			moderatorId: "mod-123",
			reason: "escape test",
			previousRoles: JSON.stringify(["role-1", "role-2"]),
		});

		// Mock GuildMember
		const rolesAdded: string[] = [];
		const fakeMember = {
			id: userId,
			user: {
				id: userId,
				username: "Escaper",
				bot: false,
				displayAvatarURL: () => "https://cdn.discordapp.com/avatar.png",
			},
			roles: {
				add: mock(async (roleId) => {
					rolesAdded.push(roleId);
					return {};
				}),
			},
			guild: {
				name: "Test Guild",
				roles: {
					cache: {
						get: (id: string) => ({ id, position: 1 }),
					},
					fetch: async (id: string) => ({ id, position: 1 }),
				},
				invites: {
					fetch: mock(() => Promise.resolve(new Map())),
				},
			},
			client: {
				user: { id: "bot-id" },
				guilds: {
					cache: {
						get: () => ({
							channels: {
								cache: {
									get: () => ({
										send: mock(() => Promise.resolve({})),
									}),
								},
							},
						}),
					},
				},
			},
		} as any;

		// Trigger onJoin
		await joinLeave.onJoin([fakeMember] as any);

		// Le code de production lit `env.JAIL_ROLE_ID` et ne connaît AUCUN repli
		// codé en dur : le test posait un « ID par défaut » qui n'existe nulle part
		// et échouait donc sans rien prouver. La variable est désormais posée par
		// `tests/setup.ts`, et c'est bien cette valeur qui doit être réappliquée.
		const expectedJailRoleId = process.env.JAIL_ROLE_ID;
		expect(expectedJailRoleId).toBeTruthy();
		const addedRoleIds = rolesAdded.map((r) => (typeof r === "string" ? r : r.id));
		expect(addedRoleIds).toContain(expectedJailRoleId!);

		// Clear jail
		await dbs.db.delete(jails).where(eq(jails.userId, userId));
	});

	test("Persistent bans tracking", async () => {
		const userId = "test-user-ban";
		// Clear existing bans
		await dbs.db.delete(bans).where(eq(bans.userId, userId));

		// Add ban
		await mod.addBan(userId, "mod-123", "spammer");

		// Verify it is active in database
		const activeBan = await mod.getActiveBan(userId);
		expect(activeBan).toBeDefined();
		expect(activeBan?.reason).toBe("spammer");
		expect(activeBan?.active).toBe(true);

		// Remove ban
		const removed = await mod.removeBan(userId, "mod-123", "unbanned");
		expect(removed).toBe(true);

		const inactiveBan = await mod.getActiveBan(userId);
		expect(inactiveBan).toBeUndefined();

		// Verify action logs got written
		const logs = await dbs.db.select().from(actionLogs).where(eq(actionLogs.userId, userId));
		const banLog = logs.find((l) => l.action === "BAN");
		const unbanLog = logs.find((l) => l.action === "UNBAN");
		expect(banLog).toBeDefined();
		expect(unbanLog).toBeDefined();

		// Cleanup
		await dbs.db.delete(bans).where(eq(bans.userId, userId));
	});
});
