import { describe, expect, test } from "bun:test";

import {
	createAchilleaClient,
	achilleaGuildStatsSchema,
	rankedAdminSeasonSchema,
	tournamentDetailSchema,
	type AchilleaFetch,
	type AchilleaClientResult,
} from "../src/v1";
import { MatchMode, ScoreReportPolicy } from "@rosegriffon/achillea-types/enums/eventEnums";
import { SanctionType } from "@rosegriffon/achillea-types/enums/sanction";

interface RecordedCall {
	url: string;
	method: string | undefined;
	body: unknown;
}

/**
 * Client branché sur un Fetch factice : on n'observe que la requête émise,
 * jamais le réseau. Le corps renvoyé est volontairement hors-schéma — ces
 * tests portent sur la construction de la requête.
 */
function tracingClient(response: unknown = {}): {
	client: ReturnType<typeof createAchilleaClient>;
	calls: RecordedCall[];
} {
	const calls: RecordedCall[] = [];
	const fetch: AchilleaFetch = async (input, init) => {
		calls.push({ url: String(input), method: init?.method, body: init?.body });
		return Response.json(response);
	};
	return { client: createAchilleaClient({ baseUrl: "https://a.test/api", fetch }), calls };
}

function path(call: RecordedCall | undefined): string {
	return String(call?.url).replace("https://a.test/api", "");
}

describe("agrégat de ressources", () => {
	test("expose une ressource par domaine", () => {
		const client = createAchilleaClient();

		expect(client.baseUrl).toBe("https://ranked.rosegriffon.fr/api");
		expect(client.timeoutMs).toBe(8000);
		for (const key of [
			"admin",
			"auth",
			"casts",
			"clans",
			"guilds",
			"leagues",
			"licenses",
			"notifications",
			"organizations",
			"playerNotes",
			"ranked",
			"sanctions",
			"stats",
			"tournaments",
			"users",
			"wallet",
		] as const) {
			expect(client[key]).toBeDefined();
		}
	});

	test("la ressource guilds construit ses routes", async () => {
		const { client, calls } = tracingClient();

		await client.guilds.list(3, 5);
		await client.guilds.stats();
		await client.guilds.get("123/456");

		expect(calls.map(path)).toEqual([
			"/guilds?page=3&limit=5",
			"/guilds/stats",
			"/guilds/123%2F456",
		]);
	});
});

