/**
 * Smoke test : exercise toutes les fonctions services + RBAC + audit
 * sans toucher Discord. Sortie attendue : 0 (succès), > 0 (au moins 1 fail).
 */
import { logAdminAction } from "../lib/audit";
import { sql } from "../lib/db";
import { NotAdminError, requireRgAdmin } from "../lib/rbac";
import {
	getAdminStats,
	getUserByDiscord,
	listArticlesAdmin,
	listEventsAdmin,
	listSettings,
	listStreamsAdmin,
	listUsers,
} from "../services/admin";

const ADMIN_DISCORD_ID = "299502648317444096"; // koltilasko

let fails = 0;
async function check<T>(name: string, fn: () => Promise<T>, assert?: (v: T) => boolean) {
	try {
		const v = await fn();
		const ok = assert ? assert(v) : true;
		if (!ok) {
			console.error(`✗ ${name}: assertion failed (${JSON.stringify(v).slice(0, 100)})`);
			fails++;
		} else {
			const summary = Array.isArray(v) ? `[${v.length}]` : typeof v === "object" ? "✓" : String(v);
			console.log(`✓ ${name} → ${summary}`);
		}
	} catch (err) {
		console.error(`✗ ${name}: ${err instanceof Error ? err.message : err}`);
		fails++;
	}
}

console.log("=== rg-bot smoke ===\n");

await check(
	"rbac.requireRgAdmin(known admin)",
	() => requireRgAdmin(ADMIN_DISCORD_ID),
	(a) => a.role === "admin"
);
await check(
	"rbac.requireRgAdmin(unknown) → throws NotAdminError",
	async () => {
		try {
			await requireRgAdmin("000000000000000000");
			return false;
		} catch (e) {
			return e instanceof NotAdminError;
		}
	},
	(ok) => ok === true
);

await check(
	"admin.getAdminStats()",
	() => getAdminStats(),
	(s) => s.profiles_total > 0 && s.discord_members > 0
);
await check(
	"admin.getUserByDiscord(known)",
	() => getUserByDiscord(ADMIN_DISCORD_ID),
	(u) => u !== null
);
await check(
	"admin.listUsers(role=admin, 5)",
	() => listUsers(null, "admin", 5),
	(rows) => rows.length > 0
);
await check("admin.listArticlesAdmin(null, 3)", () => listArticlesAdmin(null, 3));
await check("admin.listEventsAdmin('all', 3)", () => listEventsAdmin("all", 3));
await check("admin.listStreamsAdmin()", () => listStreamsAdmin());
await check("admin.listSettings()", () => listSettings());

const admin = await requireRgAdmin(ADMIN_DISCORD_ID);
await logAdminAction({
	adminId: admin.profileId,
	discordId: admin.discordId,
	action: "smoke.test",
	targetType: "system",
	targetId: "smoke",
	details: { ts: new Date().toISOString() },
});
const auditRows = await sql<{ count: number }[]>`
  SELECT count(*)::int FROM admin_audit_log
  WHERE action = 'smoke.test' AND created_at >= NOW() - INTERVAL '1 minute'
`;
await check(
	"audit.logAdminAction → row visible",
	async () => auditRows[0]?.count ?? 0,
	(n) => n > 0
);

console.log(`\n=== ${fails === 0 ? "✓ all green" : `✗ ${fails} failure(s)`} ===`);
process.exit(fails === 0 ? 0 : 1);
