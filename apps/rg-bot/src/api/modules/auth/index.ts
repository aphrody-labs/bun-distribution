import crypto from "node:crypto";
import { Elysia, status, t } from "elysia";
import { sql } from "kysely";
import { signAchilleaRealtimeToken, signAchilleaSessionToken } from "@rosegriffon/auth/achillea-session";
import {
	buildChallongeOAuthUrl,
	buildTwitchOAuthUrl,
	formatProviderOAuthState,
} from "@rosegriffon/achillea-core/oauth";
import { verifyAdminBearerToken as verifyAdminToken } from "@rosegriffon/achillea-core/auth";
import { dbPlugin } from "../../plugins/db";
import { ProviderOAuthService } from "./oauth-service";
import { resolveAchilleaSession } from "./session";
import { findLinkedPublicProfile } from "../achillea/users/public-profile";

export const authController = new Elysia({ prefix: "/auth" })
	.use(dbPlugin)
	.post("/session/exchange", async ({ db, headers, body, set }) => {
		const bearer = headers.authorization?.replace(/^Bearer\s+/i, "");
		if (!verifyAdminToken(bearer, process.env.API_ADMIN_TOKEN)) {
			set.status = 401;
			return { message: "Internal authentication required" as const };
		}
		if (!body.id && !body.betterAuthUserId) {
			set.status = 400;
			return { message: "Identity is required" as const };
		}
		const secret = process.env.JWT_SECRET_KEY;
		if (!secret) {
			set.status = 503;
			return { message: "Session authentication unavailable" as const };
		}
		let identity = { id: body.id ?? "", username: body.username ?? null, avatar: body.avatar ?? null };
		if (body.betterAuthUserId) {
			const linked = await sql<{ discord_id: string; username: string | null; avatar_url: string | null }>`
				select a.account_id as discord_id,
				       coalesce(p.username, u.name) as username,
				       coalesce(p.avatar_url, u.image) as avatar_url
				from public.account a
				join public."user" u on u.id = a.user_id
				left join public.profiles p on p.id::text = a.user_id and p.claimed_at is not null
				where a.user_id = ${body.betterAuthUserId} and a.provider_id = 'discord'
				limit 1
			`.execute(db);
			const account = linked.rows[0];
			if (!account?.discord_id) {
				set.status = 409;
				return { message: "Discord account is not linked" as const };
			}
			identity = { id: account.discord_id, username: account.username, avatar: account.avatar_url };
		}
		const displayName = identity.username?.trim() || identity.id;
		await db.insertInto("user").values({
			id: identity.id,
			created_at: new Date(),
			updated_at: new Date(),
			last_interact: new Date(),
			role: 0,
			username: identity.username,
			avatar: identity.avatar,
			display_name: displayName,
			normalized_display_name: displayName.normalize("NFKC").toUpperCase(),
			blacklist_id: null,
			bio: null,
			twitch_url: null,
		}).onConflict((oc) => oc.column("id").doUpdateSet({
			updated_at: new Date(),
			last_interact: new Date(),
			username: identity.username,
			avatar: identity.avatar,
		})).execute();
		const token = signAchilleaSessionToken(identity, secret);
		return { token, expiresIn: 60 * 60 * 24 * 30, user: identity };
	}, {
		body: t.Object({ id: t.Optional(t.String({ minLength: 1 })), betterAuthUserId: t.Optional(t.String({ minLength: 1 })), username: t.Optional(t.Nullable(t.String())), avatar: t.Optional(t.Nullable(t.String())) }),
		response: {
			200: t.Object({ token: t.String(), expiresIn: t.Number(), user: t.Object({ id: t.String(), username: t.Nullable(t.String()), avatar: t.Nullable(t.String()) }) }),
			400: t.Object({ message: t.Literal("Identity is required") }),
			401: t.Object({ message: t.Literal("Internal authentication required") }),
			409: t.Object({ message: t.Literal("Discord account is not linked") }),
			503: t.Object({ message: t.Literal("Session authentication unavailable") }),
		},
	})
	.get("/me", async ({ db, headers, set }) => {
		const session = await resolveAchilleaSession(headers);
		if (!session) {
			set.status = 401;
			return { error: "unauthorized" as const };
		}
		const user = await db.selectFrom("user")
			.select(["id", "username", "avatar", "display_name", "role", "blacklist_id"])
			.where("id", "=", session.id)
			.executeTakeFirst();
		if (!user) {
			set.status = 401;
			return { error: "unauthorized" as const };
		}
		const publicProfile = await findLinkedPublicProfile(db, session.id);
		return {
			user: {
				...session,
				username: publicProfile?.username ?? user.username ?? session.username ?? user.display_name,
				avatar: publicProfile?.avatar_url ?? user.avatar ?? session.avatar ?? null,
				displayName: publicProfile?.username ?? user.display_name,
				role: user.role,
				blacklisted: user.blacklist_id !== null,
			},
		};
	})
	.get("/realtime-token", async ({ db, headers, set }) => {
		const session = await resolveAchilleaSession(headers);
		if (!session) return status(401, { message: "Authentication required" as const });
		const user = await db.selectFrom("user").select(["id", "username", "avatar", "display_name"]).where("id", "=", session.id).executeTakeFirst();
		if (!user) return status(401, { message: "Authentication required" as const });
		const secret = process.env.JWT_SECRET_KEY;
		if (!secret) {
			set.status = 503;
			return { message: "Realtime authentication unavailable" as const };
		}
		const publicProfile = await findLinkedPublicProfile(db, session.id);
		const token = signAchilleaRealtimeToken({
			id: user.id,
			username: publicProfile?.username ?? user.username ?? user.display_name,
			avatar: publicProfile?.avatar_url ?? user.avatar,
		}, secret);
		return { token, expiresIn: 300, userId: user.id };
	}, {
		response: {
			200: t.Object({ token: t.String(), expiresIn: t.Number(), userId: t.String() }),
			401: t.Object({ message: t.Literal("Authentication required") }),
			503: t.Object({ message: t.Literal("Realtime authentication unavailable") }),
		},
	})
	.get("/oauth/:provider/start", async ({ db, params, query, headers, set }) => {
		const provider = params.provider;
		if (provider !== "twitch" && provider !== "challonge") {
			return status(400, { message: "Unsupported OAuth provider" as const });
		}

		const bearer = headers.authorization?.replace(/^Bearer\s+/i, "");
		const internal = verifyAdminToken(bearer, process.env.API_ADMIN_TOKEN);
		const session = internal ? null : await resolveAchilleaSession(headers);
		const userId = internal ? query.userId : session?.id;
		if (!userId) return status(401, { message: "Authentication required" as const });

		const user = await db.selectFrom("user").select("id").where("id", "=", userId).executeTakeFirst();
		if (!user) return status(404, { message: "User not found" as const });

		const token = crypto.randomBytes(24).toString("hex");
		// Keep the CSRF table bounded and make a repeated start deterministic for
		// this identity. The callback already enforces a ten-minute validity
		// window; expired rows must not accumulate indefinitely in production.
		await db.deleteFrom("oauth_csrf")
			.where("discord_id", "=", userId)
			.where("created_at", "<", new Date(Date.now() - 10 * 60 * 1000))
			.execute();
		await db.insertInto("oauth_csrf").values({ token, discord_id: userId }).execute();
		const state = formatProviderOAuthState(userId, token);
		const callback = `${process.env.PUBLIC_API_URL ?? "https://api.rosegriffon.fr"}/v1/auth/oauth/callback`;
		const url = provider === "twitch"
			? buildTwitchOAuthUrl({ callbackUrl: callback, clientId: process.env.TWITCH_CLIENT_ID ?? "", state })
			: buildChallongeOAuthUrl({
				callbackUrl: callback,
				clientId: process.env.NODE_ENV === "production" ? (process.env.CHALLONGE_CLIENT_ID ?? "") : (process.env.CHALLONGE_CLIENT_ID_TEST ?? ""),
				state,
			});
		return { url };
	}, {
		params: t.Object({ provider: t.String() }),
		query: t.Object({ userId: t.Optional(t.String()) }),
	})
	.get("/oauth/callback", async ({ db, query, set }) => {
		if (!query.provider || !query.code || !query.state) return status(400, { message: "OAuth parameters missing" as const });
		const result = await ProviderOAuthService.handle(db, query.provider, query.code, query.state);
		if (!result.ok) return status(result.status, { message: result.message });
		set.redirect = result.redirect;
		return status(302, { message: "Redirecting" as const });
	}, {
		query: t.Object({ provider: t.Optional(t.String()), code: t.Optional(t.String()), state: t.Optional(t.String()) }),
	});