describe("chemins et verbes par ressource", () => {
	test("utilisateurs et autocomplétion", async () => {
		const { client, calls } = tracingClient();

		await client.users.get("42");
		await client.users.leaderboard({ mode: MatchMode.TWO_VS_TWO, limit: 10, offset: 20 });
		await client.users.myRankedHistory({ limit: 5 });
		await client.users.myRankedTrend({ days: 30 });
		await client.users.updateMyProfile({ bio: "salut" });
		await client.users.regenerateCard("42");
		await client.users.resyncAvatars();
		await client.users.suggestAll("roy");

		expect(calls.map(path)).toEqual([
			"/users/42",
			"/users/leaderboard?mode=4&limit=10&offset=20",
			"/users/me/ranked-history?limit=5",
			"/users/me/ranked-trend?days=30",
			"/users/me/profile",
			"/users/42/card/regenerate",
			"/users/resync-avatars",
			"/misc/suggest/all?query=roy",
		]);
		expect(calls.map((call) => call.method)).toEqual([
			"GET",
			"GET",
			"GET",
			"GET",
			"PUT",
			"POST",
			"POST",
			"GET",
		]);
		expect(client.users.cardUrl("42")).toBe("https://a.test/api/users/42/card.png");
	});

	test("tournois : liste filtrée, cycle de vie, seeding", async () => {
		const { client, calls } = tracingClient();

		await client.tournaments.list({ page: 2, pagination: 10, organization: 7 });
		await client.tournaments.get(12);
		await client.tournaments.summary(12);
		await client.tournaments.circuitPlayer("42");
		await client.tournaments.setScorePolicy(12, ScoreReportPolicy.STAFF_ONLY);
		await client.tournaments.disqualifyParticipant(12, "42", "no-show");
		await client.tournaments.close(12, true);
		await client.tournaments.start(12);
		await client.tournaments.seedByRanked(12);
		await client.tournaments.lobby(99);

		expect(calls.map(path)).toEqual([
			"/tournaments?page=2&pagination=10&organization=7",
			"/tournaments/12",
			"/tournaments/12/summary",
			"/tournaments/circuit/players/42",
			"/tournaments/12/score-policy",
			"/tournaments/12/disqualify",
			"/tournaments/12/close",
			"/tournaments/start/12",
			"/tournaments/seed-by-ranked/12",
			"/tournaments/lobby/99",
		]);
		expect(calls[4]?.body).toBe(JSON.stringify({ policy: "staff_only" }));
		expect(calls[5]?.body).toBe(JSON.stringify({ userId: "42", reason: "no-show" }));
		expect(calls[6]?.body).toBe(JSON.stringify({ force: true }));
		expect(calls[7]?.method).toBe("PUT");
	});

	test("tournois : valide la projection publique compacte renvoyée par l'API", async () => {
		const { client } = tracingClient({
			data: [
				{
					id: 91,
					name: "Coupe de test",
					description: "Édition ouverte",
					type: "TOURNAMENT",
					status: "Open",
					createdAt: "2026-09-20T12:00:00.000Z",
					updatedAt: "2026-09-21T12:00:00.000Z",
				},
			],
			meta: { page: 1, limit: 25, total: 1, pageCount: 1 },
		});

		const result = await client.tournaments.list();
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.data[0]?.name).toBe("Coupe de test");
			expect(result.value.data[0]?.status).toBe("Open");
			expect(result.value.data[0]?.createdAt).toBeInstanceOf(Date);
		}
	});

	test("tournois : les états sont répétés dans la query-string", async () => {
		const { client, calls } = tracingClient();

		await client.tournaments.list({ states: ["Ongoing", "Finished"] as never });

		expect(path(calls[0])).toBe("/tournaments?states=Ongoing&states=Finished");
	});

	test("ranked : joueur et administration", async () => {
		const { client, calls } = tracingClient();

		await client.ranked.me(MatchMode.ONE_VS_ONE);
		await client.ranked.tiers();
		await client.ranked.leaderboard({ mode: 4, page: 1, pageSize: 50 });
		await client.ranked.createChallenge({ mode: 2, ranked: false });
		await client.ranked.getChallenge("ab cd");
		await client.ranked.acceptChallenge("ABCD");
		await client.ranked.cancelChallenge("ABCD");
		await client.ranked.uploadDisputeProof(77, "data:image/png;base64,AAAA");
		await client.ranked.adminDisputes();
		await client.ranked.adminValidateLobby(77, { scoreTeam1: 3, scoreTeam2: 1 });
		await client.ranked.adminTelemetry({ lobbyId: 77, limit: 10 });
		await client.ranked.adminUpdateSeason("s1", { name: "Saison 1" });
		await client.ranked.adminResetLadder("s1");

		expect(calls.map(path)).toEqual([
			"/ranked/me?mode=2",
			"/ranked/tiers",
			"/ranked/leaderboard?mode=4&page=1&pageSize=50",
			"/ranked/challenge",
			"/ranked/challenge/ab%20cd",
			"/ranked/challenge/ABCD/accept",
			"/ranked/challenge/ABCD",
			"/ranked/77/dispute",
			"/admin/lobbies/disputes",
			"/admin/lobbies/77/validate",
			"/admin/ranked/telemetry?lobbyId=77&limit=10",
			"/admin/seasons/s1",
			"/admin/seasons/s1/reset",
		]);
		expect(calls[6]?.method).toBe("DELETE");
		expect(calls[7]?.body).toBe("data:image/png;base64,AAAA");
		expect(calls[11]?.method).toBe("PATCH");
	});

	test("clans, organisations, casts, licences", async () => {
		const { client, calls } = tracingClient();

		await client.clans.list({ page: 1, state: 2 as never });
		await client.clans.members(3);
		await client.clans.updateMemberLimits({ playerLimit: 20, staffLimit: 5 });
		await client.clans.kickMember("42", "inactif");
		await client.organizations.list({ pagination: 10 });
		await client.organizations.approve(4);
		await client.casts.listEvents({ page: 2, pageSize: 25 });
		await client.casts.swapAttribution("att-1", "42");
		await client.licenses.verify("secret");
		await client.licenses.issue("42");

		expect(calls.map(path)).toEqual([
			"/clans?page=1&state=2",
			"/clans/3/members",
			"/clans/member-limits",
			"/clans/kick/42",
			"/organizations?pagination=10",
			"/organizations/4/approve",
			"/casts/events?page=2&pageSize=25",
			"/casts/attributions/att-1",
			"/licenses/verify/secret",
			"/licenses/issue/42",
		]);
		expect(calls[2]?.method).toBe("PATCH");
		expect(calls[7]?.method).toBe("PATCH");
		expect(client.licenses.pdfUrl("abc")).toBe("https://a.test/api/licenses/abc.pdf");
	});

	test("licence me expose le jeton de vérification propriétaire et accepte un PDF absent", async () => {
		const verificationToken = "a".repeat(64);
		const { client } = tracingClient({
			license: {
				id: "licence-1",
				userId: "user-1",
				licenseNumber: "RG-2026-001",
				issuedAt: "2026-01-01T00:00:00.000Z",
				validUntil: "2027-01-01T00:00:00.000Z",
				status: "Active",
				pdfUrl: null,
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
			verificationToken,
		});

		const result = await client.licenses.mine();
		expect(result).toMatchObject({
			ok: true,
			value: { verificationToken, license: { pdfUrl: null } },
		});
	});

	test("sanctions, notes joueur, portefeuille, notifications", async () => {
		const { client, calls } = tracingClient();

		await client.sanctions.list({ userId: "42", type: SanctionType.Ban, active: true });
		await client.sanctions.appeal("s-1", "je conteste");
		await client.playerNotes.list({ tournamentId: 12, resolved: false });
		await client.playerNotes.summary("42");
		await client.playerNotes.remove("n-1");
		await client.wallet.history({ limit: 10, offset: 0 });
		await client.notifications.markAllAsRead();
		await client.notifications.emitToUsers(["42"], "rematch_offer", {}, "chut");

		expect(calls.map(path)).toEqual([
			"/sanctions?userId=42&type=ban&active=true",
			"/sanctions/s-1/appeal",
			"/player-notes?tournamentId=12&resolved=false",
			"/player-notes/summary/42",
			"/player-notes/n-1",
			"/wallet/me/history?limit=10&offset=0",
			"/notifications/read-all",
			"/notifications/emit-to-users",
		]);
		expect(calls[4]?.method).toBe("DELETE");
	});

	test("administration, championnats, statistiques, authentification", async () => {
		const { client, calls } = tracingClient();

		await client.admin.users({ page: 1, pagination: 50, q: "roy" });
		await client.admin.adjustWallet("42", -10, "amende");
		await client.admin.dbRows("clan", { page: 2, limit: 25, sort: "name", order: "desc" });
		await client.admin.dbDeleteRow("clan", { id: 3 });
		await client.admin.dbQuery("SELECT 1");
		await client.admin.metrics();
		await client.leagues.astral("asytral-s1");
		await client.stats.commandsUsage(14);
		await client.auth.me();
		await client.auth.logout();

		expect(calls.map(path)).toEqual([
			"/admin/ops/users?page=1&pagination=50&q=roy",
			"/admin/ops/wallets/42/adjust",
			"/admin/db/tables/clan/rows?page=2&limit=25&sort=name&order=desc",
			"/admin/db/tables/clan/rows",
			"/admin/db/query",
			"/metrics",
			"/leagues/asytral-s1",
			"/stats/commands/usage?numberOfDays=14",
			"/auth/me",
			"/auth/logout",
		]);
		expect(calls[3]?.method).toBe("DELETE");
		expect(calls[3]?.body).toBe(JSON.stringify({ pk: { id: 3 } }));
		expect(client.auth.discordLoginUrl("/ranked")).toBe(
			"https://rosegriffon.fr/login?redirect=%2Franked"
		);
		expect(client.auth.callbackUrl()).toBe("https://rosegriffon.fr/api/auth/callback/discord");
	});
});

