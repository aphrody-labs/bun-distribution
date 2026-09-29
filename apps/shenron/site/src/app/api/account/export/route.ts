import { NextResponse } from "next/server";
import { readAccountData } from "@/lib/account-data";
import { getShenronUserResult } from "@/lib/shenron";
import { getCurrentUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
	const me = await getCurrentUser();
	if (!me?.user) return NextResponse.json({ error: "Connexion requise" }, { status: 401 });
	const [siteData, botProfile] = await Promise.all([
		readAccountData({
			authUserId: me.sessionUserId,
			appUserId: me.user.id,
			discordId: me.discordId,
		}),
		getShenronUserResult(me.discordId),
	]);
	return NextResponse.json(
		{
			formatVersion: 1,
			exportedAt: new Date().toISOString(),
			account: {
				id: me.user.id,
				discordId: me.discordId,
				username: me.user.username,
				avatar: me.user.avatar,
				createdAt: me.user.createdAt,
			},
			...siteData,
			botProfile: botProfile.status === "ok" ? botProfile.user : null,
		},
		{
			headers: {
				"Cache-Control": "private, no-store",
				"Content-Disposition": `attachment; filename="dbfr-account-${me.discordId}.json"`,
				"X-Content-Type-Options": "nosniff",
			},
		}
	);
}
