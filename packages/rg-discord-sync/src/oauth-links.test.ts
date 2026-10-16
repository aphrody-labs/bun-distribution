import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDiscordSnapshot, syncOAuthLinkMetadata, syncSiteTelemetryAggregates } from "./index";

test("OAuth mirror keeps link metadata and marks revoked links without credentials", async () => {
	const directory = mkdtempSync(join(tmpdir(), "rg-oauth-links-"));
	const previous = Bun.env.RG_DISCORD_SYNC_SQLITE_PATH;
	Bun.env.RG_DISCORD_SYNC_SQLITE_PATH = join(directory, "shared.sqlite");
	try {
		const row = { id: "link-1", userId: "user-1", providerId: "discord",
			providerAccountId: "discord-user-1", linkedAt: null, updatedAt: null,
			accessToken: "should-never-be-copied" };
		expect(await syncOAuthLinkMetadata([row])).toBe(1);
		let db = openDiscordSnapshot()!;
		try {
			const saved = db.query("SELECT user_id,provider_id,active FROM rg_oauth_account_links").get();
			expect(saved).toEqual({ user_id: "user-1", provider_id: "discord", active: 1 });
			const schema = db.query("SELECT sql FROM sqlite_master WHERE name='rg_oauth_account_links'").get() as { sql: string };
			expect(schema.sql).not.toContain("access_token");
		} finally { db.close(); }
		await syncOAuthLinkMetadata([]);
		await syncSiteTelemetryAggregates([{ host: "rosegriffon.fr", windowStart: "2026-09-25T04:00:00.000Z",
			requests: 12, bytes: 456, errors4xx: 1, errors5xx: 0 }], true);
		db = openDiscordSnapshot()!;
		try {
			expect(db.query("SELECT active FROM rg_oauth_account_links WHERE account_id='link-1'").get()).toEqual({ active: 0 });
			expect(db.query("SELECT requests,errors_4xx,complete FROM rg_site_telemetry").get()).toEqual({ requests: 12, errors_4xx: 1, complete: 1 });
		}
		finally { db.close(); }
	} finally {
		if (previous === undefined) delete Bun.env.RG_DISCORD_SYNC_SQLITE_PATH;
		else Bun.env.RG_DISCORD_SYNC_SQLITE_PATH = previous;
		rmSync(directory, { recursive: true, force: true });
	}
});