describe("schémas de ressource", () => {
	test("les agrégats de guildes acceptent un premium_tier nul avant scan", () => {
		const parsed = achilleaGuildStatsSchema.parse({
			total_guilds: 1,
			total_members: "0",
			last_scan: null,
			by_premium_tier: [{ premium_tier: null, count: 1 }],
			by_channel_type: [],
		});
		expect(parsed.by_premium_tier[0]?.premium_tier).toBeNull();
	});

	test("une saison brute (snake_case) est normalisée vers le DTO du contrat", () => {
		const parsed = rankedAdminSeasonSchema.parse({
			id: "s-1",
			name: "Saison 1",
			state: "Active",
			starts_at: "2026-01-01T00:00:00.000Z",
			ends_at: "2026-06-30T00:00:00.000Z",
			config: null,
			player_count: 128,
		});

		expect(parsed).toEqual({
			id: "s-1",
			name: "Saison 1",
			state: "Active",
			startsAt: "2026-01-01T00:00:00.000Z",
			endsAt: "2026-06-30T00:00:00.000Z",
			config: { kFactor: 32, baseRating: 0, decayRate: 0 },
			playerCount: 128,
		});
	});

	test("le détail d'un tournoi est un triplet, et une relation peut n'être qu'un id", () => {
		const tournament = {
			id: 12,
			name: "Astral Cup",
			description: "",
			type: "TOURNAMENT",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			internalState: "Ongoing",
			startsAt: "2026-02-01T00:00:00.000Z",
			grandFinalAt: "2026-02-02T00:00:00.000Z",
			organization: 7,
			managers: [3],
			participants: [1, 2],
			tournamentType: "single_elimination",
			participantsNumber: 16,
			seedOrdering: "natural",
			matchFormat: "bo3",
			groupStageEnabled: false,
			logo: "",
			affiche: "",
			planning: "",
			ruleset: "",
		};

		const parsed = tournamentDetailSchema.parse([tournament, [], { stage: [] }]);

		expect(parsed[0].organization).toBe(7);
		expect(parsed[0].createdAt).toBeInstanceOf(Date);
		expect(parsed[1]).toEqual([]);
		expect(parsed[2]).toEqual({ stage: [] });
	});

	test("une dérive de contrat sur un tournoi est rejetée, pas levée", async () => {
		const client = createAchilleaClient({
			baseUrl: "https://a.test/api",
			fetch: async () => Response.json([{ id: "douze" }, [], null]),
		});

		const result: AchilleaClientResult<unknown> = await client.tournaments.get(12);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.kind).toBe("invalid_response");
		expect(result.path).toBe("/tournaments/12");
	});
});
