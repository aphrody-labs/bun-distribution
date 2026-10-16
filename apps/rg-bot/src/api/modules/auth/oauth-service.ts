import { parseProviderOAuthState } from "@rosegriffon/achillea-core/oauth";
import type { Kysely } from "kysely";
import type { Database } from "@rosegriffon/db/schema";

type OAuthResult = { ok: true; redirect: string } | { ok: false; status: 400 | 404 | 500; message: string };

const website = () => process.env.WEBSITE_URL ?? "https://rosegriffon.fr";
const callbackUrl = () => `${process.env.PUBLIC_API_URL ?? "https://api.rosegriffon.fr"}/v1/auth/oauth/callback`;

export abstract class ProviderOAuthService {
	static async handle(db: Kysely<Database>, provider: string, code: string, state: string): Promise<OAuthResult> {
		const parsed = parseProviderOAuthState(state);
		if (!parsed || !["twitch", "challonge"].includes(provider)) return { ok: false, status: 400, message: "Invalid OAuth state or provider" };
		const csrf = await db.deleteFrom("oauth_csrf").where("discord_id", "=", parsed.discordId)
			.where("token", "=", parsed.token).where("created_at", ">=", new Date(Date.now() - 10 * 60 * 1000)).executeTakeFirst();
		if (Number(csrf.numDeletedRows) !== 1) return { ok: false, status: 400, message: "OAuth state expired" };
		const user = await db.selectFrom("user").select("id").where("id", "=", parsed.discordId).executeTakeFirst();
		if (!user) return { ok: false, status: 404, message: "User not found" };

		try {
			const profile = provider === "twitch" ? await this.twitch(code) : await this.challonge(code);
			await db.insertInto("user_connection").values({
				user_id: parsed.discordId, provider, external_id: profile.id, external_username: profile.username,
				access_token: profile.accessToken, refresh_token: profile.refreshToken,
			}).onConflict((oc) => oc.columns(["user_id", "provider"]).doUpdateSet({
				external_id: profile.id, external_username: profile.username,
				access_token: profile.accessToken, refresh_token: profile.refreshToken, updated_at: new Date(),
			})).execute();
			return { ok: true, redirect: `${website()}/users/${parsed.discordId}` };
		} catch (error) {
			console.error(`[unified oauth] ${provider} callback failed`, (error as Error).message);
			return { ok: false, status: 500, message: "OAuth provider exchange failed" };
		}
	}

	private static async twitch(code: string) {
		const clientId = process.env.TWITCH_CLIENT_ID;
		const secret = process.env.TWITCH_SECRET;
		if (!clientId || !secret) throw new Error("Twitch credentials missing");
		const tokenResponse = await fetch("https://id.twitch.tv/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: "authorization_code", code, redirect_uri: `${callbackUrl()}?provider=twitch` }) });
		if (!tokenResponse.ok) throw new Error(`Twitch token ${tokenResponse.status}`);
		const token = await tokenResponse.json() as { access_token: string; refresh_token: string };
		const profileResponse = await fetch("https://api.twitch.tv/helix/users", { headers: { "Client-ID": clientId, Authorization: `Bearer ${token.access_token}` } });
		if (!profileResponse.ok) throw new Error(`Twitch profile ${profileResponse.status}`);
		const profile = (await profileResponse.json() as { data?: Array<{ id: string; login: string }> }).data?.[0];
		if (!profile) throw new Error("Twitch profile missing");
		return { id: profile.id, username: profile.login, accessToken: token.access_token, refreshToken: token.refresh_token };
	}

	private static async challonge(code: string) {
		const production = process.env.NODE_ENV === "production";
		const clientId = production ? process.env.CHALLONGE_CLIENT_ID : process.env.CHALLONGE_CLIENT_ID_TEST;
		const secret = production ? process.env.CHALLONGE_API_KEY : process.env.CHALLONGE_API_KEY_TEST;
		if (!clientId) throw new Error("Challonge credentials missing");
		const tokenResponse = await fetch("https://api.challonge.com/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: secret ?? "", grant_type: "authorization_code", code, redirect_uri: `${callbackUrl()}?provider=challonge` }) });
		if (!tokenResponse.ok) throw new Error(`Challonge token ${tokenResponse.status}`);
		const token = await tokenResponse.json() as { access_token: string; refresh_token: string };
		const profileResponse = await fetch("https://api.challonge.com/v2/me.json", { headers: { Accept: "application/json", "Content-Type": "application/vnd.api+json", Authorization: `Bearer ${token.access_token}`, "Authorization-Type": "v2" } });
		if (!profileResponse.ok) throw new Error(`Challonge profile ${profileResponse.status}`);
		const body = await profileResponse.json() as any;
		const id = String(body.data?.id ?? body.id ?? "");
		const username = String(body.data?.attributes?.username ?? body.data?.attributes?.user_name ?? body.username ?? "");
		if (!id || !username) throw new Error("Challonge profile missing");
		return { id, username, accessToken: token.access_token, refreshToken: token.refresh_token };
	}
}
